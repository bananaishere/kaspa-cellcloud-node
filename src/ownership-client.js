import {accountScript} from './wallet-verifier.js';
import {manifestEntries} from '../lab/lib/manifest-entries.mjs';
const check=(value,code)=>{if(!value)throw Error(code);};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function ownershipPublicKey(address,value){
  check(typeof value==='string','OWNERSHIP_PUBLIC_KEY_UNAVAILABLE');
  const key=value.toLowerCase();check(/^(?:0[23])?[a-f0-9]{64}$/.test(key),'OWNERSHIP_PUBLIC_KEY_INVALID');
  const result=key.slice(-64);check(accountScript(address)==='000020'+result+'ac','OWNERSHIP_KEY_ACCOUNT_MISMATCH');return result;
}
const bytes=hex=>Uint8Array.from(hex.match(/../g)||[],part=>parseInt(part,16));
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function verifyOwnershipManifest(manifest,id,author){
  check(hex(id)&&hex(author)&&manifest?.author_pubkey===author,'OWNERSHIP_MANIFEST_AUTHOR_MISMATCH');
  check(await hash(new TextEncoder().encode(JSON.stringify(manifest)))===id,'OWNERSHIP_MANIFEST_HASH_MISMATCH');
  check(Array.isArray(manifest.files)&&manifestEntries(manifest).length>0,'OWNERSHIP_MANIFEST_INVALID');
  const roots=manifestEntries(manifest).flatMap(file=>file.stripes?.map(stripe=>stripe.root)||[]);check(roots.length>0&&roots.every(hex),'OWNERSHIP_ROOT_INVALID');
  let level=await Promise.all(roots.map(root=>hash(Uint8Array.from([0,...bytes(root)]))));
  while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2)next.push(await hash(Uint8Array.from([1,...bytes(level[i]),...bytes(level[i+1]||level[i])])));level=next;}
  return level[0];
}
export function verifyOwnershipChallenge(challenge,expected,{now=Date.now()}={}){
  check(challenge&&typeof challenge.message==='string'&&challenge.message.length<8000,'OWNERSHIP_MESSAGE_INVALID');
  const prefix='Kaspa CellCloud ownership authorization\n';check(challenge.message.startsWith(prefix),'OWNERSHIP_MESSAGE_INVALID');
  let body;try{body=JSON.parse(challenge.message.slice(prefix.length));}catch{throw Error('OWNERSHIP_MESSAGE_INVALID');}
  const fields=['protocol','version','networkId','domain','instanceId','operation','rootManifestId','originalMerkleRoot','previousManifestId','manifestId','merkleRoot','author_pubkey','revision','nonce','issuedAt','expiresAt','appId','name'];
  check(body&&Object.keys(body).length===fields.length&&fields.every(key=>Object.hasOwn(body,key)&&body[key]===challenge[key]),'OWNERSHIP_MESSAGE_FIELDS_CHANGED');
  check(body.protocol==='cellcloud-ownership'&&body.version===2&&body.networkId==='testnet-10','OWNERSHIP_TESTNET_ONLY');
  for(const key of ['domain','instanceId','operation','rootManifestId','originalMerkleRoot','previousManifestId','manifestId','merkleRoot','author_pubkey','revision','appId','name'])check(Object.hasOwn(expected,key)&&body[key]===expected[key],'OWNERSHIP_REVIEW_CHANGED_'+key);
  check(['CREATE','UPDATE'].includes(body.operation)&&hex(body.rootManifestId)&&hex(body.manifestId)&&hex(body.merkleRoot)&&hex(body.originalMerkleRoot)&&hex(body.author_pubkey),'OWNERSHIP_INTENT_INVALID');
  check(body.appId==='owned-'+body.rootManifestId.slice(0,48)&&typeof body.name==='string'&&body.name.trim()===body.name&&body.name.length>0&&body.name.length<=80,'OWNERSHIP_ALIAS_INVALID');
  check(body.operation==='CREATE'?body.revision===1&&body.previousManifestId===null&&body.rootManifestId===body.manifestId&&body.originalMerkleRoot===body.merkleRoot:Number.isSafeInteger(body.revision)&&body.revision>=2&&hex(body.previousManifestId)&&body.previousManifestId!==body.manifestId,'OWNERSHIP_REVISION_INVALID');
  const origin=new URL(body.domain);check(origin.origin===body.domain&&(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)),'OWNERSHIP_DOMAIN_INVALID');
  check(typeof body.nonce==='string'&&/^[0-9a-f-]{36}$/.test(body.nonce)&&challenge.challengeId===body.nonce,'OWNERSHIP_NONCE_INVALID');
  check(Number.isFinite(body.issuedAt)&&Number.isFinite(body.expiresAt)&&body.issuedAt<=now+1000&&body.expiresAt>now&&body.expiresAt-body.issuedAt>0&&body.expiresAt-body.issuedAt<=120000,'OWNERSHIP_CHALLENGE_EXPIRED');
  check(challenge.message===prefix+JSON.stringify(body),'OWNERSHIP_MESSAGE_NOT_CANONICAL');return body;
}
export function ownershipSignature(value){
  if(typeof value==='string'&&/^[a-fA-F0-9]{128}$/.test(value))return value.toLowerCase();
  // Some wallet versions return a base64-encoded 64-byte Schnorr signature.
  if(typeof value==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(value)){const raw=atob(value);if(raw.length===64)return [...raw].map(c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');}
  throw Error('OWNERSHIP_SCHNORR_SIGNATURE_REQUIRED');
}
export function ownershipError(error){
  if(error?.code==='STORAGE_OPERATION_IN_PROGRESS'||error?.message==='STORAGE_OPERATION_IN_PROGRESS'||error?.status===409&&error?.message==='OPERATION_IN_PROGRESS')return 'O armazenamento está a concluir outra operação. Aguarda alguns segundos e prepara novamente a revisão. Não há um pedido pendente na carteira.';
  if(walletOperationInProgress(error))return 'A carteira ainda está ocupada. Conclui ou fecha o pedido pendente na extensão e tenta novamente.';
  if(error?.code===4001)return 'Pedido recusado na carteira.';
  const code=error?.message||'OWNERSHIP_ERROR';
  if(code==='UPDATE_PAYMENT_REQUIRED')return 'Não existe pagamento para esta revisão de autoria. Atualiza a Biblioteca e confirma a operação no histórico antes de continuar; não repitas o pagamento.';
  if(code.startsWith('OWNERSHIP_REVIEW_CHANGED_'))return 'A revisão não corresponde à seleção ou ao domínio desta página. Prepara uma nova revisão.';
  return ({OWNERSHIP_COMPATIBLE_TESTNET_WALLET_REQUIRED:'Liga uma carteira testnet-10 com chave pública e assinatura de mensagens compatível.',OWNERSHIP_KEY_ACCOUNT_MISMATCH:'A chave pública não corresponde à conta ligada. Volta a ligar a carteira.',OWNERSHIP_CHALLENGE_EXPIRED:'A revisão de autoria expirou. Prepara uma nova.',OWNERSHIP_CHALLENGE_EXPIRED_OR_USED:'A revisão de autoria expirou ou já foi usada. Atualiza a lista.',OWNERSHIP_WALLET_CHANGED:'A carteira mudou durante a assinatura. Prepara uma nova revisão.',OWNERSHIP_SELECTION_CHANGED:'A seleção mudou. Prepara uma nova revisão.',OWNERSHIP_SIGNATURE_INVALID:'A assinatura não passou a verificação KIP-5. A autorização foi recusada.',OWNERSHIP_SCHNORR_SIGNATURE_REQUIRED:'A carteira devolveu uma assinatura incompatível. É necessária uma assinatura Schnorr de 64 bytes.',ORIGINAL_AUTHOR_REQUIRED:'Esta alteração exige a chave do autor original.',LEGACY_MANIFEST_HAS_NO_AUTHOR_PROOF:'Esta publicação antiga não tem chave de autoria. Publica novamente com a carteira ligada.'})[code]||code;
}
export function walletOperationInProgress(error){return error?.source!=='storage'&&error?.status!==409&&[error?.code,error?.message,error?.error?.code,error?.error?.message].some(value=>typeof value==='string'&&/(^|\W)OPERATION_IN_PROGRESS($|\W)/.test(value));}
