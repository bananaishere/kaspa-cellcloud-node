import fs from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {createSecureContext} from 'node:tls';
import {networkId} from '../protocol/network.js';
import {peerUrl} from '../protocol/wire.js';
import {isDigest} from '../protocol/integrity.js';
import {replicaPeers} from '../protocol/replicas.js';
import {viewerBase} from '../viewer/policy.js';

const allowed='version,network,host,port,data,quotaBytes,origins,viewerOrigins,peers,rpcUrl,logFile,publicUrl,expectedNodeId,syncIntervalMs,repairIntervalMs,reverseProxyTls,tls'.split(',');
const loopback=host=>['127.0.0.1','localhost','::1'].includes(host);
const check=(value,code)=>{if(!value)throw Error(code);};
const interval=value=>Number.isSafeInteger(value)&&value>=250&&value<=3600000;
function filePath(value,base){check(typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\0'),'INVALID_OPERATOR_PATH');return path.resolve(base,value);}
function origins(value){check(Array.isArray(value)&&value.length>0&&value.length<=16,'INVALID_ALLOWED_ORIGIN');return value.map(origin=>{let parsed;try{parsed=new URL(origin);}catch{throw Error('INVALID_ALLOWED_ORIGIN');}check(parsed.origin===origin&&!parsed.username&&!parsed.password&&['http:','https:'].includes(parsed.protocol)&&(parsed.protocol==='https:'||['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)),'INVALID_ALLOWED_ORIGIN');return origin;});}
export function validateOperatorConfig(input,{directory=process.cwd()}={}){
 check(input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).every(key=>allowed.includes(key))&&input.version===1,'INVALID_OPERATOR_CONFIG');
 const network=networkId(input.network),host=input.host??'127.0.0.1',port=input.port??8080;
 check(typeof host==='string'&&(host==='localhost'||isIP(host)!==0),'INVALID_BIND_HOST');check(Number.isSafeInteger(port)&&port>=1&&port<=65535,'INVALID_PORT');
 check(Number.isSafeInteger(input.quotaBytes)&&input.quotaBytes>=128*1024*30,'INVALID_STORAGE_QUOTA');
 const data=filePath(input.data,directory);check(data!==path.parse(data).root,'INVALID_OPERATOR_PATH');
 const expectedNodeId=input.expectedNodeId??null;check(expectedNodeId===null||isDigest(expectedNodeId),'INVALID_EXPECTED_NODE_ID');
 const browserOrigins=origins(input.origins),viewerOrigins=input.viewerOrigins??[];check(Array.isArray(viewerOrigins)&&viewerOrigins.length<=16,'INVALID_VIEWER_ORIGINS');
 for(const template of viewerOrigins)viewerBase(template,'http://127.0.0.1:5191');
 const peers=replicaPeers(input.peers??[],expectedNodeId),rpcUrl=input.rpcUrl??'';
 if(rpcUrl){let url;try{url=new URL(rpcUrl);}catch{throw Error('INVALID_OPERATOR_RPC');}check(!url.username&&!url.password&&!url.hash&&!url.search&&['ws:','wss:'].includes(url.protocol)&&(url.protocol==='wss:'||['127.0.0.1','localhost','[::1]'].includes(url.hostname)),'INVALID_OPERATOR_RPC');}
 check(typeof rpcUrl==='string','INVALID_OPERATOR_RPC');
 const syncIntervalMs=input.syncIntervalMs??5000,repairIntervalMs=input.repairIntervalMs??60000;check(interval(syncIntervalMs)&&interval(repairIntervalMs),'INVALID_REPLICA_INTERVAL');
 const reverseProxyTls=input.reverseProxyTls??false;check(typeof reverseProxyTls==='boolean','INVALID_OPERATOR_TLS');let tls=null;
 if(input.tls!==null&&input.tls!==undefined){check(typeof input.tls==='object'&&!Array.isArray(input.tls)&&Object.keys(input.tls).sort().join(',')==='certFile,keyFile'&&!reverseProxyTls,'INVALID_OPERATOR_TLS');tls={certFile:filePath(input.tls.certFile,directory),keyFile:filePath(input.tls.keyFile,directory)};}
 const publicUrl=input.publicUrl?peerUrl(input.publicUrl):null;
 check(loopback(host)||Boolean(tls)||reverseProxyTls,'REMOTE_LISTEN_REQUIRES_TLS');check(!reverseProxyTls||publicUrl?.startsWith('wss://'),'TLS_PROXY_PUBLIC_WSS_REQUIRED');
 if(publicUrl&&tls)check(publicUrl.startsWith('wss://'),'DIRECT_TLS_REQUIRES_WSS');
 if(publicUrl&&!tls&&!reverseProxyTls)check(new URL(publicUrl).protocol==='ws:'&&loopback(host),'WSS_REQUIRES_TLS_OR_PROXY');
 if(!loopback(host))check(publicUrl?.startsWith('wss://'),'REMOTE_PUBLIC_WSS_REQUIRED');
 const logFile=input.logFile?filePath(input.logFile,directory):null;
 if(logFile){const relative=path.relative(path.join(data,network),logFile);check(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative),'LOG_FILE_OUTSIDE_NETWORK_STORAGE_REQUIRED');}
 return {version:1,network,host,port,data,quotaBytes:input.quotaBytes,origins:browserOrigins,viewerOrigins,peers,rpcUrl,logFile,publicUrl,expectedNodeId,syncIntervalMs,repairIntervalMs,reverseProxyTls,tls};
}
export async function readOperatorConfig(file){
 const absolute=path.resolve(file),stat=await fs.stat(absolute);check(stat.isFile()&&stat.size<=32768,'OPERATOR_CONFIG_LIMIT');let input;try{input=JSON.parse(await fs.readFile(absolute,'utf8'));}catch{throw Error('INVALID_OPERATOR_CONFIG_JSON');}
 return validateOperatorConfig(input,{directory:path.dirname(absolute)});
}
export async function operatorTls(config){
 if(!config.tls)return undefined;let cert,key;
 try{cert=await fs.readFile(config.tls.certFile);key=await fs.readFile(config.tls.keyFile);createSecureContext({cert,key});}catch{throw Error('OPERATOR_TLS_FILES_INVALID');}
 return {cert,key};
}
export function operatorConfigReport(config){return {valid:true,network:config.network,host:config.host,port:config.port,data:config.data,quotaBytes:config.quotaBytes,origins:config.origins,viewerOrigins:config.viewerOrigins,replicationPeers:config.peers.length,publicUrl:config.publicUrl,tlsMode:config.tls?'direct':config.reverseProxyTls?'proxy':'loopback',identityPinned:Boolean(config.expectedNodeId),mainnetPayments:false,started:false,paymentRequested:false};}
