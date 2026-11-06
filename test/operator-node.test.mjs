import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {operatorTemplate} from '../protocol/operator-template.js';
import {validateOperatorConfig,readOperatorConfig,operatorTls,operatorConfigReport} from '../peer/operator-config.mjs';
import {diagnoseOperator} from '../peer/operator-doctor.mjs';
import {PeerStore} from '../peer/store.mjs';
import {startPeerServer} from '../peer/server.mjs';
const exec=promisify(execFile),cwd=path.resolve(import.meta.dirname,'..');
async function temp(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'cellcloud-operator-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return directory;}
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

test('operator configuration rejects accidental remote plaintext exposure, secret fields, unsafe origins, endpoints and quotas',()=>{
 const template=operatorTemplate(),check=value=>validateOperatorConfig(value,{directory:cwd});assert.equal(check(template).network,'testnet-10');
 for(const value of [{...template,token:'not-a-config-field'},{...template,host:'0.0.0.0'},{...template,quotaBytes:1},{...template,port:0},{...template,origins:['https://user:password@example.com']},{...template,origins:['http://public.example']},{...template,rpcUrl:'wss://rpc.example/?secret=1'},{...template,publicUrl:'wss://peer.example/peer'},{...template,viewerOrigins:['https://viewer.example']},{...template,reverseProxyTls:true},{...template,peers:[{url:'ws://public.example/peer',nodeId:'ab'.repeat(32)}]},{...template,data:path.parse(cwd).root}])assert.throws(()=>check(value));
 const remote=check({...template,host:'0.0.0.0',publicUrl:'wss://peer.example/peer',origins:['https://app.example'],viewerOrigins:['https://{site}.viewer.example'],reverseProxyTls:true});assert.equal(operatorConfigReport(remote).tlsMode,'proxy');assert.equal(operatorConfigReport(remote).started,false);assert.equal(operatorConfigReport({...remote,network:'mainnet'}).mainnetPayments,false);
 assert.throws(()=>check({...template,logFile:path.join(template.data,'testnet-10','cells','operator.log')}),/LOG_FILE/);
});

test('check-config and configuration generation never create a storage identity, token, listener or RPC connection and never overwrite an existing file',async t=>{
 const directory=await temp(t),file=path.join(directory,'node.json');
 const generated=await exec(process.execPath,['scripts/prepare-peer-config.mjs','--out',file],{cwd,timeout:10000});assert.equal(JSON.parse(generated.stdout).started,false);
 const original=await fs.readFile(file,'utf8');await assert.rejects(()=>exec(process.execPath,['scripts/prepare-peer-config.mjs','--out',file],{cwd,timeout:10000}),/ALREADY_EXISTS/);assert.equal(await fs.readFile(file,'utf8'),original);
 const {stdout}=await exec(process.execPath,['peer/cli.mjs','--config',file,'--check-config'],{cwd,timeout:10000}),report=JSON.parse(stdout);assert.equal(report.valid,true);assert.equal(report.mainnetPayments,false);assert.equal(report.paymentRequested,false);
 await assert.rejects(()=>fs.access(report.data));assert.deepEqual(await fs.readdir(directory),['node.json']);
 await assert.rejects(()=>exec(process.execPath,['peer/cli.mjs','--config',file,'--port','9999'],{cwd,timeout:10000}),/CANNOT_MIX/);
 await fs.writeFile(file,JSON.stringify({...operatorTemplate(),seed:'sensitive-content-must-not-be-logged'}));await assert.rejects(()=>exec(process.execPath,['peer/cli.mjs','--config',file,'--check-config'],{cwd,timeout:10000}),error=>!error.stderr.includes('sensitive-content-must-not-be-logged')&&error.stderr.includes('INVALID_OPERATOR_CONFIG'));
});

test('operator diagnostic verifies signed identity and network read-only, rejects another identity and does not require the private upload token',async t=>{
 const directory=await temp(t),store=await new PeerStore({directory:path.join(directory,'data'),quotaBytes:16*1024**2}).init(),server=await startPeerServer({store,origins:['http://127.0.0.1:5191']});t.after(()=>server.close());
 const grant=await fs.readFile(store.grantPath,'utf8'),config=validateOperatorConfig({...operatorTemplate(),port:server.port,publicUrl:'ws://127.0.0.1:'+server.port+'/peer',expectedNodeId:store.nodeId},{directory});
 const report=await diagnoseOperator(config);assert.equal(report.reachable,true);assert.equal(report.identityPinned,true);assert.equal(report.nodeId,store.nodeId);assert.equal(report.rpcChecked,false);assert.equal(report.wanProven,false);assert.equal(report.paymentRequested,false);assert.equal(store.jobs.size,0);assert.equal(await fs.readFile(store.grantPath,'utf8'),grant);
 await assert.rejects(()=>diagnoseOperator({...config,expectedNodeId:'ef'.repeat(32)}),/IDENTITY_CHANGED/);await assert.rejects(()=>diagnoseOperator({...config,network:'mainnet'}),/NETWORK_MISMATCH/);
 const firstContact=await diagnoseOperator({...config,expectedNodeId:null});assert.equal(firstContact.identityPinned,false);assert.equal(firstContact.replication,null);assert.ok(!JSON.stringify(report).includes(JSON.parse(grant).token));
});

test('TLS configuration requires certificate files and key agreement; private file contents never enter the validation report',async t=>{
 const directory=await temp(t),cert=path.join(directory,'cert.pem'),key=path.join(directory,'key.pem');await fs.writeFile(cert,'invalid-certificate');await fs.writeFile(key,'private-value-not-for-output');
 const config=validateOperatorConfig({...operatorTemplate(),tls:{certFile:cert,keyFile:key},publicUrl:'wss://localhost:8080/peer'},{directory});await assert.rejects(()=>operatorTls(config),/TLS_FILES_INVALID/);assert.ok(!JSON.stringify(operatorConfigReport(config)).includes('private-value-not-for-output'));
 assert.throws(()=>validateOperatorConfig({...operatorTemplate(),tls:{certFile:cert,keyFile:key},reverseProxyTls:true,publicUrl:'wss://node.example/peer'},{directory}),/INVALID_OPERATOR_TLS/);
});

test('configured CLI starts an independent node and its doctor uses the emitted identity without modifying receipts or allowing duplicate store ownership',async t=>{
 const directory=await temp(t),port=await freePort(),file=path.join(directory,'node.json');await fs.writeFile(file,JSON.stringify({...operatorTemplate(),port,publicUrl:'ws://127.0.0.1:'+port+'/peer'}));
 const child=spawn(process.execPath,['peer/cli.mjs','--config',file],{cwd,windowsHide:true,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
 t.after(async()=>{if(child.exitCode===null&&!child.signalCode){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;}});
 const started=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CONFIGURED_CLI_START_TIMEOUT')),10000);const inspect=()=>{for(const line of logs.split(/\r?\n/)){try{const value=JSON.parse(line);if(value.event==='listening'){clearTimeout(timer);child.stdout.off('data',inspect);resolve(value);return;}}catch{}}};child.stdout.on('data',inspect);child.once('exit',()=>{clearTimeout(timer);reject(Error('CONFIGURED_CLI_EXITED'));});inspect();});
 const dataDirectory=path.resolve(directory,operatorTemplate().data),identity=await fs.readFile(path.join(dataDirectory,'identity.private.json'),'utf8');
 await fs.writeFile(file,JSON.stringify({...operatorTemplate(),port,publicUrl:'ws://127.0.0.1:'+port+'/peer',expectedNodeId:started.nodeId}));
 const {stdout}=await exec(process.execPath,['peer/cli.mjs','--config',file,'--doctor'],{cwd,timeout:10000});assert.equal(JSON.parse(stdout).nodeId,started.nodeId);assert.equal(JSON.parse(stdout).identityPinned,true);
 await assert.rejects(()=>exec(process.execPath,['peer/cli.mjs','--config',file],{cwd,timeout:10000}),/ALREADY_LOCKED/);
 assert.equal(await fs.readFile(path.join(dataDirectory,'identity.private.json'),'utf8'),identity);assert.equal((await fs.readdir(path.join(dataDirectory,'testnet-10','jobs'))).length,0);assert.ok(!logs.includes(JSON.parse(identity).secret));
 const config=await readOperatorConfig(file);assert.equal(config.data,dataDirectory);
});
