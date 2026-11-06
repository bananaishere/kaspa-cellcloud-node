import fs from 'node:fs/promises';
import {atomic} from './store.mjs';
import {canonicalJson,hash,isDigest,merkleProof,verifyMerkleProof} from '../protocol/integrity.js';
import {validateManifest} from '../protocol/manifest.js';
import {verifyHeadChain} from '../protocol/heads.js';
import {requirePaymentNetwork} from '../protocol/network.js';
import {CELL} from '../protocol/codec.js';
import {updateIntent} from '../lab/lib/payment-intent.mjs';
import {accountScript,verifyPaymentReview} from '../src/wallet-verifier.js';
import {signStorageReceipt} from '../protocol/storage-receipt.js';

export class ReplicaData{
 constructor(store){this.store=store;this.diskChecks=new Map();}
 async receipt({manifestId,nonce}){
  if(!isDigest(nonce))throw Error('INVALID_STORAGE_RECEIPT');
  const s=this.store,job=s.job(manifestId);s.publication(manifestId);
  let checkedAt=this.diskChecks.get(manifestId)||0;
  if(s.now()-checkedAt>=30000){await s.complete(job);checkedAt=s.now();this.diskChecks.set(manifestId,checkedAt);}
  return signStorageReceipt(s,{manifestId,transactionId:job.transactionId,merkleRoot:s.metadata(job).merkleRoot,checkedAt,nonce});
 }
 inventory(){const roots=new Set([...this.store.heads.chains.keys(),...this.store.heads.conflicts.keys()]);return {version:1,networkId:this.store.network,publications:[...this.store.jobs.values()].filter(j=>j.state==='CONFIRMED').map(j=>({id:j.id,transactionId:j.transactionId})),heads:[...roots].map(root=>{const records=this.store.heads.chains.get(root)||this.store.heads.conflicts.get(root).left;return {root,revision:records.length,proof:verifyHeadChain(records).proof,conflict:this.store.heads.conflicts.has(root)};})};}
 record(id){
  const s=this.store,j=s.job(id);s.publication(id);
  return {version:1,networkId:s.network,id:j.id,name:j.name,address:j.address,manifest:j.manifest,plan:j.plan,signedJson:j.signedJson,transactionId:j.transactionId,anchor:j.anchor,...(j.update?{update:j.update,updateChain:s.heads.chain(j.update.rootManifestId).slice(0,j.update.revision-1)}:{})};
 }
 validate(record){
  const s=this.store;requirePaymentNetwork(s.network);
  if(!record||record.version!==1||record.networkId!==s.network||!isDigest(record.id)||!isDigest(record.transactionId)||!isDigest(record.anchor)||typeof record.name!=='string'||!record.name.trim()||record.name!==record.name.trim()||record.name.length>80)throw Error('INVALID_REPLICA_RECORD');
  const meta=validateManifest(record.manifest,record.id);
  if(record.manifest.mode==='vault')throw Error('PEER_VAULT_NOT_SUPPORTED');
  if(!record.address?.startsWith('kaspatest:')||accountScript(record.address)!=='000020'+record.manifest.author_pubkey+'ac')throw Error('AUTHOR_WALLET_MISMATCH');
  let update;
  if(record.update){
   update=updateIntent(record.update);const prior=verifyHeadChain(record.updateChain,{rootManifestId:update.rootManifestId,author:record.manifest.author_pubkey});
   if(prior.revision+1!==update.revision||prior.manifestId!==update.previousManifestId||prior.name!==record.name||update.author_pubkey!==record.manifest.author_pubkey)throw Error('UPDATE_CONTEXT_CHANGED');
   s.heads.compare(record.updateChain);
   for(const item of record.updateChain)s.heads.bind(item.body);
  }
  const expected=s.rpc.expected({address:record.address,manifestId:record.id,sizeBytes:meta.sizeBytes,update});
  verifyPaymentReview({...record.plan,expiresAt:s.now()+120000},expected,{now:s.now()});
  if(hash(record.plan.unsignedJson)!==record.plan.unsignedSha256)throw Error('PLAN_CHANGED');
  s.rpc.engine.validateSignedPaymentSignatures(record.plan,record.signedJson);
  const tx=s.rpc.sdk.Transaction.deserializeFromSafeJSON(record.signedJson);let id;try{tx.finalize();id=tx.id;}finally{tx.free();}
  if(id!==record.transactionId||id!==record.plan.transactionId)throw Error('TRANSACTION_ID_CHANGED');
  // Deliberately whitelist fields. Grants, node secrets and unsubmitted
  // signatures never travel in this confirmed-publication protocol.
  const normalized={version:1,networkId:s.network,id:record.id,name:record.name,address:record.address,manifest:record.manifest,plan:record.plan,signedJson:record.signedJson,transactionId:id,anchor:record.anchor,expected,...(update?{update}:{})};
  return {normalized,meta};
 }
 async receive(record,read){
  const s=this.store,{normalized,meta}=this.validate(record),existing=s.jobs.get(record.id);
  if(existing&&(existing.name!==record.name||existing.address!==record.address||canonicalJson(existing.update||null)!==canonicalJson(normalized.update||null)||existing.transactionId&&existing.transactionId!==record.transactionId))throw Error('REPLICA_RECEIPT_CONFLICT');
  const known=existing?.state==='CONFIRMED'&&existing.lastConfirmedAt&&existing.transactionId===record.transactionId;
  // Repair of an already locally verified receipt preserves its observed
  // confirmation timestamp. A new import must pass this node's OWN RPC.
  const confirmation=known?existing.confirmation:await s.rpc.verifySettled(normalized,normalized.expected);
  const positions=new Map();meta.entries.forEach((f,file)=>f.stripes.forEach((stripe,index)=>stripe.digests.forEach((digest,shard)=>{if(!positions.has(digest))positions.set(digest,{id:record.id,file,stripe:index,shard,proof:merkleProof(stripe.digests,shard),root:stripe.root});})));
  let reserved=0,cells=0;
  await s.serialized(async()=>{
   if(!existing&&s.jobs.size>=128)throw Error('STAGED_PUBLICATION_LIMIT');
   let missing=0;for(const [digest] of positions){try{const bytes=await fs.readFile(s.base('cells',digest));if(bytes.length===CELL&&hash(bytes)===digest)continue;}catch{}missing++;}
   const uploads=[...s.jobs.values()].filter(j=>j.state==='STAGED').reduce((sum,j)=>sum+(j.reservedBytes||0),0);
   reserved=missing*CELL+Buffer.byteLength(JSON.stringify(normalized))+16384;
   if(s.usedBytes+s.replicaReservedBytes+uploads+reserved>s.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');s.replicaReservedBytes+=reserved;
  });
  try{
   for(const [digest,position] of positions){
    try{const bytes=await fs.readFile(s.base('cells',digest));if(bytes.length===CELL&&hash(bytes)===digest)continue;}catch{}
    const bytes=await read(position);
    if(!(bytes instanceof Uint8Array)||bytes.length!==CELL||hash(bytes)!==digest||!verifyMerkleProof(digest,position.proof,position.root))throw Error('INVALID_CELL_PROOF');
    await s.serialized(async()=>{
     let replacing=0;try{const prior=await fs.readFile(s.base('cells',digest));if(prior.length===CELL&&hash(prior)===digest)return;replacing=prior.length;}catch(error){if(error.code!=='ENOENT')throw error;}
     if(s.usedBytes+CELL-replacing>s.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
     await atomic(s.base('cells',digest),bytes);s.usedBytes+=CELL-replacing;const consumed=Math.min(CELL,reserved);reserved-=consumed;s.replicaReservedBytes-=consumed;cells++;
    });
   }
   await s.serialized(async()=>{
    const current=s.jobs.get(record.id);
    if(current&&(current.name!==record.name||current.address!==record.address||canonicalJson(current.update||null)!==canonicalJson(normalized.update||null)))throw Error('REPLICA_RECEIPT_CONFLICT');
    if(current?.transactionId&&current.transactionId!==record.transactionId)throw Error('REPLICA_RECEIPT_CONFLICT');
    if(current?.state==='CONFIRMED')return;
    const job={...normalized,state:'CONFIRMED',reservedBytes:0,createdAt:current?.createdAt||s.now(),signedAt:current?.signedAt||s.now(),submissionIntentAt:current?.submissionIntentAt||s.now(),confirmation:{...confirmation,checkedAt:s.now()},lastConfirmedAt:s.now(),replicated:true};
    await s.complete(job);await s.save(job);
   });
   return {id:record.id,cells,imported:!known};
  }finally{await s.serialized(async()=>{s.replicaReservedBytes=Math.max(0,s.replicaReservedBytes-reserved);});}
 }
}
