import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from './integrity.mjs';
const safe=name=>typeof name==='string'&&name.length<400&&!name.includes('\\')&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
async function noLinks(root,name){let current=root;for(const part of ['data',...name.split('/')]){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw Error('UNSAFE_BACKUP_ENTRY');}}
async function inventory(root,relative='',exclude=[]){
  const result=[];
  for(const item of await fs.readdir(path.join(root,relative),{withFileTypes:true})){
    if(item.name.endsWith('.tmp'))continue;
    const name=relative?relative+'/'+item.name:item.name;if(!safe(name)||item.isSymbolicLink())throw Error('UNSAFE_BACKUP_ENTRY');
    if(exclude.includes(name))continue;
    if(item.isDirectory())result.push(...await inventory(root,name,exclude));
    else if(item.isFile()){if((await fs.stat(path.join(root,name))).size>64*1024*1024)throw Error('BACKUP_FILE_TOO_LARGE');const bytes=await fs.readFile(path.join(root,name));result.push({path:name,bytes:bytes.length,sha256:hash(bytes)});}
    else throw Error('UNSUPPORTED_BACKUP_ENTRY');
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
function descriptor(manifest){
  if(manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>200000||typeof manifest.createdAt!=='string')throw Error('INVALID_BACKUP_MANIFEST');
  const seen=new Set();let bytes=0;
  for(const file of manifest.files){if(!safe(file.path)||seen.has(file.path.toLowerCase())||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>64*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('INVALID_BACKUP_ENTRY');seen.add(file.path.toLowerCase());bytes+=file.bytes;}
  if(bytes>8*1024*1024*1024)throw Error('BACKUP_TOTAL_LIMIT');
  const {id,...body}=manifest;if(hash(JSON.stringify(body))!==id)throw Error('BACKUP_MANIFEST_HASH_MISMATCH');return manifest;
}
export async function verifyBackup(directory){
  const root=path.resolve(directory);if((await fs.lstat(root)).isSymbolicLink())throw Error('UNSAFE_BACKUP_ENTRY');const manifestFile=path.join(root,'backup-manifest.json'),stat=await fs.lstat(manifestFile);if(stat.isSymbolicLink()||stat.size>64*1024*1024)throw Error('INVALID_BACKUP_MANIFEST');
  const manifest=descriptor(JSON.parse(await fs.readFile(manifestFile,'utf8')));
  for(const file of manifest.files){await noLinks(root,file.path);const target=path.join(root,'data',file.path),stat=await fs.lstat(target);if(!stat.isFile()||stat.size!==file.bytes)throw Error('BACKUP_CONTENT_MISMATCH');const bytes=await fs.readFile(target);if(hash(bytes)!==file.sha256)throw Error('BACKUP_CONTENT_MISMATCH');}
  return manifest;
}
export async function createBackup(source,destination,{exclude=[]}={}){
  if(!Array.isArray(exclude)||!exclude.every(safe))throw Error('INVALID_BACKUP_EXCLUSIONS');
  const root=path.resolve(source),target=path.resolve(destination),relative=path.relative(root,target);
  if((await fs.lstat(root)).isSymbolicLink())throw Error('UNSAFE_BACKUP_ENTRY');
  if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('BACKUP_DESTINATION_INSIDE_SOURCE');
  const before=await inventory(root,'',exclude);await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target,{recursive:false,mode:0o700});
  for(const file of before){const bytes=await fs.readFile(path.join(root,file.path));if(hash(bytes)!==file.sha256)throw Error('BACKUP_SOURCE_CHANGED');const output=path.join(target,'data',file.path);await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});await fs.writeFile(output,bytes,{mode:0o600,flag:'wx'});}
  const after=await inventory(root,'',exclude);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('BACKUP_SOURCE_CHANGED');
  const body={version:1,createdAt:new Date().toISOString(),files:before},manifest={...body,id:hash(JSON.stringify(body))};
  await fs.writeFile(path.join(target,'backup-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});await verifyBackup(target);return manifest;
}
export async function restoreBackup(source,destination){
  const manifest=await verifyBackup(source),target=path.resolve(destination);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(target,{recursive:false,mode:0o700});
  for(const file of manifest.files){await noLinks(path.resolve(source),file.path);const bytes=await fs.readFile(path.join(source,'data',file.path));if(hash(bytes)!==file.sha256)throw Error('BACKUP_CONTENT_CHANGED');const output=path.join(target,file.path);await fs.mkdir(path.dirname(output),{recursive:true,mode:0o700});await fs.writeFile(output,bytes,{mode:0o600,flag:'wx'});}
  return manifest;
}
