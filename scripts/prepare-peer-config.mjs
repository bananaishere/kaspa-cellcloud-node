import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {operatorTemplate} from '../protocol/operator-template.js';
import {validateOperatorConfig,operatorConfigReport} from '../peer/operator-config.mjs';
const {values}=parseArgs({options:{out:{type:'string',default:'.local/operator-node/node.json'},port:{type:'string',default:'8080'}}});
const file=path.resolve(values.out),template={...operatorTemplate(),port:Number(values.port),publicUrl:'ws://127.0.0.1:'+values.port+'/peer'},config=validateOperatorConfig(template,{directory:path.dirname(file)});
await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
try{await fs.writeFile(file,JSON.stringify(template,null,2)+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code==='EEXIST')throw Error('OPERATOR_CONFIG_ALREADY_EXISTS_NOT_OVERWRITTEN');throw error;}
console.log(JSON.stringify({file,...operatorConfigReport(config),note:'Configuration only. Storage identity and upload token are created at first node start.'}));
