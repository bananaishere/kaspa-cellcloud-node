import {createServer,get} from 'node:http';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import path from 'node:path';

const legacyOrigin='https://kasmail-cellcloud-nodes-bananalab360.vercel.app';
const cloudflareOrigin='https://kasmail.ramalholab.workers.dev';
const prefix='/kasmail/v1/';
const bundled=Boolean(await import('node:fs/promises').then(fs=>fs.stat(new URL('../mail-kit/server/public-mail-node.mjs',import.meta.url)).then(()=>true,error=>{if(error.code!=='ENOENT')throw error;return false;})));

export function mailSettings({isPublic,mailEnabled,mailCloudflare,mailPort,port,hostname,name},state){
 if(mailEnabled!==true)return null;
 if(!isPublic||!bundled)throw Error('MAIL_REQUIRES_PUBLIC_MODE_AND_OPERATOR_KIT');
 if(!Number.isInteger(mailPort)||mailPort<1024||mailPort>65535||mailPort===port)throw Error('MAIL_REQUIRES_A_SEPARATE_PORT');
 const legacy={enabled:true,network:'testnet-10',name,port:mailPort,data:path.join(state,'mail-storage'),
  applicationOrigin:legacyOrigin,publicUrl:`https://${hostname}${prefix}`};
 if(mailCloudflare!==true)return legacy;
 return {...legacy,data:path.join(state,'mail-storage-cloudflare'),applicationOrigin:cloudflareOrigin,legacy};
}

async function service(config,state){
 const {createPublicMailNode}=await import('../mail-kit/server/public-mail-node.mjs');
 return createPublicMailNode({config,configDirectory:state});
}

export async function startMail(config,state){
 const {handler}=await service(config,state);
 const legacy=config.legacy?await service(config.legacy,state):null;
 const server=createServer((request,response)=>{
  if(legacy&&request.headers.origin===config.legacy.applicationOrigin)return legacy.handler(request,response);
  return handler(request,response);
 });
 server.requestTimeout=15000;
 server.headersTimeout=10000;
 server.listen(config.port,'127.0.0.1');
 await once(server,'listening');
 return ()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
}

export async function checkMail(config,state,{local=false}={}){
 const origin=config.applicationOrigin;
 const {profile}=await service(config,state);
 const {verifyNodeSignature}=await import('../mail-kit/src/node-protocol.mjs');
 const nonce=randomUUID();
 const url=new URL('hello',local?`http://127.0.0.1:${config.port}${prefix}`:profile.url);
 url.searchParams.set('nonce',nonce);
 const signal=AbortSignal.timeout(6000);
 const response=local?await new Promise((resolve,reject)=>{
  get(url,{headers:{Origin:origin,Host:new URL(profile.url).host},signal},resolve).on('error',reject);
 }):await fetch(url,{headers:{Origin:origin},redirect:'error',signal});
 const status=response.statusCode??response.status;
 const allowed=local?response.headers['access-control-allow-origin']:response.headers.get('Access-Control-Allow-Origin');
 if(status!==200||allowed!==origin){if(local)response.destroy();else await response.body?.cancel();throw Error('MAIL_ENDPOINT_UNAVAILABLE_'+status);}
 let bytes=0;
 const parts=[];
 for await(const part of local?response:response.body){
  bytes+=part.length;
  if(bytes>8192)throw Error('MAIL_CHALLENGE_TOO_LARGE');
  parts.push(part);
 }
 const signed=JSON.parse(Buffer.concat(parts).toString('utf8'));
 await verifyNodeSignature(signed,profile);
 const proof=signed.data;
 if(proof.kind!=='public-mail'||proof.network!=='testnet-10'||proof.origin!==origin||proof.nonce!==nonce||
  !Number.isSafeInteger(proof.issuedAt)||Math.abs(Date.now()-proof.issuedAt)>60000)throw Error('MAIL_ENDPOINT_IDENTITY_MISMATCH');
 return profile;
}
