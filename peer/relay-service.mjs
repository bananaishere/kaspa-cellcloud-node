import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {generateKeyPair,privateKeyFromProtobuf,privateKeyToProtobuf} from '@libp2p/crypto/keys';
import {circuitRelayServer} from '@libp2p/circuit-relay-v2';
import {identify} from '@libp2p/identify';
import {relayTransport} from '../protocol/relay-transport.js';

export function startTestnetRelay({privateKey,listen,announce=[]}) {
 return relayTransport({
  privateKey,addresses:{listen:[listen],announce},
  services:{identify:identify(),relay:circuitRelayServer({
   reservations:{maxReservations:16,defaultDurationLimit:15*60*1000,defaultDataLimit:256n*1024n**2n},
   maxInboundHopStreams:24,maxOutboundStopStreams:24
  })}
 });
}

// Relay operators supply WSS through an existing HTTPS reverse proxy.
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [keyFile,publicHost,port='8090']=process.argv.slice(2);
 if(!keyFile||!publicHost||!/^[a-z0-9.-]+$/i.test(publicHost)||!/^[1-9][0-9]{0,4}$/.test(port)||Number(port)>65535)throw Error('Usage: node peer/relay-service.mjs PRIVATE_KEY_FILE PUBLIC_HOSTNAME [LOCAL_PORT]');
 let privateKey;
 try{privateKey=privateKeyFromProtobuf(await fs.readFile(keyFile));}
 catch(error){if(error.code!=='ENOENT')throw error;privateKey=await generateKeyPair('Ed25519');await fs.writeFile(keyFile,privateKeyToProtobuf(privateKey),{flag:'wx',mode:0o600});}
 const relay=await startTestnetRelay({privateKey,listen:'/ip4/127.0.0.1/tcp/'+port+'/ws',announce:['/dns/'+publicHost+'/tcp/443/tls/ws']});
 console.log(JSON.stringify({event:'relay-listening',network:'testnet-10',endpoint:'wss://'+publicHost+'/relay/'+relay.peerId,port:Number(port)}));
 for(const event of ['SIGINT','SIGTERM'])process.once(event,()=>void relay.stop());
}
