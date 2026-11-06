import {paymentEngine} from './payment-engine.js';
import {NETWORKS,networkId,requirePaymentNetwork} from './network.js';
import {hash,isDigest} from './integrity.js';
import {recommendedTier} from '../lab/lib/upload-policy.mjs';
import {verifyPaymentReview} from '../src/wallet-verifier.js';
import {updateIntent} from '../lab/lib/payment-intent.mjs';

export async function deadline(promise,ms=12000){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('KASPA_RPC_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
export class DirectKaspaClient{
 constructor({sdk,network='testnet-10',url='',factory,resolverTimeoutMs=4000}={}){
  this.sdk=sdk;this.network=networkId(network);this.url=url;this.factory=factory||((options)=>new sdk.RpcClient(options));this.client=null;this.connecting=null;this.engine=paymentEngine(sdk);this.resolverTimeoutMs=resolverTimeoutMs;
 }
 check(info){if(String(info.networkId)!==this.network)throw Error('KASPA_RPC_WRONG_NETWORK');if(info.isSynced!==true||info.hasUtxoIndex!==true)throw Error('KASPA_RPC_NOT_READY');return info;}
 async connect(){
  if(this.client)return this.client;if(this.connecting)return this.connecting;
  this.connecting=(async()=>{
   let candidates=this.url?[this.url]:[];
   if(!this.url){
    const resolver=new this.sdk.Resolver();
    try{const pending=Promise.resolve(resolver.getUrl(this.sdk.Encoding.Borsh,this.network)).finally(()=>resolver.free());candidates.push(await deadline(pending,this.resolverTimeoutMs));}catch{}
    // A previously Resolver-discovered public TN10 endpoint, checked on every
    // connection. No wallet request or transaction is retried across endpoints.
    if(this.network==='testnet-10')candidates.push('wss://vector-10.kaspa.green/kaspa/testnet-10/wrpc/borsh');
   }
   let lastError=Error('KASPA_RESOLVER_UNAVAILABLE_CONFIGURE_RPC');
   for(const url of new Set(candidates)){
    const parsed=new URL(url);
    if(parsed.username||parsed.password||parsed.hash||parsed.search||!['wss:','ws:'].includes(parsed.protocol)||parsed.protocol==='ws:'&&!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname))throw Error('KASPA_RPC_REQUIRES_WSS_OR_LOCAL_WS');
    const rpc=this.factory({url,networkId:this.network,encoding:this.sdk.Encoding.Borsh});
    try{await deadline(rpc.connect({blockAsyncConnect:true,strategy:'fallback',timeoutDuration:8000}));this.check(await deadline(rpc.getServerInfo()));this.client=rpc;this.resolvedUrl=url;return rpc;}
    catch(error){lastError=error;await deadline(rpc.disconnect(),1500).catch(()=>{});}
   }
   throw lastError;
  })().finally(()=>this.connecting=null);return this.connecting;
 }
 async status(){const rpc=await this.connect();try{const info=this.check(await deadline(rpc.getServerInfo()));return {networkId:this.network,url:this.resolvedUrl,isSynced:true,virtualDaaScore:String(info.virtualDaaScore),serverVersion:String(info.serverVersion||''),paymentsEnabled:NETWORKS[this.network].paymentsEnabled};}catch(error){await this.close();throw error;}}
 async snapshot(address){
  const k=this.sdk;if(!k.Address.validate(address))throw Error('INVALID_ADDRESS');
  const parsed=new k.Address(address);let own;try{if(parsed.prefix!==NETWORKS[this.network].prefix||parsed.version!=='PubKey')throw Error('WALLET_NETWORK_MISMATCH');const script=k.payToAddressScript(parsed);try{own=script.toJSON();}finally{script.free?.();}}finally{parsed.free();}
  const rpc=await this.connect();
  try{
   this.check(await deadline(rpc.getServerInfo()));
   const [response,fees]=await Promise.all([deadline(rpc.getUtxosByAddresses({addresses:[address]})),deadline(rpc.getFeeEstimate({}))]);
   const info=this.check(await deadline(rpc.getServerInfo())),daa=BigInt(info.virtualDaaScore),entries=response.entries;
   if(!Array.isArray(entries)||entries.length>1000)throw Error('UTXO_RESPONSE_LIMIT');
   const utxos=[],seen=new Set();
   for(const raw of entries){const entry=raw.entry??raw,op=raw.outpoint??entry.outpoint,spk=entry.scriptPublicKey?.toJSON?.()??entry.scriptPublicKey;
    if(!op||!isDigest(op.transactionId)||!Number.isInteger(op.index)||op.index<0||op.index>4294967295)throw Error('RPC_INVALID_OUTPOINT');
    const id=op.transactionId+':'+op.index;if(seen.has(id))throw Error('RPC_DUPLICATE_UTXO');seen.add(id);
    const amount=BigInt(entry.amount),score=BigInt(entry.blockDaaScore);
    if(entry.isCoinbase!==false||entry.covenantId||amount<=0n||amount>18446744073709551615n||score<=0n||score>daa||spk?.version!==own.version||spk?.script!==own.script)continue;
    utxos.push({outpoint:{transactionId:op.transactionId,index:op.index},amount:String(amount),scriptPublicKey:own,blockDaaScore:String(score),isCoinbase:false});
   }
   const feeRate=Math.ceil(fees?.estimate?.normalBuckets?.[0]?.feerate);if(!Number.isSafeInteger(feeRate)||feeRate<1||feeRate>1000)throw Error('RPC_INVALID_FEE_RATE');
   return {networkId:this.network,address,virtualDaaScore:String(daa),utxos,feeRate,balanceSompi:String(utxos.reduce((sum,u)=>sum+BigInt(u.amount),0n)),checkedAt:Date.now()};
  }catch(error){await this.close();throw error;}
 }
 expected({address,manifestId,sizeBytes,update}){const config=requirePaymentNetwork(this.network);return {address,manifestId,sizeBytes,tier:update?'UPDATE':recommendedTier(sizeBytes),treasuryAddress:config.treasury,poolAddress:config.pool,...(update?{updateIntent:updateIntent(update)}:{})};}
 async prepare(args){
  const expected=this.expected(args),snapshot=await this.snapshot(args.address);
  const plan=this.engine.prepareTestnetPayment({...expected,...snapshot,networkId:this.network,...(expected.updateIntent?{update:{...expected.updateIntent,sizeBytes:expected.sizeBytes}}:{})});
  Object.assign(plan,{mode:'RPC_TESTNET_DRAFT',chainVerified:true,expiresAt:Date.now()+120000,billing:{operation:expected.updateIntent?'UPDATE':'PUBLISH',...expected.updateIntent,manifestId:expected.manifestId,tier:expected.tier,sizeBytes:expected.sizeBytes}});
  verifyPaymentReview(plan,expected);return {plan,expected};
 }
 async recheck(plan,expected){
  requirePaymentNetwork(this.network);verifyPaymentReview(plan,expected);
  if(hash(plan.unsignedJson)!==plan.unsignedSha256)throw Error('PLAN_CHANGED');
  const snapshot=await this.snapshot(expected.address),available=new Map(snapshot.utxos.map(u=>[u.outpoint.transactionId+':'+u.outpoint.index,u]));
  const tx=JSON.parse(plan.unsignedJson);
  for(const input of tx.inputs){const actual=available.get(input.transactionId+':'+input.index);if(!actual||actual.amount!==input.utxo.amount||actual.blockDaaScore!==input.utxo.blockDaaScore||'0000'+actual.scriptPublicKey.script!==input.utxo.scriptPublicKey)throw Error('PAYMENT_INPUT_SPENT_OR_CHANGED');}
  if(BigInt(plan.feeSompi)<this.engine.requiredFeeForReview(plan.unsignedJson,snapshot.feeRate))throw Error('PAYMENT_FEE_CHANGED');
  return {checked:true};
 }
 async validate(plan,expected,signedJson){await this.recheck(plan,expected);return this.engine.validateSignedPaymentSignatures(plan,signedJson);}
 async verifySettled(record,expected){
  requirePaymentNetwork(this.network);
  // Historical read verification deliberately does not query spendable UTXOs:
  // the already accepted transaction has consumed them. Never renew authority
  // to sign/send, construct another plan, or submit during replication.
  const plan=record.plan;verifyPaymentReview({...plan,expiresAt:Date.now()+120000},expected);
  if(hash(plan.unsignedJson)!==plan.unsignedSha256)throw Error('PLAN_CHANGED');
  this.engine.validateSignedPaymentSignatures(plan,record.signedJson);
  const tx=this.sdk.Transaction.deserializeFromSafeJSON(record.signedJson);let id;try{tx.finalize();id=tx.id;}finally{tx.free();}
  if(id!==record.transactionId||id!==plan.transactionId)throw Error('TRANSACTION_ID_CHANGED');
  const confirmation=await this.acceptance(record.anchor,id);
  if(!confirmation.accepted||confirmation.confirmations<10)throw Error('REPLICA_PAYMENT_UNCONFIRMED');return confirmation;
 }
 async checkpoint(){const rpc=await this.connect();this.check(await deadline(rpc.getServerInfo()));const {sink}=await deadline(rpc.getSink());if(!isDigest(sink))throw Error('INVALID_CHECKPOINT');await deadline(rpc.getVirtualChainFromBlock({startHash:sink,includeAcceptedTransactionIds:true,minConfirmationCount:0}));return sink;}
 async submit(signedJson,{approved=false}={}){
  requirePaymentNetwork(this.network);if(!approved)throw Error('EXPLICIT_TESTNET_SEND_REQUIRED');
  const rpc=await this.connect();this.check(await deadline(rpc.getServerInfo()));const transaction=this.sdk.Transaction.deserializeFromSafeJSON(signedJson);
  let pending;try{pending=rpc.submitTransaction({transaction,allowOrphan:false});}catch(error){transaction.free();throw error;}
  return deadline(Promise.resolve(pending).finally(()=>transaction.free()));
 }
 async acceptance(anchor,transactionId){
  if(!isDigest(anchor)||!isDigest(transactionId))throw Error('INVALID_TRACKING_ID');
  const rpc=await this.connect();this.check(await deadline(rpc.getServerInfo()));
  const {addedChainBlockHashes:added,removedChainBlockHashes:removed,acceptedTransactionIds:groups}=await deadline(rpc.getVirtualChainFromBlock({startHash:anchor,includeAcceptedTransactionIds:true,minConfirmationCount:0}));
  if(!Array.isArray(added)||!Array.isArray(removed)||!Array.isArray(groups)||added.length>20000||removed.length>20000||groups.length>20000||added.some(h=>!isDigest(h))||removed.some(h=>!isDigest(h))||new Set(added).size!==added.length)throw Error('INVALID_CHAIN_RESPONSE');
  for(const group of groups){
   if(!isDigest(group.acceptingBlockHash)||!Array.isArray(group.acceptedTransactionIds)||group.acceptedTransactionIds.length>100000||group.acceptedTransactionIds.some(id=>!isDigest(id)))throw Error('INVALID_ACCEPTANCE_RESPONSE');
   if(group.acceptedTransactionIds.includes(transactionId)){const index=added.indexOf(group.acceptingBlockHash);if(index<0||removed.includes(group.acceptingBlockHash))throw Error('ACCEPTING_BLOCK_NOT_ON_CHAIN');return {accepted:true,acceptingBlockHash:group.acceptingBlockHash,confirmations:added.length-1-index};}
  }
  return {accepted:false,confirmations:0};
 }
 async close(){const rpc=this.client;this.client=null;if(rpc)await deadline(rpc.disconnect(),1500).catch(()=>{});}
}
