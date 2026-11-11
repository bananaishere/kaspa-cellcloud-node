import http from 'node:http';
import https from 'node:https';
import {WebSocketServer} from 'ws';
import {FRAME_LIMIT,unpack,pack} from '../protocol/wire.js';
import {MAX_MANIFEST_BYTES} from '../protocol/manifest.js';
import {PROTOCOL,sameNetwork} from '../protocol/network.js';
import {readOnlyViewerOrigin} from '../viewer/policy.js';
import {REPLICA_ORIGIN,verifyReplicaAuth} from '../protocol/replicas.js';
import {ReplicaData} from './replica-data.mjs';
import {randomBytes} from 'node:crypto';
import {canonicalJson} from '../protocol/integrity.js';
import {verifyUploadChallenge,verifyUploadSignature,uploadAdmissionMessage} from '../protocol/upload-admission.js';

const publicErrors=new Set(['UPLOAD_AUTHORIZATION_REQUIRED','PEER_NETWORK_MISMATCH','INVALID_HELLO_NONCE','INVALID_PUBLICATION_REQUEST','AUTHOR_WALLET_MISMATCH','MANIFEST_HASH_MISMATCH','INVALID_MANIFEST','MANIFEST_LIMIT','INVALID_CELL_PROOF','STORAGE_QUOTA_EXCEEDED','STAGED_PUBLICATION_LIMIT','PUBLICATION_METADATA_CHANGED','PUBLICATION_NOT_FOUND','PUBLICATION_NOT_STAGED','INVALID_CELL_POSITION','UPLOAD_INCOMPLETE','STORED_CELL_CORRUPTED','PAYMENT_CONTEXT_CHANGED','PAYMENT_INPUT_SPENT_OR_CHANGED','PAYMENT_FEE_CHANGED','EXISTING_PAYMENT_MUST_BE_RESUMED','SIGNED_PAYMENT_REQUIRED','PAYMENT_CONFIRMATION_REQUIRED','TRANSACTION_ID_CHANGED','PLAN_CHANGED','CRYPTOGRAPHIC_SIGNATURE_INVALID','PEER_PAYMENT_RPC_REQUIRED','MAINNET_PAYMENTS_NOT_ENABLED','KASPA_RPC_TIMEOUT','KASPA_RPC_WRONG_NETWORK','KASPA_RPC_NOT_READY','PEER_VAULT_NOT_SUPPORTED','SEND_ALREADY_REQUESTED_RESUME_CONFIRMATION']);
for(const code of ['INVALID_HEAD_FIELDS','INVALID_HEAD_PROTOCOL','INVALID_HEAD_DIGEST','INVALID_HEAD_NAME','INVALID_HEAD_TIME','HEAD_HISTORY_LIMIT','INVALID_HEAD_SEQUENCE','INVALID_HEAD_RECORD','HEAD_SIGNATURE_INVALID','HEAD_GENESIS_REQUIRED','HEAD_SEQUENCE_CONFLICT','HEAD_ROOT_MISMATCH','ORIGINAL_AUTHOR_REQUIRED','VERSION_CONSISTENCY_ERROR','HEAD_NOT_FOUND','HEAD_CONFIRMED_PAYMENT_REQUIRED','UPDATE_PAYMENT_REQUIRED','ORIGINAL_PAYMENT_REQUIRED','HEAD_ALREADY_EXISTS','HEAD_REVIEW_EXPIRED','UPDATE_ALREADY_STAGED'])publicErrors.add(code);
for(const code of ['REPLICA_AUTH_REQUIRED','REPLICA_READ_ONLY','INVALID_REPLICA_RECORD','REPLICA_PAYMENT_UNCONFIRMED','REPLICA_RECEIPT_CONFLICT','INVALID_HEAD_CONFLICT_PROOF'])publicErrors.add(code);
publicErrors.add('INVALID_STORAGE_RECEIPT');
publicErrors.add('ROLLBACK_TARGET_NOT_IN_HISTORY');
publicErrors.add('RECOVERY_VERIFICATION_ONLY');
for(const code of ['PUBLIC_UPLOADS_DISABLED','PUBLIC_UPLOADS_TESTNET_ONLY','UPLOAD_SIGNATURE_INVALID','INVALID_UPLOAD_CHALLENGE','UPLOAD_CHALLENGE_CONTEXT_CHANGED','UPLOAD_OWNER_REQUIRED','UPLOAD_SESSION_EXPIRED','UPLOAD_AUTH_RATE_LIMIT','PUBLIC_UPLOAD_SIZE_LIMIT','PUBLIC_UPLOAD_PENDING_LIMIT','PUBLIC_UPLOAD_PENDING_BYTES_LIMIT'])publicErrors.add(code);
export async function startPeerServer({store,host='127.0.0.1',port=0,origins=[],viewerOrigins=[],tls,log=()=>{}}){
 const replicas=new ReplicaData(store);let authWindow=0,authCount=0;
 const allowed=new Set(origins.map(origin=>{const parsed=new URL(origin);if(parsed.origin!==origin||parsed.username||parsed.password||!['https:','http:'].includes(parsed.protocol)||parsed.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))throw Error('INVALID_ALLOWED_ORIGIN');return origin;}));
 if(!allowed.size)throw Error('EXPLICIT_BROWSER_ORIGINS_REQUIRED');
 const handler=(req,res)=>{res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.writeHead(req.method==='GET'&&req.url==='/health'?200:404);res.end(JSON.stringify(req.url==='/health'?{protocol:PROTOCOL,networkId:store.network,nodeId:store.nodeId,status:'online'}:{error:'NOT_FOUND'}));};
 const server=tls?https.createServer(tls,handler):http.createServer(handler),wss=new WebSocketServer({noServer:true,maxPayload:MAX_MANIFEST_BYTES+65536,perMessageDeflate:false}),tasks=new Set();let closing=false;
 server.on('upgrade',(req,socket,head)=>{
  // Origin is a browser isolation policy, not authentication. Writes additionally
  // require an operator token or an explicitly enabled, wallet-bound session.
  const viewer=readOnlyViewerOrigin(req.headers.origin,viewerOrigins);
  const replica=req.headers.origin===REPLICA_ORIGIN&&store.replicaPeers.length>0;
  if(closing||req.url!=='/peer'||!allowed.has(req.headers.origin)&&!viewer&&!replica||wss.clients.size>=16){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
 });
 wss.on('connection',(ws,req)=>{
  const readOnly=readOnlyViewerOrigin(req.headers.origin,viewerOrigins);
  const replicaOnly=req.headers.origin===REPLICA_ORIGIN;
  let greeted=false,authenticated=false,replicaAuthenticated=false,replicaChallenge,uploadChallenge,uploadSession,authAttempts=0,queue=Promise.resolve(),waiting=0;ws.alive=true;
  ws.on('error',()=>{});ws.on('pong',()=>ws.alive=true);
  const send=value=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
  ws.on('message',(data,isBinary)=>{
   if(closing){ws.close(1001,'NODE_STOPPING');return;}
   if(++waiting>4){ws.close(1008,'REQUEST_QUEUE_LIMIT');return;}
   queue=queue.then(async()=>{
    let request,id;
    try{
     let bytes;
     if(isBinary){if(data.length>FRAME_LIMIT)throw Error('FRAME_LIMIT');({header:request,bytes}=unpack(new Uint8Array(data)));}
     else {if(data.length>MAX_MANIFEST_BYTES+32768)throw Error('REQUEST_LIMIT');request=JSON.parse(data.toString('utf8'));}
     id=request?.id;if(typeof id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(id))throw Error('INVALID_REQUEST_ID');
     if(request.protocol!==PROTOCOL)throw Error('UNSUPPORTED_PROTOCOL');sameNetwork(store.network,request.networkId);
     const args=request.args||{};let result;
     if(request.operation==='hello'){
      if(isBinary)throw Error('INVALID_HELLO');result=store.hello(args.nonce);replicaChallenge=result.body.replicaChallenge;greeted=true;authenticated=false;replicaAuthenticated=false;uploadChallenge=null;uploadSession=null;
     }else{
      if(!greeted)throw Error('HANDSHAKE_REQUIRED');
      if(replicaOnly){
       if(request.operation==='replicaAuth'){verifyReplicaAuth(store,args,replicaChallenge);replicaAuthenticated=true;result={authenticated:true};}
       else {
        if(!replicaAuthenticated)throw Error('REPLICA_AUTH_REQUIRED');
        if(request.operation==='replicaInventory')result=replicas.inventory();
        else if(request.operation==='replicaRecord')result=replicas.record(args.manifestId);
        else if(request.operation==='replicaHead')result=store.heads.replicationState(args.rootManifestId);
        else if(request.operation==='replicaReceipt')result=await replicas.receipt(args);
        else if(request.operation==='get'){const data=await store.get(args);ws.send(pack({id,ok:true},data),{binary:true});return;}
        else throw Error('REPLICA_READ_ONLY');
       }
      }
      else if(request.operation==='uploadChallenge'){
       if(readOnly||!store.publicUploads.enabled||store.recoveryReadOnly||!store.rpc)throw Error('PUBLIC_UPLOADS_DISABLED');
       if(++authAttempts>8)throw Error('UPLOAD_AUTH_RATE_LIMIT');
       if(store.now()-authWindow>=60000){authWindow=store.now();authCount=0;}if(++authCount>64)throw Error('UPLOAD_AUTH_RATE_LIMIT');
       const now=store.now(),body={protocol:'cellcloud-upload-access',version:1,networkId:store.network,nodeId:store.nodeId,origin:req.headers.origin,address:args.address,author_pubkey:args.author_pubkey,policy:store.publicUploads,issuedAt:now,expiresAt:now+120000,nonce:randomBytes(32).toString('hex')};
       const challenge={body,message:uploadAdmissionMessage(body)};verifyUploadChallenge(challenge,{nodeId:store.nodeId,origin:req.headers.origin,address:args.address,author_pubkey:args.author_pubkey},{now});uploadChallenge=challenge;result=uploadChallenge;
      }
      else if(request.operation==='uploadAuth'){
       const challenge=uploadChallenge;uploadChallenge=null;
       if(readOnly||!store.publicUploads.enabled||!challenge||canonicalJson(args.body)!==canonicalJson(challenge.body))throw Error('INVALID_UPLOAD_CHALLENGE');
       const b=verifyUploadSignature(challenge,args.signature,{nodeId:store.nodeId,origin:req.headers.origin,address:challenge.body.address,author_pubkey:challenge.body.author_pubkey},{now:store.now()});
       uploadSession={address:b.address,author_pubkey:b.author_pubkey,expiresAt:store.now()+60*60*1000};authenticated=true;result={authenticated:true,mode:'wallet',expiresAt:uploadSession.expiresAt};
      }
      else if(request.operation==='auth'){if(readOnly)throw Error('UPLOAD_AUTHORIZATION_REQUIRED');store.auth(args.token);authenticated=true;uploadSession=null;result={authenticated:true};}
      else if(request.operation==='replicaStatus'){result=store.replicationStatus?.()||{enabled:false,networkId:store.network,peers:[],conflicts:[]};}
      else if(request.operation==='publicationStatus'){store.publication(args.manifestId);result=store.publicationReplication?.(args.manifestId)||{manifestId:args.manifestId,networkId:store.network,peers:[]};}
      else if(request.operation==='manifest'){result=store.publication(args.manifestId);}
      else if(request.operation==='resolve'){result=store.heads.resolve(args.rootManifestId);}
      else if(request.operation==='get'){
       const data=await store.get(args);ws.send(pack({id,ok:true},data),{binary:true});return;
      }else{
       if(!authenticated)throw Error('UPLOAD_AUTHORIZATION_REQUIRED');
       if(uploadSession){
        if(uploadSession.expiresAt<=store.now()){authenticated=false;throw Error('UPLOAD_SESSION_EXPIRED');}
        if(request.operation==='open'){if(args.address!==uploadSession.address)throw Error('UPLOAD_OWNER_REQUIRED');}
        else {
         const id=request.operation==='headAuthorize'?args.record?.body?.manifestId:args.id||args.manifestId,job=store.job(id);
         if(job.address!==uploadSession.address||job.manifest.author_pubkey!==uploadSession.author_pubkey)throw Error('UPLOAD_OWNER_REQUIRED');
         if(request.operation==='headAuthorize'&&args.record?.body?.author_pubkey!==uploadSession.author_pubkey)throw Error('UPLOAD_OWNER_REQUIRED');
        }
       }
       if(request.operation==='open')result=await store.open(args,uploadSession);
       else if(request.operation==='put'){if(!isBinary)throw Error('BINARY_CELL_REQUIRED');result=await store.put(args,bytes);}
       else if(request.operation==='review')result=await store.review(args);
       else if(request.operation==='authorize')result=await store.authorize(args);
       else if(request.operation==='confirm')result=await store.confirm(args.manifestId);
       else if(request.operation==='resume')result=await store.resume(args.manifestId);
       else if(request.operation==='beginSend')result=await store.beginSend(args.manifestId);
       else if(request.operation==='headChallenge')result=store.heads.challenge(args);
       else if(request.operation==='headAuthorize')result=await store.heads.authorize(args.record);
       else throw Error('UNKNOWN_PEER_OPERATION');
      }
     }
     send({id,ok:true,result});
     if(['confirm','headAuthorize'].includes(request.operation))store.replicationWake?.();
     if(['open','authorize','confirm','headAuthorize'].includes(request.operation))log({event:request.operation,networkId:store.network,nodeId:store.nodeId,manifestId:args.id||args.manifestId,state:result?.state});
    }catch(error){const code=publicErrors.has(error.message)?error.message:'PEER_REQUEST_REJECTED';send({id,ok:false,error:code});log({event:'request-rejected',code});}
    finally{waiting--;}
   }).catch(()=>ws.close(1011,'PEER_FAILURE'));
   const task=queue;tasks.add(task);task.then(()=>tasks.delete(task));
  });
 });
 const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},30000);heartbeat.unref();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
 const address=server.address();
 return {port:address.port,server,close:async()=>{closing=true;clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));await Promise.all([...tasks]);await new Promise(resolve=>server.close(resolve));await store.queue;store.close();}};
}
