import {schnorr} from '@noble/curves/secp256k1.js';
import {blake2b} from '@noble/hashes/blake2.js';
import {hexToBytes} from '@noble/hashes/utils.js';
import {canonicalJson,hash,isDigest,utf8} from './integrity.js';

const prefix='Kaspa CellCloud P2P version authorization\n';
const fields='protocol,version,networkId,operation,appId,name,rootManifestId,originalMerkleRoot,previousManifestId,previousProof,manifestId,merkleRoot,author_pubkey,revision,transactionId,issuedAt,expiresAt,nonce'.split(',');
export const appIdFor=root=>'owned-'+root.slice(0,48);
export const headMessage=body=>prefix+canonicalJson(body);
export const proofHash=record=>hash(canonicalJson(record));
export function headRelation(left,right){
 const a=verifyHeadChain(left),b=verifyHeadChain(right);
 if(a.rootManifestId!==b.rootManifestId||a.author_pubkey!==b.author_pubkey||proofHash(left[Math.min(left.length,right.length)-1])!==proofHash(right[Math.min(left.length,right.length)-1]))return 'conflict';
 return left.length===right.length?'same':left.length>right.length?'behind':'ahead';
}
export function verifyHeadFork(conflict,{rootManifestId,author}={}){
 const left=verifyHeadChain(conflict?.left,{rootManifestId,author});verifyHeadChain(conflict?.right,{rootManifestId:left.rootManifestId,author:left.author_pubkey});
 if(headRelation(conflict.left,conflict.right)!=='conflict')throw Error('INVALID_HEAD_CONFLICT_PROOF');return true;
}
const check=(value,code)=>{if(!value)throw Error(code);};
export function validateHeadBody(body){
 check(body&&Object.keys(body).length===fields.length&&fields.every(key=>Object.hasOwn(body,key)),'INVALID_HEAD_FIELDS');
 check(body.protocol==='cellcloud-peer-head'&&body.version===1&&body.networkId==='testnet-10','INVALID_HEAD_PROTOCOL');
 for(const key of ['rootManifestId','originalMerkleRoot','manifestId','merkleRoot','author_pubkey','transactionId','nonce'])check(isDigest(body[key]),'INVALID_HEAD_DIGEST');
 check(body.appId===appIdFor(body.rootManifestId)&&typeof body.name==='string'&&body.name.trim()===body.name&&body.name.length>0&&body.name.length<=80,'INVALID_HEAD_NAME');
 check(Number.isSafeInteger(body.issuedAt)&&body.issuedAt>0&&Number.isSafeInteger(body.expiresAt)&&body.expiresAt>body.issuedAt&&body.expiresAt-body.issuedAt<=120000,'INVALID_HEAD_TIME');
 check(Number.isSafeInteger(body.revision)&&body.revision>=1&&body.revision<=128,'HEAD_HISTORY_LIMIT');
 check(body.operation==='CREATE'?body.revision===1&&body.rootManifestId===body.manifestId&&body.originalMerkleRoot===body.merkleRoot&&body.previousManifestId===null&&body.previousProof===null:['UPDATE','ROLLBACK'].includes(body.operation)&&body.revision>=2&&isDigest(body.previousManifestId)&&body.previousManifestId!==body.manifestId&&isDigest(body.previousProof),'INVALID_HEAD_SEQUENCE');
 return body;
}
export function verifyHeadChain(records,{rootManifestId,author,minimum}={}){
 check(Array.isArray(records)&&records.length>0&&records.length<=128,'HEAD_HISTORY_LIMIT');
 let previous;
 for(const record of records){
  check(record&&Object.keys(record).sort().join(',')==='body,signature','INVALID_HEAD_RECORD');
  const b=validateHeadBody(record.body);
  check(typeof record.signature==='string'&&/^[a-f0-9]{128}$/.test(record.signature),'HEAD_SIGNATURE_INVALID');
  let valid=false;try{valid=schnorr.verify(hexToBytes(record.signature),blake2b(utf8(headMessage(b)),{dkLen:32,key:utf8('PersonalMessageSigningHash')}),hexToBytes(b.author_pubkey));}catch{}
  check(valid,'HEAD_SIGNATURE_INVALID');
  if(!previous)check(b.operation==='CREATE','HEAD_GENESIS_REQUIRED');
  else {const p=previous.body;check(['UPDATE','ROLLBACK'].includes(b.operation)&&b.rootManifestId===p.rootManifestId&&b.author_pubkey===p.author_pubkey&&b.appId===p.appId&&b.name===p.name&&b.originalMerkleRoot===p.originalMerkleRoot&&b.previousManifestId===p.manifestId&&b.previousProof===proofHash(previous)&&b.revision===p.revision+1&&b.issuedAt>=p.issuedAt,'HEAD_SEQUENCE_CONFLICT');
   if(b.operation==='ROLLBACK')check(records.slice(0,b.revision-1).some(r=>r.body.manifestId===b.manifestId&&r.body.merkleRoot===b.merkleRoot&&r.body.transactionId===b.transactionId),'ROLLBACK_TARGET_NOT_IN_HISTORY');
  }
  previous=record;
 }
 const first=records[0].body,head=previous.body;
 if(rootManifestId)check(first.rootManifestId===rootManifestId,'HEAD_ROOT_MISMATCH');
 if(author)check(first.author_pubkey===author,'ORIGINAL_AUTHOR_REQUIRED');
 if(minimum){check(minimum.rootManifestId===first.rootManifestId&&minimum.author===first.author_pubkey&&Number.isSafeInteger(minimum.revision),'HEAD_MINIMUM_INVALID');check(head.revision>=minimum.revision&&records[minimum.revision-1]&&proofHash(records[minimum.revision-1])===minimum.proof,'VERSION_CONSISTENCY_ERROR');}
 return {...head,proof:proofHash(previous)};
}
export function verifyHeadChallenge(challenge,expected,{now=Date.now()}={}){
 const b=validateHeadBody(challenge?.body);
 check(challenge.message===headMessage(b)&&canonicalJson(b)===canonicalJson(expected),'HEAD_REVIEW_CHANGED');
 check(b.issuedAt<=now+1000&&b.expiresAt>now,'HEAD_REVIEW_EXPIRED');return b;
}
export function expectedHead(challenge,{id,merkleRoot,author,name,transactionId,prior,network='testnet-10',operation=prior?'UPDATE':'CREATE'}){
 const b={protocol:'cellcloud-peer-head',version:1,networkId:network,operation,appId:prior?.appId||appIdFor(id),name:prior?.name||name,rootManifestId:prior?.rootManifestId||id,originalMerkleRoot:prior?.originalMerkleRoot||merkleRoot,previousManifestId:prior?.manifestId||null,previousProof:prior?.proof||null,manifestId:id,merkleRoot,author_pubkey:author,revision:prior?prior.revision+1:1,transactionId,issuedAt:challenge?.body?.issuedAt,expiresAt:challenge?.body?.expiresAt,nonce:challenge?.body?.nonce};
 verifyHeadChallenge(challenge,b);return b;
}
