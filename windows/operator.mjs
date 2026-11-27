import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
import WebSocket from 'ws';
import {operatorTemplate} from '../protocol/operator-template.js';
import {validateOperatorConfig} from '../peer/operator-config.mjs';
import {diagnoseOperator} from '../peer/operator-doctor.mjs';
import {isDigest} from '../protocol/integrity.js';
import {validateManifest} from '../protocol/manifest.js';
import {peerUrl} from '../protocol/wire.js';
import {PeerClient} from '../src/peer-client.js';
import {publicationCopies} from '../src/peer-replica-status.js';
import {mailSettings,startMail,checkMail} from './mail.mjs';

const publicOrigin='https://kaspacellcloud.vercel.app';
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
let inputClosed=false;
let closeMail=async()=>{};
const stop=async()=>{await closeMail();process.emit('SIGTERM');};
input.once('close',()=>{inputClosed=true;if(process.listenerCount('SIGTERM'))void stop();});
const [command]=process.argv.slice(2);
const options=JSON.parse((await input[Symbol.asyncIterator]().next()).value);
const {isPublic,hostname,name,quotaGiB,port,folder,uploads}=options;
const domain=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
if(isPublic&&(!domain.test(hostname)||/\.(?:local|localhost|internal|test|invalid|onion|home\.arpa)$/.test(hostname)||!name||name.length>60))throw Error('PUBLIC_NAME_AND_HOSTNAME_REQUIRED');
if(!Number.isInteger(quotaGiB)||quotaGiB<1||quotaGiB>1024||!path.isAbsolute(folder))throw Error('INVALID_STORAGE_SETTINGS');

const url=isPublic?`wss://${hostname}/peer`:`ws://127.0.0.1:${port}/peer`;
const state=path.resolve(folder,isPublic?'public-testnet':'private-testnet');
const mail=['prepare','start','diagnose','check-mail'].includes(command)?mailSettings(options,state):null;
const configFile=path.join(state,'node.json');
const local={...operatorTemplate(),port,quotaBytes:quotaGiB*1024**3,data:path.join(state,'storage'),logFile:path.join(state,'logs','node.log'),
 publicUrl:url,reverseProxyTls:isPublic,publicUploads:{enabled:isPublic&&uploads===true}};
if(isPublic){local.origins=[publicOrigin];local.viewerOrigins=[];}
const config=validateOperatorConfig(local,{directory:state});
const readSettings=()=>fs.readFile(configFile,'utf8').then(JSON.parse,error=>{if(error.code!=='ENOENT')throw error;return null;});
async function writeSettings(settings){
 validateOperatorConfig(settings,{directory:state});
 await fs.mkdir(state,{recursive:true});
 const next=`${configFile}.${process.pid}.tmp`;
 try{await fs.writeFile(next,JSON.stringify(settings,null,2)+'\n',{flag:'wx'});await fs.rename(next,configFile);}
 finally{await fs.rm(next,{force:true});}
}

if(command==='prepare'){
 const existing=await readSettings();
 local.expectedNodeId=existing?.expectedNodeId??null;
 local.peers=existing?.peers??[];
 local.rpcUrl=existing?.rpcUrl??'';
 await writeSettings(local);
 if(isPublic){
  const routes=mail?`\thandle /kasmail/v1/* {\n\t\treverse_proxy 127.0.0.1:${mail.port}\n\t}\n\thandle {\n\t\treverse_proxy 127.0.0.1:${port}\n\t}`:`\treverse_proxy 127.0.0.1:${port}`;
  await fs.writeFile(path.join(state,'Caddyfile'),`{\n\tadmin off\n\tskip_install_trust\n}\n${hostname} {\n${routes}\n}\n`);
 }
 console.log(JSON.stringify({state,configFile,url}));
}else if(command==='diagnose'){
 const pinned=await readSettings();
 const localReport=await diagnoseOperator({...config,expectedNodeId:pinned.expectedNodeId??null,publicUrl:`ws://127.0.0.1:${port}/peer`});
 let publicReachable=false;
 if(isPublic){
  try{const result=await diagnoseOperator({...config,expectedNodeId:localReport.nodeId});publicReachable=result.signedHandshake;}
  catch{ /* a local success does not prove TLS or public reachability */ }
 }
 const profile={version:1,networkId:'testnet-10',name,url,nodeId:localReport.nodeId};
 if(pinned.expectedNodeId&&pinned.expectedNodeId!==profile.nodeId)throw Error('CONFIGURED_NODE_IDENTITY_MISMATCH');
 if(!pinned.expectedNodeId){
  pinned.expectedNodeId=profile.nodeId;
  await writeSettings(pinned);
 }
 console.log(JSON.stringify({profile,publicReachable,quotaBytes:localReport.quotaBytes,replication:localReport.replication}));
}else if(command==='check-mail'){
 if(!mail)throw Error('MAIL_SERVICE_DISABLED');
 let profile,publicReachable=false;
 try{profile=await checkMail(mail,state,{local:true});}catch{}
 if(profile){try{await checkMail(mail,state);publicReachable=true;}catch{}}
 console.log(JSON.stringify({localReady:Boolean(profile),publicReachable,...(publicReachable?{profile}:{})}));
}else if(command==='replica-settings'||command==='save-replica-settings'){
 if(!isPublic)throw Error('REPLICATION_REQUIRES_PUBLIC_MODE');
 const settings=await readSettings()||local;
 if(command==='save-replica-settings'){
  settings.peers=options.peers;
  if(Object.hasOwn(options,'rpcUrl'))settings.rpcUrl=options.rpcUrl;
  const {peers}=validateOperatorConfig(settings,{directory:state});
  if(peers.some(peer=>!peer.url.startsWith('wss:')||peer.url===peerUrl(url)))throw Error('REPLICATION_REQUIRES_ANOTHER_WSS_NODE');
  settings.peers=peers;
  await writeSettings(settings);
 }
 console.log(JSON.stringify({peers:settings.peers||[],rpcUrl:settings.rpcUrl||''}));
}else if(command==='replica-copy'){
 const manifestId=options.manifestId;
 if(!isPublic||!isDigest(manifestId))throw Error('REPLICATION_MANIFEST_ID_REQUIRED');
 const settings=await readSettings();
 const active=validateOperatorConfig(settings,{directory:state});
 const peer=new PeerClient({url:`ws://127.0.0.1:${active.port}/peer`,network:active.network,pin:active.expectedNodeId||'',timeoutMs:7000,
  socketFactory:value=>new WebSocket(value,{headers:{Origin:active.origins[0]}})});
 try{
  const hello=await peer.connect();
  const publication=await peer.request('manifest',{manifestId});
  const metadata=validateManifest(publication.manifest,manifestId);
  const result=await peer.request('publicationStatus',{manifestId});
  console.log(JSON.stringify(publicationCopies(result,{id:manifestId,network:active.network,nodeId:hello.nodeId,transactionId:publication.transactionId},metadata,active.peers)));
 }finally{peer.close();}
}else if(command==='start'){
 if(mail)closeMail=await startMail(mail,state);
 process.argv=[process.execPath,'peer/cli.mjs','--config',configFile];
 await import('../peer/cli.mjs');
 if(inputClosed)await stop();
}else throw Error('UNKNOWN_DESKTOP_COMMAND');
if(command!=='start')input.close();
