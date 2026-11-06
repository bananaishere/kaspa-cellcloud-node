import {recommendedTier,deploymentPrice} from './upload-policy.js';
import {paymentPayload,updatePrice,updateIntent} from '../lab/lib/payment-intent.mjs';
const check=(value,message='TRANSAÇÃO_DIFERENTE_DO_PEDIDO')=>{if(!value)throw Error(message);};
export function accountScript(address,{testnetOnly=false}={}){
  check(typeof address==='string'&&address===address.toLowerCase(),'ENDEREÇO_INVÁLIDO');
  const [prefix,encoded,...extra]=address.split(':');check(['kaspatest','kaspa'].includes(prefix)&&(!testnetOnly||prefix==='kaspatest')&&!extra.length&&encoded?.length===61,'ENDEREÇO_KASPA_INCOMPATÍVEL');
  const alphabet='qpzry9x8gf2tvdw0s3jn54khce6mua7l',words=[...encoded].map(c=>alphabet.indexOf(c));check(words.every(v=>v>=0));
  let crc=1n;const generators=[0x98f2bc8e61n,0x79b76d99e2n,0xf33e5fb3c4n,0xae2eabe2a8n,0x1e4f43e470n];
  for(const value of [...prefix].map(c=>c.charCodeAt(0)&31).concat(0,words)){const top=crc>>35n;crc=((crc&0x07ffffffffn)<<5n)^BigInt(value);for(let i=0;i<5;i++)if((top>>BigInt(i))&1n)crc^=generators[i];}
  check((crc^1n)===0n,'CHECKSUM_DO_ENDEREÇO_INVÁLIDO');
  const bytes=[];let acc=0,bits=0;for(const w of words.slice(0,-8)){acc=((acc<<5)|w)&65535;bits+=5;while(bits>=8){bits-=8;bytes.push((acc>>bits)&255);}}
  check(bits<5&&((acc<<(8-bits))&255)===0&&bytes.length===33&&bytes[0]===0,'ENDEREÇO_SCHNORR_NECESSÁRIO');
  return '000020'+bytes.slice(1).map(n=>n.toString(16).padStart(2,'0')).join('')+'ac';
}
const integer=value=>{check(typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value));return BigInt(value);};
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
export function verifyPaymentReview(plan,expected,{now=Date.now()}={}){
  check(plan?.networkId==='testnet-10'&&plan.broadcastEnabled===false&&plan.chainVerified===true,'PLANO_TESTNET_NÃO_VERIFICADO');
  check(plan.address===expected.address&&plan.manifestId===expected.manifestId&&plan.tier===expected.tier&&plan.treasuryAddress===expected.treasuryAddress&&plan.poolAddress===expected.poolAddress);
  const updating=Boolean(expected.updateIntent);if(updating){const context=updateIntent(expected.updateIntent);check(expected.tier==='UPDATE'&&accountScript(expected.address)==='000020'+context.author_pubkey+'ac','UPDATE_OWNER_WALLET_REQUIRED');check(plan.billing?.operation==='UPDATE'&&Object.entries(context).every(([key,value])=>plan.billing[key]===value),'UPDATE_CONTEXT_CHANGED');}
  if(expected.sizeBytes!==undefined){check(Number.isSafeInteger(expected.sizeBytes)&&expected.sizeBytes>=0&&(updating||recommendedTier(expected.sizeBytes)===expected.tier),'PLANO_INCOMPATÍVEL_COM_O_TAMANHO');check(plan.billing?.operation===(updating?'UPDATE':'PUBLISH')&&plan.billing.manifestId===expected.manifestId&&plan.billing.tier===expected.tier&&plan.billing.sizeBytes===expected.sizeBytes,'COBRANÇA_DIFERENTE_DA_PUBLICAÇÃO');}
  check(Number.isFinite(plan.expiresAt)&&plan.expiresAt>now&&plan.expiresAt<=now+180000,'REVISÃO_EXPIRADA');
  const price=BigInt(updating?updatePrice(expected.sizeBytes):deploymentPrice(expected.tier,expected.sizeBytes));
  const total=price*100000000n,treasury=total*5n/100n,pool=total-treasury,own=accountScript(expected.address,{testnetOnly:true});
  const scripts=[accountScript(expected.treasuryAddress,{testnetOnly:true}),accountScript(expected.poolAddress,{testnetOnly:true}),own];check(new Set(scripts).size===3);
  check(typeof plan.unsignedJson==='string'&&plan.unsignedJson.length<=200000);const tx=JSON.parse(plan.unsignedJson);
  check(tx.version===0&&tx.subnetworkId==='00'.repeat(20)&&tx.lockTime==='0'&&tx.gas==='0'&&Array.isArray(tx.inputs)&&tx.inputs.length>0&&tx.inputs.length<=32&&tx.outputs?.length===3);
  let funding=0n;const seen=new Set();
  // The SDK builder assigns each input its ordinal sequence (0, 1, ...).
  // Require that exact value; the signed transaction must still preserve it.
  for(const [ordinal,input] of tx.inputs.entries()){const key=input.transactionId+':'+input.index;check(/^[a-f0-9]{64}$/.test(input.transactionId)&&Number.isInteger(input.index)&&input.index>=0&&input.index<=4294967295&&!seen.has(key));seen.add(key);check(input.sequence===String(ordinal)&&input.sigOpCount===1&&input.computeBudget===0&&!input.signatureScript,'As entradas da transação não correspondem à revisão. Prepara uma nova revisão.');check(input.utxo?.address===expected.address&&input.utxo.scriptPublicKey===own&&input.utxo.isCoinbase===false&&!input.utxo.covenantId&&integer(input.utxo.blockDaaScore)>0n);const amount=integer(input.utxo.amount);check(amount>0n&&amount<=18446744073709551615n);funding+=amount;}
  tx.outputs.forEach((out,i)=>check(out.scriptPublicKey===scripts[i]&&!out.covenant));
  const change=integer(tx.outputs[2].value),fee=funding-total-change;
  check(integer(tx.outputs[0].value)===treasury&&integer(tx.outputs[1].value)===pool&&change>=100000000n&&fee>0n&&fee<=10000000n);
  check(integer(plan.totalSompi)===total&&integer(plan.treasurySompi)===treasury&&integer(plan.poolSompi)===pool&&integer(plan.feeSompi)===fee&&integer(plan.changeSompi)===change);
  check(plan.signInputs?.length===tx.inputs.length&&plan.signInputs.every((s,i)=>s.index===i&&s.sighashType===1));
  const payload=paymentPayload({manifestId:expected.manifestId,tier:expected.tier,update:expected.updateIntent});
  check(tx.payload===[...new TextEncoder().encode(payload)].map(n=>n.toString(16).padStart(2,'0')).join(''));
  return {verified:true,totalSompi:String(total),feeSompi:String(fee)};
}
export function verifySignedReview(unsignedJson,signedJson){
  check(typeof signedJson==='string'&&signedJson.length<=200000);const unsigned=JSON.parse(unsignedJson),signed=JSON.parse(signedJson);
  check(Array.isArray(signed.inputs)&&signed.inputs.length===unsigned.inputs.length&&signed.inputs.every(i=>/^41[a-f0-9]{128}01$/.test(i.signatureScript||'')));
  for(const tx of [unsigned,signed]){delete tx.id;for(const input of tx.inputs)delete input.signatureScript;}
  check(canonical(unsigned)===canonical(signed));return true;
}
