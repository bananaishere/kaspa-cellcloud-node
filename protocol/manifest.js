import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import {CELL,K,N,encode,decode} from './codec.js';
import {hash,isDigest,merkle,merkleProof} from './integrity.js';

export const MAX_CONTENT_BYTES=5*1024**3;
export const MAX_MANIFEST_BYTES=16*1024**2;
const stripeBytes=CELL*K;
const check=(condition,code)=>{if(!condition)throw Error(code);};
export function safeName(name){
 check(typeof name==='string'&&name.length>0&&name.length<=512&&!name.includes('\\')&&!/[\x00-\x1f\x7f]/.test(name)&&!name.startsWith('/')&&!name.split('/').some(p=>!p||p==='.'||p==='..')&&!name.includes(':'),'INVALID_FILE_NAME');return name;
}
export function validateManifest(manifest,id){
 const serialized=JSON.stringify(manifest);
 check(new TextEncoder().encode(serialized).length<=MAX_MANIFEST_BYTES,'MANIFEST_LIMIT');
 if(id!==undefined)check(isDigest(id)&&hash(serialized)===id,'MANIFEST_HASH_MISMATCH');
 check(manifest?.version===1&&manifest.cellBytes===CELL&&manifest.data===K&&manifest.total===N&&Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=10000,'INVALID_MANIFEST');
 if(manifest.author_pubkey!==undefined)check(isDigest(manifest.author_pubkey),'INVALID_AUTHOR');
 check(manifest.mode===undefined||['drive','web','vault'].includes(manifest.mode),'INVALID_CONTENT_MODE');
 const names=new Set();let size=0;
 const entries=[...manifest.files,...(manifest.originalArchive?[manifest.originalArchive]:[])];
 for(const file of entries){
  safeName(file.name);check(!names.has(file.name),'DUPLICATE_FILE_NAME');names.add(file.name);
  check(Number.isSafeInteger(file.length)&&file.length>=0&&isDigest(file.sha256)&&Array.isArray(file.stripes)&&file.stripes.length===Math.max(1,Math.ceil(file.length/stripeBytes)),'INVALID_FILE_ENTRY');
  size+=file.length;check(size<=MAX_CONTENT_BYTES,'CONTENT_SIZE_LIMIT');
  file.stripes.forEach((stripe,index)=>{
   const length=Math.min(stripeBytes,Math.max(0,file.length-index*stripeBytes));
   check(stripe.length===length&&Array.isArray(stripe.digests)&&stripe.digests.length===N&&stripe.digests.every(isDigest)&&merkle(stripe.digests)===stripe.root,'INVALID_STRIPE');
  });
 }
 return {sizeBytes:size,merkleRoot:merkle(entries.flatMap(f=>f.stripes.map(s=>s.root))),entries};
}

// Two passes keep memory bounded: analyse only retains hashes; transfer encodes
// one stripe at a time and releases it after every receiver acknowledgement.
export async function analyseFiles(files,{author,progress=()=>{},signal}={}){
 check(Array.isArray(files)&&files.length>0&&files.length<=10000,'FILES_REQUIRED');
 const total=files.reduce((sum,f)=>sum+f.size,0);check(Number.isSafeInteger(total)&&total<=MAX_CONTENT_BYTES,'CONTENT_SIZE_LIMIT');
 const sorted=[...files].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),entries=[];let done=0;
 for(const file of sorted){
  safeName(file.name);check(Number.isSafeInteger(file.size)&&file.size>=0&&typeof file.slice==='function','INVALID_FILE');
  const digest=sha256.create(),stripes=[];
  for(let offset=0;offset<file.size||offset===0;offset+=stripeBytes){
   signal?.throwIfAborted();const bytes=new Uint8Array(await file.slice(offset,offset+stripeBytes).arrayBuffer());digest.update(bytes);
   const digests=encode(bytes).map(hash);stripes.push({length:bytes.length,digests,root:merkle(digests)});
   done+=bytes.length;progress({phase:'analyse',done,total});
  }
  entries.push({name:file.name,length:file.size,sha256:bytesToHex(digest.digest()),stripes});
 }
 const manifest={version:1,cellBytes:CELL,data:K,total:N,files:entries,mode:'drive',...(author?{author_pubkey:author}:{})};
 const id=hash(JSON.stringify(manifest)),summary=validateManifest(manifest,id);return {id,manifest,...summary};
}
export async function encodeFileStripe(file,entry,index){
 check(Number.isSafeInteger(index)&&index>=0&&index<entry.stripes.length&&file.size===entry.length&&file.name===entry.name,'FILE_SELECTION_CHANGED');
 return encodeStripeSlice(file,{name:entry.name,length:entry.length,stripe:entry.stripes[index]},index);
}
export async function encodeStripeSlice(file,entry,index){
 check(Number.isSafeInteger(index)&&index>=0&&index<Math.max(1,Math.ceil(file.size/stripeBytes))&&file.size===entry.length&&file.name===entry.name,'FILE_SELECTION_CHANGED');
 const stripe=entry.stripe,bytes=new Uint8Array(await file.slice(index*stripeBytes,index*stripeBytes+stripe.length).arrayBuffer()),cells=encode(bytes);
 check(cells.every((cell,i)=>hash(cell)===stripe.digests[i]),'FILE_BYTES_CHANGED');
 return cells.map((bytes,shard)=>({bytes,shard,proof:merkleProof(stripe.digests,shard)}));
}
export function reconstructStripe(stripe,available){
 const checked=available.filter(item=>Number.isInteger(item.index)&&item.index>=0&&item.index<N&&item.data instanceof Uint8Array&&item.data.length===CELL&&hash(item.data)===stripe.digests[item.index]);
 const unique=[...new Map(checked.map(item=>[item.index,item])).values()];
 return decode(unique,stripe.length);
}
