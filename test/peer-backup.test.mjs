import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PeerStore} from '../peer/store.mjs';
import {createPeerBackup,restorePeerBackup} from '../peer/backup.mjs';
import {createBackup} from '../lab/lib/backup.mjs';
import {fixtureRpc,publishFixture,key} from './helpers/replica-fixtures.mjs';
import {sdk} from '../lab/kaspa/payment.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cellcloud-peer-backup-')),accepted=new Set(),ledger=fixtureRpc({read:async()=>[...accepted],accept:async id=>accepted.add(id)}),source=path.join(root,'source'),store=await new PeerStore({directory:source,rpc:ledger.rpc}).init();
 t.after(async()=>{store.close();await ledger.rpc.close();await fs.rm(root,{recursive:true,force:true});});
 return {root,source,store,ledger};
}
test('P2P restore preserves author rollback, identity and exact receipts; stale signed payments can only be checked',async t=>{
 const {root,source,store,ledger}=await fixture(t),first=await publishFixture(store,ledger),second=await publishFixture(store,ledger,{root:first.id,text:'Version 2'});
 const challenge=store.heads.challenge({rootManifestId:first.id,manifestId:first.id,operation:'ROLLBACK'});
 await store.heads.authorize({body:challenge.body,signature:sdk.signMessage({message:challenge.message,privateKey:key})});
 const pending=await publishFixture(store,ledger,{text:'Signed but not submitted',activate:false}),job={...store.job(pending.id),state:'SIGNED'};delete job.submissionIntentAt;delete job.lastConfirmedAt;delete job.confirmation;await store.save(job);
 const originalReceipt=await fs.readFile(store.base('jobs',pending.id+'.json'),'utf8');
 await fs.writeFile(store.base('node.lock'),'1234');
 const backup=path.join(root,'backup'),target=path.join(root,'restored'),manifest=await createPeerBackup(source,backup);
 assert.equal(manifest.files.some(f=>f.path.endsWith('node.lock')),false);
 const report=await restorePeerBackup(backup,target);
 assert.equal(report.nodeId,store.nodeId);assert.equal(report.pending,1);assert.equal(report.receipts,3);assert.equal(report.files,3);assert.equal(report.blockchainConnections,0);
 assert.equal(report.histories[0].revision,3);assert.equal(report.histories[0].operation,'ROLLBACK');assert.equal(report.histories[0].manifestId,first.id);
 assert.equal(await fs.readFile(path.join(target,'testnet-10/jobs',pending.id+'.json'),'utf8'),originalReceipt);
 assert.equal(await fs.readFile(path.join(target,'upload-token.private.json'),'utf8'),await fs.readFile(path.join(source,'upload-token.private.json'),'utf8'));
 const restored=await new PeerStore({directory:target,rpc:ledger.rpc}).init();
 try{
  const reads=ledger.state.reads,expiry=restored.job(pending.id).plan.expiresAt;
  assert.equal((await restored.resume(pending.id)).recoveryReadOnly,true);assert.equal(ledger.state.reads,reads);assert.equal(restored.job(pending.id).plan.expiresAt,expiry);
  await assert.rejects(()=>restored.beginSend(pending.id),/RECOVERY_VERIFICATION_ONLY/);
  await assert.rejects(()=>restored.open({}),/RECOVERY_VERIFICATION_ONLY/);
  assert.equal((await restored.confirm(pending.id)).state,'CONFIRMED');assert.equal(ledger.state.submissions,0);
  assert.equal(restored.heads.current(first.id).manifestId,first.id);assert.notEqual(second.id,first.id);
 }finally{restored.close();}
 await assert.rejects(()=>restorePeerBackup(backup,target),/EEXIST/);
 assert.equal(await fs.readFile(store.base('jobs',pending.id+'.json'),'utf8'),originalReceipt);
});
test('rehashed backup cannot hide a forged transaction signature',async t=>{
 const {root,source,store,ledger}=await fixture(t),publication=await publishFixture(store,ledger,{activate:false}),job=store.job(publication.id),signed=JSON.parse(job.signedJson);
 signed.inputs[0].signatureScript='41'+'00'.repeat(65);await store.save({...job,signedJson:JSON.stringify(signed)});
 const backup=path.join(root,'forged');await createPeerBackup(source,backup);
 await assert.rejects(()=>restorePeerBackup(backup,path.join(root,'rejected')));
});
test('corrupt cells and missing identity fail restore instead of generating a replacement node key',async t=>{
 const {root,source,store,ledger}=await fixture(t);await publishFixture(store,ledger);
 const backup=path.join(root,'backup');await createPeerBackup(source,backup);
 const [cell]=await fs.readdir(store.base('cells'));await fs.writeFile(path.join(backup,'data/testnet-10/cells',cell),new Uint8Array(128*1024));
 await assert.rejects(()=>restorePeerBackup(backup,path.join(root,'bad-cell')),/CONTENT_MISMATCH/);
 await fs.rm(path.join(source,'identity.private.json'));
 const noKey=path.join(root,'missing-key');await createBackup(source,noKey);
 await assert.rejects(()=>restorePeerBackup(noKey,path.join(root,'bad-key')),/IDENTITY_REQUIRED/);
 await assert.rejects(()=>fs.access(path.join(root,'bad-key')));
});
