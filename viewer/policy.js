import {isDigest} from '../protocol/integrity.js';
import {networkId} from '../protocol/network.js';
import {peerUrl} from '../protocol/wire.js';

export function viewerBase(configured,appOrigin){
 const app=new URL(appOrigin),local=['localhost','127.0.0.1','[::1]'].includes(app.hostname)||app.hostname.endsWith('.localhost');
 if(!configured&&!local)throw Error('P2P_VIEWER_ORIGIN_NOT_CONFIGURED');
 const template=configured||'http://{site}.viewer.localhost:5192';
 if(typeof template!=='string'||template.split('{site}').length!==2)throw Error('P2P_VIEWER_ORIGIN_TEMPLATE_REQUIRED');
 const url=new URL(template.replace('{site}','tn10-'+'0'.repeat(32)));
 if(!url.hostname.startsWith('tn10-'+'0'.repeat(32)+'.')||url.origin===app.origin||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&(!local||!url.hostname.endsWith('.localhost')))throw Error('P2P_VIEWER_REQUIRES_SEPARATE_SECURE_ORIGIN');
 return url.origin.replace('tn10-'+'0'.repeat(32),'{site}');
}
export function viewerLink({base,appOrigin,network,id,application,name='',peers,language='en'}){
 if(application){if(!isDigest(application.rootManifestId)||!isDigest(application.author))throw Error('INVALID_HEAD_LINK');id=application.rootManifestId;}
 if(!isDigest(id))throw Error('INVALID_MANIFEST');networkId(network);const origin=viewerBase(base,appOrigin).replace('{site}',(network==='testnet-10'?'tn10':'main')+'-'+(application?'a-':'')+id.slice(0,32)),link=new URL('/_viewer/',origin);
 if(link.origin===new URL(appOrigin).origin)throw Error('P2P_VIEWER_REQUIRES_SEPARATE_SECURE_ORIGIN');
 const selected=validatePeers(peers,{secureContext:link.protocol==='https:'});link.hash=new URLSearchParams({network:networkId(network),...(application?{app:id,author:application.author}:{manifest:id}),name:String(name).slice(0,80),peers:JSON.stringify(selected),lang:language==='pt'?'pt':'en'}).toString();return link.href;
}
export function validatePeers(peers,{secureContext=false}={}){
 if(!Array.isArray(peers)||peers.length<1||peers.length>4)throw Error('VIEWER_PEERS_REQUIRED');return peers.map(peer=>{if(!isDigest(peer?.nodeId))throw Error('VIEWER_PIN_REQUIRED');return {url:peerUrl(peer.url,{secureContext}),nodeId:peer.nodeId};});
}
export function parseViewerLink(location){
 if(location.hash.length>6000)throw Error('VIEWER_LINK_LIMIT');const args=new URLSearchParams(location.hash.slice(1)),root=args.get('app'),id=args.get('manifest');
 if(root?(!isDigest(root)||!isDigest(args.get('author'))||id!==null):!isDigest(id))throw Error('INVALID_MANIFEST');
 return {id:root?null:id,...(root?{application:{rootManifestId:root,author:args.get('author')}}:{}),path:navigationPath(args.get('path')||'/'),network:networkId(args.get('network')),name:(args.get('name')||'CellCloud').slice(0,80),language:args.get('lang')==='pt'?'pt':'en',peers:validatePeers(JSON.parse(args.get('peers')||'null'),{secureContext:location.protocol==='https:'})};
}
export function verifyViewerOrigin(hostname,network,id,application=false){if(!isDigest(id)||hostname.split('.')[0]!==((networkId(network)==='testnet-10'?'tn10':'main')+'-'+(application?'a-':'')+id.slice(0,32)))throw Error('VIEWER_PUBLICATION_ORIGIN_MISMATCH');}
// Hard reload may bypass the Service Worker. Recover only a previously saved
// bootstrap on this exact publication origin; never guess peers or an author.
export function recoverViewerBootstrap(location,active){
 if(!active?.bootstrap)throw Error('VIEWER_ORIGINAL_LINK_REQUIRED');
 const current=new URL(location.href),bootstrap=new URL(active.bootstrap),config=parseViewerLink(bootstrap);
 if(bootstrap.origin!==current.origin||bootstrap.pathname!=='/_viewer/'||config.network!==active.network)throw Error('INVALID_BOOTSTRAP');
 verifyViewerOrigin(current.hostname,config.network,config.application?.rootManifestId||config.id,Boolean(config.application));
 if(active.application){if(config.application?.rootManifestId!==active.application.rootManifestId||config.application.author!==active.application.author)throw Error('INVALID_BOOTSTRAP');}
 else if(config.application||config.id!==active.id)throw Error('INVALID_BOOTSTRAP');
 const args=new URLSearchParams(bootstrap.hash.slice(1));args.set('path',navigationPath(current.pathname.startsWith('/_viewer/')?'/':current.pathname+current.search));bootstrap.hash=args.toString();return bootstrap.href;
}
export function viewerControlRetry(location,alreadyRetried){
 if(alreadyRetried)throw Error('VIEWER_SERVICE_WORKER_CONTROL_TIMEOUT');
 const url=new URL(location.href),config=parseViewerLink(url);
 if(url.pathname!=='/_viewer/')throw Error('INVALID_BOOTSTRAP');
 verifyViewerOrigin(url.hostname,config.network,config.application?.rootManifestId||config.id,Boolean(config.application));
 url.searchParams.set('__cellcloud_sw_retry','1');return url.href;
}
export function readOnlyViewerOrigin(origin,templates=[]){
 try{const url=new URL(origin);if(url.origin!==origin)return false;const site=url.hostname.split('.')[0];if(!/^(tn10|main)-(?:a-)?[a-f0-9]{32}$/.test(site))return false;return templates.some(template=>viewerBase(template,'http://127.0.0.1:5191').replace('{site}',site)===origin);}catch{return false;}
}
export function resourceName(path){let decoded;try{decoded=decodeURIComponent(path);}catch{throw Error('INVALID_RESOURCE_PATH');}if(decoded.includes('\\')||/[\x00-\x1f\x7f]/.test(decoded)||decoded.includes(':')||decoded.split('/').some(part=>part==='.'||part==='..'))throw Error('INVALID_RESOURCE_PATH');return decoded;}
export function navigationPath(value){
 if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||/[\x00-\x1f\x7f\\]/.test(value))throw Error('INVALID_NAVIGATION_PATH');
 const url=new URL(value,'https://viewer.invalid');resourceName(value.split('?')[0]);
 if(url.origin!=='https://viewer.invalid'||url.hash||url.pathname.startsWith('/_viewer/')||url.pathname==='/viewer-sw.js')throw Error('INVALID_NAVIGATION_PATH');return url.pathname+url.search;
}
const types={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json; charset=utf-8',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',ico:'image/x-icon',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',wasm:'application/wasm',txt:'text/plain; charset=utf-8',pdf:'application/pdf',mp3:'audio/mpeg',mp4:'video/mp4',webmanifest:'application/manifest+json'};
export const mime=name=>types[name.split('.').at(-1).toLowerCase()]||'application/octet-stream';
export const siteCsp="sandbox allow-scripts allow-same-origin; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: wss:; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'none'";
