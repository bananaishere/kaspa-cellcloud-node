// Public unfunded fixture key and simulated RPC ledger. No real Kaspa network,
// wallet extension or submit call. Shared by in-process and OS-process tests.
import {sdk as k} from '../../lab/kaspa/payment.mjs';
import {DirectKaspaClient} from '../../protocol/kaspa-client.js';
import {analyseFiles,encodeFileStripe} from '../../protocol/manifest.js';
import {verifyHeadChain} from '../../protocol/heads.js';
export const key=new k.PrivateKey('01'.repeat(32)),author=key.toPublicKey().toString().slice(-64),address=key.toPublicKey().toAddress('testnet').toString();
export function fixtureRpc({read=async()=>[],accept=async()=>{}}={}){
 const state={submissions:0,reads:0,offline:false},blocks=Array.from({length:12},(_,i)=>(i+30).toString(16).padStart(64,'0'));
 const raw={connect:async()=>{},disconnect:async()=>{},getServerInfo:async()=>{if(state.offline)throw Error('FIXTURE_RPC_OFFLINE');return {networkId:'testnet-10',isSynced:true,hasUtxoIndex:true,virtualDaaScore:100n};},getUtxosByAddresses:async()=>{state.reads++;return {entries:[{outpoint:{transactionId:'11'.repeat(32),index:0},amount:'100000000000',scriptPublicKey:k.payToAddressScript(address).toJSON(),blockDaaScore:'10',isCoinbase:false}]};},getFeeEstimate:async()=>({estimate:{normalBuckets:[{feerate:2}]}}),getSink:async()=>({sink:'aa'.repeat(32)}),getVirtualChainFromBlock:async()=>({addedChainBlockHashes:blocks,removedChainBlockHashes:[],acceptedTransactionIds:[{acceptingBlockHash:blocks[0],acceptedTransactionIds:await read()}]}),submitTransaction:async()=>{state.submissions++;throw Error('FIXTURE_MUST_NEVER_SUBMIT');}};
 return {rpc:new DirectKaspaClient({sdk:k,url:'ws://127.0.0.1:1',factory:()=>raw}),state,accept};
}
export async function publishFixture(store,ledger,{text='Version 1',root,activate=true}={}){
 const prior=root?store.heads.current(root):null,update=prior?{operation:'UPDATE',appId:prior.appId,rootManifestId:root,previousManifestId:prior.manifestId,author_pubkey:author,revision:prior.revision+1}:undefined;
 const file=new File(['<!doctype html><h1>'+text+'</h1><p>Isolated fixture; no real payment.</p>'],'index.html'),publication=await analyseFiles([file],{author});
 await store.open({id:publication.id,manifestText:JSON.stringify(publication.manifest),name:'Replicated fixture',address,update});
 for(const cell of await encodeFileStripe(file,publication.manifest.files[0],0))await store.put({id:publication.id,file:0,stripe:0,shard:cell.shard,proof:cell.proof},cell.bytes);
 const review=await ledger.rpc.prepare({address,manifestId:publication.id,sizeBytes:file.size,update}),tx=k.Transaction.deserializeFromSafeJSON(review.plan.unsignedJson),signed=k.signTransaction(tx,[key],true),signedJson=signed.serializeToSafeJSON();tx.free();signed.free();
 await store.authorize({id:publication.id,...review,signedJson});await ledger.accept(review.plan.transactionId);await store.confirm(publication.id);
 let head;if(activate){const challenge=store.heads.challenge({manifestId:publication.id,...(root?{rootManifestId:root}:{})});const result=await store.heads.authorize({body:challenge.body,signature:k.signMessage({message:challenge.message,privateKey:key})});head=verifyHeadChain(result.records);}
 return {id:publication.id,manifest:publication.manifest,transactionId:review.plan.transactionId,head,text:await file.text()};
}
