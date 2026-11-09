import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRequest} from '../functions/navrang-gate/security.mjs';

const eventId='O9KL3',id='12345678-1234-4234-9234-123456789abc';
const parse=(action,payload)=>validateRequest({action,payload}).payload;

test('locator consent separates both choices and requires the disclosed version',()=>{
 const value={eventId,requestId:id,disclosureVersion:1,location:false,findMe:true};
 assert.deepEqual(parse('locator-consent',value),value);
 for(const p of [{...value,location:1},{...value,findMe:undefined},{...value,disclosureVersion:0},{...value,principal:'admin'},{...value,eventId:'another-event'}])assert.throws(()=>parse('locator-consent',p));
});
test('locator request targets exactly one UUID and has no client-controlled actor or status',()=>{
 const value={eventId,requestId:id,volunteerId:id.toUpperCase()};
 assert.equal(parse('locator-request',value).volunteerId,id);
 for(const extra of [{volunteerIds:[id]},{adminName:'Namdev'},{status:'found'},{expiresAt:'2099-01-01T00:00:00Z'},{volunteerId:'all'}])assert.throws(()=>parse('locator-request',{...value,...extra}));
});
test('location accepts one bounded fix with capture metadata and rejects identity injection',()=>{
 const value={eventId,sampleId:id,requestId:id,latitude:15.49,longitude:73.82,accuracy:35,capturedAt:'2026-10-25T17:00:00Z'};
 assert.deepEqual(parse('locator-fix',value),{...value,capturedAt:'2026-10-25T17:00:00.000Z'});
 for(const extra of [{latitude:91},{longitude:-181},{accuracy:-1},{accuracy:5001},{latitude:NaN},{capturedAt:'2026-02-30T00:00:00Z'},{checkerId:id},{locations:[value]}])assert.throws(()=>parse('locator-fix',{...value,...extra}));
 assert.equal(parse('locator-fix',Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestId'))).requestId,undefined);
});
test('duty bounds and response choices cannot turn into background tracking or forced UI',()=>{
 assert.equal(parse('locator-duty',{eventId,requestId:id,durationMinutes:60}).durationMinutes,60);
 for(const durationMinutes of [0,61,Infinity,'60'])assert.throws(()=>parse('locator-duty',{eventId,requestId:id,durationMinutes}));
 for(const choice of ['acknowledged','declined','sound','bright'])assert.equal(parse('locator-respond',{eventId,requestId:id,choice}).choice,choice);
 for(const choice of ['fullscreen','force-sound','tracking','found'])assert.throws(()=>parse('locator-respond',{eventId,requestId:id,choice}));
});
test('reads and stop/found actions reject arbitrary recipient and pagination fields',()=>{
 for(const action of ['locator-status','locator-roster','locator-inbox']){
  assert.deepEqual(parse(action,{eventId}),{eventId});
  assert.throws(()=>parse(action,{eventId,volunteerId:id}));
 }
 for(const action of ['locator-stop','locator-found'])assert.deepEqual(parse(action,{eventId,requestId:id}),{eventId,requestId:id});
 assert.throws(()=>parse('locator-prune',{eventId}));
});
test('selected-person view accepts exactly one volunteer and no requested fields',()=>{
 assert.deepEqual(parse('locator-view',{eventId,volunteerId:id}),{eventId,volunteerId:id});
 assert.throws(()=>parse('locator-view',{eventId,volunteerIds:[id]}));
 assert.throws(()=>parse('locator-view',{eventId,volunteerId:id,includeHistory:true}));
});
