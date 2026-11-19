import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {hash,isDigest,utf8} from '../protocol/integrity.js';
import {peerUrl} from '../protocol/wire.js';

const base64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const join=(...parts)=>{const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;};
const checksum=(name,bytes)=>hexToBytes(hash(join(utf8(name),bytes)).slice(0,8));
const fail=()=>{throw Error('INVALID_COMPACT_FILE_LINK');};

// Self-contained, versioned binary encoding: all 256-bit identities remain
// intact. No shortener service, peer directory lookup or private token.
export function compactFileHash({id,application,name='',peers,language='en'}){
 const stable=Boolean(application),root=stable?application.rootManifestId:id;
 if(!isDigest(root)||stable&&!isDigest(application.author)||!Array.isArray(peers)||peers.length<1||peers.length>4)fail();
 const label=new TextDecoder().decode(utf8(String(name).slice(0,80))),parts=[Uint8Array.of(0x10|(stable?1:0)|(language==='pt'?2:0)),hexToBytes(root)];
 if(stable)parts.push(hexToBytes(application.author));parts.push(Uint8Array.of(peers.length));
 for(const peer of peers){
  if(!isDigest(peer.nodeId))fail();const url=new URL(peerUrl(peer.url)),extended=url.pathname!=='/peer',host=utf8(extended?url.href:url.host);if(host.length>1024)fail();
  parts.push(hexToBytes(peer.nodeId),Uint8Array.of(extended?2:url.protocol==='ws:'?1:0,host.length>>8,host.length&255),host);
 }
 const body=join(...parts),fragment=encodeURIComponent(label).replaceAll('~','%7E')+'~c1.'+base64(join(body,checksum(label,body)));
 if(fragment.length>5999)throw Error('VIEWER_LINK_LIMIT');return fragment;
}
export function expandCompactFileHash(fragment){
 if(typeof fragment!=='string'||fragment.length>6000)fail();
 const match=/^#([^~]*)~c1\.([A-Za-z0-9_-]+)$/.exec(fragment);if(!match)fail();let name,bytes;
 try{name=decodeURIComponent(match[1]);const token=match[2];bytes=Uint8Array.from(atob(token.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-token.length%4)%4)),c=>c.charCodeAt(0));if(base64(bytes)!==token)fail();}catch{fail();}
 if(name.length>80||bytes.length<38)fail();
 const body=bytes.subarray(0,-4);if(bytesToHex(bytes.subarray(-4))!==bytesToHex(checksum(name,body)))throw Error('COMPACT_FILE_LINK_CHECKSUM');
 let offset=0;const read=length=>{if(offset+length>body.length)fail();const part=body.subarray(offset,offset+length);offset+=length;return part;};
 const flags=read(1)[0];if((flags&0xfc)!==0x10)fail();const root=bytesToHex(read(32)),stable=Boolean(flags&1),author=stable?bytesToHex(read(32)):null,count=read(1)[0],peers=[];
 if(count<1||count>4)fail();
 for(let index=0;index<count;index++){
  const nodeId=bytesToHex(read(32)),header=read(3),length=(header[1]<<8)|header[2];if(header[0]>2||length<1||length>1024)fail();
  let host;try{host=new TextDecoder('utf-8',{fatal:true}).decode(read(length));}catch{fail();}
  peers.push({nodeId,url:peerUrl(header[0]===2?host:(header[0]?'ws://':'wss://')+host+'/peer')});
 }
 if(offset!==body.length)fail();
 return new URLSearchParams({network:'testnet-10',...(stable?{app:root,author}:{manifest:root}),name,peers:JSON.stringify(peers),lang:flags&2?'pt':'en'}).toString();
}
