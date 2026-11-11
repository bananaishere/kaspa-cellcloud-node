import {accountScript,verifyPaymentReview,verifySignedReview} from './wallet-verifier.js';
import {ownershipPublicKey,verifyOwnershipChallenge,ownershipSignature,walletOperationInProgress} from './ownership-client.js';
import {vaultKeyMessage,verifyVaultSignature} from './vault-crypto.js';
import {vaultWalletIssue} from './vault-compatibility.js';
import {verifyHeadChallenge} from '../protocol/heads.js';
import {verifyUploadChallenge,verifyUploadSignature} from '../protocol/upload-admission.js';
export function normalizeNetwork(network){const value=typeof network==='string'?network:'';return ['testnet-10','kaspa_testnet_10','kaspa_testnet10'].includes(value)?'testnet-10':['mainnet','kaspa_mainnet'].includes(value)?'mainnet':value||'unknown';}
export function detectWallets(host=window){
  const result=[];
  if(host.kasware&&typeof host.kasware.requestAccounts==='function')result.push({id:'kasware',name:'KasWare',provider:host.kasware});
  if(host.kastle&&typeof host.kastle.connect==='function'&&typeof host.kastle.getAccount==='function')result.push({id:'kastle',name:'Kastle',provider:host.kastle});
  return result;
}
export class WalletConnection {
  constructor(host,onChange=()=>{},{signingTimeoutMs=60000}={}){this.host=host;this.onChange=onChange;this.epoch=0;this.session=null;this.cleanups=[];this.signingTimeoutMs=signingTimeoutMs;this.signatureRequest=null;}
  async requestSignature(action){
    if(this.signatureRequest)throw Error('Já existe um pedido de assinatura nesta página. Fecha o pedido na extensão e recarrega a página antes de tentar novamente.');
    const request={expired:false};this.signatureRequest=request;
    let timer;
    try{
      const pending=Promise.resolve().then(action);
      // A timed-out provider request cannot be cancelled by the dApp. Keep the
      // lock even if it settles later; never reuse or retry its late signature.
      return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{request.expired=true;reject(Error('A carteira não respondeu em 60 segundos. Fecha a janela da extensão, recarrega esta página e volta a ligar a carteira. Prepara uma nova revisão. Nenhum envio foi iniciado por este pedido.'));},this.signingTimeoutMs);})]);
    }catch(error){
      // Preserve the original rejection code (including user cancellation), but
      // distinguish provider failures from the independent backend RPC checks.
      throw Object.assign(Error(error?.message||String(error)),{code:error?.code,source:'wallet',cause:error});
    }finally{clearTimeout(timer);if(!request.expired&&this.signatureRequest===request)this.signatureRequest=null;}
  }
  clear(){this.epoch++;for(const cleanup of this.cleanups)cleanup();this.cleanups=[];this.session=null;this.onChange(null);}
  dispose(){this.clear();}
  async read(wallet){
    // Only repeat read-only queries. Never retry a signature or a transaction request.
    for(let attempt=0;;attempt++){
      try{return await this.readOnce(wallet);}catch(error){
        if(!walletOperationInProgress(error)||attempt>=3)throw error;
        await new Promise(resolve=>setTimeout(resolve,150*2**attempt));
      }
    }
  }
  async readOnce(wallet){
    if(typeof wallet.provider.getNetwork!=='function')throw Error('A carteira não permite verificar a rede.');
    if(wallet.id==='kasware'&&typeof wallet.provider.getAccounts!=='function')throw Error('Esta versão da KasWare não permite rever a conta ligada.');
    const network=normalizeNetwork(await wallet.provider.getNetwork());
    const account=wallet.id==='kastle'?await wallet.provider.getAccount():null;
    const address=wallet.id==='kastle'?account?.address:(await wallet.provider.getAccounts())?.[0];
    const rawKey=wallet.id==='kastle'?account?.publicKey:typeof wallet.provider.getPublicKey==='function'?await wallet.provider.getPublicKey():null;
    const publicKey=rawKey?ownershipPublicKey(address,rawKey):null;
    if(normalizeNetwork(await wallet.provider.getNetwork())!==network)throw Error('A rede mudou durante a leitura da carteira.');
    accountScript(address);return {id:wallet.id,name:wallet.name,address,network,publicKey,messageSigningSupported:Boolean(publicKey)&&typeof wallet.provider.signMessage==='function',signingSupported:wallet.id==='kastle'?typeof wallet.provider.signTx==='function':typeof wallet.provider.signPskt==='function'};
  }
  async connect(id){
    this.clear();const epoch=this.epoch,wallet=detectWallets(this.host).find(w=>w.id===id);if(!wallet)throw Error('Carteira não detetada neste navegador.');
    if(wallet.id==='kastle'){if(await wallet.provider.connect()!==true)throw Error('Ligação recusada pela carteira.');}
    else {const accounts=await wallet.provider.requestAccounts();if(!Array.isArray(accounts)||!accounts.length)throw Error('Ligação recusada pela carteira.');}
    const snapshot=await this.read(wallet);if(epoch!==this.epoch||this.host[id]!==wallet.provider)throw Error('A carteira mudou durante a ligação.');
    const invalidate=()=>{if(this.session?.wallet===wallet)this.clear();};
    if(typeof wallet.provider.on==='function'&&(typeof wallet.provider.removeListener==='function'||typeof wallet.provider.off==='function'))for(const event of ['accountsChanged','networkChanged','chainChanged','disconnect','kas:account_changed','kas:network_changed']){wallet.provider.on(event,invalidate);this.cleanups.push(()=>{try{(wallet.provider.removeListener||wallet.provider.off).call(wallet.provider,event,invalidate);}catch{}});}
    this.session={wallet,snapshot};this.onChange(snapshot);return snapshot;
  }
  async current(){
    const session=this.session,epoch=this.epoch;if(!session)throw Error('Liga primeiro a carteira.');
    const next=await this.read(session.wallet);
    if(epoch!==this.epoch||this.session!==session||this.host[next.id]!==session.wallet.provider||next.address!==session.snapshot.address||next.network!==session.snapshot.network||next.publicKey!==session.snapshot.publicKey){this.clear();throw Error('Conta ou rede alterada. Liga novamente a carteira.');}
    return next;
  }
  async signReview(plan,expected,{approved=false}={}){
    if(!approved)throw Error('Confirma primeiro a revisão da transação.');
    const current=await this.current();if(current.network!=='testnet-10'||current.address!==expected.address)throw Error('É necessária a conta revista na testnet-10.');
    verifyPaymentReview(plan,expected);
    const session=this.session,epoch=this.epoch,p=session.wallet.provider;let signed;
    if(current.id==='kastle'){if(typeof p.signTx!=='function')throw Error('Esta versão da Kastle não permite assinar sem enviar.');signed=await this.requestSignature(()=>p.signTx('testnet-10',plan.unsignedJson));}
    else {if(typeof p.signPskt!=='function')throw Error('Esta versão da KasWare não suporta signPskt.');signed=await this.requestSignature(()=>p.signPskt({txJsonString:plan.unsignedJson,options:{signInputs:plan.signInputs}}));}
    if(epoch!==this.epoch||this.session!==session)throw Error('A carteira mudou durante a assinatura.');await this.current();
    verifyPaymentReview(plan,expected);verifySignedReview(plan.unsignedJson,signed);return {signedJson:signed,broadcast:false};
  }
  async signVaultFactor({approved=false}={}){
    if(!approved)throw Error('VAULT_REVIEW_APPROVAL_REQUIRED');
    const current=await this.current();if(current.network!=='testnet-10'||!current.messageSigningSupported)throw Error('Liga uma carteira de teste com assinatura de mensagens.');
    const issue=vaultWalletIssue(current);if(issue)throw Error(issue);
    const session=this.session,epoch=this.epoch,message=vaultKeyMessage(current.publicKey);
    const signature=ownershipSignature(await this.requestSignature(()=>current.id==='kasware'?session.wallet.provider.signMessage(message,{noAuxRand:true}):session.wallet.provider.signMessage(message)));
    if(epoch!==this.epoch||this.session!==session)throw Error('VAULT_WALLET_CHANGED');
    await this.current();verifyVaultSignature(current.publicKey,signature).fill(0);
    return {owner:current.publicKey,signature};
  }
  async signPeerUpload(challenge,expected,{approved=false}={}){
    if(!approved)throw Error('UPLOAD_REVIEW_APPROVAL_REQUIRED');
    const current=await this.current();if(current.network!=='testnet-10'||current.address!==expected.address||current.publicKey!==expected.author_pubkey||!current.messageSigningSupported)throw Error('UPLOAD_COMPATIBLE_TESTNET_WALLET_REQUIRED');
    verifyUploadChallenge(challenge,expected);
    const session=this.session,epoch=this.epoch,signature=ownershipSignature(await this.requestSignature(()=>session.wallet.provider.signMessage(challenge.message)));
    if(epoch!==this.epoch||this.session!==session)throw Error('UPLOAD_WALLET_CHANGED');await this.current();
    verifyUploadSignature(challenge,signature,expected);return {body:challenge.body,signature};
  }
  async signPeerHead(challenge,expected,{approved=false}={}){
    if(!approved)throw Error('OWNERSHIP_REVIEW_APPROVAL_REQUIRED');
    const current=await this.current();if(current.network!=='testnet-10'||current.publicKey!==expected.author_pubkey||!current.messageSigningSupported)throw Error('OWNERSHIP_COMPATIBLE_TESTNET_WALLET_REQUIRED');
    verifyHeadChallenge(challenge,expected);
    const session=this.session,epoch=this.epoch,signature=ownershipSignature(await this.requestSignature(()=>session.wallet.provider.signMessage(challenge.message)));
    if(epoch!==this.epoch||this.session!==session)throw Error('OWNERSHIP_WALLET_CHANGED');await this.current();verifyHeadChallenge(challenge,expected);
    return {body:expected,signature};
  }
  async signOwnership(challenge,expected,{approved=false}={}){
    if(!approved)throw Error('OWNERSHIP_REVIEW_APPROVAL_REQUIRED');
    const current=await this.current();if(current.network!=='testnet-10'||current.publicKey!==expected.author_pubkey||!current.messageSigningSupported)throw Error('OWNERSHIP_COMPATIBLE_TESTNET_WALLET_REQUIRED');
    verifyOwnershipChallenge(challenge,expected);
    const session=this.session,epoch=this.epoch;
    const signature=ownershipSignature(await this.requestSignature(()=>session.wallet.provider.signMessage(challenge.message)));
    if(epoch!==this.epoch||this.session!==session)throw Error('OWNERSHIP_WALLET_CHANGED');
    await this.current();verifyOwnershipChallenge(challenge,expected);
    return {challengeId:challenge.challengeId,author_pubkey:current.publicKey,signature};
  }
}
