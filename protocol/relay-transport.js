import {createLibp2p} from 'libp2p';
import {webSockets} from '@libp2p/websockets';
import {circuitRelayTransport} from '@libp2p/circuit-relay-v2';
import {identify} from '@libp2p/identify';
import {noise} from '@chainsafe/libp2p-noise';
import {yamux} from '@chainsafe/libp2p-yamux';
import {lpStream} from '@libp2p/utils';
import {utf8} from './integrity.js';
import {MAX_MANIFEST_BYTES} from './manifest.js';

export const RELAY_READ = '/cellcloud/testnet-10/read/1';
export const RELAY_UPLOAD = '/cellcloud/testnet-10/wallet/1';

export function relayTransport(options = {}) {
 return createLibp2p({
  transports: [webSockets(), circuitRelayTransport({listenTimeout: 5000})],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {identify: identify()},
  connectionManager: {maxConnections: 32, dialTimeout: 6000, reconnectRetries: 0},
  ...options
 });
}

// Adapt a Noise-encrypted libp2p stream to the existing CellCloud message protocol.
export class RelaySocket extends EventTarget {
 readyState = 0;
 #queue = Promise.resolve();
 #waiting = 0;
 #stream;
 #frames;

 attach(stream) {
  if (this.readyState !== 0) {
   stream.abort(Error('RELAY_SESSION_CLOSED'));
   return;
  }
  this.#stream = stream;
  this.#frames = lpStream(stream, {maxDataLength: MAX_MANIFEST_BYTES + 65536});
  this.readyState = 1;
  this.dispatchEvent(new Event('open'));
  void this.#receive();
 }

 async #receive() {
  const decoder = new TextDecoder('utf-8', {fatal: true});
  try {
   while (this.readyState === 1) {
    const frame = (await this.#frames.read()).subarray();
    if (frame.length < 2 || frame[0] > 1) throw Error('INVALID_RELAY_FRAME');
    const payload = frame.subarray(1);
    const data = frame[0] === 1 ? payload.slice().buffer : decoder.decode(payload);
    this.dispatchEvent(new MessageEvent('message', {data}));
   }
  } catch {
   this.close();
  }
 }

 send(data) {
  if (this.readyState !== 1) throw Error('RELAY_SESSION_CLOSED');
  if (this.#waiting >= 4) {
   this.close();
   throw Error('RELAY_QUEUE_LIMIT');
  }
  const binary = typeof data !== 'string';
  const payload = binary ? new Uint8Array(data) : utf8(data);
  const frame = new Uint8Array(payload.length + 1);
  frame[0] = Number(binary);
  frame.set(payload, 1);
  this.#waiting++;
  this.#queue = this.#queue.then(() => this.#frames.write(frame)).catch(() => this.close())
   .finally(() => this.#waiting--);
 }

 close() {
  if (this.readyState === 3) return;
  this.readyState = 3;
  this.#stream?.abort(Error('RELAY_SESSION_CLOSED'));
  this.dispatchEvent(new Event('close'));
 }
}
