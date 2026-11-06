import {ed25519} from '@noble/curves/ed25519.js';
import {hexToBytes,bytesToHex} from '@noble/hashes/utils.js';
import {hash,isDigest,canonicalJson,utf8} from '../protocol/integrity.js';
import {PROTOCOL,networkId,sameNetwork} from '../protocol/network.js';
import {pack,unpack,peerUrl} from '../protocol/wire.js';
import {replicaPeers} from '../protocol/replicas.js';

export class PeerClient{
 constructor({url,network='testnet-10',pin='',secureContext=false,socketFactory=value=>new WebSocket(value),timeoutMs=30000}){
  Object.assign(this,{url:peerUrl(url,{secureContext}),network:networkId(network),pin,socketFactory,timeoutMs});this.pending=new Map();this.sequence=0;this.trusted=false;this.socket=null;
 }
 async connect(){
  if(this.socket)throw Error('PEER_ALREADY_CONNECTED');
  const socket=this.socketFactory(this.url);this.socket=socket;socket.binaryType='arraybuffer';
  socket.addEventListener('message',event=>{
   try{
    if(typeof event.data==='string'&&event.data.length>18*1024**2)throw Error('PEER_RESPONSE_LIMIT');
    const binary=typeof event.data!=='string',frame=binary?unpack(new Uint8Array(event.data)):null,message=binary?frame.header:JSON.parse(event.data);
    const request=this.pending.get(message.id);if(!request)throw Error('UNEXPECTED_PEER_RESPONSE');
    this.pending.delete(message.id);clearTimeout(request.timer);
    if(message.ok!==true){request.reject(Error(typeof message.error==='string'?message.error:'PEER_REQUEST_FAILED'));return;}
    request.resolve(binary?frame.bytes:message.result);
   }catch{this.close('INVALID_PEER_RESPONSE');}
  });
  socket.addEventListener('close',()=>this.close('PEER_DISCONNECTED'));
  socket.addEventListener('error',()=>this.close('PEER_CONNECTION_FAILED'));
  try{
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.close();reject(Error('PEER_CONNECT_TIMEOUT'));},this.timeoutMs);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('PEER_CONNECTION_FAILED'));},{once:true});socket.addEventListener('close',()=>{clearTimeout(timer);reject(Error('PEER_DISCONNECTED'));},{once:true});});
   const nonce=bytesToHex(crypto.getRandomValues(new Uint8Array(32))),hello=await this.request('hello',{nonce});
   const b=hello?.body;
   if(!b||b.protocol!==PROTOCOL||b.nonce!==nonce||!isDigest(b.nodeId)||!isDigest(b.publicKey)||b.nodeId!==hash(hexToBytes(b.publicKey))||!Number.isSafeInteger(b.timestamp)||Math.abs(Date.now()-b.timestamp)>120000||typeof hello.signature!=='string'||!/^[a-f0-9]{128}$/.test(hello.signature)||!ed25519.verify(hexToBytes(hello.signature),utf8(canonicalJson(b)),hexToBytes(b.publicKey)))throw Error('PEER_IDENTITY_INVALID');
   sameNetwork(this.network,b.networkId);
   if(b.cellBytes!==128*1024||b.data!==10||b.total!==30)throw Error('PEER_CODEC_INCOMPATIBLE');
   if(this.pin&&this.pin!==b.nodeId)throw Error('PEER_IDENTITY_CHANGED');
   replicaPeers(b.replicas||[],b.nodeId);
   this.hello=b;this.trusted=Boolean(this.pin);return b;
  }catch(error){this.close();throw error;}
 }
 trust(nodeId){if(this.hello?.nodeId!==nodeId||!isDigest(nodeId))throw Error('PEER_IDENTITY_NOT_REVIEWED');this.pin=nodeId;this.trusted=true;}
 request(operation,args={},bytes){
  if(!this.socket||this.socket.readyState!==1)return Promise.reject(Error('PEER_DISCONNECTED'));
  if(operation!=='hello'&&!this.trusted)return Promise.reject(Error('PEER_IDENTITY_APPROVAL_REQUIRED'));
  if(this.pending.size>=2)return Promise.reject(Error('PEER_REQUEST_IN_PROGRESS'));
  const id=String(++this.sequence),request={id,protocol:PROTOCOL,networkId:this.network,operation,args};
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.close('PEER_REQUEST_TIMEOUT');},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});
   try{this.socket.send(bytes?pack(request,bytes):JSON.stringify(request));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);this.close();}
  });
 }
 close(code='PEER_DISCONNECTED'){
  const socket=this.socket;this.socket=null;this.trusted=false;
  for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(Error(code));}this.pending.clear();
  if(socket&&socket.readyState<2)socket.close();
 }
}

export class WorkerClient{
 constructor(url){this.worker=new Worker(url,{type:'module'});this.pending=new Map();this.sequence=0;this.closed=false;this.worker.onmessage=({data})=>{if(data.diagnostic){this.diagnostic=data.diagnostic;return;}const request=this.pending.get(data.id);if(!request)return;if(data.progress){request.progress?.(data.progress);return;}this.pending.delete(data.id);data.error?request.reject(Error(data.error)):request.resolve(data.result);};this.worker.onerror=event=>this.close('WORKER_FAILED: '+(this.diagnostic||event.message||'module load failed'));}
 call(operation,args={},progress){if(this.closed)return Promise.reject(Error('WORKER_CLOSED_RETRY'));const id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject,progress});try{this.worker.postMessage({id,operation,...args});}catch(error){this.pending.delete(id);reject(error);}});}
 close(code='OPERATION_CANCELLED'){this.closed=true;this.worker.terminate();for(const pending of this.pending.values())pending.reject(Error(code));this.pending.clear();}
}

export function savedPeers(storage,network){
 try{const data=JSON.parse(storage.getItem('cellcloud-peers-v1:'+network)||'[]');if(!Array.isArray(data))return [];return data.filter(p=>typeof p?.url==='string'&&isDigest(p.nodeId)).slice(0,16).map(p=>({url:peerUrl(p.url),nodeId:p.nodeId}));}catch{return [];}
}
export function rememberPeer(storage,network,peer){const list=savedPeers(storage,network).filter(p=>p.url!==peer.url);storage.setItem('cellcloud-peers-v1:'+network,JSON.stringify([{url:peerUrl(peer.url),nodeId:peer.nodeId},...list].slice(0,16)));}
