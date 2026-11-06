// Systematic Reed–Solomon over GF(256), primitive polynomial 0x11d.
// Each stripe has 10 data shards + 20 parity shards of exactly 128 KiB.
export const CELL = 128 * 1024, K = 10, N = 30;
const exp = new Uint8Array(512), log = new Uint8Array(256);
let x = 1;
for (let i=0;i<255;i++) { exp[i]=x; log[x]=i; x<<=1; if(x&256)x^=0x11d; }
for(let i=255;i<512;i++)exp[i]=exp[i-255];
const mul=(a,b)=>a&&b?exp[log[a]+log[b]]:0;
const inv=a=>{if(!a)throw Error('SINGULAR_MATRIX');return exp[255-log[a]];};
export function invert(matrix) {
  const size=matrix.length, a=matrix.map((r,i)=>[...r,...Array.from({length:size},(_,j)=>+(i===j))]);
  for(let col=0;col<size;col++) {
    const pivot=a.findIndex((r,i)=>i>=col&&r[col]); if(pivot<0)throw Error('SINGULAR_MATRIX');
    [a[col],a[pivot]]=[a[pivot],a[col]];
    const scale=inv(a[col][col]); a[col]=a[col].map(v=>mul(v,scale));
    for(let row=0;row<size;row++)if(row!==col){const f=a[row][col];for(let j=0;j<size*2;j++)a[row][j]^=mul(f,a[col][j]);}
  }
  return a.map(r=>r.slice(size));
}
// Cauchy parity rows combined with identity yield an MDS systematic code.
const generator = Array.from({length:N},(_,i)=>Array.from({length:K},(_,j)=>i<K?+(i===j):inv(i^j)));
function combine(coefficients, shards) {
  const out=new Uint8Array(shards[0].length);
  for(let j=0;j<shards.length;j++) {
    const coefficient=coefficients[j]; if(!coefficient)continue;
    const table=Uint8Array.from({length:256},(_,v)=>mul(coefficient,v)), source=shards[j];
    for(let b=0;b<out.length;b++)out[b]^=table[source[b]];
  }
  return out;
}
export function encode(data) {
  if(!(data instanceof Uint8Array))throw Error('INVALID_STRIPE_BYTES');
  if(data.length>CELL*K)throw Error('STRIPE_TOO_LARGE');
  const shards=Array.from({length:K},(_,i)=>{const b=new Uint8Array(CELL);if(i*CELL<data.length)b.set(data.subarray(i*CELL,Math.min(data.length,(i+1)*CELL)));return b;});
  return [...shards,...generator.slice(K).map(row=>combine(row,shards))];
}
export function decode(available, length) {
  if(!Number.isSafeInteger(length)||length<0||length>CELL*K)throw Error('INVALID_STRIPE_LENGTH');
  if(!Array.isArray(available)||available.length<K)throw Error('INSUFFICIENT_SHARDS');
  const selected=available.slice(0,K);
  if(new Set(selected.map(s=>s.index)).size!==K || selected.some(s=>!Number.isInteger(s.index)||s.index<0||s.index>=N||s.data.length!==CELL))throw Error('INVALID_SHARDS');
  const inverse=invert(selected.map(s=>generator[s.index]));
  const out=new Uint8Array(length);
  for(let i=0;i<K&&i*CELL<length;i++)out.set(combine(inverse[i],selected.map(s=>s.data)).subarray(0,Math.min(CELL,length-i*CELL)),i*CELL);
  return out;
}
