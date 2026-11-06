import {verifyHeadChain,proofHash,verifyHeadFork} from '../protocol/heads.js';
import {validateManifest} from '../protocol/manifest.js';

export function verifyResolvedHead(result,application,{minimum}={}){
 if(result?.conflict){verifyHeadFork(result.conflict,{rootManifestId:application.rootManifestId,author:application.author});throw Error('HEAD_SEQUENCE_CONFLICT');}
 const head=verifyHeadChain(result?.records,{rootManifestId:application.rootManifestId,author:application.author,minimum});
 const publication=result.publication,metadata=validateManifest(publication?.manifest,head.manifestId);
 if(publication.id!==head.manifestId||publication.state!=='CONFIRMED'||publication.transactionId!==head.transactionId||publication.manifest.author_pubkey!==head.author_pubkey||metadata.merkleRoot!==head.merkleRoot)throw Error('HEAD_CONTENT_BINDING_INVALID');
 return head;
}
export function chooseResolvedHead(results,application,{minimum}={}){
 let selected,head;
 for(const result of results){
  const candidate=verifyResolvedHead(result,application);
  if(selected){
   const common=Math.min(candidate.revision,head.revision)-1;
   if(proofHash(result.records[common])!==proofHash(selected.records[common]))throw Error('HEAD_SEQUENCE_CONFLICT');
  }
  if(!head||candidate.revision>head.revision){selected=result;head=candidate;}
 }
 if(!selected)throw Error('HEAD_NOT_FOUND');if(minimum)verifyResolvedHead(selected,application,{minimum});return {head,result:selected};
}
