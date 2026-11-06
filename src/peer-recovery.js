import {validateManifest} from '../protocol/manifest.js';
import {NETWORKS} from '../protocol/network.js';
import {recommendedTier} from './upload-policy.js';
import {verifyPaymentReview,verifySignedReview} from './wallet-verifier.js';
import {verifyHeadChain,proofHash} from '../protocol/heads.js';
import {updateIntent} from '../lab/lib/payment-intent.mjs';
import {canonicalJson} from '../protocol/integrity.js';

export function verifyRecoveredReceipt(restored,record,wallet){
 const metadata=validateManifest(restored.manifest,record.id);
 if(restored.address!==record.address||record.address!==wallet?.address||record.network!==wallet?.network||restored.manifest.author_pubkey!==wallet?.publicKey)throw Error('WALLET_CHANGED');
 if(!['STAGED','SIGNED','CONFIRMED'].includes(restored.state))throw Error('INVALID_RECOVERED_STATE');
 let update;
 if(restored.update){
  update=updateIntent(restored.update);const prior=verifyHeadChain(restored.updateChain,{rootManifestId:update.rootManifestId,author:wallet.publicKey});
  if(prior.manifestId!==update.previousManifestId||prior.revision+1!==update.revision||canonicalJson(update)!==canonicalJson(record.update))throw Error('UPDATE_CONTEXT_CHANGED');
 }else if(record.update)throw Error('UPDATE_CONTEXT_CHANGED');
 const expected={address:record.address,manifestId:record.id,sizeBytes:metadata.sizeBytes,tier:update?'UPDATE':recommendedTier(metadata.sizeBytes),treasuryAddress:NETWORKS[record.network].treasury,poolAddress:NETWORKS[record.network].pool,...(update?{updateIntent:update}:{})};
 if(restored.plan){
  // Expiry protects NEW approvals/submissions, not read-only history. Validate
  // historical transaction fields with a temporary clock window; never return
  // or persist that window as authority to submit or ask for another signature.
  const historical=restored.state==='CONFIRMED'||Boolean(restored.submissionIntentAt)||restored.recoveryReadOnly===true;
  verifyPaymentReview(historical?{...restored.plan,expiresAt:Date.now()+120000}:restored.plan,expected);
  verifySignedReview(restored.plan.unsignedJson,restored.signedJson);
  if(restored.transactionId!==restored.plan.transactionId)throw Error('TRANSACTION_ID_CHANGED');
 }else if(restored.state!=='STAGED')throw Error('SIGNED_PAYMENT_REQUIRED');
 let application;
 if(restored.headChain){
  const head=verifyHeadChain(restored.headChain,{author:wallet.publicKey}),entry=restored.headChain.findLast(r=>r.body.manifestId===record.id);
  if(!entry||entry.body.transactionId!==restored.transactionId||entry.body.merkleRoot!==metadata.merkleRoot)throw Error('HEAD_CONTENT_BINDING_INVALID');
  application={rootManifestId:head.rootManifestId,author:head.author_pubkey,revision:entry.body.revision,proof:proofHash(entry)};
 }else if(record.application)throw Error('HEAD_PROOF_REQUIRED');
 return {metadata,expected,application};
}
