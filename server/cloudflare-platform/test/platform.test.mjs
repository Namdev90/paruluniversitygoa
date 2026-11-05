import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {PlatformOwner} from '../owner.mjs';import {createWorkerConnector} from '../connector.mjs';
import {createVoiceController} from '../../voice/controller.mjs';
const id='12345678-1234-4234-9234-123456789abc',token='a'.repeat(64);
function fixture(enabled=true){const calls=[],state={last_activity:0},alarms=[];
 const ctx={storage:{sql:{exec(sql,...args){if(sql.startsWith('INSERT'))state.last_activity=args[0];return {toArray:()=>[state]};}},setAlarm:async at=>alarms.push(at)}};
 const env=enabled?{VOICE_ENABLED:'true',AUTH_DB:{connectionString:'synthetic-local-only'},AUTH_DB_CACHE_DISABLED:'true',ISSUER_PRIVATE_JWK:'{}',RELAY_ORIGIN:'https://relay.invalid',CONTROLLER_ID:id,QUALIFICATION_JSON:'{}'}:{};
 const owner=new PlatformOwner(ctx,env,{subtle:{importKey:async()=>({})},poolFactory:()=>({end:async()=>calls.push('pool-end')}),runtimeFactory:()=>({service:{supports:a=>a.startsWith('voice-'),handle:async(a,p,h)=>{calls.push({a,p,h});return {state:'idle'};}},controller:{cycle:async()=>{calls.push('cycle');return {state:'CLEANUP_ONLY'};}},close:()=>calls.push('close')})});
 const request=(payload={sessionId:id,requestId:id},authorization='Bearer '+token)=>new Request('https://control.invalid/voice',{method:'POST',headers:{Authorization:authorization},body:JSON.stringify({action:'voice-floor',payload})});
 return {owner,calls,state,alarms,request};}
test('absent bindings fail closed without pool or issuer calls',async()=>{const f=fixture(false);assert.equal((await f.owner.fetch(f.request())).status,503);assert.deepEqual(f.calls,[]);});
test('actual existing handler hashes raw bearer and validates payload',async()=>{const f=fixture();assert.equal((await f.owner.fetch(f.request())).status,200);assert.equal(f.calls.at(-1).h,createHash('sha256').update(token).digest('hex'));assert.notEqual(f.calls.at(-1).h,token);assert.ok(f.alarms.length);const n=f.calls.filter(x=>typeof x==='object').length;assert.equal((await f.owner.fetch(f.request({sessionId:id,requestId:id,role:'admin'}))).status,400);assert.equal(f.calls.filter(x=>typeof x==='object').length,n);});
test('missing raw bearer rejected before runtime initialization',async()=>{const f=fixture();assert.equal((await f.owner.fetch(f.request(undefined,''))).status,503);assert.deepEqual(f.calls,[]);});
test('idle alarm closes resources, fresh request reconstructs and runs cleanup first',async()=>{const f=fixture();await f.owner.fetch(f.request());f.state.last_activity=0;await f.owner.alarm();assert.ok(f.calls.includes('close'));assert.ok(f.calls.includes('pool-end'));await f.owner.fetch(f.request());assert.equal(f.calls.at(-2),'cycle');assert.equal(f.calls.at(-1).a,'voice-floor');});
test('disabled alarm does not reschedule forever',async()=>{const f=fixture(false);await f.owner.alarm();assert.deepEqual(f.alarms,[]);});
test('Worker connector rejects foreign targets before fetch',async()=>{let calls=0;const c=createWorkerConnector({origin:'https://relay.invalid',fetchImpl:async()=>{calls++;}});await assert.rejects(c.connect({url:'wss://other.invalid/v1/rooms/x/socket',headers:{},onClose(){}}));assert.equal(calls,0);});
import {createEdgeVoiceForwarder} from '../edge-forwarder.mjs';
test('Edge forwarder only sends validated voice action and raw bearer to pinned origin',async()=>{const f=fixture();let call;const forward=createEdgeVoiceForwarder({origin:'https://control.invalid',fetchImpl:async(url,options)=>{call={url,options};return new Response('{"ok":true}',{headers:{'Content-Type':'application/json'}});}});const response=await forward(f.request(),()=>{throw Error('Fallback unexpected');});assert.equal(response.status,200);assert.equal(call.url,'https://control.invalid/voice');assert.deepEqual(Object.keys(call.options.headers),['Authorization','Content-Type']);assert.equal(call.options.headers.Authorization,'Bearer '+token);assert.equal(call.options.redirect,'error');});
test('Edge forwarder leaves other actions and absent configuration with original handler',async()=>{let fetched=0,fallback=0;const call=async()=>{fetched++;};for(const origin of [undefined,'https://control.invalid']){const forward=createEdgeVoiceForwarder({origin,fetchImpl:call});for(const action of ['login','relay-commit','notifications-feed'])await forward(new Request('https://gate.invalid',{method:'POST',body:JSON.stringify({action,payload:{}})}),()=>{fallback++;return new Response('original');});}assert.equal(fetched,0);assert.equal(fallback,6);});
test('Edge forwarder rejects injected authority fields without forwarding',async()=>{let fetched=0;const f=fixture();const forward=createEdgeVoiceForwarder({origin:'https://control.invalid',fetchImpl:async()=>{fetched++;}});assert.equal((await forward(f.request({sessionId:id,requestId:id,role:'admin'}),()=>{})).status,503);assert.equal(fetched,0);});
test('persisted exact query budget survives reconstruction and rejects clock rollback',()=>{
 let row={day:Math.floor(Date.now()/86400000),operations:79999};
 const ctx={storage:{sql:{exec(sql,...args){if(sql.startsWith('INSERT INTO usage_budget'))row={day:args[0],operations:args[1]};return {toArray:()=>[row]};}}}};
 const a=new PlatformOwner(ctx,{});a.budget();assert.equal(row.operations,80000);assert.throws(()=>a.budget());
 const b=new PlatformOwner(ctx,{});assert.throws(()=>b.budget());row={day:row.day+1,operations:2};assert.throws(()=>b.budget(),/rollback/);assert.equal(row.operations,2);
});
test('rejected session result cannot extend persistent activity',async()=>{const f=fixture();await f.owner.initialize();f.owner.handler=async()=>new Response('{}',{status:403});f.state.last_activity=123;assert.equal((await f.owner.fetch(f.request())).status,403);assert.equal(f.state.last_activity,123);});
test('private pool wrapper counts before issuing SQL and preserves release on rejection',async()=>{
 let row={day:Math.floor(Date.now()/86400000),operations:79999},queries=0,releases=0,wrapped;
 const ctx={storage:{sql:{exec(sql,...args){if(sql.startsWith('INSERT INTO usage_budget'))row={day:args[0],operations:args[1]};return {toArray:()=>[row]};}}}};
 const env={VOICE_ENABLED:'true',AUTH_DB:{connectionString:'synthetic'},AUTH_DB_CACHE_DISABLED:'true',ISSUER_PRIVATE_JWK:'{}',RELAY_ORIGIN:'https://relay.invalid',CONTROLLER_ID:id,QUALIFICATION_JSON:'{}'};
 const owner=new PlatformOwner(ctx,env,{subtle:{importKey:async()=>({})},poolFactory:()=>({connect:async()=>({query:async()=>{queries++;return {};},release:()=>{releases++;}}),end:async()=>{}}),runtimeFactory:options=>{wrapped=options.pool;return {service:{supports:()=>false},close(){}};}});
 await owner.initialize();const client=await wrapped.connect();await client.query({text:'synthetic'});await assert.rejects(client.query({text:'synthetic'}));client.release(true);assert.equal(queries,1);assert.equal(releases,1);assert.equal(row.operations,80000);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function blockedCleanup(f){
 await f.owner.initialize();const entered=deferred(),polled=deferred(),calls=[];
 f.owner.runtime.controller=createVoiceController({controllerId:id,store:{
  claim:async()=>{calls.push('claim');return {claimed:true};},
  poll:async()=>{calls.push('poll');entered.resolve();return polled.promise;},
  ack:async()=>({state:'acked'}),heartbeat:async()=>{calls.push('heartbeat');return {observed:true};},release:async()=>({released:true}),
 },relay:{revoke:async()=>({revoked:true})}});
 return {entered,polled,calls};
}
test('concurrent owner cleanup callers share the real result without clearing freshness on BUSY',async()=>{
 const f=fixture(),cleanup=await blockedCleanup(f);f.owner.workerAt=123;
 const first=f.owner.cycle();await cleanup.entered.promise;const second=f.owner.cycle();
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.owner.workerAt,123,'an overlapping caller must not manufacture a failed cleanup');
 }finally{cleanup.polled.resolve({commands:[]});}
 const results=await Promise.all([first,second]);
 assert.deepEqual(results,[{state:'CLEANUP_ONLY',acked:0},{state:'CLEANUP_ONLY',acked:0}]);
 assert.deepEqual(cleanup.calls,['claim','poll','heartbeat']);assert.ok(f.owner.workerAt>123);
});
test('request and alarm wait for one successful cleanup before using freshness',async()=>{
 const f=fixture(),cleanup=await blockedCleanup(f),handled=[];
 f.owner.handler=async()=>{handled.push(f.owner.workerAt);return new Response('{}');};
 const request=f.owner.fetch(f.request());await cleanup.entered.promise;const alarm=f.owner.alarm();
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(handled,[],'a request must not pass an unfinished cleanup');
  assert.equal(f.calls.includes('close'),false,'an active request retains its runtime');
 }finally{cleanup.polled.resolve({commands:[]});}
 const [response]=await Promise.all([request,alarm]);
 assert.equal(response.status,200);assert.equal(handled.length,1);assert.ok(handled[0]>0);
 assert.deepEqual(cleanup.calls,['claim','poll','heartbeat']);assert.equal(f.calls.includes('close'),false);
});
test('request arriving during alarm cleanup cannot bypass the unfinished cycle',async()=>{
 const f=fixture(),cleanup=await blockedCleanup(f),handled=[];
 f.owner.handler=async()=>{handled.push(f.owner.workerAt);return new Response('{}');};
 const alarm=f.owner.alarm();await cleanup.entered.promise;const request=f.owner.fetch(f.request());
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(handled,[],'BUSY must not allow early handler dispatch');
 }finally{cleanup.polled.resolve({commands:[]});}
 const [,response]=await Promise.all([alarm,request]);
 assert.equal(response.status,200);assert.equal(handled.length,1);assert.ok(handled[0]>0);
 assert.deepEqual(cleanup.calls,['claim','poll','heartbeat']);assert.equal(f.calls.includes('close'),false);
});
test('coalesced failed cleanup clears freshness for every caller and the next cycle can retry',async()=>{
 const f=fixture(),cleanup=await blockedCleanup(f);f.owner.workerAt=123;
 const first=f.owner.cycle();await cleanup.entered.promise;const second=f.owner.cycle();
 cleanup.polled.resolve({commands:null});
 assert.deepEqual(await Promise.all([first,second]),[{state:'DEGRADED',acked:0},{state:'DEGRADED',acked:0}]);
 assert.equal(f.owner.workerAt,0);assert.deepEqual(cleanup.calls,['claim','poll']);
 f.owner.runtime.controller={cycle:async()=>({state:'CLEANUP_ONLY',acked:0})};
 assert.equal((await f.owner.cycle()).state,'CLEANUP_ONLY');assert.ok(f.owner.workerAt>0);
});
test('unexpected cleanup rejection is shared, clears freshness and does not stick the next cycle',async()=>{
 const f=fixture();await f.owner.initialize();let calls=0;f.owner.workerAt=123;
 f.owner.runtime.controller={cycle:()=>{calls++;throw Error('synthetic cleanup failure');}};
 const results=await Promise.allSettled([f.owner.cycle(),f.owner.cycle()]);
 assert.equal(calls,1);assert.ok(results.every(x=>x.status==='rejected'));assert.equal(f.owner.workerAt,0);
 f.owner.runtime.controller={cycle:async()=>({state:'CLEANUP_ONLY',acked:0})};
 assert.equal((await f.owner.cycle()).state,'CLEANUP_ONLY');assert.ok(f.owner.workerAt>0);
});
test('late result from an old runtime cannot overwrite or detach replacement cleanup',async()=>{
 const f=fixture();await f.owner.initialize();const old=deferred(),current=deferred();let calls=0;
 f.owner.runtime.controller={cycle:()=>old.promise};const previous=f.owner.cycle();
 f.owner.runtime={controller:{cycle:()=>{calls++;return current.promise;}}};f.owner.workerAt=456;
 const next=f.owner.cycle();old.resolve({state:'DEGRADED',acked:0});await previous;
 assert.equal(f.owner.workerAt,456);const repeated=f.owner.cycle();
 current.resolve({state:'CLEANUP_ONLY',acked:0});
 assert.deepEqual(await Promise.all([next,repeated]),[{state:'CLEANUP_ONLY',acked:0},{state:'CLEANUP_ONLY',acked:0}]);
 assert.equal(calls,1);assert.ok(f.owner.workerAt>456);
});
