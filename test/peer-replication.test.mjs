import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {PeerStore} from '../peer/store.mjs';
import {startPeerServer} from '../peer/server.mjs';
import {PeerReplicator} from '../peer/replication.mjs';
import {ReplicaData} from '../peer/replica-data.mjs';
import {PeerClient} from '../src/peer-client.js';
import {replicaPeers,signReplicaAuth,verifyReplicaAuth,REPLICA_ORIGIN,publicationPeers} from '../protocol/replicas.js';
import {verifyHeadFork,verifyHeadChain,headMessage,proofHash,expectedHead} from '../protocol/heads.js';
import {verifyResolvedHead} from '../viewer/heads.js';
import {hash} from '../protocol/integrity.js';
import {fixtureRpc,publishFixture,author,key,address} from './helpers/replica-fixtures.mjs';
import {sdk as k} from '../lab/kaspa/payment.mjs';
import {verifyStorageReceipt} from '../protocol/storage-receipt.js';
import {publicationCopies} from '../src/peer-replica-status.js';
import {verifyRecoveredReceipt} from '../src/peer-recovery.js';

async function pair(t,{shared=true,quota=64*1024**2}={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cellcloud-replicas-')),acceptedA=new Set(),acceptedB=shared?acceptedA:new Set(),nodes=[];
 for(const [index,accepted] of [acceptedA,acceptedB].entries()){
  const ledger=fixtureRpc({read:async()=>[...accepted],accept:async id=>accepted.add(id)}),store=await new PeerStore({directory:path.join(directory,String(index)),rpc:ledger.rpc,quotaBytes:quota}).init(),server=await startPeerServer({store,origins:['http://127.0.0.1:5191'],viewerOrigins:['http://{site}.viewer.localhost:5192']});
  nodes.push({ledger,store,server,url:'ws://127.0.0.1:'+server.port+'/peer',accepted});
 }
 const [a,b]=nodes;
 for(const [node,other] of [[a,b],[b,a]])node.sync=new PeerReplicator({store:node.store,peers:[{url:other.url,nodeId:other.store.nodeId}],timeoutMs:2000,intervalMs:500,repairIntervalMs:500});
 t.after(async()=>{for(const node of nodes){await node.sync.close();await node.server.close();await node.ledger.rpc.close();}await fs.rm(directory,{recursive:true,force:true});});return {a,b,directory};
}
const reader=(node,origin='http://127.0.0.1:5191')=>new PeerClient({url:node.url,pin:node.store.nodeId,timeoutMs:2000,socketFactory:url=>new WebSocket(url,{headers:{Origin:origin}})});

test('replica authentication is mutual, nonce-bound and distinct from upload grants; only confirmed public receipts are exported',async t=>{
 const {a,b}=await pair(t),client=reader(a,REPLICA_ORIGIN);t.after(()=>client.close());await client.connect();
 await assert.rejects(()=>client.request('replicaInventory'),/REPLICA_AUTH/);
 const token=JSON.parse(await fs.readFile(a.store.grantPath,'utf8')).token;await assert.rejects(()=>client.request('auth',{token}),/REPLICA_AUTH/);
 const auth=signReplicaAuth(b.store,client.hello);await client.request('replicaAuth',auth);assert.deepEqual((await client.request('replicaInventory')).publications,[]);
 assert.throws(()=>verifyReplicaAuth({...a.store,network:'mainnet'},auth,client.hello.replicaChallenge),/REPLICA_AUTH/);
 assert.throws(()=>verifyReplicaAuth({...a.store,nodeId:'ef'.repeat(32)},auth,client.hello.replicaChallenge),/REPLICA_AUTH/);
 await assert.rejects(()=>client.request('beginSend',{manifestId:'aa'.repeat(32)}),/REPLICA_READ_ONLY/);
 const replay=reader(a,REPLICA_ORIGIN);t.after(()=>replay.close());await replay.connect();await assert.rejects(()=>replay.request('replicaAuth',auth),/REPLICA_AUTH/);
 const publicReader=reader(a);t.after(()=>publicReader.close());await publicReader.connect();await assert.rejects(()=>publicReader.request('replicaInventory'),/AUTHORIZATION/);await assert.rejects(()=>publicReader.request('replicaAuth',signReplicaAuth(b.store,publicReader.hello)),/AUTHORIZATION/);
 const p=await publishFixture(a.store,a.ledger,{activate:false});const exported=await client.request('replicaRecord',{manifestId:p.id});assert.equal(exported.transactionId,p.transactionId);assert.equal(exported.networkId,'testnet-10');assert.equal(exported.token,undefined);assert.equal(exported.secret,undefined);
 const original=a.store.job(p.id);await a.store.save({...original,state:'SIGNED'});await assert.rejects(()=>client.request('replicaRecord',{manifestId:p.id}),/CONFIRMATION/);assert.equal((await client.request('replicaInventory')).publications.length,0);await a.store.save(original);
});

test('replication independently verifies settled payments, catches up signed history, repairs damaged cells and never submits or reselects UTXOs',async t=>{
 const {a,b}=await pair(t,{shared:false}),v1=await publishFixture(a.store,a.ledger,{text:'Version one'});
 const readCount=b.ledger.state.reads;await b.sync.synchronize({force:true});assert.equal(b.store.jobs.size,0);assert.equal(b.sync.status().peers[0].pending,true);
 b.accepted.add(v1.transactionId);await b.sync.synchronize({force:true});assert.equal(b.store.heads.current(v1.id).revision,1);assert.equal(b.ledger.state.reads,readCount);
 const v2=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Version two'});await a.sync.synchronize({force:true});assert.equal(a.sync.status().peers[0].pending,true);assert.equal(a.sync.status().peers[0].remoteBehind,1);b.accepted.add(v2.transactionId);await b.sync.synchronize({force:true});assert.equal(b.store.heads.current(v1.id).manifestId,v2.id);
 const v3=await publishFixture(b.store,b.ledger,{root:v1.id,text:'Version three from B'}),afterLocalPublication=b.ledger.state.reads;a.accepted.add(v3.transactionId);await a.sync.synchronize({force:true});assert.equal(a.store.heads.current(v1.id).revision,3);
 await b.sync.synchronize({force:true});assert.equal(b.store.heads.current(v1.id).manifestId,v3.id);assert.equal(a.ledger.state.submissions+b.ledger.state.submissions,0);
 const digest=v3.manifest.files[0].stripes[0].digests[0],file=b.store.base('cells',digest),before=b.store.job(v3.id).confirmation.checkedAt;await fs.writeFile(file,new Uint8Array(128*1024).fill(23));b.ledger.state.offline=true;
 await b.sync.synchronize({force:true});assert.equal(hash(await fs.readFile(file)),digest);assert.equal(b.store.job(v3.id).confirmation.checkedAt,before,'repair must not claim a fresh network confirmation');assert.ok(b.sync.status().peers[0].cells>=1);
 assert.equal(b.store.replicaReservedBytes,0);assert.equal(b.ledger.state.reads,afterLocalPublication,'replication and repair must not query spendable UTXOs');
});

test('bad cells, altered receipts, false ancestry and quota failure never promote a replica or consume another payment',async t=>{
 const {a,b}=await pair(t),p=await publishFixture(a.store,a.ledger),data=new ReplicaData(b.store),record=new ReplicaData(a.store).record(p.id),good=position=>a.store.get(position);
 await assert.rejects(()=>data.receive({...record,transactionId:'ff'.repeat(32)},good),/TRANSACTION_ID/);assert.equal(b.store.usedBytes,0);
 const changed=structuredClone(record);changed.plan.poolSompi='1';await assert.rejects(()=>data.receive(changed,good));assert.equal(b.store.jobs.size,0);
 await assert.rejects(()=>data.receive(record,async()=>new Uint8Array(128*1024).fill(81)),/CELL_PROOF/);assert.equal(b.store.jobs.size,0);assert.equal(b.store.heads.chains.size,0);assert.equal(b.store.replicaReservedBytes,0);
 b.store.quotaBytes=128*1024;await assert.rejects(()=>data.receive(record,good),/QUOTA/);assert.equal(b.store.jobs.size,0);assert.equal(b.store.usedBytes,0);b.store.quotaBytes=64*1024**2;
 await b.sync.synchronize({force:true});const v2=await publishFixture(a.store,a.ledger,{root:p.id,text:'Next version'}),update=new ReplicaData(a.store).record(v2.id);update.updateChain=structuredClone(update.updateChain);update.updateChain[0].signature='00'.repeat(64);
 await assert.rejects(()=>data.receive(update,position=>a.store.get(position)),/SIGNATURE/);assert.equal(b.store.heads.current(p.id).revision,1);assert.equal(a.ledger.state.submissions+b.ledger.state.submissions,0);
});

test('valid conflicting author branches produce durable proof-backed quarantine, propagate the alarm and cannot be resolved by timestamp',async t=>{
 const {a,b,directory}=await pair(t),v1=await publishFixture(a.store,a.ledger);await b.sync.synchronize({force:true});
 const left=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Left branch'}),right=await publishFixture(b.store,b.ledger,{root:v1.id,text:'Right branch'});assert.notEqual(left.id,right.id);
 await b.sync.synchronize({force:true});assert.equal(b.store.heads.conflicts.size,1);assert.throws(()=>b.store.heads.current(v1.id),/CONFLICT/);
 const blocked=b.store.heads.resolve(v1.id);assert.equal(verifyHeadFork(blocked.conflict,{rootManifestId:v1.id,author}),true);assert.throws(()=>verifyResolvedHead(blocked,{rootManifestId:v1.id,author}),/CONFLICT/);
 await a.sync.synchronize({force:true});assert.equal(a.store.heads.conflicts.size,1);assert.equal(a.store.jobs.size,2,'conflicting branch must not replace or activate local content');
 const invalid={left:blocked.conflict.left,right:structuredClone(blocked.conflict.right)};invalid.right[1].signature='00'.repeat(64);assert.throws(()=>verifyHeadFork(invalid),/SIGNATURE/);
 const unrelated=await publishFixture(a.store,a.ledger,{text:'Another independent application'});assert.throws(()=>verifyHeadFork({left:blocked.conflict.left,right:a.store.heads.chain(unrelated.id)}),/ROOT_MISMATCH/);
 const restarted=await new PeerStore({directory:path.join(directory,'1'),rpc:b.ledger.rpc,quotaBytes:64*1024**2}).init();t.after(()=>restarted.close());assert.equal(restarted.heads.conflicts.size,1);assert.throws(()=>restarted.heads.current(v1.id),/CONFLICT/);
});

test('replica descriptors preserve pinned failover links while rejecting duplicates, unsafe endpoints, other networks and credentials',()=>{
 const primary={url:'ws://127.0.0.1:6091/peer',nodeId:'ab'.repeat(32)},other={url:'ws://127.0.0.1:6092/peer',nodeId:'cd'.repeat(32)};
 assert.deepEqual(publicationPeers(primary,{replicas:[other]}),[primary,other]);
 assert.throws(()=>replicaPeers([other,other],primary.nodeId));assert.throws(()=>replicaPeers([primary],primary.nodeId));assert.throws(()=>replicaPeers([{...other,url:'wss://user:secret@peer.example/peer'}],primary.nodeId));assert.throws(()=>replicaPeers([{...other,token:'secret'}],primary.nodeId));
 const secure={url:'wss://peer.example/peer',nodeId:primary.nodeId};assert.deepEqual(publicationPeers(secure,{replicas:[other]},{secureContext:true}),[secure]);
});

test('publication copy status requires a recent signed full-cell check by the pinned online neighbour; an index entry alone never counts',async t=>{
 const {a,b}=await pair(t),v1=await publishFixture(a.store,a.ledger),meta=a.store.metadata(a.store.job(v1.id));
 const descriptor={url:b.url,nodeId:b.store.nodeId},record={id:v1.id,nodeId:a.store.nodeId,network:'testnet-10',transactionId:v1.transactionId};
 await a.sync.synchronize({force:true});assert.equal(publicationCopies(a.sync.publication(v1.id),record,meta,[descriptor]).verified,0);
 await b.sync.synchronize({force:true});await a.sync.synchronize({force:true});
 const report=a.sync.publication(v1.id),receipt=report.peers[0].receipt;
 assert.equal(publicationCopies(report,record,meta,[descriptor]).verified,1);
 assert.equal(publicationCopies(report,record,meta,[descriptor],{now:Date.now()+121000}).verified,0);
 const offline=structuredClone(report);offline.peers[0].online=false;assert.equal(publicationCopies(offline,record,meta,[descriptor]).verified,0);
 const altered=structuredClone(report);altered.peers[0].receipt.body.transactionId='ee'.repeat(32);assert.equal(publicationCopies(altered,record,meta,[descriptor]).verified,0);
 const expected={networkId:'testnet-10',nodeId:b.store.nodeId,manifestId:v1.id,transactionId:v1.transactionId,merkleRoot:meta.merkleRoot};
 assert.throws(()=>verifyStorageReceipt(receipt,expected,{nonce:'ee'.repeat(32)}),/INVALID_STORAGE/);
 assert.throws(()=>verifyStorageReceipt(receipt,{...expected,networkId:'mainnet'}),/INVALID_STORAGE/);
 const forged=structuredClone(report);forged.peers[0].url='ws://127.0.0.1:1/peer';assert.throws(()=>publicationCopies(forged,record,meta,[descriptor]),/INVALID_PUBLICATION/);
 const disk=new ReplicaData(b.store),digest=v1.manifest.files[0].stripes[0].digests[0];await fs.writeFile(b.store.base('cells',digest),new Uint8Array(128*1024));
 await assert.rejects(()=>disk.receipt({manifestId:v1.id,nonce:'ef'.repeat(32)}),/INCOMPLETE|CORRUPTED/);
 assert.equal(a.ledger.state.submissions+b.ledger.state.submissions,0);
});

test('signed rollback reuses only paid historical bytes, appends a monotonic revision, survives restart and replicates before another paid update',async t=>{
 const {a,b,directory}=await pair(t),v1=await publishFixture(a.store,a.ledger,{text:'Original'}),v2=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Update'});
 await b.sync.synchronize({force:true});const h2=a.store.heads.current(v1.id),beforeReads=a.ledger.state.reads;
 const challenge=a.store.heads.challenge({manifestId:v1.id,rootManifestId:v1.id,operation:'ROLLBACK'});
 const expected=expectedHead(challenge,{id:v1.id,merkleRoot:a.store.metadata(a.store.job(v1.id)).merkleRoot,author,name:h2.name,transactionId:v1.transactionId,prior:h2,operation:'ROLLBACK'});
 const signed={body:expected,signature:k.signMessage({message:headMessage(expected),privateKey:key})};
 const wrong={...signed,signature:'00'.repeat(64)};await assert.rejects(()=>a.store.heads.authorize(wrong),/SIGNATURE/);
 const result=await a.store.heads.authorize(signed),head=verifyHeadChain(result.records);assert.equal(head.revision,3);assert.equal(head.manifestId,v1.id);assert.equal(head.transactionId,v1.transactionId);assert.equal(head.previousProof,h2.proof);
 assert.equal((await a.store.heads.authorize(signed)).records.length,3);assert.equal(a.ledger.state.reads,beforeReads,'rollback never requests funding UTXOs');
 assert.throws(()=>a.store.heads.challenge({manifestId:v1.id,rootManifestId:v1.id,operation:'ROLLBACK'}),/TARGET/);
 const restored=await a.store.resume(v1.id),recovered=verifyRecoveredReceipt(restored,{id:v1.id,address,network:'testnet-10'},{address,publicKey:author,network:'testnet-10'});assert.equal(recovered.application.revision,3);assert.equal(recovered.application.proof,proofHash(signed));
 await b.sync.synchronize({force:true});assert.equal(b.store.heads.current(v1.id).revision,3);assert.equal(b.store.heads.current(v1.id).manifestId,v1.id);
 const stale=b.store.heads.resolve(v1.id);assert.equal(verifyResolvedHead(stale,{rootManifestId:v1.id,author},{minimum:{rootManifestId:v1.id,author,revision:2,proof:h2.proof}}).manifestId,v1.id);
 const restarted=await new PeerStore({directory:path.join(directory,'1'),rpc:b.ledger.rpc,quotaBytes:64*1024**2}).init();t.after(()=>restarted.close());assert.equal(restarted.heads.current(v1.id).revision,3);
 const v4=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Update after rollback'});assert.equal(a.store.job(v4.id).plan.totalSompi,'1000000000');await b.sync.synchronize({force:true});assert.equal(b.store.heads.current(v1.id).revision,4);assert.equal(b.store.heads.current(v1.id).manifestId,v4.id);
 assert.equal(a.ledger.state.submissions+b.ledger.state.submissions,0);
});

test('rollback rejects unrelated paid files, forged historical references, stale ancestry and pending paid updates',async t=>{
 const {a}=await pair(t),v1=await publishFixture(a.store,a.ledger),v2=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Second'}),unrelated=await publishFixture(a.store,a.ledger,{text:'Unrelated'});
 assert.throws(()=>a.store.heads.challenge({manifestId:unrelated.id,rootManifestId:v1.id,operation:'ROLLBACK'}),/TARGET/);
 const signed=c=>({body:c.body,signature:k.signMessage({message:c.message,privateKey:key})});
 const challenge=a.store.heads.challenge({manifestId:v1.id,rootManifestId:v1.id,operation:'ROLLBACK'}),forged=structuredClone(challenge);forged.body.manifestId=unrelated.id;forged.body.merkleRoot=a.store.metadata(a.store.job(unrelated.id)).merkleRoot;forged.body.transactionId=unrelated.transactionId;forged.message=headMessage(forged.body);
 await assert.rejects(()=>a.store.heads.authorize(signed(forged)),/TARGET/);
 const pending=await publishFixture(a.store,a.ledger,{root:v1.id,text:'Paid but not active',activate:false});assert.throws(()=>a.store.heads.challenge({manifestId:v1.id,rootManifestId:v1.id,operation:'ROLLBACK'}),/ALREADY_STAGED/);await assert.rejects(()=>a.store.heads.authorize(signed(challenge)),/ALREADY_STAGED/);
 await a.store.heads.authorize(signed(a.store.heads.challenge({manifestId:pending.id,rootManifestId:v1.id})));await assert.rejects(()=>a.store.heads.authorize(signed(challenge)),/SEQUENCE/);
 assert.equal(a.store.heads.current(v1.id).revision,3);assert.equal(a.ledger.state.submissions,0);
});
