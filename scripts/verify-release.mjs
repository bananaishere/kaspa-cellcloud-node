import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..'),manifest=JSON.parse(await fs.readFile(path.join(root,'SOURCE_MANIFEST.json'),'utf8'));
if(manifest.version!==1||manifest.mainnetPayments!==false||!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)||!Array.isArray(manifest.files)||manifest.files.length>500)throw Error('INVALID_SOURCE_MANIFEST');
const seen=new Set();
for(const file of manifest.files){
 if(typeof file.path!=='string'||file.path.includes('\\')||file.path.includes(':')||file.path.split('/').some(p=>!p||p==='.'||p==='..')||seen.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('UNSAFE_SOURCE_MANIFEST_ENTRY');
 seen.add(file.path.toLowerCase());let current=root;
 for(const part of file.path.split('/')){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw Error('RELEASE_SYMLINK_REJECTED');}
 const bytes=await fs.readFile(current);if(bytes.length!==file.bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('RELEASE_CONTENT_MISMATCH: '+file.path);
}
console.log(JSON.stringify({verified:true,sourceCommit:manifest.sourceCommit,files:seen.size,mainnetPayments:false,note:'Checks byte integrity, not independent release authenticity.'}));
