// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayCore } from '../src/core.mjs';
import { parseFrame } from '../src/protocol.mjs';
import { fixture,frame,binaries,ack } from './helpers.mjs';

test('synthetic binary forward preserves envelope and bytes; no payload stored in SQLite',()=>{
  const f=fixture(),{s,l,g}=f.setup(),b=frame(g);
  assert.equal(f.core.message(s,b),1); assert.deepEqual(binaries(l),[b]);
  assert.equal(f.core.state.grant.sequence,1);assert.equal(f.store.load().grant.sequence,0);
  assert.ok(!JSON.stringify(f.store.load()).includes('165,165'));
});
test('controller observed death revokes immediately',()=>{
  const f=fixture(),{c,s,l,g}=f.setup();f.core.disconnect(c,'controller died');
  assert.throws(()=>f.core.message(s,frame(g)),/grant/); assert.equal(binaries(l).length,0);
});
test('unobserved controller death never extends immutable deadline',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.advance(15000);
  assert.throws(()=>f.core.message(s,frame(g)),/grant/);assert.equal(binaries(l).length,0);
});
test('boundary: deadline minus1 forwards; exact deadline rejects without alarm',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.advance(14999);f.core.message(s,frame(g));ack(f.core,l,g,1);f.advance(1);
  assert.throws(()=>f.core.message(s,frame(g,2)));assert.equal(binaries(l).length,1);
});
test('simulated process suspension/resumption drops queued frame after lease elapsed',()=>{
  const f=fixture(),{s,l,g}=f.setup(),queued=frame(g);f.advance(60000);
  assert.throws(()=>f.core.message(s,queued));assert.equal(binaries(l).length,0);
});
test('SQLite reconstruction retires lease while preserving epoch and attachment flow credit',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.core.message(s,frame(g));
  // Rebuild actor and socket metadata as a hibernation constructor would.
  for(const p of f.peers.values()) p.flow=structuredClone(p.attachment.flow);
  const resumed=new RelayCore(f.store,f.peers,f.now);
  assert.equal(resumed.state.grant,null);assert.equal(resumed.state.epoch,g.epoch);assert.throws(()=>resumed.message(s,frame(g)));
  assert.throws(()=>resumed.message(s,frame(g,2)));assert.equal(l.flow.outstanding.sequence,1);assert.equal(binaries(l).length,1);
  f.advance(15000);assert.throws(()=>resumed.message(s,frame(g,3)));assert.equal(binaries(l).length,1);
});
test('actual runtime delay and actor reconstruction cannot reset short auth-capped lease',async()=>{
  const f=fixture();const c=f.add('controller',undefined,{expires:f.now()+50}),s=f.add('speaker'),l=f.add('listener');
  f.core.message(c,'{"type":"grant","subject":"speaker"}');const g=structuredClone(f.core.state.grant);
  assert.equal(g.deadline,f.now()+50);const start=performance.now();await new Promise(r=>setTimeout(r,80));f.advance(Math.ceil(performance.now()-start));
  const resumed=new RelayCore(f.store,f.peers,f.now);assert.throws(()=>resumed.message(s,frame(g)));assert.equal(binaries(l).length,0);
});
test('stale grant is rejected after revoke and new epoch',()=>{
  const f=fixture(),{c,s,l,g}=f.setup();f.core.message(c,'{"type":"revoke"}');f.core.message(c,'{"type":"grant","subject":"speaker"}');
  assert.equal(f.core.state.grant.epoch,g.epoch+1);assert.throws(()=>f.core.message(s,frame(g)));assert.equal(binaries(l).length,0);
});
test('single-use jti reconnect replay is durably rejected',()=>{
  const f=fixture(),p=f.add('speaker');f.core.disconnect(p);const resumed=new RelayCore(f.store,f.peers,f.now);
  assert.throws(()=>resumed.connect(f.peer('speaker',p.subject,{jti:p.jti})),/replay/);
});
test('fresh jti reconnect cannot inherit previous speaker grant',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.core.disconnect(s);const s2=f.add('speaker');
  assert.throws(()=>f.core.message(s2,frame(g)));assert.equal(binaries(l).length,0);
});
test('backpressure skips all queued frames until exact ack, with no retry queue',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.core.message(s,frame(g));
  for(let seq=2;seq<=10;seq++)assert.equal(f.core.message(s,frame(g,seq)),0);
  assert.equal(binaries(l).length,1);ack(f.core,l,g,1);assert.equal(f.core.message(s,frame(g,11)),1);
  assert.deepEqual(binaries(l).map(x=>parseFrame(x).sequence),[1,11]);
});
test('ack after expiry never releases an old queued frame into a new send',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.core.message(s,frame(g));f.advance(15000);ack(f.core,l,g,1);
  assert.throws(()=>f.core.message(s,frame(g,2)));assert.equal(binaries(l).length,1);
});
test('per-recipient deadline checked between fanout sends',()=>{
  const f=fixture(),{s,l,g}=f.setup(),l2=f.add('listener','second');l.onSend=data=>{if(data instanceof ArrayBuffer)f.advance(15000);};
  assert.equal(f.core.message(s,frame(g)),1);assert.equal(binaries(l2).length,0);
});
test('higher authorization version role change invalidates session and grant; lower version cannot reconnect',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.add('listener',s.subject,{version:2});
  assert.equal(s.alive,false);assert.equal(f.core.state.grant,null);assert.throws(()=>f.core.message(s,frame(g)));
  assert.throws(()=>f.add('speaker',s.subject,{version:1}),/stale role/);assert.equal(binaries(l).length,0);
});
test('same-version role change denied and listener cannot grant or send bytes',()=>{
  const f=fixture(),{l,g}=f.setup();assert.throws(()=>f.add('speaker',l.subject),/stale role/);
  assert.throws(()=>f.core.message(l,'{"type":"grant","subject":"speaker"}'),/controller/);assert.throws(()=>f.core.message(l,frame(g)));
});
test('authorization expiration is checked on every recipient even before grant expires',()=>{
  const f=fixture(),{s,g}=f.setup(),short=f.add('listener','short',{expires:f.now()+10});f.advance(10);
  f.core.message(s,frame(g));assert.equal(binaries(short).length,0);
});
test('sequence duplicate/gap, mismatched deadline and codec are rejected',()=>{
  const f=fixture(),{s,g}=f.setup();for(const seq of [0,2,0xffffffff])assert.throws(()=>f.core.message(s,frame(g,seq)));
  assert.throws(()=>f.core.message(s,frame({...g,deadline:g.deadline+1})));
  const b=frame(g);new Uint8Array(b)[5]=2;assert.throws(()=>f.core.message(s,b));
});
test('frame/control bounds reject malformed and oversized synthetic input',()=>{
  const f=fixture(),{s,c,g}=f.setup();for(const b of [new ArrayBuffer(0),frame(g,1,0),frame(g,1,2049)])assert.throws(()=>f.core.message(s,b));
  assert.throws(()=>f.core.message(c,' '.repeat(513)));assert.throws(()=>f.core.message(c,'null'));assert.throws(()=>f.core.message(c,'{"type":"unknown"}'));
});
test('frame rate cannot be bypassed by reconstruction within the same grant',()=>{
  const f=fixture(),{s,g}=f.setup();for(let n=1;n<=50;n++)f.core.message(s,frame(g,n));
  assert.throws(()=>f.core.message(s,frame(g,51)),/rate/);
  const resumed=new RelayCore(f.store,f.peers,f.now);assert.throws(()=>resumed.message(s,frame(g,51)),/grant/);
});
test('control rate is bounded and survives attachment reconstruction',()=>{
  const f=fixture(),c=f.add('controller');for(let n=0;n<100;n++)f.core.message(c,'{"type":"revoke"}');
  c.flow=structuredClone(c.attachment.flow);assert.throws(()=>f.core.message(c,'{"type":"revoke"}'),/rate/);
});
test('lifetime send budget bounds runtime backlog even if listener falsely acks',()=>{
  const f=fixture(),{s,l,g}=f.setup();
  for(let n=1;n<=200 && l.alive;n++) {if(n%40===0)f.advance(1000);f.core.message(s,frame(g,n,2048));if(l.alive)ack(f.core,l,g,n);}
  assert.equal(l.closed.reason,'send budget');assert.ok(l.flow.sentBytes<=262144);assert.ok(binaries(l).length<200);
});
test('fanout/socket capacity bounded',()=>{
  const f=fixture();f.add('controller');f.add('speaker');for(let n=0;n<8;n++)f.add('listener',`listener${n}`);
  assert.throws(()=>f.add('listener','ninth'),/capacity/);assert.equal(f.peers.size,10);
});
test('clock rollback after restart fails closed',()=>{
  const f=fixture(),{s,l,g}=f.setup();f.core.message(s,frame(g));f.setTime(f.now()-1);
  const resumed=new RelayCore(f.store,f.peers,f.now);assert.throws(()=>resumed.message(s,frame(g,2)),/clock rollback/);assert.equal(binaries(l).length,1);
});
test('active grant cannot be extended',()=>{
  const f=fixture(),{c,g}=f.setup();f.advance(1000);assert.throws(()=>f.core.message(c,'{"type":"grant","subject":"speaker"}'),/immutable/);assert.equal(f.core.state.grant.deadline,g.deadline);
});
test('SQLite failure during grant creation prevents grant from authorizing sends after fail-closed disconnect',()=>{
  const f=fixture(),c=f.add('controller'),s=f.add('speaker'),l=f.add('listener');f.store.save=()=>{throw new Error('quota exhausted');};
  assert.throws(()=>f.core.message(c,'{"type":"grant","subject":"speaker"}'),/quota/);
  c.close(1011,'unavailable');assert.throws(()=>f.core.message(s,frame(f.core.state.grant)));assert.equal(binaries(l).length,0);
});
test('deadline crossed during final attachment bookkeeping prevents send and releases unsent credit',()=>{
  const f=fixture(),{s,l,g}=f.setup();const persist=l.persist;let calls=0;
  l.persist=()=>{persist();if(++calls===2)f.advance(15000);};
  assert.equal(f.core.message(s,frame(g)),0);assert.equal(binaries(l).length,0);assert.equal(l.flow.outstanding,null);
});
