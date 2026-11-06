import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {canonicalJson,hash,isDigest,utf8} from './integrity.js';

export const STORAGE_RECEIPT_AGE=120000;
const fields='protocol,version,networkId,nodeId,publicKey,manifestId,transactionId,merkleRoot,checkedAt,issuedAt,nonce'.split(',');
const message=body=>utf8('CellCloud verified storage receipt v1\n'+canonicalJson(body));
export function signStorageReceipt(store,{manifestId,transactionId,merkleRoot,checkedAt,nonce}){
 const body={protocol:'cellcloud-storage-receipt',version:1,networkId:store.network,nodeId:store.nodeId,publicKey:store.publicKey,manifestId,transactionId,merkleRoot,checkedAt,issuedAt:store.now(),nonce};
 return {body,signature:bytesToHex(ed25519.sign(message(body),store.secret))};
}
export function verifyStorageReceipt(receipt,expected,{now=Date.now(),nonce}={}){
 const b=receipt?.body,fail=()=>{throw Error('INVALID_STORAGE_RECEIPT');};
 if(!b||Object.keys(b).length!==fields.length||!fields.every(k=>Object.hasOwn(b,k))||b.protocol!=='cellcloud-storage-receipt'||b.version!==1||b.networkId!==expected.networkId)fail();
 for(const k of ['nodeId','publicKey','manifestId','transactionId','merkleRoot','nonce'])if(!isDigest(b[k]))fail();
 for(const k of ['nodeId','manifestId','transactionId','merkleRoot'])if(b[k]!==expected[k])fail();
 if(hash(hexToBytes(b.publicKey))!==b.nodeId||nonce&&b.nonce!==nonce)fail();
 if(!Number.isSafeInteger(b.checkedAt)||!Number.isSafeInteger(b.issuedAt)||b.checkedAt<=0||b.checkedAt>b.issuedAt||b.issuedAt>now+1000||now-b.checkedAt>STORAGE_RECEIPT_AGE)throw Error('STORAGE_RECEIPT_EXPIRED');
 if(typeof receipt.signature!=='string'||!/^[a-f0-9]{128}$/.test(receipt.signature)||!ed25519.verify(hexToBytes(receipt.signature),message(b),hexToBytes(b.publicKey)))fail();
 return b;
}
