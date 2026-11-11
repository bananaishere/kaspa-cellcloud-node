import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {hash,isDigest,canonicalJson,utf8,verifyMerkleProof} from '../protocol/integrity.js';
import {validateManifest} from '../protocol/manifest.js';
import {CELL,N,K} from '../protocol/codec.js';
import {PROTOCOL,networkId,requirePaymentNetwork} from '../protocol/network.js';
import {accountScript} from '../src/wallet-verifier.js';
import {PeerHeads} from './heads.mjs';
import {updateIntent} from '../lab/lib/payment-intent.mjs';
import {publicUploadPolicy} from '../protocol/upload-admission.js';

export async function atomic(file,value){
 const temp=file+'.'+randomUUID()+'.tmp',handle=await fs.open(temp,'wx',0o600);
 try{await handle.writeFile(value);await handle.sync();}finally{await handle.close();}
 try{await fs.rename(temp,file);}catch(error){await fs.rm(temp,{force:true});throw error;}
 // Directory fsync is supported on Unix; Windows does not expose it here.
 if(process.platform!=='win32'){const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}}
}
export class PeerStore{
 constructor({directory,network='testnet-10',quotaBytes=1024**3,rpc,now=()=>Date.now(),publicUploads}){
  if(!Number.isSafeInteger(quotaBytes)||quotaBytes<CELL*N)throw Error('INVALID_STORAGE_QUOTA');
  Object.assign(this,{directory:path.resolve(directory),network:networkId(network),quotaBytes,rpc,now});this.jobs=new Map();this.manifests=new Map();this.usedBytes=0;this.queue=Promise.resolve();
  this.replicaPeers=[];this.replicaReservedBytes=0;
  this.publicUploads=publicUploadPolicy(publicUploads);if(this.publicUploads.enabled&&this.network!=='testnet-10')throw Error('PUBLIC_UPLOADS_TESTNET_ONLY');
 }
 async init(){
  await fs.mkdir(this.directory,{recursive:true,mode:0o700});
  for(const dir of ['cells','jobs','heads','head-conflicts']){
   await fs.mkdir(this.base(dir),{recursive:true,mode:0o700});
   // A force-killed process can leave an unacknowledged atomic-write temp.
   // Only our exact generated basename is removed, never a committed record.
   for(const entry of await fs.readdir(this.base(dir),{withFileTypes:true}))if(entry.isFile()&&/^[a-f0-9]{64}(?:\.json)?\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$/.test(entry.name))await fs.rm(this.base(dir,entry.name));
  }
  const identityPath=path.join(this.directory,'identity.private.json');
  let identity;try{identity=JSON.parse(await fs.readFile(identityPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;identity={version:1,secret:randomBytes(32).toString('hex')};try{await fs.writeFile(identityPath,JSON.stringify(identity),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;identity=JSON.parse(await fs.readFile(identityPath,'utf8'));}}
  if(identity.version!==1||!isDigest(identity.secret))throw Error('INVALID_NODE_IDENTITY');
  this.secret=hexToBytes(identity.secret);this.publicKey=bytesToHex(ed25519.getPublicKey(this.secret));this.nodeId=hash(hexToBytes(this.publicKey));
  const grantPath=path.join(this.directory,'upload-token.private.json');
  let grant;try{grant=JSON.parse(await fs.readFile(grantPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;grant={version:1,token:randomBytes(32).toString('hex')};try{await fs.writeFile(grantPath,JSON.stringify(grant),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;grant=JSON.parse(await fs.readFile(grantPath,'utf8'));}}
  if(grant.version!==1||!isDigest(grant.token))throw Error('INVALID_UPLOAD_TOKEN');this.tokenHash=hash(grant.token);this.grantPath=grantPath;
  // A restored snapshot may predate a broadcast on the original node. Keep its
  // historical receipts readable, but never grant fresh payment submission.
  try{const recovery=JSON.parse(await fs.readFile(path.join(this.directory,'recovery.private.json'),'utf8'));if(recovery.version!==1||recovery.verificationOnly!==true||!isDigest(recovery.backupId))throw Error('INVALID_RECOVERY_MARKER');this.recoveryReadOnly=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const entry of await fs.readdir(this.base('cells'),{withFileTypes:true})){
   if(!entry.isFile()||!isDigest(entry.name))throw Error('UNEXPECTED_STORAGE_ENTRY');
   const stat=await fs.stat(this.base('cells',entry.name));if(stat.size!==CELL)throw Error('INVALID_STORED_CELL');this.usedBytes+=stat.size;
  }
  for(const entry of await fs.readdir(this.base('jobs'),{withFileTypes:true})){
   if(!entry.isFile()||!entry.name.endsWith('.json')||!isDigest(entry.name.slice(0,-5)))throw Error('UNEXPECTED_JOB_ENTRY');
   const file=this.base('jobs',entry.name),stat=await fs.stat(file);if(stat.size>20*1024**2)throw Error('JOB_SIZE_LIMIT');this.usedBytes+=stat.size;
   const job=JSON.parse(await fs.readFile(file,'utf8'));this.validateJob(job,entry.name.slice(0,-5));this.jobs.set(job.id,job);
  }
  // Recompute reservations after a crash; an acknowledged cell may have reached
  // disk before in-memory progress was updated. No manifest is rewritten per cell.
  const present=new Set((await fs.readdir(this.base('cells'))).filter(isDigest));
  for(const job of this.jobs.values())if(job.state==='STAGED'){const {entries}=this.metadata(job),missing=new Set(entries.flatMap(f=>f.stripes.flatMap(s=>s.digests)).filter(d=>!present.has(d)));job.reservedBytes=missing.size*CELL;}
  this.heads=new PeerHeads(this,atomic);await this.heads.init();
  if(this.usedBytes>this.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');return this;
 }
 base(...parts){return path.join(this.directory,this.network,...parts);}
 serialized(action){const next=this.queue.then(action);this.queue=next.catch(()=>{});return next;}
 auth(token){if(typeof token!=='string'||!isDigest(token)||!timingSafeEqual(Buffer.from(hash(token)),Buffer.from(this.tokenHash)))throw Error('UPLOAD_AUTHORIZATION_REQUIRED');return true;}
 hello(nonce){
  if(!isDigest(nonce))throw Error('INVALID_HELLO_NONCE');
  const body={protocol:PROTOCOL,networkId:this.network,nodeId:this.nodeId,publicKey:this.publicKey,nonce,cellBytes:CELL,data:K,total:N,quotaBytes:this.quotaBytes,usedBytes:this.usedBytes,paymentVerification:Boolean(this.rpc),writesEnabled:!this.recoveryReadOnly&&this.network==='testnet-10'&&Boolean(this.rpc),timestamp:this.now(),replicaChallenge:randomBytes(32).toString('hex'),replicas:this.replicaPeers};
  body.publicUploads=this.publicUploads;
  return {body,signature:bytesToHex(ed25519.sign(utf8(canonicalJson(body)),this.secret))};
 }
 validateJob(job,id){
  if(job?.version!==1||job.networkId!==this.network||job.id!==id||!['STAGED','SIGNED','CONFIRMED'].includes(job.state)||typeof job.name!=='string'||job.name.length>80)throw Error('INVALID_STORED_JOB');
  this.metadata(job);if(accountScript(job.address)!=='000020'+job.manifest.author_pubkey+'ac')throw Error('AUTHOR_WALLET_MISMATCH');
  if(job.update)updateIntent(job.update);
  if(job.state!=='STAGED'&&(!job.plan||!isDigest(job.transactionId)||!isDigest(job.anchor)||typeof job.signedJson!=='string'||!job.expected))throw Error('INVALID_STORED_RECEIPT');
 }
 metadata(job){let cached=this.manifests.get(job.id);if(cached?.manifest!==job.manifest){cached={manifest:job.manifest,...validateManifest(job.manifest,job.id)};this.manifests.set(job.id,cached);}return cached;}
 async save(job){
  this.validateJob(job,job.id);const file=this.base('jobs',job.id+'.json'),serialized=JSON.stringify(job),size=Buffer.byteLength(serialized);if(size>20*1024**2)throw Error('JOB_SIZE_LIMIT');
  let prior=0;try{prior=(await fs.stat(file)).size;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(this.usedBytes+size-prior>this.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
  await atomic(file,serialized);this.usedBytes+=size-prior;this.jobs.set(job.id,job);return job;
 }
 job(id){if(!isDigest(id)||!this.jobs.has(id))throw Error('PUBLICATION_NOT_FOUND');return this.jobs.get(id);}
 async open({manifestText,id,address,name,update},admission){
  if(this.recoveryReadOnly)throw Error('RECOVERY_VERIFICATION_ONLY');
  requirePaymentNetwork(this.network);if(!this.rpc)throw Error('PEER_PAYMENT_RPC_REQUIRED');
  if(typeof manifestText!=='string'||Buffer.byteLength(manifestText)>16*1024**2||hash(manifestText)!==id)throw Error('MANIFEST_HASH_MISMATCH');
  const manifest=JSON.parse(manifestText),summary=validateManifest(manifest,id);
  if(manifest.mode==='vault')throw Error('PEER_VAULT_NOT_SUPPORTED');
  if(accountScript(address)!=='000020'+manifest.author_pubkey+'ac')throw Error('AUTHOR_WALLET_MISMATCH');
  if(!address.startsWith('kaspatest:')||typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>80)throw Error('INVALID_PUBLICATION_REQUEST');
  return this.serialized(async()=>{
   const existing=this.jobs.get(id);if(existing){if(existing.address!==address||existing.name!==name||canonicalJson(existing.update||null)!==canonicalJson(update?updateIntent(update):null))throw Error('PUBLICATION_METADATA_CHANGED');return this.summary(existing);}
   const context=update?this.heads.updateContext(update,manifest.author_pubkey):null;
   if(context){
    if(name!==this.heads.current(context.rootManifestId).name)throw Error('INVALID_HEAD_NAME');
    if([...this.jobs.values()].some(j=>j.update?.rootManifestId===context.rootManifestId&&j.update.revision===context.revision))throw Error('UPDATE_ALREADY_STAGED');
   }
   if(admission){
    const p=this.publicUploads;if(!p.enabled||admission.author_pubkey!==manifest.author_pubkey||admission.address!==address)throw Error('UPLOAD_OWNER_REQUIRED');
    const pending=[...this.jobs.values()].filter(j=>j.publicAdmission&&j.state!=='CONFIRMED');
    if(summary.sizeBytes>p.maxFileBytes)throw Error('PUBLIC_UPLOAD_SIZE_LIMIT');
    if(pending.filter(j=>j.manifest.author_pubkey===admission.author_pubkey).length>=p.maxPendingPerWallet||pending.length>=p.maxPendingTotal)throw Error('PUBLIC_UPLOAD_PENDING_LIMIT');
    const footprint=job=>new Set(this.metadata(job).entries.flatMap(f=>f.stripes.flatMap(s=>s.digests))).size*CELL;
    if(pending.reduce((total,j)=>total+footprint(j),0)+new Set(summary.entries.flatMap(f=>f.stripes.flatMap(s=>s.digests))).size*CELL>p.maxPendingBytes)throw Error('PUBLIC_UPLOAD_PENDING_BYTES_LIMIT');
   }
   if(this.jobs.size>=128)throw Error('STAGED_PUBLICATION_LIMIT');
   const digests=new Set(summary.entries.flatMap(f=>f.stripes.flatMap(s=>s.digests))),missing=[];
   for(const digest of digests){try{await fs.access(this.base('cells',digest));}catch{missing.push(digest);}}
   // This initial private/operator node reserves enough room for all 30 positions.
   // It does not advertise unimplemented partial-distribution guarantees.
   const reserved=[...this.jobs.values()].filter(j=>j.state==='STAGED').reduce((sum,j)=>sum+(j.reservedBytes||0),0);
   if(this.usedBytes+reserved+this.replicaReservedBytes+missing.length*CELL+Buffer.byteLength(manifestText)+512*1024>this.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
   const job={version:1,networkId:this.network,id,name,address,manifest,state:'STAGED',createdAt:this.now(),reservedBytes:missing.length*CELL,...(admission?{publicAdmission:true}:{}),...(context?{update:context}:{})};
   await this.save(job);return this.summary(job);
  });
 }
 summary(job){const summary=this.metadata(job);return {id:job.id,name:job.name,state:job.state,sizeBytes:summary.sizeBytes,merkleRoot:summary.merkleRoot,transactionId:job.transactionId||null,confirmation:job.confirmation||null};}
 stripe(job,fileIndex,stripeIndex){const {entries}=this.metadata(job);if(!Number.isSafeInteger(fileIndex)||!Number.isSafeInteger(stripeIndex)||!entries[fileIndex]?.stripes[stripeIndex])throw Error('INVALID_CELL_POSITION');return entries[fileIndex].stripes[stripeIndex];}
 async put({id,file,stripe,shard,proof},bytes){
  const job=this.job(id),expected=this.stripe(job,file,stripe);
  if(job.state!=='STAGED'||!Number.isInteger(shard)||shard<0||shard>=N||!(bytes instanceof Uint8Array)||bytes.length!==CELL||hash(bytes)!==expected.digests[shard]||proof?.index!==shard||proof?.count!==N||!verifyMerkleProof(expected.digests[shard],proof,expected.root))throw Error('INVALID_CELL_PROOF');
  const digest=expected.digests[shard];
  return this.serialized(async()=>{
   const current=this.job(id);if(current.state!=='STAGED')throw Error('PUBLICATION_NOT_STAGED');
   let replacing=0;try{const prior=await fs.readFile(this.base('cells',digest));if(prior.length===CELL&&hash(prior)===digest)return {stored:true,digest,reused:true};replacing=prior.length;}catch(error){if(error.code!=='ENOENT')throw error;}
   if(this.usedBytes+CELL-replacing>this.quotaBytes)throw Error('STORAGE_QUOTA_EXCEEDED');
   await atomic(this.base('cells',digest),bytes);this.usedBytes+=CELL-replacing;
   this.jobs.set(id,{...current,reservedBytes:Math.max(0,(current.reservedBytes||0)-CELL)});return {stored:true,digest,reused:false};
  });
 }
 async complete(job){
  const {entries}=this.metadata(job);
  for(const entry of entries)for(const stripe of entry.stripes)for(const digest of new Set(stripe.digests)){
   let bytes;try{bytes=await fs.readFile(this.base('cells',digest));}catch{throw Error('UPLOAD_INCOMPLETE');}if(bytes.length!==CELL||hash(bytes)!==digest)throw Error('STORED_CELL_CORRUPTED');
  }
 }
 async review({id,plan,expected}){
  if(this.recoveryReadOnly)throw Error('RECOVERY_VERIFICATION_ONLY');
  const job=this.job(id);if(job.state!=='STAGED')throw Error('EXISTING_PAYMENT_MUST_BE_RESUMED');
  await this.complete(job);
  if(job.update){this.heads.updateContext(job.update,job.manifest.author_pubkey);this.checkUpdateReservation(job);}
  const independentlyExpected=this.rpc.expected({address:job.address,manifestId:id,sizeBytes:this.metadata(job).sizeBytes,update:job.update});
  if(canonicalJson(expected)!==canonicalJson(independentlyExpected))throw Error('PAYMENT_CONTEXT_CHANGED');
  await this.rpc.recheck(plan,independentlyExpected);return {reviewed:true,id};
 }
 async authorize({id,plan,expected,signedJson}){
  requirePaymentNetwork(this.network);const job=this.job(id);
  if(job.state!=='STAGED'){if(hash(signedJson)===hash(job.signedJson))return this.summary(job);throw Error('EXISTING_PAYMENT_MUST_BE_RESUMED');}
  await this.review({id,plan,expected});await this.rpc.validate(plan,expected,signedJson);
  const transaction=this.rpc.sdk.Transaction.deserializeFromSafeJSON(signedJson);let transactionId;try{transaction.finalize();transactionId=transaction.id;}finally{transaction.free();}
  if(transactionId!==plan.transactionId)throw Error('TRANSACTION_ID_CHANGED');
  const anchor=await this.rpc.checkpoint();
  return this.serialized(async()=>{
   const current=this.job(id);if(current.state!=='STAGED'){if(current.transactionId===transactionId)return this.summary(current);throw Error('EXISTING_PAYMENT_MUST_BE_RESUMED');}
   this.checkUpdateReservation(current);
   const next={...current,state:'SIGNED',reservedBytes:0,plan,expected,signedJson,transactionId,anchor,signedAt:this.now()};await this.save(next);return this.summary(next);
  });
 }
 async confirm(id){
  const job=this.job(id);if(job.state==='STAGED')throw Error('SIGNED_PAYMENT_REQUIRED');
  // Always recheck the existing transaction. Never submit or prepare a replacement.
  const confirmation=await this.rpc.acceptance(job.anchor,job.transactionId);
  return this.serialized(async()=>{
   const current=this.job(id),next={...current,confirmation:{...confirmation,checkedAt:this.now()}};
   if(confirmation.accepted&&confirmation.confirmations>=10){await this.complete(current);next.state='CONFIRMED';next.lastConfirmedAt=this.now();}
   else next.state='SIGNED';
   await this.save(next);return this.summary(next);
  });
 }
 async resume(id){
  const job=this.job(id);
  if(job.state==='SIGNED'&&!job.submissionIntentAt&&!this.recoveryReadOnly){
   // Expiry belongs to the review, not the transaction. Recheck the exact saved
   // transaction against fresh UTXOs; never select inputs or ask for a new signature.
   const plan={...job.plan,expiresAt:this.now()+120000};await this.rpc.validate(plan,job.expected,job.signedJson);
   await this.serialized(async()=>{const current=this.job(id);if(current.state==='SIGNED'&&!current.submissionIntentAt)await this.save({...current,plan});});
  }
  const current=this.job(id),chain=this.heads.chains.get(current.update?.rootManifestId||id);
  return {...this.summary(current),recoveryReadOnly:Boolean(this.recoveryReadOnly),manifest:current.manifest,address:current.address,plan:current.plan||null,expected:current.expected||null,signedJson:current.signedJson||null,anchor:current.anchor||null,submissionIntentAt:current.submissionIntentAt||null,...(current.update?{update:current.update,updateChain:this.heads.chain(current.update.rootManifestId).slice(0,current.update.revision-1)}:{}),...(chain?.some(r=>r.body.manifestId===id)?{headChain:chain}:{})};
 }
 async beginSend(id){
  if(this.recoveryReadOnly)throw Error('RECOVERY_VERIFICATION_ONLY');
  const job=this.job(id);if(job.state!=='SIGNED'||job.submissionIntentAt)throw Error('SEND_ALREADY_REQUESTED_RESUME_CONFIRMATION');
  await this.rpc.validate(job.plan,job.expected,job.signedJson);
  return this.serialized(async()=>{const current=this.job(id);if(current.state!=='SIGNED'||current.submissionIntentAt)throw Error('SEND_ALREADY_REQUESTED_RESUME_CONFIRMATION');await this.save({...current,submissionIntentAt:this.now()});return {granted:true,transactionId:current.transactionId};});
 }
 publication(id){const job=this.job(id);if(job.state!=='CONFIRMED')throw Error('PAYMENT_CONFIRMATION_REQUIRED');return {manifest:job.manifest,...this.summary(job)};}
 checkUpdateReservation(job){if(job.update&&[...this.jobs.values()].some(other=>other.id!==job.id&&other.update?.rootManifestId===job.update.rootManifestId&&other.update.revision===job.update.revision&&other.state!=='STAGED'))throw Error('UPDATE_ALREADY_STAGED');}
 async get({id,file,stripe,shard}){
  const job=this.job(id);this.publication(id);const expected=this.stripe(job,file,stripe);
  if(!Number.isInteger(shard)||shard<0||shard>=N)throw Error('INVALID_CELL_POSITION');
  const bytes=await fs.readFile(this.base('cells',expected.digests[shard]));if(bytes.length!==CELL||hash(bytes)!==expected.digests[shard])throw Error('STORED_CELL_CORRUPTED');return bytes;
 }
 close(){this.secret?.fill(0);}
}
