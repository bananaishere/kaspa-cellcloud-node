import {multiaddr} from '@multiformats/multiaddr';
import {relayTransport, RelaySocket, RELAY_READ, RELAY_UPLOAD} from '../protocol/relay-transport.js';

export function openRelaySocket(route, {readOnly = false, timeoutMs = 8000} = {}) {
 const socket = new RelaySocket();
 const controller = new AbortController();
 const stop = () => controller.abort();
 socket.addEventListener('close', stop, {once: true});
 void (async () => {
  let client;
  try {
   client = await relayTransport();
   if (controller.signal.aborted) return;
   for (const endpoint of route.endpoints) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.min(3500, timeoutMs / route.endpoints.length))]);
    const address = multiaddr(endpoint.address + '/p2p-circuit/p2p/' + route.peerId);
    let connection;
    try {
     connection = await client.dial(address, {signal});
     if (connection.remotePeer.toString() !== route.peerId) throw Error('RELAY_PEER_IDENTITY_CHANGED');
     const stream = await connection.newStream(readOnly ? RELAY_READ : RELAY_UPLOAD,
      {signal, runOnLimitedConnection: true});
     socket.attach(stream);
     await new Promise(resolve => {
      if (controller.signal.aborted) resolve();
      else controller.signal.addEventListener('abort', resolve, {once: true});
     });
     return;
    } catch (error) {
     connection?.abort(error);
     if (controller.signal.aborted) return;
    }
   }
  } finally {
   socket.close();
   await client?.stop();
  }
 })().catch(() => socket.close());
 return socket;
}
