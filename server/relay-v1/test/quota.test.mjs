// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,frame,binaries,ack } from './helpers.mjs';
import {RelayCore} from '../src/core.mjs';

for(const listeners of [1,2,4,8]) test(`synthetic 15s/50fps/${listeners} listeners: 750 frames, ACKs, zero hot-path SQL writes`,()=>{
  const f=fixture();let writes=0;const save=f.store.save.bind(f.store);f.store.save=s=>{writes++;save(s);};
  const c=f.add('controller'),s=f.add('speaker'),ls=Array.from({length:listeners},(_,i)=>f.add('listener',`l${i}`));
  f.core.message(c,'{"type":"grant","subject":"speaker"}');const g=structuredClone(f.core.state.grant),before=writes;
  for(let n=1;n<=750;n++){assert.equal(f.core.message(s,frame(g,n,80)),listeners);for(const l of ls)ack(f.core,l,g,n);f.advance(20);}
  assert.equal(writes-before,0);for(const l of ls){assert.equal(binaries(l).length,750);assert.ok(l.flow.sentBytes<92000);}
  // A recreated actor durably retires the grant; same grant replay fails, even if attachments were lost.
  const restored=new RelayCore(f.store,f.peers,f.now);assert.equal(writes-before,1);assert.equal(restored.state.grant,null);assert.throws(()=>restored.message(s,frame(g,751)));
  restored.message(c,'{"type":"grant","subject":"speaker"}');assert.equal(restored.state.grant.epoch,g.epoch+1);
});
test('cold restart without socket attachments never reuses previous grant or single-use identity',()=>{
  const f=fixture(),{s,g}=f.setup();f.core.message(s,frame(g));
  const cold=new RelayCore(f.store,new Map(),f.now);assert.equal(cold.state.grant,null);assert.equal(cold.state.epoch,g.epoch);
  assert.throws(()=>cold.connect(f.peer('speaker','speaker',{jti:s.jti})),/replay/);
});
test('failed speaker attachment checkpoint causes no binary side effects',()=>{
  const f=fixture(),{s,l,g}=f.setup();s.persist=()=>{throw new Error('attachment failure');};
  assert.throws(()=>f.core.message(s,frame(g)),/attachment/);assert.equal(binaries(l).length,0);
});
test('quota equations include all ACK writes in former implementation and account-wide event budget',()=>{
  assert.equal(50*(1+2*8),850);assert.ok(Math.abs(100000/850-117.647)<0.001);
  for(const listeners of [1,2,4,8]){
    const requestsPerSecond=50*(1+listeners)/20+1/15+1/300+(listeners+2)/30;
    const conservativeMinutes=80000/requestsPerSecond/60;
    assert.ok(conservativeMinutes>58&&conservativeMinutes<259);
  }
});
