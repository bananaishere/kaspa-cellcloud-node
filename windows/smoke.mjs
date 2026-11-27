import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const [payload,build]=process.argv.slice(2);
const runtime=path.join(payload,'runtime','node.exe');
const helper=path.join(payload,'app','windows','operator.mjs');
const folder=await fs.mkdtemp(path.join(build,'smoke-'));
const socket=net.createServer().listen(0,'127.0.0.1');
await once(socket,'listening');
const {port}=socket.address();
await new Promise(resolve=>socket.close(resolve));
const options={isPublic:false,hostname:'',name:'',quotaGiB:1,port,folder,uploads:true};

function launch(command,setup=options){
 const child=spawn(runtime,[helper,command],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 let errors='';
 child.stderr.on('data',data=>{errors+=data;});
 const closed=once(child,'close').then(([code])=>{assert.equal(code,0,errors||`${command} failed`);});
 closed.catch(()=>{});
 child.stdin.write(JSON.stringify(setup)+'\n');
 return {child,closed};
}

async function request(command,setup){
 const {child,closed}=launch(command,setup);
 let output='';
 child.stdout.on('data',data=>{output+=data;});
 child.stdin.end();
 await closed;
 return JSON.parse(output);
}

async function cycle({pinned=false,setup=options,verify}={}){
 const {child,closed}=launch('start',setup);
 const lines=createInterface({input:child.stdout});
 try{
  let listening=false;
  for await(const line of lines){
   if(JSON.parse(line).event==='listening'){listening=true;break;}
  }
  if(!listening)await closed;
  assert.ok(listening);
  const result=await request('diagnose',setup);
  assert.equal(result.profile.networkId,'testnet-10');
  assert.match(result.profile.nodeId,/^[a-f0-9]{64}$/);
  if(!setup.isPublic)assert.equal(result.publicReachable,false);
  if(pinned)assert.deepEqual(result.replication?.peers,[]);
  if(verify)await verify(result.profile);
  child.stdin.end();
  await closed;
  const mode=setup.isPublic?'public-testnet':'private-testnet';
  await assert.rejects(fs.access(path.join(folder,mode,'storage','testnet-10','node.lock')),{code:'ENOENT'});
  return result.profile.nodeId;
 }finally{child.stdin.end();}
}

const {configFile}=await request('prepare');
const config=JSON.parse(await fs.readFile(configFile,'utf8'));
assert.deepEqual(config.peers,[]);
assert.equal(config.publicUploads.enabled,false);
assert.equal(config.host,'127.0.0.1');
const identity=await cycle();
await request('prepare');
assert.equal(await cycle({pinned:true}),identity);

const publicSetup={...options,isPublic:true,hostname:'node.example.com',name:'Windows fixture'};
const result=await request('prepare',publicSetup);
const publicConfig=JSON.parse(await fs.readFile(result.configFile,'utf8'));
assert.equal(publicConfig.expectedNodeId,null);
assert.deepEqual(publicConfig.peers,[]);
assert.equal(publicConfig.publicUrl,'wss://node.example.com/peer');
assert.match(await fs.readFile(path.join(result.state,'Caddyfile'),'utf8'),/reverse_proxy 127\.0\.0\.1:/);
const peers=[{url:'wss://other.example.com/peer',nodeId:'ab'.repeat(32)}];
const rpcUrl='wss://rpc.example.com/testnet-10/wrpc/borsh';
assert.deepEqual(await request('save-replica-settings',{...publicSetup,peers,rpcUrl}),{peers,rpcUrl});
await request('prepare',publicSetup);
assert.deepEqual(await request('replica-settings',publicSetup),{peers,rpcUrl});
await assert.rejects(request('save-replica-settings',{...publicSetup,peers:[{...peers[0],url:'wss://node.example.com/peer'}]}),/ANOTHER_WSS_NODE/);
await assert.rejects(request('save-replica-settings',{...publicSetup,peers:[...peers,...peers]}),/INVALID_REPLICA_PEER/);
await assert.rejects(request('save-replica-settings',{...publicSetup,peers:[{...peers[0],url:'ws://127.0.0.1:8080/peer'}]}),/ANOTHER_WSS_NODE/);
await assert.rejects(request('save-replica-settings',{...publicSetup,peers,rpcUrl:'http://rpc.example.com'}),/INVALID_OPERATOR_RPC/);
assert.deepEqual(await request('replica-settings',publicSetup),{peers,rpcUrl});
assert.deepEqual(await request('save-replica-settings',{...publicSetup,peers:[],rpcUrl:''}),{peers:[],rpcUrl:''});
const mailSocket=net.createServer().listen(0,'127.0.0.1');
await once(mailSocket,'listening');
const mailPort=mailSocket.address().port;
await new Promise(resolve=>mailSocket.close(resolve));
const mailSetup={...publicSetup,mailEnabled:true,mailPort};
await assert.rejects(request('prepare',{...mailSetup,mailPort:port}),/MAIL_REQUIRES_A_SEPARATE_PORT/);
await assert.rejects(request('prepare',{...mailSetup,isPublic:false}),/MAIL_REQUIRES_PUBLIC_MODE/);
const mailReady=await request('prepare',mailSetup);
assert.match(await fs.readFile(path.join(mailReady.state,'Caddyfile'),'utf8'),/handle \/kasmail\/v1\/\*/);
const {mailSettings,checkMail}=await import(pathToFileURL(path.join(payload,'app','windows','mail.mjs')));
const configMail=mailSettings(mailSetup,mailReady.state);
const cloudflareSetup={...mailSetup,mailCloudflare:true};
const cloudflareMail=mailSettings(cloudflareSetup,mailReady.state);
let mailIdentity;
const publicIdentity=await cycle({setup:mailSetup,verify:async(profile)=>{
 assert.equal(profile.url,'wss://node.example.com/peer');
 const signedMail=await checkMail(configMail,mailReady.state,{local:true});
 assert.equal(signedMail.network,'testnet-10');
 assert.equal(signedMail.url,'https://node.example.com/kasmail/v1/');
 assert.notEqual(signedMail.id,profile.nodeId);
 mailIdentity=signedMail.id;
 const denied=await fetch(`http://127.0.0.1:${mailPort}/kasmail/v1/hello?nonce=invalid`,{headers:{Origin:'https://unapproved.example.com',Host:'node.example.com'}});
 assert.equal(denied.status,403);
}});
let cloudflareIdentity;
const verifyBothOrigins=async()=>{
 const signedMail=await checkMail(configMail,mailReady.state,{local:true});
 assert.equal(signedMail.id,mailIdentity);
 const signedCloudflare=await checkMail(cloudflareMail,mailReady.state,{local:true});
 assert.notEqual(signedCloudflare.id,mailIdentity);
 if(cloudflareIdentity)assert.equal(signedCloudflare.id,cloudflareIdentity);
 cloudflareIdentity=signedCloudflare.id;
};
assert.equal(await cycle({setup:cloudflareSetup,verify:verifyBothOrigins}),publicIdentity);
assert.equal(await cycle({setup:cloudflareSetup,verify:verifyBothOrigins}),publicIdentity);
console.log('Windows payload passed: node restarts, persisted replication settings and separate k@sMail identities for both origins.');
