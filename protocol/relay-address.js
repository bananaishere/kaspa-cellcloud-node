const peerId = '[1-9A-HJ-NP-Za-km-z]{30,80}';
const relayPath = new RegExp('^/relay/(' + peerId + ')$');
const peerPath = new RegExp('^/peer/(' + peerId + ')/(' + peerId + ')$');
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);

export function relayEndpoint(value, {secureContext = false} = {}) {
 const url = new URL(value);
 const match = relayPath.exec(url.pathname);
 if (!match || url.username || url.password || url.search || url.hash ||
     !(url.protocol === 'wss:' || url.protocol === 'ws:' && !secureContext && loopback(url.hostname))) {
  throw Error('INVALID_RELAY_ENDPOINT');
 }
 const host = url.hostname;
 const address = (host === '127.0.0.1' ? '/ip4/' : host === '[::1]' ? '/ip6/' : '/dns/') + host.replace(/^\[|\]$/g, '') +
  '/tcp/' + (url.port || (url.protocol === 'wss:' ? 443 : 80)) +
  (url.protocol === 'wss:' ? '/tls/ws' : '/ws') + '/p2p/' + match[1];
 return {url: url.href, address};
}

export function relayPeer(value, options) {
 const url = new URL(value);
 const match = peerPath.exec(url.pathname);
 if (!match) return null;
 if (url.hash || url.username || url.password ||
     [...url.searchParams.keys()].some(key => key !== 'via')) throw Error('INVALID_RELAY_ENDPOINT');
 const primary = new URL(url.href);
 primary.pathname = '/relay/' + match[1];
 primary.search = '';
 const candidates = [primary.href, ...url.searchParams.getAll('via')];
 if (candidates.length > 3 || url.href.length > 1024) throw Error('RELAY_ENDPOINT_LIMIT');
 const endpoints = candidates.map(item => relayEndpoint(item, options));
 if (new Set(endpoints.map(item => item.url)).size !== endpoints.length) throw Error('DUPLICATE_RELAY_ENDPOINT');
 return {url: url.href, peerId: match[2], endpoints};
}

export function relayPeerUrl(relays, target) {
 const url = new URL(relays[0]);
 url.pathname = url.pathname.replace('/relay/', '/peer/') + '/' + target;
 for (const relay of relays.slice(1)) url.searchParams.append('via', relay);
 return relayPeer(url).url;
}
