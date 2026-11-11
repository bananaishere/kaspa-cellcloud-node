import {schnorr} from '@noble/curves/secp256k1.js';
import {blake2b} from '@noble/hashes/blake2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {canonicalJson,isDigest,utf8} from './integrity.js';
import {accountScript} from '../src/wallet-verifier.js';

export const DEFAULT_PUBLIC_UPLOADS=Object.freeze({enabled:false,maxFileBytes:50*1024**2,maxPendingBytes:128*1024**2,maxPendingPerWallet:2,maxPendingTotal:8});
export function publicUploadPolicy(value){
 if(value===undefined)return {...DEFAULT_PUBLIC_UPLOADS};
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(DEFAULT_PUBLIC_UPLOADS,k)))throw Error('INVALID_PUBLIC_UPLOAD_POLICY');
 const p={...DEFAULT_PUBLIC_UPLOADS,...value};
 if(typeof p.enabled!=='boolean'||!Number.isSafeInteger(p.maxFileBytes)||p.maxFileBytes<1||p.maxFileBytes>5*1024**3||!Number.isSafeInteger(p.maxPendingBytes)||p.maxPendingBytes<30*128*1024||p.maxPendingBytes>1024**4||!Number.isInteger(p.maxPendingPerWallet)||p.maxPendingPerWallet<1||p.maxPendingPerWallet>8||!Number.isInteger(p.maxPendingTotal)||p.maxPendingTotal<p.maxPendingPerWallet||p.maxPendingTotal>64)throw Error('INVALID_PUBLIC_UPLOAD_POLICY');
 return p;
}
export const uploadAdmissionMessage=body=>'Kaspa CellCloud Testnet upload access (not a payment)\n'+canonicalJson(body);
export function verifyUploadChallenge(challenge,expected,{now=Date.now()}={}){
 const b=challenge?.body,fields='address,author_pubkey,expiresAt,issuedAt,networkId,nodeId,nonce,origin,policy,protocol,version';
 if(!b||Object.keys(b).sort().join(',')!==fields||b.protocol!=='cellcloud-upload-access'||b.version!==1||b.networkId!=='testnet-10'||!isDigest(b.nodeId)||!isDigest(b.author_pubkey)||!isDigest(b.nonce)||!Number.isSafeInteger(b.issuedAt)||!Number.isSafeInteger(b.expiresAt)||b.issuedAt>now+1000||b.expiresAt<=now||b.expiresAt-b.issuedAt!==120000||challenge.message!==uploadAdmissionMessage(b))throw Error('INVALID_UPLOAD_CHALLENGE');
 if(!expected||['nodeId','origin','address','author_pubkey'].some(k=>b[k]!==expected[k]))throw Error('UPLOAD_CHALLENGE_CONTEXT_CHANGED');
 if(expected.policy&&canonicalJson(expected.policy)!==canonicalJson(b.policy))throw Error('UPLOAD_CHALLENGE_CONTEXT_CHANGED');
 let origin;try{origin=new URL(b.origin);}catch{throw Error('INVALID_UPLOAD_CHALLENGE');}
 if(origin.origin!==b.origin||!['https:','http:'].includes(origin.protocol)||origin.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(origin.hostname)||accountScript(b.address,{testnetOnly:true})!=='000020'+b.author_pubkey+'ac'||!publicUploadPolicy(b.policy).enabled||canonicalJson(publicUploadPolicy(b.policy))!==canonicalJson(b.policy))throw Error('INVALID_UPLOAD_CHALLENGE');
 return b;
}
export function verifyUploadSignature(challenge,signature,expected,options){
 const b=verifyUploadChallenge(challenge,expected,options);let valid=false;
 try{valid=typeof signature==='string'&&/^[a-f0-9]{128}$/.test(signature)&&schnorr.verify(hexToBytes(signature),blake2b(utf8(challenge.message),{dkLen:32,key:utf8('PersonalMessageSigningHash')}),hexToBytes(b.author_pubkey));}catch{}
 if(!valid)throw Error('UPLOAD_SIGNATURE_INVALID');return b;
}
