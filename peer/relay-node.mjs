import {privateKeyFromRaw} from '@libp2p/crypto/keys';
import {multiaddr} from '@multiformats/multiaddr';
import {relayEndpoint,relayPeerUrl} from '../protocol/relay-address.js';
import {relayTransport,RelaySocket,RELAY_READ,RELAY_UPLOAD} from '../protocol/relay-transport.js';

export async function startRelayNode({store,server,relays,origin,log=()=>{}}) {
 if (store.network !== 'testnet-10') throw Error('RELAY_TESTNET_ONLY');
 const secret=Buffer.concat([store.secret,Buffer.from(store.publicKey,'hex')]);
 const privateKey=privateKeyFromRaw(secret);
 secret.fill(0);
 const route=relayPeerUrl(relays,privateKey.publicKey.toString());
 let closing=false;
 const attach=readOnly=>stream=>{
  if(closing){stream.abort(Error('NODE_STOPPING'));return;}
  const socket=new RelaySocket();
  server.acceptRelay(socket,origin,readOnly);
  socket.attach(stream);
 };
 const routes=relays.map(value=>({endpoint:relayEndpoint(value),client:null}));
 async function connect(routeInfo) {
  if(closing)return;
  const {endpoint,client}=routeInfo;
  if(client?.getMultiaddrs().length&&client.getConnections().some(connection=>
   connection.remotePeer.toString()===endpoint.address.split('/').at(-1)&&connection.status==='open'))return;
  routeInfo.client=null;
  await client?.stop();
  let peer;
  try {
   peer=await relayTransport({privateKey,addresses:{listen:[endpoint.address+'/p2p-circuit']},start:false});
   await peer.handle(RELAY_READ,attach(true),{runOnLimitedConnection:true,maxInboundStreams:2});
   await peer.handle(RELAY_UPLOAD,attach(false),{runOnLimitedConnection:true,maxInboundStreams:2});
   await peer.start();
   if(closing){await peer.stop();return;}
   if(!peer.getMultiaddrs().length)throw Error('RELAY_RESERVATION_UNAVAILABLE');
   routeInfo.client=peer;
   log({event:'relay-ready',networkId:store.network,nodeId:store.nodeId,publicUrl:route,relay:endpoint.url});
  }catch{
   await peer?.stop();
   log({event:'relay-unavailable',relay:endpoint.url});
  }
 }
 let cycle=Promise.resolve();
 const refresh=()=>{cycle=Promise.all(routes.map(connect)).catch(()=>{});return cycle;};
 let timer;
 const schedule=()=>{if(!closing)timer=setTimeout(()=>void refresh().then(schedule),10000);};
 await refresh();
 schedule();
 return {url:route,close:async()=>{closing=true;clearTimeout(timer);await cycle;await Promise.all(routes.map(item=>item.client?.stop()));}};
}
