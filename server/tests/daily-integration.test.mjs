import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createHandler} from '../functions/navrang-gate/handler.mjs';
import {createDailyVoiceRuntime} from '../workers/daily-voice.mjs';
import {createDailyVoiceStore, createVoiceControllerStore} from '../workers/voice-store.mjs';
import {createVoiceController} from '../voice/controller.mjs';

const id='12345678-1234-4234-9234-123456789abc';
const bearer='a'.repeat(64), hash=createHash('sha256').update(bearer).digest('hex');
const request=(action,payload={},authenticated=true)=>new Request('https://fixture.invalid/api',{
 method:'POST',headers:authenticated?{authorization:`Bearer ${bearer}`}:{},body:JSON.stringify({action,payload})});
const base={googleUser:async()=>null,googleEnabled:async()=>false};

test('existing voice route validates payload and authentication before service dispatch',async()=>{
 const calls=[];
 const handler=createHandler({...base,rpc:async()=>{throw Error('Unexpected RPC');},voiceService:{
  supports:action=>action==='duty-join',handle:async(...args)=>{calls.push(args);return {state:'idle'};}}});
 assert.equal((await handler(request('duty-join',{installationId:'fixture-installation'},false))).status,401);
 assert.equal((await handler(request('duty-join',{installationId:123}))).status,400);
 assert.equal((await handler(request('daily-plan',{}))).status,400);
 assert.equal(calls.length,0);
 const response=await handler(request('duty-join',{installationId:'fixture-installation'}));
 assert.equal(response.status,200);assert.equal((await response.json()).state,'idle');
 assert.equal(calls.length,1);assert.equal(calls[0][2],hash);assert.notEqual(calls[0][2],bearer);
 assert.ok(calls[0][3].signal instanceof AbortSignal);
});

test('absent injected service preserves existing RPC behavior and disabled response',async()=>{
 const calls=[];const handler=createHandler({...base,rpc:async(...args)=>{calls.push(args);return {error:'Voice unavailable.',status:503};}});
 assert.equal((await handler(request('duty-join',{installationId:'fixture-installation'}))).status,503);
 assert.equal(calls[0][0],'duty-join');assert.equal(calls[0][2],hash);
});

test('composition and disabled service never discover credentials or contact a provider/database',async()=>{
 let database=0,network=0;
 const runtime=createDailyVoiceRuntime({pool:{connect:async()=>{database++;throw Error('No database expected');}},
  url:'https://fixture.daily.co',apiKey:'synthetic-server-only-fixture',
  fetchImpl:async()=>{network++;throw Error('No provider expected');},controllerId:id});
 assert.equal((await runtime.service.handle('duty-join',{installationId:'fixture-installation'},hash)).status,503);
 assert.equal((await runtime.readiness()).leaseEnforced,false);
 assert.equal(database,0);assert.equal(network,0);assert.equal(runtime.transportEvidence,'NOT_RUN');
});

test('authenticated store uses only fixed private SQL and rejects unapproved actions/hashes',async()=>{
 const queries=[];let released=0;
 const pool={connect:async()=>({query:async query=>{queries.push(query);return {rows:[{result:{state:'idle'}}]};},release:()=>released++})};
 const store=createDailyVoiceStore(pool);
 await store.rpc('daily-receive',{dutyId:id,sessionId:id},hash);
 assert.equal(queries[0].text,'select navrang_private.voice_rpc($1::text,$2::jsonb,$3::text) as result');
 assert.deepEqual(queries[0].values,['daily-receive',JSON.stringify({dutyId:id,sessionId:id}),hash]);
 assert.throws(()=>store.rpc('controller-claim',{},hash));assert.throws(()=>store.rpc('daily-receive',{},'not-a-hash'));
 assert.equal(queries.length,1);assert.equal(released,1);
 const controllerStore=createVoiceControllerStore(pool);
 await controllerStore.ackDaily(id,{operationId:id,commandId:id,generation:3},{provider:'daily'},{deleted:true});
 assert.equal(queries[1].values[0],'controller-daily-ack');assert.equal(queries[1].values.length,2);
});

test('Daily cleanup never ACKs control-plane-only evidence or falls back to participant removal',async()=>{
 const plan={provider:'daily',roomId:'nv_'+'b'.repeat(32),leaseId:id,generation:3,expiresAt:'2026-10-25T12:00:00Z'};
 const command={commandId:id,operationId:id,room:id,identity:id,generation:4,operation:'revoke',plan};
 for(const verified of [false,true]){
  const calls=[];const store={claim:async()=>({claimed:true}),poll:async()=>({commands:[command]}),
   ack:async()=>{throw Error('Participant ACK is forbidden');},ackDaily:async(...args)=>{calls.push(['ack',...args]);return {state:'acked'};},
   heartbeat:async()=>({observed:true}),release:async()=>({released:true})};
  const relay={revoke:async()=>{throw Error('Participant removal is forbidden');},deleteLeaseRoom:async value=>{
   calls.push(['delete',value]);return {...plan,deleted:true,absenceObserved:true,mediaTerminationVerified:verified};}};
  const result=await createVoiceController({store,relay,controllerId:id}).cycle();
  assert.equal(result.acked,verified?1:0);assert.equal(result.state,verified?'CLEANUP_ONLY':'DEGRADED');
  assert.equal(calls.filter(x=>x[0]==='ack').length,verified?1:0);
  if(verified)assert.equal(calls[1][3],plan);
 }
});
