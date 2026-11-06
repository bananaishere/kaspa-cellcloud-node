import {CELL} from './codec.js';
import {canonicalJson,utf8} from './integrity.js';
export const HEADER_LIMIT=8192,FRAME_LIMIT=CELL+HEADER_LIMIT+4;
export function pack(header,bytes=new Uint8Array()){
 const encoded=utf8(canonicalJson(header));
 if(encoded.length>HEADER_LIMIT||!(bytes instanceof Uint8Array)||bytes.length>CELL)throw Error('FRAME_LIMIT');
 const frame=new Uint8Array(4+encoded.length+bytes.length);new DataView(frame.buffer).setUint32(0,encoded.length);frame.set(encoded,4);frame.set(bytes,4+encoded.length);return frame;
}
export function unpack(frame){
 if(!(frame instanceof Uint8Array)||frame.length<6||frame.length>FRAME_LIMIT)throw Error('INVALID_FRAME');
 const size=new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getUint32(0);
 if(size<2||size>HEADER_LIMIT||size+4>frame.length)throw Error('INVALID_FRAME_HEADER');
 const header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(frame.subarray(4,4+size)));
 if(!header||Array.isArray(header)||typeof header!=='object')throw Error('INVALID_FRAME_HEADER');
 return {header,bytes:frame.subarray(4+size)};
}
export function peerUrl(value,{secureContext=false}={}){
 const url=new URL(value),local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password||url.hash||url.search||url.pathname!=='/peer'||url.protocol==='ws:'&&(!local||secureContext))throw Error('PEER_REQUIRES_WSS_OR_LOCAL_WS');
 return url.href;
}
