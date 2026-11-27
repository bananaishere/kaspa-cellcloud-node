import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {canonicalJson,hash,isDigest,utf8} from './integrity.js';

export function placementNodes(nodes){
 if(!Array.isArray(nodes)||nodes.length<2||nodes.length>3||
    !nodes.every(isDigest)||new Set(nodes).size!==nodes.length)throw Error('INVALID_CELL_PLACEMENT');
 return [...nodes];
}

export function assignedCellDigests(entries,nodes,nodeId){
 const owner=nodes.indexOf(nodeId);
 if(owner<0)throw Error('INVALID_CELL_PLACEMENT');
 return new Set(entries.flatMap(entry=>entry.stripes.flatMap(stripe=>
  stripe.digests.filter((_,position)=>position%nodes.length===owner)
 )));
}

function receiptMessage(body){
 return utf8('CellCloud staged cell placement v1\n'+canonicalJson(body));
}

export function signPlacementReceipt(store,manifestId,nodes){
 const body={networkId:store.network,manifestId,nodes,issuedAt:store.now(),publicKey:store.publicKey};
 return {body,signature:bytesToHex(ed25519.sign(receiptMessage(body),store.secret))};
}

export function verifyPlacementReceipts(receipts,{networkId,manifestId,nodes,acceptedAt}){
 if(!Array.isArray(receipts)||receipts.length!==nodes.length||
    !Number.isSafeInteger(acceptedAt))throw Error('PLACEMENT_RECEIPTS_REQUIRED');
 const confirmed=new Set();
 for(const receipt of receipts){
  const {body,signature}=receipt||{};
  if(!body||Object.keys(body).sort().join(',')!=='issuedAt,manifestId,networkId,nodes,publicKey'||
     body.networkId!==networkId||body.manifestId!==manifestId||
     canonicalJson(placementNodes(body.nodes))!==canonicalJson(nodes)||
     !isDigest(body.publicKey)||!Number.isSafeInteger(body.issuedAt)||
     body.issuedAt>acceptedAt+5000||acceptedAt-body.issuedAt>10*60*1000||
     typeof signature!=='string'||!/^[a-f0-9]{128}$/.test(signature))throw Error('INVALID_PLACEMENT_RECEIPT');
  const key=hexToBytes(body.publicKey),nodeId=hash(key);
  if(!nodes.includes(nodeId)||confirmed.has(nodeId)||
     !ed25519.verify(hexToBytes(signature),receiptMessage(body),key))throw Error('INVALID_PLACEMENT_RECEIPT');
  confirmed.add(nodeId);
 }
}

export function placementHeadMessage(networkId,proof){
 return utf8('CellCloud committed distributed version v1\n'+canonicalJson({networkId,proof}));
}

export function verifyPlacementHead(witness,{networkId,proof,coordinator}){
 if(!isDigest(witness?.publicKey)||hash(hexToBytes(witness.publicKey))!==coordinator||
    typeof witness.signature!=='string'||!/^[a-f0-9]{128}$/.test(witness.signature)||
    !ed25519.verify(hexToBytes(witness.signature),placementHeadMessage(networkId,proof),hexToBytes(witness.publicKey)))
  throw Error('INVALID_PLACEMENT_HEAD');
}
