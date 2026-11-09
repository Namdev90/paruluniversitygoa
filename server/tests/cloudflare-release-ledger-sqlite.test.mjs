import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ReleaseLedger} from '../cloudflare-platform/release-ledger.mjs';

function fixture(){
 const database=new DatabaseSync(':memory:');
 return {database,sql:{exec(query,...values){const rows=database.prepare(query).all(...values);return {toArray:()=>rows};}}};
}
const release={versionCode:19,sha256:'a'.repeat(64)};

test('SQLite claims remain one-shot through reconstruction and reject a conflicting digest',async()=>{
 const {database,sql}=fixture();try{
  const first=new ReleaseLedger(sql);
  const results=await Promise.all([first.reserve(release),first.reserve(release)]);
  assert.deepEqual(results.sort(),['claimed','duplicate']);
  const reconstructed=new ReleaseLedger(sql);
  assert.equal(await reconstructed.reserve(release),'duplicate');
  assert.equal(await reconstructed.reserve({...release,sha256:'b'.repeat(64)}),'unavailable');
  await reconstructed.finish(release,'accepted');
  assert.equal(await first.reserve(release),'duplicate');
  await assert.rejects(reconstructed.finish(release,'unknown'));
  const rows=database.prepare('SELECT version,digest,state FROM release_claims').all();
  assert.equal(rows.length,1);assert.equal(rows[0].version,19);assert.equal(rows[0].digest,release.sha256);assert.equal(rows[0].state,'accepted');
 }finally{database.close();}
});

test('SQLite preserves an interrupted reservation, fencing retries across owner replacement',async()=>{
 const {database,sql}=fixture();try{
  const first=new ReleaseLedger(sql);let checks=0;
  const interrupted={throwIfAborted(){if(++checks===2)throw Error('synthetic interruption after insert');}};
  await assert.rejects(first.reserve(release,{signal:interrupted}));
  const reconstructed=new ReleaseLedger(sql);
  assert.equal(await reconstructed.reserve(release),'duplicate');
  assert.equal(database.prepare('SELECT state FROM release_claims WHERE version=?').get(19).state,'claimed');
  assert.equal(await reconstructed.reserve({...release,sha256:'c'.repeat(64)}),'unavailable');
 }finally{database.close();}
});
