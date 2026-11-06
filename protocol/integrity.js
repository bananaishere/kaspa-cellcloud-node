import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
export const isDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const utf8=value=>new TextEncoder().encode(value);
export const hash=data=>bytesToHex(sha256(typeof data==='string'?utf8(data):data));
const join=(...parts)=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;};
const leaf=digest=>{if(!isDigest(digest))throw Error('INVALID_CELL_DIGEST');return sha256(join(Uint8Array.of(0),hexToBytes(digest)));};
const parent=(left,right)=>sha256(join(Uint8Array.of(1),left,right));
export function merkle(digests){
 let level=digests.map(leaf);if(!level.length)return hash(new Uint8Array());
 while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2)next.push(parent(level[i],level[i+1]||level[i]));level=next;}return bytesToHex(level[0]);
}
export function merkleProof(digests,index){
 if(!Number.isSafeInteger(index)||index<0||index>=digests.length)throw Error('INVALID_PROOF_INDEX');
 let level=digests.map(leaf),position=index;const siblings=[];
 while(level.length>1){siblings.push(bytesToHex(level[position^1]||level[position]));const next=[];for(let i=0;i<level.length;i+=2)next.push(parent(level[i],level[i+1]||level[i]));position=Math.floor(position/2);level=next;}
 return {index,count:digests.length,siblings};
}
export function verifyMerkleProof(digest,proof,root){
 if(!isDigest(digest)||!isDigest(root)||!Number.isSafeInteger(proof?.count)||proof.count<1||proof.count>65536||!Number.isSafeInteger(proof.index)||proof.index<0||proof.index>=proof.count||!Array.isArray(proof.siblings))return false;
 if(proof.siblings.length!==Math.ceil(Math.log2(proof.count))||proof.siblings.some(s=>!isDigest(s)))return false;
 let value=leaf(digest),position=proof.index,count=proof.count;
 for(const sibling of proof.siblings){if(position%2===0&&position+1===count&&sibling!==bytesToHex(value))return false;const bytes=hexToBytes(sibling);value=position%2?parent(bytes,value):parent(value,bytes);position=Math.floor(position/2);count=Math.ceil(count/2);}
 return bytesToHex(value)===root;
}
export function canonicalJson(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'){if(!Number.isSafeInteger(value))throw Error('NON_CANONICAL_NUMBER');return String(value);}
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJson(value[key])).join(',')+'}';
 throw Error('NON_CANONICAL_VALUE');
}
