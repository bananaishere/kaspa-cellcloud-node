import fs from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {sdk} from '../lab/kaspa/payment.mjs';
import {DirectKaspaClient} from '../protocol/kaspa-client.js';
import {PeerStore} from './store.mjs';
import {startPeerServer} from './server.mjs';
import {PeerReplicator} from './replication.mjs';
import {networkId} from '../protocol/network.js';
import {readOperatorConfig,operatorTls,operatorConfigReport} from './operator-config.mjs';
import {diagnoseOperator} from './operator-doctor.mjs';

let {values}=parseArgs({options:{network:{type:'string',default:'testnet-10'},host:{type:'string',default:'127.0.0.1'},port:{type:'string',default:'6091'},data:{type:'string',default:'.local/peer-node'},quota:{type:'string',default:String(1024**3)},origin:{type:'string',multiple:true},'viewer-origin-template':{type:'string',multiple:true},rpc:{type:'string'},'tls-cert':{type:'string'},'tls-key':{type:'string'},'peers-file':{type:'string'},'log-file':{type:'string'},'sync-interval-ms':{type:'string',default:'5000'},'repair-interval-ms':{type:'string',default:'60000'},config:{type:'string'},'check-config':{type:'boolean'},doctor:{type:'boolean'},help:{type:'boolean'}}});
if(values.help){console.log('Create configuration: node scripts/prepare-peer-config.mjs --out .local/operator-node/node.json\nValidate without starting: node peer/cli.mjs --config FILE --check-config\nStart: node peer/cli.mjs --config FILE\nRead-only diagnostic of a running node: node peer/cli.mjs --config FILE --doctor\nLegacy flags remain supported: --network testnet-10 --port 6091 --data .local/peer-node --quota 1073741824\nReplication: --peers-file FILE --sync-interval-ms 5000 --repair-interval-ms 60000\nRemote: configure TLS/WSS and exact app/viewer origins. Never publish the upload token. Mainnet payments are disabled.');process.exit(0);}
let operator;
if(values.config){
 if(process.argv.slice(2).some(arg=>arg.startsWith('--')&&!['--config','--check-config','--doctor'].includes(arg.split('=')[0])))throw Error('OPERATOR_CONFIG_CANNOT_MIX_RUNTIME_FLAGS');
 if(values.doctor&&values['check-config'])throw Error('CHOOSE_CHECK_CONFIG_OR_DOCTOR');
 operator=await readOperatorConfig(values.config);await operatorTls(operator);
 if(values['check-config']){console.log(JSON.stringify(operatorConfigReport(operator)));process.exit(0);}
 if(values.doctor){console.log(JSON.stringify(await diagnoseOperator(operator)));process.exit(0);}
 values={network:operator.network,host:operator.host,port:operator.port,data:operator.data,quota:operator.quotaBytes,origin:operator.origins,'viewer-origin-template':operator.viewerOrigins,rpc:operator.rpcUrl,'tls-cert':operator.tls?.certFile,'tls-key':operator.tls?.keyFile,'log-file':operator.logFile,'sync-interval-ms':operator.syncIntervalMs,'repair-interval-ms':operator.repairIntervalMs};
}else if(values.doctor||values['check-config'])throw Error('OPERATOR_CONFIG_FILE_REQUIRED');
const port=Number(values.port),quotaBytes=Number(values.quota);if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_PORT');
if(Boolean(values['tls-cert'])!==Boolean(values['tls-key']))throw Error('TLS_CERT_AND_KEY_REQUIRED');
const tls=values['tls-cert']?{cert:await fs.readFile(values['tls-cert']),key:await fs.readFile(values['tls-key'])}:undefined;
// One process owns a store; fail closed instead of racing quota/job/identity writes.
const lock=path.resolve(values.data,networkId(values.network),'node.lock');await fs.mkdir(path.dirname(lock),{recursive:true,mode:0o700});let lockHandle;
try{lockHandle=await fs.open(lock,'wx',0o600);await lockHandle.writeFile(String(process.pid));}catch{throw Error('NODE_DATA_DIRECTORY_ALREADY_LOCKED: verify the process before removing node.lock after an unclean shutdown.');}
let logQueue=Promise.resolve();const logFile=values['log-file']?path.resolve(values['log-file']):null;if(logFile)await fs.mkdir(path.dirname(logFile),{recursive:true});
const log=record=>{const text=JSON.stringify({at:new Date().toISOString(),...record});console.log(text);if(logFile)logQueue=logQueue.then(()=>fs.appendFile(logFile,text+'\n',{mode:0o600})).catch(()=>console.error('PEER_LOG_WRITE_FAILED'));};
const rpc=new DirectKaspaClient({sdk,network:values.network,url:values.rpc||''});let store,server,replicator;
try{
 store=await new PeerStore({directory:values.data,network:values.network,quotaBytes,rpc}).init();
 if(operator?.expectedNodeId&&operator.expectedNodeId!==store.nodeId)throw Error('CONFIGURED_NODE_IDENTITY_MISMATCH');
 let peers=operator?.peers||[];if(values['peers-file']){const raw=await fs.readFile(values['peers-file'],'utf8');if(Buffer.byteLength(raw)>16384)throw Error('REPLICA_CONFIG_LIMIT');const config=JSON.parse(raw);if(config.version!==1||config.networkId!==store.network||Object.keys(config).sort().join(',')!=='networkId,peers,version')throw Error('INVALID_REPLICA_CONFIG');peers=config.peers;}
 replicator=new PeerReplicator({store,peers,intervalMs:Number(values['sync-interval-ms']),repairIntervalMs:Number(values['repair-interval-ms']),log});
 server=await startPeerServer({store,host:values.host,port,origins:values.origin||['http://127.0.0.1:5191','http://localhost:5191'],viewerOrigins:values['viewer-origin-template']||['http://{site}.viewer.localhost:5192'],tls,log});replicator.start();
}catch(error){await replicator?.close();await server?.close();store?.close();await rpc.close();await lockHandle.close();await fs.rm(lock,{force:true});throw error;}
log({event:'listening',networkId:store.network,nodeId:store.nodeId,host:values.host,port:server.port,tls:Boolean(tls),...(operator?.publicUrl?{configuredPublicUrl:operator.publicUrl,wanVerified:false}:{}),uploadTokenFile:store.grantPath,mainnetPayments:false});
let closing=false;async function close(){if(closing)return;closing=true;await replicator.close();await server.close();await rpc.close();await lockHandle.close();await fs.rm(lock,{force:true});await logQueue;}
process.on('SIGINT',()=>close().then(()=>process.exit(0)));process.on('SIGTERM',()=>close().then(()=>process.exit(0)));
