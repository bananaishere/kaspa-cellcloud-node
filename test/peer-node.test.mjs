import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {sdk as k} from '../lab/kaspa/payment.mjs';
import {DirectKaspaClient} from '../protocol/kaspa-client.js';
import {PeerStore} from '../peer/store.mjs';
import {startPeerServer} from '../peer/server.mjs';
import {PeerClient} from '../src/peer-client.js';
import {analyseFiles,encodeFileStripe,reconstructStripe} from '../protocol/manifest.js';
import {hash} from '../protocol/integrity.js';
import {pack,unpack,peerUrl} from '../protocol/wire.js';
import {CELL,N} from '../protocol/codec.js';

// Public, unfunded test key. RPC responses below are deterministic test doubles.
const key=new k.PrivateKey('01'.repeat(32)),publicKey=key.toPublicKey().toString().slice(-64),address=key.toPublicKey().toAddress('testnet').toString();
function rpcFixture(){
 const state={accepted:false,transactionId:null,submissions:0,reads:0,networkId:'testnet-10',entries:[{outpoint:{transactionId:'11'.repeat(32),index:0},amount:'100000000000',scriptPublicKey:k.payToAddressScript(address).toJSON(),blockDaaScore:'10',isCoinbase:false}]};
 const blocks=Array.from({length:12},(_,index)=>(index+30).toString(16).padStart(64,'0'));
 const raw={connect:async()=>{},disconnect:async()=>{},getServerInfo:async()=>({networkId:state.networkId,isSynced:true,hasUtxoIndex:true,virtualDaaScore:100n}),getUtxosByAddresses:async()=>{state.reads++;return {entries:state.entries};},getFeeEstimate:async()=>({estimate:{normalBuckets:[{feerate:1.1}]}}),getSink:async()=>({sink:'aa'.repeat(32)}),getVirtualChainFromBlock:async()=>({addedChainBlockHashes:blocks,removedChainBlockHashes:[],acceptedTransactionIds:state.accepted?[{acceptingBlockHash:blocks[0],acceptedTransactionIds:[state.transactionId]}]:[]}),submitTransaction:async()=>{state.submissions++;throw Error('NODE_MUST_NEVER_SUBMIT');}};
 return {state,rpc:new DirectKaspaClient({sdk:k,url:'ws://127.0.0.1:12345',factory:()=>raw})};
}
async function temp(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cellcloud-peer-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
function clientFor(port,options={}){return new PeerClient({url:'ws://127.0.0.1:'+port+'/peer',socketFactory:url=>new WebSocket(url,{headers:{Origin:'http://127.0.0.1:5191'}}),timeoutMs:3000,...options});}

test('peer frames and browser endpoint policy reject unsafe remote/mixed-content connections',()=>{
 const bytes=new Uint8Array(CELL).fill(17),packet=pack({id:'1',value:7},bytes),decoded=unpack(packet);assert.deepEqual(decoded.bytes,bytes);assert.equal(decoded.header.value,7);
 assert.throws(()=>unpack(packet.subarray(0,5)),/FRAME/);assert.throws(()=>pack({tooLarge:'x'.repeat(8192)}),/LIMIT/);
 assert.equal(peerUrl('ws://localhost:6091/peer'),'ws://localhost:6091/peer');
 for(const url of ['ws://example.com/peer','https://example.com/peer','wss://user:secret@example.com/peer','wss://example.com/peer?token=secret'])assert.throws(()=>peerUrl(url),/REQUIRES/);
 assert.throws(()=>peerUrl('ws://127.0.0.1:6091/peer',{secureContext:true}),/REQUIRES/);
});

test('browser ingestion reads bounded stripes; Merkle proofs and parity restore exact original bytes',async()=>{
 const source=new Uint8Array(CELL*11+5).map((_,i)=>i%251),file=new File([source],'images.zip');let maxRead=0;
 const bounded={name:file.name,size:file.size,slice:(start,end)=>{maxRead=Math.max(maxRead,end-start);return file.slice(start,end);}};
 const publication=await analyseFiles([bounded],{author:publicKey});assert.ok(maxRead<=CELL*10);assert.equal(publication.manifest.files[0].stripes.length,2);
 const restored=[];for(let index=0;index<2;index++){const cells=await encodeFileStripe(bounded,publication.manifest.files[0],index);restored.push(reconstructStripe(publication.manifest.files[0].stripes[index],cells.slice(20).map(c=>({index:c.shard,data:c.bytes}))));}
 assert.equal(hash(Buffer.concat(restored)),hash(source));
 await assert.rejects(()=>analyseFiles([new File(['x'],'../escape')]),/NAME/);
 const changed=new File([new Uint8Array(source.length)],'images.zip');await assert.rejects(()=>encodeFileStripe(changed,publication.manifest.files[0],0),/BYTES_CHANGED/);
});

for(const publicAccess of [false,true])test((publicAccess?'wallet public admission: ':'private token: ')+'direct peer verifies identity, denies unauthorised/corrupt/cross-network writes, confirms only an independently checked payment and recovers after restart',async t=>{
 const directory=await temp(t),{rpc,state}=rpcFixture();let store=await new PeerStore({directory,rpc,quotaBytes:64*1024**2,publicUploads:{enabled:publicAccess}}).init();
 const token=JSON.parse(await fs.readFile(store.grantPath,'utf8')).token,nodeId=store.nodeId;
 let server=await startPeerServer({store,origins:['http://127.0.0.1:5191'],viewerOrigins:['http://{site}.viewer.localhost:5192']}),peer=clientFor(server.port);t.after(async()=>{peer.close();await server.close();await rpc.close();});
 const hello=await peer.connect();assert.equal(hello.nodeId,nodeId);await assert.rejects(()=>peer.request('auth',{token}),/IDENTITY_APPROVAL/);peer.trust(hello.nodeId);
 await assert.rejects(()=>peer.request('resume',{manifestId:'ab'.repeat(32)}),/AUTHORIZATION/);
 await assert.rejects(()=>peer.request('auth',{token:'00'.repeat(32)}),/AUTHORIZATION/);if(publicAccess){const challenge=await peer.request('uploadChallenge',{address,author_pubkey:publicKey});await peer.request('uploadAuth',{body:challenge.body,signature:k.signMessage({message:challenge.message,privateKey:key})});}else await peer.request('auth',{token});
 const wrong=clientFor(server.port,{network:'mainnet'});await assert.rejects(()=>wrong.connect(),/NETWORK_MISMATCH/);wrong.close();
 const wrongPin=clientFor(server.port,{pin:'00'.repeat(32)});await assert.rejects(()=>wrongPin.connect(),/IDENTITY_CHANGED/);wrongPin.close();
 const file=new File(['A small ZIP or document is just bytes.'],'document.txt'),publication=await analyseFiles([file],{author:publicKey});
 const args={id:publication.id,manifestText:JSON.stringify(publication.manifest),address,name:'My document'};
 const opened=await peer.request('open',args);assert.equal(opened.state,'STAGED');
 await assert.rejects(()=>peer.request('manifest',{manifestId:publication.id}),/CONFIRMATION_REQUIRED/);
 const cells=await encodeFileStripe(file,publication.manifest.files[0],0),first=cells[0],position={id:publication.id,file:0,stripe:0,shard:first.shard,proof:first.proof};
 await assert.rejects(()=>peer.request('put',position,new Uint8Array(CELL).fill(99)),/INVALID_CELL_PROOF/);
 const {plan,expected}=await rpc.prepare({address,manifestId:publication.id,sizeBytes:file.size});
 await assert.rejects(()=>peer.request('review',{id:publication.id,plan,expected}),/UPLOAD_INCOMPLETE/);
 for(const cell of cells)await peer.request('put',{id:publication.id,file:0,stripe:0,shard:cell.shard,proof:cell.proof},cell.bytes);
 let used=store.usedBytes;await peer.request('put',position,first.bytes);assert.equal(store.usedBytes,used);
 await peer.request('review',{id:publication.id,plan,expected});
 const unsigned=k.Transaction.deserializeFromSafeJSON(plan.unsignedJson),signed=k.signTransaction(unsigned,[key],true),signedJson=signed.serializeToSafeJSON();signed.free();unsigned.free();
 const forged=JSON.parse(signedJson);forged.inputs[0].signatureScript='41'+'00'.repeat(64)+'01';await assert.rejects(()=>peer.request('authorize',{id:publication.id,plan,expected,signedJson:JSON.stringify(forged)}),/SIGNATURE_INVALID/);
 const authorized=await peer.request('authorize',{id:publication.id,plan,expected,signedJson});assert.equal(authorized.state,'SIGNED');assert.equal(state.submissions,0);state.transactionId=authorized.transactionId;
 // Exactly one durable explicit send intent may be granted. No endpoint submits.
 const intents=await Promise.allSettled([store.beginSend(publication.id),store.beginSend(publication.id)]);assert.equal(intents.filter(r=>r.status==='fulfilled').length,1);assert.match(intents.find(r=>r.status==='rejected').reason.message,/ALREADY_REQUESTED/);
 const pending=await peer.request('confirm',{manifestId:publication.id});assert.equal(pending.state,'SIGNED');
 used=store.usedBytes;
 peer.close();await server.close();
 store=await new PeerStore({directory,rpc,quotaBytes:64*1024**2,publicUploads:{enabled:publicAccess}}).init();assert.equal(store.nodeId,nodeId);assert.equal(store.jobs.size,1);assert.equal(store.usedBytes,used);
 server=await startPeerServer({store,origins:['http://127.0.0.1:5191'],viewerOrigins:['http://{site}.viewer.localhost:5192']});peer=clientFor(server.port,{pin:nodeId});await peer.connect();await peer.request('auth',{token});
 const reads=state.reads;state.entries=[];
 const resumed=await peer.request('resume',{manifestId:publication.id});assert.equal(resumed.transactionId,authorized.transactionId);assert.equal(resumed.signedJson,signedJson);assert.ok(resumed.submissionIntentAt);assert.equal(state.reads,reads);
 await assert.rejects(()=>peer.request('beginSend',{manifestId:publication.id}),/ALREADY_REQUESTED/);assert.equal(state.submissions,0);
 state.accepted=true;assert.equal((await peer.request('confirm',{manifestId:publication.id})).state,'CONFIRMED');assert.equal(state.submissions,0);assert.equal(store.jobs.size,1);
 // A fresh read-only connection retrieves content without upload credentials.
 const reader=clientFor(server.port,{pin:nodeId,socketFactory:url=>new WebSocket(url,{headers:{Origin:'http://tn10-'+publication.id.slice(0,32)+'.viewer.localhost:5192'}})});await reader.connect();t.after(()=>reader.close());
 await assert.rejects(()=>reader.request('auth',{token}),/AUTHORIZATION_REQUIRED/);
 const metadata=await reader.request('manifest',{manifestId:publication.id});assert.equal(metadata.manifest.author_pubkey,publicKey);
 const available=[];for(let shard=20;shard<30;shard++)available.push({index:shard,data:await reader.request('get',{id:publication.id,file:0,stripe:0,shard})});
 assert.equal(hash(reconstructStripe(publication.manifest.files[0].stripes[0],available)),hash(new TextEncoder().encode(await file.text())));
 state.accepted=false;assert.equal((await peer.request('confirm',{manifestId:publication.id})).state,'SIGNED');await assert.rejects(()=>reader.request('manifest',{manifestId:publication.id}),/CONFIRMATION_REQUIRED/);assert.equal(state.submissions,0);
});

test('peer quota and network/payment policies fail closed before writing content',async t=>{
 const directory=await temp(t),{rpc}=rpcFixture(),store=await new PeerStore({directory,rpc,quotaBytes:CELL*N}).init();t.after(()=>store.close());
 const file=new File([new Uint8Array(CELL*10+1).map((_,i)=>i%251)],'big.bin'),publication=await analyseFiles([file],{author:publicKey});
 await assert.rejects(()=>store.open({id:publication.id,manifestText:JSON.stringify(publication.manifest),address,name:'Too big'}),/QUOTA/);assert.equal(store.usedBytes,0);
 const mainnet=await new PeerStore({directory,network:'mainnet',rpc,quotaBytes:CELL*N}).init();t.after(()=>mainnet.close());
 await assert.rejects(()=>mainnet.open({}),/MAINNET_PAYMENTS_NOT_ENABLED/);assert.equal(mainnet.jobs.size,0);
 const noRpc=await new PeerStore({directory:directory+'-offline',quotaBytes:CELL*N}).init();t.after(async()=>{noRpc.close();await fs.rm(directory+'-offline',{recursive:true,force:true});});assert.equal(noRpc.hello('ab'.repeat(32)).body.writesEnabled,false);await assert.rejects(()=>noRpc.open({}),/RPC_REQUIRED/);
});
