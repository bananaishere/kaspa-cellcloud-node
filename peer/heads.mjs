import fs from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {appIdFor,headMessage,proofHash,verifyHeadChain,headRelation,verifyHeadFork} from '../protocol/heads.js';
import {canonicalJson,isDigest} from '../protocol/integrity.js';
import {updateIntent} from '../lab/lib/payment-intent.mjs';

export class PeerHeads{
 constructor(store,atomic){this.store=store;this.atomic=atomic;this.chains=new Map();this.conflicts=new Map();}
 async init(){
  await fs.mkdir(this.store.base('heads'),{recursive:true,mode:0o700});
  for(const name of await fs.readdir(this.store.base('heads'))){
   if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('INVALID_HEAD_STORAGE');
   const file=this.store.base('heads',name),stat=await fs.stat(file);if(stat.size>512*1024)throw Error('HEAD_HISTORY_LIMIT');
   const records=JSON.parse(await fs.readFile(file,'utf8')),root=name.slice(0,-5);verifyHeadChain(records,{rootManifestId:root});
   for(const record of records)this.bind(record.body,{historical:true});
   this.chains.set(root,records);this.store.usedBytes+=stat.size;
  }
  await fs.mkdir(this.store.base('head-conflicts'),{recursive:true,mode:0o700});
  for(const name of await fs.readdir(this.store.base('head-conflicts'))){
   if(!/^[a-f0-9]{64}\.json$/.test(name))throw Error('INVALID_HEAD_STORAGE');
   const file=this.store.base('head-conflicts',name),stat=await fs.stat(file);if(stat.size>1024*1024)throw Error('HEAD_HISTORY_LIMIT');
   const value=JSON.parse(await fs.readFile(file,'utf8')),root=name.slice(0,-5);verifyHeadFork(value,{rootManifestId:root});const first=value.left[0].body,job=this.store.job(root);
   if(!job.lastConfirmedAt||job.manifest.author_pubkey!==first.author_pubkey||this.store.metadata(job).merkleRoot!==first.originalMerkleRoot||job.transactionId!==first.transactionId)throw Error('INVALID_HEAD_CONFLICT_PROOF');
   this.conflicts.set(root,value);this.store.usedBytes+=stat.size;
  }
 }
 chain(root){if(!isDigest(root)||!this.chains.has(root))throw Error('HEAD_NOT_FOUND');return this.chains.get(root);}
 current(root){if(this.conflicts.has(root))throw Error('HEAD_SEQUENCE_CONFLICT');return verifyHeadChain(this.chain(root),{rootManifestId:root});}
 compare(records){const head=verifyHeadChain(records),local=this.chains.get(head.rootManifestId);if(local&&local[0].body.author_pubkey!==head.author_pubkey)throw Error('ORIGINAL_AUTHOR_REQUIRED');if(this.conflicts.has(head.rootManifestId)||local&&headRelation(local,records)==='conflict')throw Error('HEAD_SEQUENCE_CONFLICT');return local?headRelation(local,records):'ahead';}
 async conflict(root,left,right){
  const value={left,right};verifyHeadFork(value,{rootManifestId:root});if(this.conflicts.has(root))return;
  this.conflicts.set(root,value);const data=JSON.stringify(value);
  if(this.store.usedBytes+Buffer.byteLength(data)>this.store.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
  await this.atomic(this.store.base('head-conflicts',root+'.json'),data);this.store.usedBytes+=Buffer.byteLength(data);
 }
 async checkRemote(records){return this.store.serialized(async()=>{
  const remote=verifyHeadChain(records),local=this.chains.get(remote.rootManifestId);
  if(local&&local[0].body.author_pubkey!==remote.author_pubkey)throw Error('ORIGINAL_AUTHOR_REQUIRED');
  if(local&&headRelation(local,records)==='conflict')await this.conflict(remote.rootManifestId,local,records);
  return this.compare(records);
 });}
 async acceptConflict(value){
  verifyHeadFork(value);const first=value.left[0].body,job=this.store.job(first.rootManifestId),meta=this.store.metadata(job);
  if(job.state!=='CONFIRMED'||job.manifest.author_pubkey!==first.author_pubkey||meta.merkleRoot!==first.originalMerkleRoot||job.transactionId!==first.transactionId)throw Error('ORIGINAL_AUTHOR_REQUIRED');
  return this.store.serialized(()=>this.conflict(first.rootManifestId,value.left,value.right));
 }
 async reconcile(records){return this.store.serialized(async()=>{
  const head=verifyHeadChain(records),root=head.rootManifestId,local=this.chains.get(root);
  if(local&&local[0].body.author_pubkey!==head.author_pubkey)throw Error('ORIGINAL_AUTHOR_REQUIRED');
  if(local&&headRelation(local,records)==='conflict')await this.conflict(root,local,records);
  const relation=this.compare(records);if(relation!=='ahead')return {changed:false,relation};
  if(!local&&this.chains.size>=128)throw Error('HEAD_HISTORY_LIMIT');
  if(head.issuedAt>this.store.now()+1000)throw Error('INVALID_HEAD_TIME');
  // Old accepted proofs retain their signed history; expiry only limits a NEW
  // wallet approval at ingestion. Every referenced receipt was independently
  // checked and all cells must exist before publishing the imported head.
  for(const record of records){const job=this.bind(record.body);await this.store.complete(job);}
  const data=JSON.stringify(records),prior=local?Buffer.byteLength(JSON.stringify(local)):0;
  if(this.store.usedBytes+Buffer.byteLength(data)-prior>this.store.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
  await this.atomic(this.store.base('heads',root+'.json'),data);this.store.usedBytes+=Buffer.byteLength(data)-prior;this.chains.set(root,records);return {changed:true,relation};
 });}
 replicationState(root){const conflict=this.conflicts.get(root),records=this.chains.get(root)||conflict?.left;if(!records)throw Error('HEAD_NOT_FOUND');return {records,...(conflict?{conflict}:{})};}
 bind(body,{historical=false}={}){
  const job=this.store.job(body.manifestId),meta=this.store.metadata(job);
  if((historical?!job.lastConfirmedAt:job.state!=='CONFIRMED')||job.manifest.author_pubkey!==body.author_pubkey||meta.merkleRoot!==body.merkleRoot||job.transactionId!==body.transactionId||job.name!==body.name)throw Error('HEAD_CONFIRMED_PAYMENT_REQUIRED');
  if(body.operation==='ROLLBACK'){
   if(job.plan.billing.operation!==(job.update?'UPDATE':'PUBLISH'))throw Error('HEAD_CONFIRMED_PAYMENT_REQUIRED');
  }else if(body.operation==='UPDATE'){
   const expected=updateIntent(body),actual=job.update;
   if(!actual||canonicalJson(expected)!==canonicalJson(actual)||job.plan.billing.operation!=='UPDATE')throw Error('UPDATE_PAYMENT_REQUIRED');
  }else if(job.update||job.plan.billing.operation!=='PUBLISH')throw Error('ORIGINAL_PAYMENT_REQUIRED');
  return job;
 }
 updateContext(value,author){
  const intent=updateIntent(value),head=this.current(intent.rootManifestId);
  if(head.author_pubkey!==author||intent.author_pubkey!==author)throw Error('ORIGINAL_AUTHOR_REQUIRED');
  if(head.revision>=128)throw Error('HEAD_HISTORY_LIMIT');
  if(intent.previousManifestId!==head.manifestId||intent.revision!==head.revision+1)throw Error('VERSION_CONSISTENCY_ERROR');
  this.store.publication(intent.rootManifestId);return intent;
 }
 rollbackTarget(root,manifestId){
  const head=this.current(root),entry=this.chain(root).find(r=>r.body.manifestId===manifestId);
  if(!entry||head.manifestId===manifestId)throw Error('ROLLBACK_TARGET_NOT_IN_HISTORY');
  if(head.revision>=128)throw Error('HEAD_HISTORY_LIMIT');
  if([...this.store.jobs.values()].some(j=>j.update?.rootManifestId===root&&j.update.revision===head.revision+1))throw Error('UPDATE_ALREADY_STAGED');
  this.bind(entry.body);return entry;
 }
 challenge({manifestId,rootManifestId,operation}){
  const job=this.store.job(manifestId),prior=rootManifestId?this.current(rootManifestId):null;
  const rollback=operation==='ROLLBACK';if(operation&&operation!=='ROLLBACK')throw Error('INVALID_HEAD_SEQUENCE');
  if(rollback){if(!prior)throw Error('ROLLBACK_TARGET_NOT_IN_HISTORY');this.rollbackTarget(rootManifestId,manifestId);}
  else if(prior&&(!job.update||job.update.rootManifestId!==rootManifestId))throw Error('UPDATE_PAYMENT_REQUIRED');
  if(!prior&&(job.update||this.chains.has(manifestId)))throw Error('HEAD_ALREADY_EXISTS');
  const now=this.store.now(),body={protocol:'cellcloud-peer-head',version:1,networkId:this.store.network,operation:rollback?'ROLLBACK':prior?'UPDATE':'CREATE',appId:prior?.appId||appIdFor(manifestId),name:prior?.name||job.name,rootManifestId:prior?.rootManifestId||manifestId,originalMerkleRoot:prior?.originalMerkleRoot||this.store.metadata(job).merkleRoot,previousManifestId:prior?.manifestId||null,previousProof:prior?.proof||null,manifestId,merkleRoot:this.store.metadata(job).merkleRoot,author_pubkey:job.manifest.author_pubkey,revision:prior?prior.revision+1:1,transactionId:job.transactionId,issuedAt:now,expiresAt:now+120000,nonce:randomBytes(32).toString('hex')};
  this.bind(body);if(prior&&!rollback)this.updateContext(job.update,body.author_pubkey);return {body,message:headMessage(body)};
 }
 authorize(record){return this.store.serialized(async()=>{
  const b=record?.body;if(!b||!isDigest(b.rootManifestId))throw Error('INVALID_HEAD_RECORD');
  const existing=this.chains.get(b.rootManifestId)||[];
  if(existing.some(item=>proofHash(item)===proofHash(record)))return this.resolve(b.rootManifestId);
  if(existing.length===0&&this.chains.size>=128)throw Error('HEAD_HISTORY_LIMIT');
  const next=[...existing,record],head=verifyHeadChain(next,{rootManifestId:b.rootManifestId});
  if(b.issuedAt>this.store.now()+1000||b.expiresAt<=this.store.now())throw Error('HEAD_REVIEW_EXPIRED');
  this.bind(b);if(b.operation==='UPDATE')this.updateContext(this.store.job(b.manifestId).update,b.author_pubkey);
  if(b.operation==='ROLLBACK'){this.rollbackTarget(b.rootManifestId,b.manifestId);await this.store.complete(this.store.job(b.manifestId));}
  const file=this.store.base('heads',b.rootManifestId+'.json'),serialized=JSON.stringify(next),priorBytes=existing.length?Buffer.byteLength(JSON.stringify(existing)):0;
  if(this.store.usedBytes+Buffer.byteLength(serialized)-priorBytes>this.store.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
  await this.atomic(file,serialized);this.store.usedBytes+=Buffer.byteLength(serialized)-priorBytes;this.chains.set(head.rootManifestId,next);return this.resolve(head.rootManifestId);
 });}
 resolve(root){if(this.conflicts.has(root))return {conflict:this.conflicts.get(root)};const records=this.chain(root),head=this.current(root);this.bind(head);return {records,publication:this.store.publication(head.manifestId)};}
}
