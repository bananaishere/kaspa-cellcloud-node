// One audited builder for Node and browser bindings of the same SDK version.
import {bytesToHex} from '@noble/hashes/utils.js';
import {hash,utf8} from './integrity.js';
import {paymentPayload,updatePrice,updateIntent} from '../lab/lib/payment-intent.mjs';
import {deploymentPrice} from '../lab/lib/upload-policy.mjs';
export function paymentEngine(k){
const NETWORK='testnet-10',SOMPI=100000000n,MAX_FEE=10000000n;
function account(address){
  if(typeof address!=='string'||!k.Address.validate(address))throw Error('INVALID_ADDRESS');
  const parsed=new k.Address(address);
  try{if(parsed.prefix!=='kaspatest'||parsed.version!=='PubKey')throw Error('TESTNET_SCHNORR_ADDRESS_REQUIRED');const script=k.payToAddressScript(parsed);try{return {address:parsed.toString(),spk:script.toJSON()};}finally{script.free?.();}}finally{parsed.free();}
}
function measure(transaction){
  const copy=k.Transaction.deserializeFromSafeJSON(transaction.serializeToSafeJSON());
  try{
  for(const input of copy.inputs)input.signatureScript='41'+'00'.repeat(64)+'01';
  if(!k.updateTransactionMass(NETWORK,copy,1))throw Error('TRANSACTION_MASS_LIMIT');
  const fee=k.calculateTransactionFee(NETWORK,copy,1);if(fee===undefined)throw Error('FEE_UNAVAILABLE');return {mass:BigInt(k.calculateTransactionMass(NETWORK,copy,1)),minimumFee:BigInt(fee)};
  }finally{copy.free();}
}
// RPC feerate is sompi per mass unit, not a multiplier of the SDK relay minimum.
function estimatedFee(measured,feeRate){const marketFee=measured.mass*BigInt(feeRate);return marketFee>measured.minimumFee?marketFee:measured.minimumFee;}
function requiredFeeForReview(unsignedJson,feeRate){if(!Number.isSafeInteger(feeRate)||feeRate<1||feeRate>1000)throw Error('INVALID_FEE_RATE');const transaction=k.Transaction.deserializeFromSafeJSON(unsignedJson);try{return estimatedFee(measure(transaction),feeRate);}finally{transaction.free();}}
function prepareTestnetPayment({networkId,address,treasuryAddress,poolAddress,manifestId,tier,utxos,virtualDaaScore,feeRate=1,update,sizeBytes}){
  if(networkId!==NETWORK)throw Error('TESTNET_ONLY');
  if(!/^[a-f0-9]{64}$/.test(manifestId))throw Error('INVALID_MANIFEST');
  deploymentPrice(tier,sizeBytes);
  if(!Number.isSafeInteger(feeRate)||feeRate<1||feeRate>1000)throw Error('INVALID_FEE_RATE');
  const owner=account(address),treasury=account(treasuryAddress),pool=account(poolAddress);
  if(new Set([owner.address,treasury.address,pool.address]).size!==3)throw Error('DISTINCT_PAYMENT_ADDRESSES_REQUIRED');
  if(update){updateIntent(update);if(tier!=='UPDATE')throw Error('UPDATE_TIER_REQUIRED');}
  const total=BigInt(update?updatePrice(update.sizeBytes):deploymentPrice(tier,sizeBytes))*SOMPI,founder=total*5n/100n,p2p=total-founder,daa=BigInt(virtualDaaScore);
  if(daa<=0n||!Array.isArray(utxos)||!utxos.length||utxos.length>1000)throw Error('INVALID_UTXO_SET');
  const seen=new Set(),available=[];
  for(const u of utxos){
    const op=u.outpoint;
    if(!op||!/^[a-f0-9]{64}$/.test(op.transactionId)||!Number.isInteger(op.index)||op.index<0||op.index>4294967295)throw Error('INVALID_OUTPOINT');
    const id=op.transactionId+':'+op.index;if(seen.has(id))throw Error('DUPLICATE_UTXO');seen.add(id);
    const amount=BigInt(u.amount),score=BigInt(u.blockDaaScore),spk=u.scriptPublicKey;
    if(amount<=0n||amount>18446744073709551615n||score<=0n||score>daa||u.isCoinbase!==false||u.covenantId||spk?.version!==owner.spk.version||spk?.script!==owner.spk.script)throw Error('UNSUPPORTED_OR_UNCONFIRMED_UTXO');
    available.push({...u,amount,blockDaaScore:score,address:owner.address});
  }
  available.sort((a,b)=>a.amount===b.amount?0:a.amount>b.amount?-1:1);
  const selected=[];let inputTotal=0n;
  for(const u of available){selected.push(u);inputTotal+=u.amount;if(inputTotal>=total+SOMPI+MAX_FEE)break;if(selected.length>=32)break;}
  if(inputTotal<total+SOMPI+MAX_FEE)throw Error('MORE_CONFIRMED_TEST_KAS_REQUIRED');
  const payload=bytesToHex(utf8(paymentPayload({manifestId,tier,update})));
  let fee=1000n,tx,measured;
  try{
  for(let round=0;round<10;round++){
    const change=inputTotal-total-fee;
    tx?.free();tx=null;
    tx=k.createTransaction(selected,[{address:treasury.address,amount:founder},{address:pool.address,amount:p2p},{address:owner.address,amount:change}],0n,payload,1);
    measured=measure(tx);const required=estimatedFee(measured,feeRate);
    if(required>MAX_FEE)throw Error('FEE_CAP_EXCEEDED');
    if(fee>=required)break;fee=required;
  }
  if(fee<estimatedFee(measured,feeRate))throw Error('FEE_DID_NOT_CONVERGE');
  if(!k.updateTransactionMass(NETWORK,tx,1))throw Error('TRANSACTION_MASS_LIMIT');tx.finalize();
  const unsignedJson=tx.serializeToSafeJSON();
  return {version:1,mode:'OFFLINE_TESTNET_DRAFT',networkId:NETWORK,tier,manifestId,payloadHex:payload,address:owner.address,treasuryAddress:treasury.address,poolAddress:pool.address,totalSompi:total.toString(),treasurySompi:founder.toString(),poolSompi:p2p.toString(),feeSompi:fee.toString(),changeSompi:(inputTotal-total-fee).toString(),mass:measured.mass.toString(),unsignedJson,unsignedSha256:hash(unsignedJson),transactionId:tx.id,signInputs:tx.inputs.map((_,index)=>({index,sighashType:1})),chainVerified:false,broadcastEnabled:false};
  }finally{tx?.free();}
}
function immutable(serialized){const value=JSON.parse(serialized);delete value.id;for(const input of value.inputs)input.signatureScript='';return value;}
function validateSignedPaymentShape(plan,signedJson){
  if(!['OFFLINE_TESTNET_DRAFT','RPC_TESTNET_DRAFT'].includes(plan.mode)||plan.networkId!==NETWORK||plan.broadcastEnabled!==false)throw Error('INVALID_TESTNET_PLAN');
  if(hash(plan.unsignedJson)!==plan.unsignedSha256)throw Error('PLAN_CHANGED');
  if(typeof signedJson!=='string'||utf8(signedJson).length>200000)throw Error('INVALID_SIGNED_TRANSACTION');
  const signed=k.Transaction.deserializeFromSafeJSON(signedJson);
  try{
  if(JSON.stringify(immutable(signed.serializeToSafeJSON()))!==JSON.stringify(immutable(plan.unsignedJson)))throw Error('TRANSACTION_CHANGED');
  for(const input of signed.inputs)if(!/^41[0-9a-f]{128}01$/.test(input.signatureScript||''))throw Error('SIGHASH_ALL_SIGNATURE_REQUIRED');
  // Shape check only: a real node must validate signatures and current UTXOs.
  return {shapeVerified:true,cryptographicSignaturesVerified:false,broadcastEnabled:false};
  }finally{signed.free();}
}
function validateSignedPaymentSignatures(plan,signedJson){
  const shape=validateSignedPaymentShape(plan,signedJson);
  // Only use the saved, reviewed transaction and its trusted UTXO scripts/amounts.
  const trusted=JSON.parse(plan.unsignedJson),supplied=JSON.parse(signedJson),owner=account(plan.address);
  if(!trusted.inputs?.length||trusted.inputs.length>32)throw Error('INVALID_SIGNED_INPUT_COUNT');
  for(let index=0;index<trusted.inputs.length;index++){
    if(trusted.inputs[index].utxo?.scriptPublicKey!=='0000'+owner.spk.script)throw Error('UNSUPPORTED_SIGNATURE_SCRIPT');
    trusted.inputs[index].signatureScript=supplied.inputs[index].signatureScript;
  }
  const transaction=k.Transaction.deserializeFromSafeJSON(JSON.stringify(trusted));
  try{
    // SDK verify_sig=true invokes native Schnorr verification for every input.
    // Empty signer array: no keys are supplied and no signatures are generated.
    const verified=k.signTransaction(transaction,[],true);
    verified.free();
  }catch{throw Error('CRYPTOGRAPHIC_SIGNATURE_INVALID');}
  finally{transaction.free();}
  return {...shape,cryptographicSignaturesVerified:true,verifiedInputCount:trusted.inputs.length};
}

return {prepareTestnetPayment,requiredFeeForReview,validateSignedPaymentShape,validateSignedPaymentSignatures};
}
