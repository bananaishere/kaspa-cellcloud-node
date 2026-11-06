import WebSocket from 'ws';
import {PeerClient} from '../src/peer-client.js';

export async function diagnoseOperator(config,{timeoutMs=5000}={}){
 const local=['0.0.0.0','::'].includes(config.host)?'127.0.0.1':config.host;
 const host=local.includes(':')?'['+local+']':local,url=config.publicUrl||`${config.tls?'wss':'ws'}://${host}:${config.port}/peer`;
 const peer=new PeerClient({url,network:config.network,pin:config.expectedNodeId||'',timeoutMs,socketFactory:value=>new WebSocket(value,{headers:{Origin:config.origins[0]}})});
 try{
  const hello=await peer.connect(),replication=config.expectedNodeId?await peer.request('replicaStatus'):null;
  return {reachable:true,url,network:hello.networkId,nodeId:hello.nodeId,signedHandshake:true,identityPinned:peer.trusted,usedBytes:hello.usedBytes,quotaBytes:hello.quotaBytes,replicationNeighbours:hello.replicas||[],replication,configuredTransport:url.startsWith('wss:')?'wss':'loopback-ws',wanProven:false,rpcChecked:false,mainnetPayments:false,paymentRequested:false};
 }finally{peer.close();}
}
