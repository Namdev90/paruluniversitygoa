// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,frame,binaries } from './helpers.mjs';

test('proof model: an unchanged observed clock cannot establish an independent physical-time cutoff',()=>{
  const f=fixture();
  const c=f.add('controller',undefined,{expires:f.now()+20}),s=f.add('speaker'),l=f.add('listener');
  f.core.message(c,'{"type":"grant","subject":"speaker"}');const g=structuredClone(f.core.state.grant);
  const before=performance.now();Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,40);
  assert.ok(performance.now()-before>=20);
  // The injected clock deliberately remains constant. This is NOT a Cloudflare production probe.
  assert.ok(f.now()<g.deadline);assert.equal(f.core.message(s,frame(g)),1);assert.equal(binaries(l).length,1);
});
