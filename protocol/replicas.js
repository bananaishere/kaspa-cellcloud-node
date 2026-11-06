import {ed25519} from '@noble/curves/ed25519.js';
import {bytesToHex,hexToBytes} from '@noble/hashes/utils.js';
import {canonicalJson,hash,isDigest,utf8} from './integrity.js';
import {peerUrl} from './wire.js';
import {networkId} from './network.js';

export const REPLICA_ORIGIN='http://cellcloud-replica.localhost';
export function replicaPeers(value,ownId){
 if(!Array.isArray(value)||value.length>3)throw Error('REPLICA_PEER_LIMIT');
 const ids=new Set(),urls=new Set();return value.map(item=>{
  if(!item||Object.keys(item).sort().join(',')!=='nodeId,url'||!isDigest(item.nodeId)||item.nodeId===ownId||ids.has(item.nodeId))throw Error('INVALID_REPLICA_PEER');
  const url=peerUrl(item.url);if(urls.has(url))throw Error('INVALID_REPLICA_PEER');ids.add(item.nodeId);urls.add(url);return {url,nodeId:item.nodeId};
 });
}
export function replicaAuthMessage({network,serverId,clientId,challenge}){
 networkId(network);if(![serverId,clientId,challenge].every(isDigest))throw Error('INVALID_REPLICA_CHALLENGE');
 return utf8('CellCloud replica authentication v1\n'+canonicalJson({networkId:network,serverId,clientId,challenge}));
}
export function signReplicaAuth(store,hello){
 const message=replicaAuthMessage({network:store.network,serverId:hello.nodeId,clientId:store.nodeId,challenge:hello.replicaChallenge});
 return {nodeId:store.nodeId,publicKey:store.publicKey,signature:bytesToHex(ed25519.sign(message,store.secret))};
}
export function verifyReplicaAuth(store,args,challenge){
 if(!store.replicaPeers?.some(peer=>peer.nodeId===args?.nodeId)||!isDigest(args?.publicKey)||hash(hexToBytes(args.publicKey))!==args.nodeId||typeof args.signature!=='string'||!/^[a-f0-9]{128}$/.test(args.signature))throw Error('REPLICA_AUTH_REQUIRED');
 const message=replicaAuthMessage({network:store.network,serverId:store.nodeId,clientId:args.nodeId,challenge});
 if(!ed25519.verify(hexToBytes(args.signature),message,hexToBytes(args.publicKey)))throw Error('REPLICA_AUTH_REQUIRED');return true;
}
export function publicationPeers(primary,hello,{secureContext=false}={}){
 const result=[{url:peerUrl(primary.url,{secureContext}),nodeId:primary.nodeId}];
 if(!isDigest(primary.nodeId))throw Error('INVALID_REPLICA_PEER');
 for(const peer of replicaPeers(hello?.replicas||[],primary.nodeId)){
  // HTTPS viewers can only contact WSS peers. Keep the primary usable if a
  // local operator also has a loopback-only replication neighbour.
  try{result.push({url:peerUrl(peer.url,{secureContext}),nodeId:peer.nodeId});}catch{}
 }return result;
}
