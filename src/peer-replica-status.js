import {verifyStorageReceipt} from '../protocol/storage-receipt.js';

// A peer's signed, recent disk check is an observation, never a payment receipt
// or a guarantee of future availability. The browser only counts pinned peers.
export function publicationCopies(report,record,metadata,peers,{now=Date.now()}={}){
 if(report?.manifestId!==record.id||report.networkId!==record.network||!Array.isArray(report.peers)||report.peers.length>3)throw Error('INVALID_PUBLICATION_STATUS');
 const seen=new Set(),copies=[];
 for(const row of report.peers){
  const peer=peers.find(p=>p.nodeId===row.nodeId&&p.url===row.url);if(!peer||peer.nodeId===record.nodeId||seen.has(peer.nodeId))throw Error('INVALID_PUBLICATION_STATUS');seen.add(peer.nodeId);
  let verified=null,error=row.error||null;
  if(row.online===true&&row.receipt)try{verified=verifyStorageReceipt(row.receipt,{networkId:record.network,nodeId:peer.nodeId,manifestId:record.id,transactionId:record.transactionId,merkleRoot:metadata.merkleRoot},{now});}catch(e){error=e.message;}
  copies.push({url:peer.url,nodeId:peer.nodeId,online:row.online===true,checkedAt:verified?.checkedAt||null,verified:Boolean(verified),error});
 }
 return {checkedAt:now,verified:copies.filter(c=>c.verified).length,configured:copies.length,peers:copies};
}
