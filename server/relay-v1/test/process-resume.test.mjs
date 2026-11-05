// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,frame,binaries } from './helpers.mjs';
import { RelayCore } from '../src/core.mjs';

test('real event-loop suspension/resumption uses elapsed wall time rather than a paused lease timer',()=>{
  const f=fixture();const realNow=Date.now;
  const core=new RelayCore(f.store,f.peers,realNow);
  const n=Date.now(),c=f.peer('controller','controller',{expires:n+80}),s=f.peer('speaker','speaker',{expires:n+300000}),l=f.peer('listener','listener',{expires:n+300000});
  core.connect(c);core.connect(s);core.connect(l);core.message(c,'{"type":"grant","subject":"speaker"}');const g=structuredClone(core.state.grant);
  // Block this process's event loop. There are no timers/alarms able to enforce expiry here.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120);
  assert.ok(Date.now()>=g.deadline);
  const resumed=new RelayCore(f.store,f.peers,realNow);
  assert.throws(()=>resumed.message(s,frame(g)));assert.equal(binaries(l).length,0);
});
