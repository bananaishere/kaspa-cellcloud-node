import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import {sdk as k} from '../lab/kaspa/payment.mjs';
import {PeerStore} from '../peer/store.mjs';
import {startPeerServer} from '../peer/server.mjs';
import {PeerClient} from '../src/peer-client.js';
import {WalletConnection} from '../src/wallets.js';
import {analyseFiles,encodeFileStripe} from '../protocol/manifest.js';
import {publicUploadPolicy,verifyUploadChallenge} from '../protocol/upload-admission.js';
import {operatorTemplate} from '../protocol/operator-template.js';
import {validateOperatorConfig} from '../peer/operator-config.mjs';
const origin='http://127.0.0.1:5191',key=new k.PrivateKey('01'.repeat(32)),other=new k.PrivateKey('02'.repeat(32));
const owner=privateKey=>({address:privateKey.toPublicKey().toAddress('testnet').toString(),author_pubkey:privateKey.toPublicKey().toString().slice(-64)});
async function fixture(t,options={}){
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cellcloud-admission-'));let now=Date.now();
 const store=await new PeerStore({directory,rpc:{},publicUploads:{enabled:true,...options},now:()=>now}).init();
 const server=await startPeerServer({store,origins:[origin,'https://other.example'],viewerOrigins:['http://{site}.viewer.localhost:5192']});
 const clients=[];t.after(async()=>{for(const p of clients)p.close();await server.close();if(!directory.startsWith(path.join(os.tmpdir(),'cellcloud-admission-')))throw Error('UNSAFE_CLEANUP');await fs.rm(directory,{recursive:true,force:true});});
 async function connect(browserOrigin=origin){const p=new PeerClient({url:'ws://127.0.0.1:'+server.port+'/peer',pin:store.nodeId,socketFactory:url=>new WebSocket(url,{headers:{Origin:browserOrigin}}),timeoutMs:3000});clients.push(p);await p.connect();return p;}
 const challenge=(p,privateKey=key)=>p.request('uploadChallenge',owner(privateKey));
 const sign=c=>({body:c.body,signature:k.signMessage({message:c.message,privateKey:key})});
 const authenticate=async(p,privateKey=key)=>{const c=await challenge(p,privateKey);return p.request('uploadAuth',{body:c.body,signature:k.signMessage({message:c.message,privateKey})});};
 async function publication(text,privateKey=key){const file=new File([text],'notes.txt'),p=await analyseFiles([file],{author:owner(privateKey).author_pubkey});return {file,p,args:{id:p.id,manifestText:JSON.stringify(p.manifest),address:owner(privateKey).address,name:'Fixture'}};}
 return {store,directory,connect,challenge,sign,authenticate,publication,advance:ms=>now+=ms};
}
test('public upload admission is opt-in, Testnet-only and strictly bounded in operator configuration',()=>{
 const base=operatorTemplate();assert.equal(validateOperatorConfig(base).publicUploads.enabled,false);
 assert.equal(validateOperatorConfig({...base,publicUploads:{enabled:true}}).publicUploads.maxPendingPerWallet,2);
 assert.throws(()=>validateOperatorConfig({...base,network:'mainnet',publicUploads:{enabled:true}}),/TESTNET_ONLY/);
 for(const value of [true,{enabled:'true'},{enabled:true,token:'x'},{maxPendingTotal:0},{maxPendingBytes:Infinity},{maxFileBytes:6*1024**3}])assert.throws(()=>publicUploadPolicy(value));
});
test('a wallet signs one-use node/origin/account-bound admission; replay, cross-session/origin, wrong key and expired challenges fail',async t=>{
 const f=await fixture(t),a=await f.connect(),b=await f.connect(),c=await f.challenge(a),proof=f.sign(c);
 assert.equal(a.hello.publicUploads.enabled,true);assert.equal(verifyUploadChallenge(c,{nodeId:f.store.nodeId,origin,...owner(key)}).address,owner(key).address);
 await assert.rejects(()=>b.request('uploadAuth',proof),/INVALID_UPLOAD_CHALLENGE/);
 const cross=await f.connect('https://other.example');await f.challenge(cross);await assert.rejects(()=>cross.request('uploadAuth',proof),/INVALID_UPLOAD_CHALLENGE/);
 await assert.rejects(()=>a.request('uploadAuth',{...proof,signature:k.signMessage({message:c.message,privateKey:other})}),/SIGNATURE_INVALID/);
 await assert.rejects(()=>a.request('uploadAuth',proof),/INVALID_UPLOAD_CHALLENGE/);
 const fresh=await f.challenge(a);await a.request('uploadAuth',f.sign(fresh));await assert.rejects(()=>a.request('uploadAuth',f.sign(fresh)),/INVALID_UPLOAD_CHALLENGE/);
 const expired=await f.challenge(b);f.advance(120001);await assert.rejects(()=>b.request('uploadAuth',f.sign(expired)),/INVALID_UPLOAD_CHALLENGE/);
 assert.equal(f.store.jobs.size,0);
});
test('wallet admission uploads bounded cells, keeps unpaid content inaccessible, and isolates resume/payment/head operations from other wallets',async t=>{
 const f=await fixture(t),a=await f.connect();await f.authenticate(a);const {file,p,args}=await f.publication('Public admission fixture');
 await a.request('open',args);for(const cell of await encodeFileStripe(file,p.manifest.files[0],0))await a.request('put',{id:p.id,file:0,stripe:0,shard:cell.shard,proof:cell.proof},cell.bytes);
 assert.equal((await a.request('resume',{manifestId:p.id})).state,'STAGED');
 await assert.rejects(()=>a.request('manifest',{manifestId:p.id}),/PAYMENT_CONFIRMATION_REQUIRED/);
 const b=await f.connect();await f.authenticate(b,other);
 for(const operation of ['resume','confirm','beginSend','headChallenge'])await assert.rejects(()=>b.request(operation,{manifestId:p.id}),/UPLOAD_OWNER_REQUIRED/);
 await assert.rejects(()=>b.request('put',{id:p.id,file:0,stripe:0,shard:0},new Uint8Array(128*1024)),/UPLOAD_OWNER_REQUIRED/);
 await assert.rejects(()=>b.request('open',args),/UPLOAD_OWNER_REQUIRED/);
 f.advance(60*60*1000+1);await assert.rejects(()=>a.request('resume',{manifestId:p.id}),/UPLOAD_SESSION_EXPIRED/);
 await f.authenticate(a);assert.equal((await a.request('resume',{manifestId:p.id})).id,p.id);
});
test('public quotas survive restart and concurrent wallets cannot exceed the global unpaid allowance',async t=>{
 const f=await fixture(t,{maxPendingPerWallet:1,maxPendingTotal:2}),a=await f.connect();await f.authenticate(a);
 const first=await f.publication('first');await a.request('open',first.args);
 const second=await f.publication('second');await assert.rejects(()=>a.request('open',second.args),/PENDING_LIMIT/);
 const b=await f.connect();await f.authenticate(b,other);const third=await f.publication('third',other);await b.request('open',third.args);
 const persisted=JSON.parse(await fs.readFile(f.store.base('jobs',first.p.id+'.json'),'utf8'));assert.equal(persisted.publicAdmission,true);
 const fresh=await new PeerStore({directory:f.directory,rpc:{},publicUploads:{enabled:true,maxPendingPerWallet:1,maxPendingTotal:2}}).init();
 try{await assert.rejects(()=>fresh.open(second.args,owner(key)),/PENDING_LIMIT/);assert.equal(fresh.jobs.size,2);}finally{fresh.close();}
});
test('public per-file and encoded pending-byte limits reject before reserving storage; private and viewer access remain separate',async t=>{
 const f=await fixture(t,{maxFileBytes:4,maxPendingBytes:30*128*1024}),p=await f.connect();await f.authenticate(p);
 const large=await f.publication('too large');await assert.rejects(()=>p.request('open',large.args),/SIZE_LIMIT/);assert.equal(f.store.jobs.size,0);
 const viewer=await f.connect('http://tn10-'+ 'ab'.repeat(16)+'.viewer.localhost:5192');await assert.rejects(()=>f.challenge(viewer),/PUBLIC_UPLOADS_DISABLED/);
 f.store.publicUploads.enabled=false;await assert.rejects(()=>f.challenge(p),/PUBLIC_UPLOADS_DISABLED/);
 const token=JSON.parse(await fs.readFile(f.store.grantPath,'utf8')).token;await p.request('auth',{token});await p.request('open',large.args);assert.equal(f.store.jobs.size,1);
});
test('encoded pending bytes are bounded across concurrent admissions, including after reconnect',async t=>{
 const f=await fixture(t,{maxPendingBytes:30*128*1024}),a=await f.connect();await f.authenticate(a);
 const first=await f.publication('one'),second=await f.publication('two');
 const results=await Promise.allSettled([f.store.open(first.args,owner(key)),f.store.open(second.args,owner(key))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(results.find(r=>r.status==='rejected').reason.message,/PENDING_BYTES_LIMIT/);
 const b=await f.connect();await f.authenticate(b);const third=await f.publication('three');await assert.rejects(()=>b.request('open',third.args),/PENDING_BYTES_LIMIT/);
 assert.equal(f.store.jobs.size,1);
});
test('KasWare and Kastle sign only reviewed admission messages, can decline/retry, and never call transaction APIs for access',async()=>{
 for(const kind of ['kasware','kastle']){
  let calls=0,decline=false;const account=owner(key),provider={requestAccounts:async()=>[account.address],getAccounts:async()=>[account.address],connect:async()=>true,getAccount:async()=>({address:account.address,publicKey:account.author_pubkey}),getPublicKey:async()=>account.author_pubkey,getNetwork:async()=>'testnet-10',signMessage:async message=>{calls++;if(decline)throw Object.assign(Error('declined'),{code:4001});return k.signMessage({message,privateKey:key});}};
  for(const method of ['signTx','signPskt','sendKaspa'])provider[method]=()=>assert.fail('NO_PAYMENT_FOR_ADMISSION');
  const connection=new WalletConnection({[kind]:provider});await connection.connect(kind);const now=Date.now(),body={protocol:'cellcloud-upload-access',version:1,networkId:'testnet-10',nodeId:'aa'.repeat(32),origin,...account,policy:publicUploadPolicy({enabled:true}),issuedAt:now,expiresAt:now+120000,nonce:'bb'.repeat(32)};
  const {uploadAdmissionMessage}=await import('../protocol/upload-admission.js'),challenge={body,message:uploadAdmissionMessage(body)},expected={nodeId:body.nodeId,origin,...account};
  await assert.rejects(()=>connection.signPeerUpload(challenge,expected),/APPROVAL/);assert.equal(calls,0);
  await assert.rejects(()=>connection.signPeerUpload({...challenge,message:challenge.message+'x'},expected,{approved:true}),/CHALLENGE/);assert.equal(calls,0);
  decline=true;await assert.rejects(()=>connection.signPeerUpload(challenge,expected,{approved:true}),{code:4001});decline=false;
  const signed=await connection.signPeerUpload(challenge,expected,{approved:true});assert.equal(k.verifyMessage({message:challenge.message,signature:signed.signature,publicKey:account.author_pubkey}),true);assert.equal(calls,2);connection.dispose();
 }
});
