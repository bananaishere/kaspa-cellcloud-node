export const VAULT_FILE='content.ccvault',VAULT_MAGIC=new TextEncoder().encode('CCVAULT1'),VAULT_HEADER_LIMIT=8192;
const hex=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value);
export function validateVaultHeader(h){
  if(!h||Object.keys(h).sort().join(',')!=='dataIv,metadataCipher,metadataIv,network,owner,salt,v'||h.v!==1||h.network!=='testnet-10'||!hex(h.owner,64)||!hex(h.salt,64)||!hex(h.dataIv,24)||!hex(h.metadataIv,24)||h.dataIv===h.metadataIv||!hex(h.metadataCipher,h.metadataCipher?.length)||h.metadataCipher.length<32||h.metadataCipher.length>4096||h.metadataCipher.length%2)throw Error('INVALID_VAULT_HEADER');
  return h;
}
export function vaultHeaderBytes(h){validateVaultHeader(h);return new TextEncoder().encode(JSON.stringify(h));}
export function vaultPrefix(h){const header=vaultHeaderBytes(h),bytes=new Uint8Array(12+header.length);bytes.set(VAULT_MAGIC);new DataView(bytes.buffer).setUint32(8,header.length);bytes.set(header,12);return bytes;}
export function readVaultHeader(value){
  const bytes=value instanceof Uint8Array?value:new Uint8Array(value);
  if(bytes.length<12||!VAULT_MAGIC.every((b,i)=>bytes[i]===b))throw Error('INVALID_VAULT_CONTAINER');
  const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8);
  if(length<1||length>VAULT_HEADER_LIMIT||bytes.length<12+length)throw Error('INVALID_VAULT_HEADER_LENGTH');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length)),header=validateVaultHeader(JSON.parse(raw));
  if(JSON.stringify(header)!==raw)throw Error('NONCANONICAL_VAULT_HEADER');
  return {header,offset:12+length};
}
