const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function updatePrice(sizeBytes){if(!Number.isSafeInteger(sizeBytes)||sizeBytes<0||sizeBytes>5*1024**3)throw Error('UPDATE_SIZE_LIMIT');return sizeBytes<=100*1024**2?10:sizeBytes<=500*1024**2?50:sizeBytes<=1024**3?100:sizeBytes<=2*1024**3?150:150+50*Math.ceil((sizeBytes-2*1024**3)/1024**3);}
export function updateIntent(value){
  if(value?.operation!=='UPDATE'||!hex(value.rootManifestId)||value.appId!=='owned-'+value.rootManifestId.slice(0,48)||!hex(value.previousManifestId)||!hex(value.author_pubkey)||!Number.isSafeInteger(value.revision)||value.revision<2)throw Error('INVALID_UPDATE_INTENT');
  return {operation:'UPDATE',appId:value.appId,rootManifestId:value.rootManifestId,previousManifestId:value.previousManifestId,revision:value.revision,author_pubkey:value.author_pubkey};
}
export function paymentPayload({manifestId,tier,update}){
  return JSON.stringify(update?{p:'cellcloud',v:2,op:'update',manifest:manifestId,tier,network:'testnet-10',...updateIntent(update)}:{p:'cellcloud',v:1,op:'publish',manifest:manifestId,tier,network:'testnet-10'});
}
export function samePaymentIntent(left,right){
  if(left.address!==right.address)return false;
  if(left.billing?.operation==='UPDATE'||right.billing?.operation==='UPDATE')return left.billing?.operation==='UPDATE'&&right.billing?.operation==='UPDATE'&&['appId','rootManifestId','previousManifestId','revision'].every(key=>left.billing[key]===right.billing[key]);
  return left.manifestId===right.manifestId;
}
