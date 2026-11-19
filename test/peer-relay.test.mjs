import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair} from '@libp2p/crypto/keys';
import {ed25519} from '@noble/curves/ed25519.js';
import {startTestnetRelay} from '../peer/relay-service.mjs';
import {startRelayNode} from '../peer/relay-node.mjs';
import {startPeerServer} from '../peer/server.mjs';
import {PeerClient} from '../src/peer-client.js';
import {PROTOCOL} from '../protocol/network.js';
import {hash,canonicalJson,utf8} from '../protocol/integrity.js';
import {compactFileHash,expandCompactFileHash} from '../viewer/compact-file-link.js';
import {publicUploadPolicy} from '../protocol/upload-admission.js';
import {sdk} from '../lab/kaspa/payment.mjs';

async function relay(){
 const server=await startTestnetRelay({privateKey:await generateKeyPair('Ed25519'),listen:'/ip4/127.0.0.1/tcp/0/ws'});
 const port=server.getMultiaddrs()[0].toString().split('/')[4];
 return {server,url:'ws://127.0.0.1:'+port+'/relay/'+server.peerId};
}

test('an outbound storage node uses two encrypted routes, binds identity and fails over for a cell read',async t=>{
 const a=await relay(),b=await relay();
 t.after(()=>Promise.all([a.server.stop(),b.server.stop()]));
 const secret=crypto.getRandomValues(new Uint8Array(32)),key=ed25519.getPublicKey(secret);
 const nodeId=hash(key),publicKey=Buffer.from(key).toString('hex'),network='testnet-10';
 const cell=crypto.getRandomValues(new Uint8Array(65536));
 const publicUploads=publicUploadPolicy({enabled:true});
 const store={secret,publicKey,nodeId,network,now:Date.now,rpc:{},publicUploads,queue:Promise.resolve(),close(){},
  get:async()=>cell,auth(){throw Error('TOKEN_MUST_NOT_REACH_STORE');},
  open(args,session){assert.equal(args.address,session.address);return {state:'STAGED'};},
  hello(nonce){
   const body={protocol:PROTOCOL,nonce,nodeId,publicKey,timestamp:Date.now(),networkId:network,cellBytes:131072,data:10,total:30,publicUploads};
   return {body,signature:Buffer.from(ed25519.sign(utf8(canonicalJson(body)),secret)).toString('hex')};
  }
 };
 const origin='https://kaspacellcloud.vercel.app';
 const server=await startPeerServer({store,origins:[origin]});
 t.after(()=>server.close());
 const logs=[];
 const node=await startRelayNode({store,server,relays:[a.url,b.url],origin,log:event=>logs.push(event)});
 t.after(()=>node.close());
 assert.equal(logs.filter(entry=>entry.event==='relay-ready').length,2,JSON.stringify(logs));
 const fragment=compactFileHash({id:'b'.repeat(64),peers:[{url:node.url,nodeId}]});
 assert.deepEqual(JSON.parse(new URLSearchParams(expandCompactFileHash('#'+fragment)).get('peers')),[{url:node.url,nodeId}]);
 async function client(pin=nodeId,relayReadOnly=false){
  const peer=new PeerClient({url:node.url,pin,relayReadOnly,timeoutMs:9000});
  t.after(()=>peer.close());
  await peer.connect();
  return peer;
 }
 await assert.rejects(client('a'.repeat(64)),/PEER_IDENTITY_CHANGED/);
 const writer=await client();
 await assert.rejects(writer.request('auth',{token:'mock-secret'}),/UPLOAD_AUTHORIZATION_REQUIRED/);
 const wallet=new sdk.PrivateKey('01'.repeat(32));
 const address=wallet.toPublicKey().toAddress('testnet').toString(),author_pubkey=wallet.toPublicKey().toString().slice(-64);
 await assert.rejects(writer.request('open',{address}),/UPLOAD_AUTHORIZATION_REQUIRED/);
 const challenge=await writer.request('uploadChallenge',{address,author_pubkey});
 assert.equal(challenge.body.origin,origin);
 const signature=sdk.signMessage({message:challenge.message,privateKey:wallet});
 assert.equal((await writer.request('uploadAuth',{body:challenge.body,signature})).mode,'wallet');
 assert.equal((await writer.request('open',{address})).state,'STAGED');
 writer.close();
 await a.server.stop();
 const reader=await client(nodeId,true);
 assert.deepEqual(await reader.request('get',{}),cell);
 await assert.rejects(reader.request('uploadChallenge',{address,author_pubkey}),/PUBLIC_UPLOADS_DISABLED/);
 reader.close();
});
