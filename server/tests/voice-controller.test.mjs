import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceController} from '../voice/controller.mjs';

const id='12345678-1234-4234-9234-123456789abc';
const command={commandId:id,room:id,identity:id,generation:3,operation:'revoke'};
function fixture(overrides={}) {
 const calls=[];
 const store={
  claim:async()=>{calls.push('claim');return {claimed:true};},
  poll:async()=>{calls.push('poll');return {commands:[command]};},
  ack:async()=>{calls.push('ack');return {state:'acked'};},
  heartbeat:async()=>{calls.push('heartbeat');return {observed:true,ready:true};},
  release:async()=>{calls.push('release');return {released:true};},...overrides.store,
 };
 const relay={revoke:async p=>{calls.push('revoke');assert.equal(p.strict,true);return {revoked:true};},...overrides.relay};
 return {calls,store,relay,controller:createVoiceController({store,relay,controllerId:id,...overrides.options})};
}
test('persistent controller claims, strictly removes, durably acknowledges then reports cleanup-only',async()=>{
 const {controller,calls}=fixture();assert.deepEqual(await controller.cycle(),{state:'CLEANUP_ONLY',acked:1});
 assert.deepEqual(calls,['claim','poll','revoke','ack','heartbeat']);assert.equal(controller.transportEvidence,'NOT_RUN');
});
test('another owner prevents all relay operations and health updates',async()=>{
 const {controller,calls}=fixture({store:{claim:async()=>({status:409})}});
 assert.equal((await controller.cycle()).state,'STANDBY');assert.deepEqual(calls,[]);
});
test('unacknowledged removal remains durable and never records successful health',async()=>{
 const {controller,calls}=fixture({relay:{revoke:async()=>({revoked:false})}});
 assert.equal((await controller.cycle()).state,'DEGRADED');assert.deepEqual(calls,['claim','poll']);
});
test('lost acknowledgement retries the same durable removal on the next cycle',async()=>{
 let fail=true;const {controller,calls}=fixture({store:{ack:async()=>fail?{status:409}:{state:'acked'}}});
 assert.equal((await controller.cycle()).state,'DEGRADED');fail=false;
 assert.equal((await controller.cycle()).acked,1);assert.equal(calls.filter(x=>x==='revoke').length,2);
 assert.equal(calls.filter(x=>x==='heartbeat').length,1);
});
test('hung provider times out; no acknowledgement and no overlapping work',async()=>{
 const {controller,calls}=fixture({relay:{revoke:()=>new Promise(()=>{})},options:{adapterTimeoutMs:20,cycleBudgetMs:100}});
 const pending=controller.cycle();assert.equal((await controller.cycle()).state,'BUSY');
 assert.equal((await pending).state,'DEGRADED');assert(!calls.includes('ack'));assert(!calls.includes('heartbeat'));
});
test('malformed durable command cannot choose a different provider operation',async()=>{
 for(const invalid of [{...command,operation:'grant'},{...command,generation:-1},{...command,identity:'../secret'},null]) {
  const {controller,calls}=fixture({store:{poll:async()=>({commands:[invalid]})}});
  assert.equal((await controller.cycle()).state,'DEGRADED');assert(!calls.includes('revoke'));
 }
});
test('bounded backlog does not mark worker fresh before all removals finish',async()=>{
 const {controller,calls}=fixture({store:{poll:async()=>({commands:[command],more:true})}});
 assert.deepEqual(await controller.cycle(),{state:'PARTIAL',acked:1});assert(!calls.includes('heartbeat'));
});
test('run loops as one persistent process and graceful shutdown releases its owner lease',async()=>{
 const shutdown=new AbortController();const observed=[];
 const {controller,calls}=fixture({options:{wait:async()=>{}}});
 await controller.run({signal:shutdown.signal,onCycle:result=>{observed.push(result);if(observed.length===3)shutdown.abort();}});
 assert.equal(observed.length,3);assert.equal(calls.filter(x=>x==='claim').length,3);assert.equal(calls.at(-1),'release');
 assert(observed.every(x=>x.state==='CLEANUP_ONLY'));
});
test('aborting a pending transport stops quickly without falsely acknowledging it',async()=>{
 const shutdown=new AbortController();let started;
 const ready=new Promise(resolve=>{started=resolve;});
 const {controller,calls}=fixture({relay:{revoke:async()=>{started();return new Promise(()=>{});}}});
 const running=controller.cycle({signal:shutdown.signal});await ready;shutdown.abort();
 assert.equal((await running).state,'STOPPED');assert(!calls.includes('ack'));
});
test('controller status redacts backend data and secrets',async()=>{
 const {controller}=fixture({store:{poll:async()=>{throw Error('secret-private-identity');}}});
 assert.deepEqual(await controller.cycle(),{state:'DEGRADED',acked:0});
});
test('unbounded timers are rejected',()=>{
 assert.throws(()=>fixture({options:{cycleBudgetMs:5000}}));
});

const cloudflarePlan={provider:'navrang-relay-v1',leaseId:id,publisherIdentity:id,generation:7,
 roomId:'nr_'+id.replaceAll('-',''),origin:'https://relay.fixture.invalid',expiresAt:'2026-10-26T12:00:00.000Z'};
const cloudflareReceipt={provider:cloudflarePlan.provider,roomId:cloudflarePlan.roomId,leaseId:id,generation:7,
 expiresAt:cloudflarePlan.expiresAt,revoked:true,forwardingStopped:true,mediaTerminationVerified:true};
function cloudflareCleanup(change={}) {
 const exactCommand={...command,operationId:id,generation:8,plan:cloudflarePlan};
 return fixture({store:{poll:async()=>({commands:[exactCommand]}),ackRelay:async(owner,cmd,plan,receipt)=>{
  assert.equal(owner,id);assert.deepEqual(cmd,exactCommand);assert.equal(cmd.generation,8);assert.deepEqual(plan,cloudflarePlan);assert.equal(receipt.generation,7);
  return {state:'acked'};
 },...change.store},relay:{revoke:async(plan)=>{assert.deepEqual(plan,cloudflarePlan);return {...cloudflareReceipt,...change.receipt};},...change.relay}});
}
test('Cloudflare cleanup uses exact immutable plan and controller-relay acknowledgement with no generic ACK',async()=>{
 const f=cloudflareCleanup();assert.deepEqual(await f.controller.cycle(),{state:'CLEANUP_ONLY',acked:1});
 assert.equal(f.calls.includes('ack'),false);assert.equal(f.calls.at(-1),'heartbeat');
});
test('Cloudflare malformed or unverified cutoff evidence never falls back to legacy ACK',async()=>{
 for(const receipt of [{forwardingStopped:false},{mediaTerminationVerified:false},{generation:8},{roomId:'nr_forged'},{provider:'daily'}]) {
  let acknowledged=false;const f=cloudflareCleanup({receipt,store:{ackRelay:async()=>{acknowledged=true;return {state:'acked'};}}});
  assert.equal((await f.controller.cycle()).state,'DEGRADED');assert.equal(acknowledged,false);assert.equal(f.calls.includes('ack'),false);
 }
});
test('missing Cloudflare receipt acknowledgement or unknown provider plan fails closed before fallback',async()=>{
 const missing=cloudflareCleanup({store:{ackRelay:undefined}});
 assert.equal((await missing.controller.cycle()).state,'DEGRADED');assert.equal(missing.calls.includes('ack'),false);
 const unknown=fixture({store:{poll:async()=>({commands:[{...command,plan:{provider:'unknown'}}]})}});
 assert.equal((await unknown.controller.cycle()).state,'DEGRADED');assert.equal(unknown.calls.includes('revoke'),false);assert.equal(unknown.calls.includes('ack'),false);
});
test('lost Cloudflare SQL acknowledgement retries exact cutoff evidence without generic ACK',async()=>{
 let count=0;const f=cloudflareCleanup({store:{ackRelay:async()=>++count===1?{status:409}:{state:'acked'}}});
 assert.equal((await f.controller.cycle()).state,'DEGRADED');assert.deepEqual(await f.controller.cycle(),{state:'CLEANUP_ONLY',acked:1});
 assert.equal(count,2);assert.equal(f.calls.includes('ack'),false);
});
