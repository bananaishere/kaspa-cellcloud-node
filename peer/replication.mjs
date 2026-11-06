import WebSocket from 'ws';
import {PeerClient} from '../src/peer-client.js';
import {replicaPeers,signReplicaAuth,REPLICA_ORIGIN} from '../protocol/replicas.js';
import {isDigest} from '../protocol/integrity.js';
import {verifyHeadChain,proofHash,verifyHeadFork} from '../protocol/heads.js';
import {ReplicaData} from './replica-data.mjs';
import {verifyStorageReceipt} from '../protocol/storage-receipt.js';

function inventory(value,network){
 if(value?.version!==1||value.networkId!==network||!Array.isArray(value.publications)||value.publications.length>128||!Array.isArray(value.heads)||value.heads.length>128)throw Error('INVALID_REPLICA_INVENTORY');
 const ids=new Set(),roots=new Set();
 for(const row of value.publications){if(!isDigest(row.id)||!isDigest(row.transactionId)||ids.has(row.id))throw Error('INVALID_REPLICA_INVENTORY');ids.add(row.id);}
 for(const row of value.heads){if(!isDigest(row.root)||!isDigest(row.proof)||!Number.isSafeInteger(row.revision)||row.revision<1||row.revision>128||roots.has(row.root))throw Error('INVALID_REPLICA_INVENTORY');roots.add(row.root);}
 return value;
}
export class PeerReplicator{
 constructor({store,peers=[],intervalMs=5000,repairIntervalMs=60000,timeoutMs=12000,log=()=>{}}){
  if(!Number.isSafeInteger(intervalMs)||intervalMs<250||intervalMs>3600000||!Number.isSafeInteger(repairIntervalMs)||repairIntervalMs<250||repairIntervalMs>3600000)throw Error('INVALID_REPLICA_INTERVAL');
  Object.assign(this,{store,intervalMs,repairIntervalMs,timeoutMs,log});this.peers=replicaPeers(peers,store.nodeId);store.replicaPeers=this.peers;this.data=new ReplicaData(store);this.states=new Map();this.checked=new Map();this.receipts=new Map();this.stopping=false;this.inFlight=null;this.active=null;store.replicationWake=()=>this.wake();store.replicationStatus=()=>this.status();store.publicationReplication=id=>this.publication(id);
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>this.wake(),this.intervalMs);this.timer.unref();this.wake();}
 wake(){if(this.stopping)return;this.synchronize().catch(error=>this.log({event:'replication-error',code:error.message}));}
 status(){return {enabled:this.peers.length>0,networkId:this.store.network,peers:this.peers.map(peer=>({...peer,...this.states.get(peer.nodeId)})),conflicts:[...this.store.heads.conflicts.keys()]};}
 publication(id){this.store.publication(id);return {manifestId:id,networkId:this.store.network,peers:this.peers.map(peer=>({...peer,online:this.states.get(peer.nodeId)?.online===true,...(this.receipts.get(peer.nodeId+id)||{})}))};}
 synchronize({force=false}={}){
  if(this.stopping)return Promise.resolve();if(this.inFlight)return this.inFlight;
  this.inFlight=(async()=>{for(const peer of this.peers){if(this.stopping)break;await this.syncPeer(peer,force);}})().finally(()=>this.inFlight=null);return this.inFlight;
 }
 async syncPeer(descriptor,force){
  const peer=new PeerClient({url:descriptor.url,network:this.store.network,pin:descriptor.nodeId,timeoutMs:this.timeoutMs,socketFactory:url=>new WebSocket(url,{headers:{Origin:REPLICA_ORIGIN},maxPayload:20*1024**2})});this.active=peer;
  const totals={cells:0,publications:0,heads:0},errors=[];let remoteBehind=0;
  try{
   const hello=await peer.connect();await peer.request('replicaAuth',signReplicaAuth(this.store,hello));
   const index=inventory(await peer.request('replicaInventory'),this.store.network),visited=new Set();
   const remoteRoots=new Set(index.heads.map(row=>row.root)),remoteIds=new Set(index.publications.map(row=>row.id));
   remoteBehind=[...this.store.heads.chains.keys()].filter(root=>!remoteRoots.has(root)).length;
   const fetch=async(id,requiredTransaction)=>{
    if(visited.has(id))return;visited.add(id);const local=this.store.jobs.get(id);
    if(requiredTransaction&&local?.transactionId&&local.transactionId!==requiredTransaction)throw Error('REPLICA_RECEIPT_CONFLICT');
    if(!force&&local?.state==='CONFIRMED'&&this.store.now()-(this.checked.get(id)||0)<this.repairIntervalMs)return;
    const record=await peer.request('replicaRecord',{manifestId:id});if(record.id!==id||requiredTransaction&&record.transactionId!==requiredTransaction)throw Error('REPLICA_RECEIPT_CONFLICT');
    const result=await this.data.receive(record,position=>peer.request('get',position));this.checked.set(id,this.store.now());totals.cells+=result.cells;if(result.imported)totals.publications++;
   };
   for(const row of index.heads){
    try{
     const state=await peer.request('replicaHead',{rootManifestId:row.root});
     if(state.conflict){verifyHeadFork(state.conflict,{rootManifestId:row.root});await fetch(row.root,state.conflict.left[0].body.transactionId);await this.store.heads.acceptConflict(state.conflict);throw Error('HEAD_SEQUENCE_CONFLICT');}
     const head=verifyHeadChain(state.records,{rootManifestId:row.root});
     if(head.revision<row.revision||proofHash(state.records[row.revision-1])!==row.proof)throw Error('VERSION_CONSISTENCY_ERROR');
     const relation=await this.store.heads.checkRemote(state.records);if(relation==='behind')remoteBehind++;
     for(const record of state.records)await fetch(record.body.manifestId,record.body.transactionId);
     const merged=await this.store.heads.reconcile(state.records);if(merged.changed){totals.heads++;this.log({event:'replica-head-applied',source:descriptor.nodeId,root:row.root,revision:head.revision});}
    }catch(error){errors.push({root:row.root,code:error.message});this.log({event:'replica-head-pending',source:descriptor.nodeId,root:row.root,code:error.message});}
   }
   for(const row of index.publications)try{await fetch(row.id,row.transactionId);}catch(error){errors.push({manifest:row.id,code:error.message});}
   for(const job of this.store.jobs.values())if(job.state==='CONFIRMED'){
    const key=descriptor.nodeId+job.id;
    if(!remoteIds.has(job.id)){this.receipts.delete(key);continue;}
    try{
     const receipt=await peer.request('replicaReceipt',{manifestId:job.id,nonce:hello.replicaChallenge});
     verifyStorageReceipt(receipt,{networkId:this.store.network,nodeId:descriptor.nodeId,manifestId:job.id,transactionId:job.transactionId,merkleRoot:this.store.metadata(job).merkleRoot},{now:this.store.now(),nonce:hello.replicaChallenge});
     this.receipts.set(key,{receipt});
    }catch(error){this.receipts.set(key,{error:error.message});errors.push({manifest:job.id,code:error.message});}
   }
   const outgoingMissing=[...this.store.jobs.values()].filter(job=>job.state==='CONFIRMED'&&!remoteIds.has(job.id)).length,pending=errors.length>0||remoteBehind>0||outgoingMissing>0;
   this.states.set(descriptor.nodeId,{online:true,pending,checkedAt:this.store.now(),...totals,remoteBehind,outgoingMissing,errors});
   if(totals.cells||totals.heads||totals.publications)this.log({event:'replication-complete',source:descriptor.nodeId,...totals,pending});
  }catch(error){this.states.set(descriptor.nodeId,{online:false,pending:true,checkedAt:this.store.now(),...totals,errors:[{code:error.message}]});this.log({event:'replica-unavailable',source:descriptor.nodeId,code:error.message});}
  finally{peer.close();if(this.active===peer)this.active=null;}
 }
 async close(){this.stopping=true;clearInterval(this.timer);this.active?.close();await this.inFlight;}
}
