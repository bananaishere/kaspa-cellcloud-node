#!/usr/bin/env node
const [command,...args]=process.argv.slice(2);
const entries={start:'../peer/cli.mjs',check:'../peer/cli.mjs',doctor:'../peer/cli.mjs',init:'../scripts/prepare-peer-config.mjs',backup:'../scripts/peer-backup.mjs',restore:'../scripts/peer-backup.mjs'};
if(!command||command==='--help'||command==='help'){
 console.log('CellCloud Node · Testnet-10\nCommands: init --out FILE | check --config FILE | start --config FILE | doctor --config FILE | backup SOURCE NEW_DESTINATION | restore BACKUP NEW_DESTINATION\nMainnet payments are disabled. Never publish identities, tokens or backups.');
}else{
 if(!Object.hasOwn(entries,command))throw Error('UNKNOWN_NODE_COMMAND');
 const entry=new URL(entries[command],import.meta.url);
 const extra=command==='check'?['--check-config']:command==='doctor'?['--doctor']:command==='backup'?['create']:command==='restore'?['restore']:[];
 process.argv=[process.execPath,entry.pathname,...extra,...args];await import(entry.href);
}
