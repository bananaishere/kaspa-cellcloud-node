import {schnorr} from '@noble/curves/secp256k1.js';
import {blake2b} from '@noble/hashes/blake2.js';
import {LEGACY_UPLOAD_LIMIT as PILOT_UPLOAD_LIMIT} from '../lab/lib/large-policy.mjs';
import {readVaultHeader,vaultPrefix,validateVaultHeader} from '../lab/lib/vault-format.mjs';
const utf8=value=>new TextEncoder().encode(value),hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex=value=>Uint8Array.from(value.match(/../g)||[],b=>parseInt(b,16));
const random=n=>crypto.getRandomValues(new Uint8Array(n));
export function vaultKeyMessage(owner){
  if(!/^[a-f0-9]{64}$/.test(owner))throw Error('INVALID_VAULT_OWNER');
  return 'Kaspa CellCloud PRIVATE VAULT KEY v1\nNetwork: testnet-10\nOwner: '+owner+'\nSECRET KEY MATERIAL: do not share, copy, publish or send this signature.\nOnly approve this request in the CellCloud app or your vault gateway.\nThis creates a private decryption factor. No payment or transaction.';
}
export function verifyVaultSignature(owner,signature){
  if(typeof signature!=='string'||!/^[a-f0-9]{128}$/.test(signature))throw Error('INVALID_VAULT_SIGNATURE');
  const hash=blake2b(utf8(vaultKeyMessage(owner)),{dkLen:32,key:utf8('PersonalMessageSigningHash')});
  if(!schnorr.verify(unhex(signature),hash,unhex(owner)))throw Error('INVALID_VAULT_SIGNATURE');
  return unhex(signature);
}
export async function vaultMasterKey(owner,password,signature){
  if(typeof password!=='string'||password.length<12||password.length>1024)throw Error('Usa uma palavra-passe com pelo menos 12 caracteres.');
  const factor=verifyVaultSignature(owner,signature),secret=utf8(password.normalize('NFC'));
  let pass,combined;
  try{
    const input=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveBits']);
    const salt=await crypto.subtle.digest('SHA-256',utf8('CellCloud/vault/password/v1/testnet-10/'+owner));
    pass=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},input,256));
    const walletHash=new Uint8Array(await crypto.subtle.digest('SHA-256',factor));combined=new Uint8Array(64);combined.set(pass);combined.set(walletHash,32);walletHash.fill(0);
    return await crypto.subtle.importKey('raw',combined,'HKDF',false,['deriveKey']);
  }finally{factor.fill(0);secret.fill(0);pass?.fill(0);combined?.fill(0);}
}
async function fileKey(master,header){return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:unhex(header.salt),info:utf8('CellCloud/vault/AES-256-GCM/v1/'+header.owner)},master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
const baseHeader=h=>({v:h.v,network:h.network,owner:h.owner,salt:h.salt,metadataIv:h.metadataIv,dataIv:h.dataIv});
const metadataAAD=h=>utf8(JSON.stringify(baseHeader(h)));
function metadata(value){
  if(!value||Object.keys(value).sort().join(',')!=='fileName,name,size,type'||typeof value.name!=='string'||!value.name.trim()||value.name.length>80||typeof value.fileName!=='string'||!value.fileName||value.fileName.length>240||/[\\/\u0000-\u001f]/.test(value.fileName)||typeof value.type!=='string'||value.type.length>100||!Number.isSafeInteger(value.size)||value.size<0||value.size>PILOT_UPLOAD_LIMIT)throw Error('INVALID_PRIVATE_METADATA');
  return value;
}
export function estimateVaultSize(file,name){
 const meta={name:name.trim()||'Cofre',fileName:file.name,type:file.type||'application/octet-stream',size:file.size};
 const h={v:1,network:'testnet-10',owner:'00'.repeat(32),salt:'00'.repeat(32),metadataIv:'00'.repeat(12),dataIv:'01'.repeat(12),metadataCipher:'00'.repeat(utf8(JSON.stringify(meta)).length+16)};
 return vaultPrefix(h).length+file.size+16;
}
export async function encryptVault(bytes,info,master,owner){
  bytes=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);const data=metadata({...info,size:bytes.length});
  const h={v:1,network:'testnet-10',owner,salt:hex(random(32)),metadataIv:hex(random(12)),dataIv:hex(random(12))};
  while(h.dataIv===h.metadataIv)h.dataIv=hex(random(12));
  const key=await fileKey(master,h),meta=utf8(JSON.stringify(data));
  h.metadataCipher=hex(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:unhex(h.metadataIv),additionalData:metadataAAD(h),tagLength:128},key,meta)));meta.fill(0);
  const prefix=vaultPrefix(h);if(prefix.length+bytes.length+16>PILOT_UPLOAD_LIMIT)throw Error('O ficheiro cifrado excede 500 MiB. Reduz ligeiramente o original.');
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:unhex(h.dataIv),additionalData:prefix,tagLength:128},key,bytes));
  const output=new Uint8Array(prefix.length+cipher.length);output.set(prefix);output.set(cipher,prefix.length);cipher.fill(0);return {bytes:output,header:h};
}
export async function decryptVaultMetadata(header,master){
  validateVaultHeader(header);const key=await fileKey(master,header);let clear;
  try{clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(header.metadataIv),additionalData:metadataAAD(header),tagLength:128},key,unhex(header.metadataCipher)));return metadata(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(clear)));}
  catch{throw Error('Carteira ou palavra-passe incorreta, ou cofre alterado.');}finally{clear?.fill(0);}
}
export async function decryptVault(bytes,master){
  const {header,offset}=readVaultHeader(bytes),info=await decryptVaultMetadata(header,master),key=await fileKey(master,header);
  if(bytes.length-offset!==info.size+16)throw Error('INVALID_VAULT_LENGTH');
  let clear;
  try{clear=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(header.dataIv),additionalData:bytes.subarray(0,offset),tagLength:128},key,bytes.subarray(offset)));return {info,bytes:clear};}
  catch{clear?.fill(0);throw Error('Carteira ou palavra-passe incorreta, ou cofre alterado.');}
}
