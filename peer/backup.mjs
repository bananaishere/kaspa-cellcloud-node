import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ed25519} from '@noble/curves/ed25519.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {createBackup,verifyBackup,restoreBackup} from '../lab/lib/backup.mjs';
import {PeerStore} from './store.mjs';
import {hash,canonicalJson,isDigest} from '../protocol/integrity.js';
import {CELL} from '../protocol/codec.js';
import {reconstructStripe} from '../protocol/manifest.js';
import {verifyHeadChain} from '../protocol/heads.js';
import {DirectKaspaClient} from '../protocol/kaspa-client.js';
import {sdk} from '../lab/kaspa/payment.mjs';
import {verifyPaymentReview} from '../src/wallet-verifier.js';

const network='testnet-10';
function layout(manifest){
 const names=new Set(manifest.files.map(f=>f.path));
 if(!names.has('identity.private.json')||!names.has('upload-token.private.json'))throw Error('PEER_BACKUP_IDENTITY_REQUIRED');
 const allowed=/^testnet-10\/(?:cells\/[a-f0-9]{64}|(?:jobs|heads|head-conflicts)\/[a-f0-9]{64}\.json)$/;
 for(const name of names)if(!['identity.private.json','upload-token.private.json','recovery.private.json'].includes(name)&&!allowed.test(name))throw Error('UNEXPECTED_PEER_BACKUP_ENTRY');
}
export async function createPeerBackup(source,destination){
 const manifest=await createBackup(source,destination,{exclude:[network+'/node.lock']});
 layout(manifest);return manifest;
}

// This operation never opens an RPC socket, selects UTXOs or submits a payment.
// It checks the saved signatures and historical observations, not current L1 state.
export async function inspectPeerRestore(directory){
 const root=path.resolve(directory),recovery=JSON.parse(await fs.readFile(path.join(root,'recovery.private.json'),'utf8'));
 if(recovery.version!==1||recovery.verificationOnly!==true||!isDigest(recovery.backupId))throw Error('RECOVERY_GUARD_REQUIRED');
 const identity=JSON.parse(await fs.readFile(path.join(root,'identity.private.json'),'utf8')),grant=JSON.parse(await fs.readFile(path.join(root,'upload-token.private.json'),'utf8'));
 if(identity.version!==1||!isDigest(identity.secret)||grant.version!==1||!isDigest(grant.token))throw Error('INVALID_BACKUP_IDENTITY');
 const expectedNodeId=hash(ed25519.getPublicKey(hexToBytes(identity.secret)));
 const rpc=new DirectKaspaClient({sdk,network,factory:()=>{throw Error('BACKUP_MUST_NEVER_CONNECT_RPC');}});
 const store=await new PeerStore({directory:root,network,quotaBytes:8*1024**3,rpc}).init();
 try{
  if(store.nodeId!==expectedNodeId||!store.recoveryReadOnly)throw Error('RECOVERY_GUARD_REQUIRED');
  let cells=0,files=0,receipts=0,pending=0,staged=0;const histories=[];
  for(const digest of await fs.readdir(store.base('cells'))){const bytes=await fs.readFile(store.base('cells',digest));if(bytes.length!==CELL||hash(bytes)!==digest)throw Error('STORED_CELL_CORRUPTED');cells++;}
  for(const job of store.jobs.values()){
   if(job.state==='STAGED'){staged++;continue;}
   const meta=store.metadata(job),expected=rpc.expected({address:job.address,manifestId:job.id,sizeBytes:meta.sizeBytes,update:job.update});
   if(canonicalJson(expected)!==canonicalJson(job.expected))throw Error('PAYMENT_CONTEXT_CHANGED');
   verifyPaymentReview({...job.plan,expiresAt:Date.now()+120000},expected);
   if(hash(job.plan.unsignedJson)!==job.plan.unsignedSha256)throw Error('PLAN_CHANGED');
   rpc.engine.validateSignedPaymentSignatures(job.plan,job.signedJson);
   const tx=sdk.Transaction.deserializeFromSafeJSON(job.signedJson);try{tx.finalize();if(tx.id!==job.transactionId||tx.id!==job.plan.transactionId)throw Error('TRANSACTION_ID_CHANGED');}finally{tx.free();}
   if(job.update){const chain=store.heads.chain(job.update.rootManifestId).slice(0,job.update.revision-1),prior=verifyHeadChain(chain,{author:job.manifest.author_pubkey,rootManifestId:job.update.rootManifestId});if(prior.revision+1!==job.update.revision||prior.manifestId!==job.update.previousManifestId||prior.name!==job.name)throw Error('UPDATE_CONTEXT_CHANGED');}
   receipts++;if(job.state==='SIGNED')pending++;
   await store.complete(job);
   for(const entry of meta.entries){
    const digest=createHash('sha256');let length=0;
    for(const stripe of entry.stripes){const shards=[];for(let index=20;index<30;index++)shards.push({index,data:await fs.readFile(store.base('cells',stripe.digests[index]))});const bytes=reconstructStripe(stripe,shards);digest.update(bytes);length+=bytes.length;}
    if(length!==entry.length||digest.digest('hex')!==entry.sha256)throw Error('RESTORED_FILE_MISMATCH');files++;
   }
  }
  for(const [root,records] of store.heads.chains){const head=verifyHeadChain(records);histories.push({root,revision:head.revision,manifestId:head.manifestId,author:head.author_pubkey,operation:head.operation,conflict:store.heads.conflicts.has(root)});}
  return {nodeId:store.nodeId,network,cells,files,receipts,pending,staged,histories,conflicts:store.heads.conflicts.size,identityPreserved:true,reconstruction:'10 parity positions (20–29)',paymentSubmissionEnabled:false,blockchainConnections:0,currentNetworkConfirmationChecked:false};
 }finally{store.close();await rpc.close();}
}
export async function restorePeerBackup(source,destination){
 const manifest=await verifyBackup(source);layout(manifest);
 await restoreBackup(source,destination);
 // Written before opening the restored store. All pending transaction IDs,
 // signatures and real submission intents remain byte-for-byte untouched.
 await fs.writeFile(path.join(destination,'recovery.private.json'),JSON.stringify({version:1,verificationOnly:true,backupId:manifest.id,restoredAt:new Date().toISOString()}),{mode:0o600});
 const report=await inspectPeerRestore(destination);return {backupId:manifest.id,restoredInto:path.resolve(destination),...report};
}
