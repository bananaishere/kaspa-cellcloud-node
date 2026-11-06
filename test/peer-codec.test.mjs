import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encode,decode,CELL,K,N} from '../protocol/codec.js';
import {hash,merkle,merkleProof,verifyMerkleProof,canonicalJson} from '../protocol/integrity.js';
import {hash as nodeHash,merkle as nodeMerkle} from '../lab/lib/integrity.mjs';
import {sameNetwork,requirePaymentNetwork} from '../protocol/network.js';

test('portable browser codec preserves existing cell hashes, Merkle roots and parity-only recovery',()=>{
 for(const length of [0,1,CELL-1,CELL+17,CELL*K]){
  const input=new Uint8Array(randomBytes(length)),shards=encode(input),digests=shards.map(hash);
  assert.equal(shards.length,N);assert.ok(shards.every(b=>b instanceof Uint8Array&&b.length===CELL));
  assert.equal(hash(input),nodeHash(input));assert.equal(merkle(digests),nodeMerkle(digests));
  assert.deepEqual(decode(shards.slice(K,K*2).map((data,i)=>({index:i+K,data})),length),input);
  for(let index=0;index<N;index++){const proof=merkleProof(digests,index);assert.equal(verifyMerkleProof(digests[index],proof,merkle(digests)),true);assert.equal(verifyMerkleProof('00'.repeat(32),proof,merkle(digests)),false);}
 }
 assert.throws(()=>decode([],CELL*K+1),/INVALID_STRIPE_LENGTH/);
});
test('protocol records have canonical bytes and reject cross-network replay or unconfigured mainnet payments',()=>{
 assert.equal(canonicalJson({b:2,a:[1,'x']}),canonicalJson({a:[1,'x'],b:2}));
 assert.throws(()=>canonicalJson({bad:NaN}),/NUMBER/);assert.throws(()=>canonicalJson({bad:undefined}),/VALUE/);
 sameNetwork('testnet-10','testnet-10');assert.throws(()=>sameNetwork('mainnet','testnet-10'),/NETWORK_MISMATCH/);assert.throws(()=>requirePaymentNetwork('mainnet'),/NOT_ENABLED/);
});
