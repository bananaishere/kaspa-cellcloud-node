import { createHash } from 'node:crypto';
export const hash = data=>createHash('sha256').update(data).digest('hex');
export function merkle(digests) {
  let level=digests.map(d=>Buffer.from(hash(Buffer.concat([Buffer.from([0]),Buffer.from(d,'hex')])),'hex'));
  if(!level.length)return hash(Buffer.alloc(0));
  while(level.length>1){const next=[];for(let i=0;i<level.length;i+=2)next.push(Buffer.from(hash(Buffer.concat([Buffer.from([1]),level[i],level[i+1]??level[i]])),'hex'));level=next;}
  return level[0].toString('hex');
}
