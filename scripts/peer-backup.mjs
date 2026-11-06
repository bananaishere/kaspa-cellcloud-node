import {parseArgs} from 'node:util';
import {createPeerBackup,restorePeerBackup} from '../peer/backup.mjs';
const {positionals}=parseArgs({allowPositionals:true,options:{}}),[operation,source,destination]=positionals;
if(positionals.length!==3||!['create','restore'].includes(operation))throw Error('Usage: node scripts/peer-backup.mjs create|restore SOURCE NEW_DESTINATION');
if(operation==='create'){const result=await createPeerBackup(source,destination);console.log(JSON.stringify({backupId:result.id,files:result.files.length,bytes:result.files.reduce((n,f)=>n+f.bytes,0),privateBackup:true}));}
else console.log(JSON.stringify(await restorePeerBackup(source,destination),null,2));
