// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,frame,ack,binaries} from './helpers.mjs';
test('mid-lease listener receives ready then original immutable grant and next sequence',()=>{
  const f=fixture(),{s,l,g}=f.setup();for(let n=1;n<=5;n++){f.core.message(s,frame(g,n));ack(f.core,l,g,n);f.advance(20);}
  const before=structuredClone(f.core.state.grant),late=f.add('listener','late');
  const controls=late.messages.map(JSON.parse);assert.deepEqual(controls.map(m=>m.type),['ready','grant']);
  assert.deepEqual(controls[1],f.core.publicGrant(g));assert.deepEqual(f.core.state.grant,before);
  assert.equal(f.core.message(s,frame(g,6)),2);assert.equal(new DataView(binaries(late)[0]).getUint32(12),6);
});
test('joining at expired deadline never discovers or renews an expired grant',()=>{
  const f=fixture(),{g}=f.setup();f.advance(15000);const p=f.add('listener','late');
  assert.deepEqual(p.messages.map(m=>JSON.parse(m).type),['ready']);assert.equal(f.core.state.grant.deadline,g.deadline);assert.equal(f.core.state.epoch,g.epoch);
});
test('joining after controller death receives no grant',()=>{
  const f=fixture(),{c}=f.setup();f.core.disconnect(c);const p=f.add('listener','late');assert.deepEqual(p.messages.map(m=>JSON.parse(m).type),['ready']);
});
test('expiry crossed while emitting ready suppresses grant discovery',()=>{
  const f=fixture();f.setup();const p=f.peer('listener','late');p.onSend=m=>{if(typeof m==='string'&&JSON.parse(m).type==='ready')f.advance(15000);};
  f.core.connect(p);assert.deepEqual(p.messages.map(m=>JSON.parse(m).type),['ready']);
});
