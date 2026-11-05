import test from 'node:test';import assert from 'node:assert/strict';
import {createScheduledNotificationDispatcher} from '../cloudflare-platform/notification-dispatcher.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const credential={type:'private',extractable:false,algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'},modulusLength:2048},usages:['sign']};
function fixture(options={}){
 const calls=[], reservations=[],released=[];
 const pool={async connect(){calls.push('connect');return {async query({text,values}){
  const phase=text.includes('navrang_notification_bridge.claim(')?'claim':text.includes('navrang_notification_bridge.check_delivery(')?'check':'finish';calls.push(phase);
  if(options[phase])return options[phase](values);
  if(phase==='claim')return {rows:[{result:[{id:42,leaseId:'synthetic-lease'}]}]};
  if(phase==='check')return {rows:[{result:{allowed:true,providerTarget:{type:'legacyToken',value:'synthetic-target'},eventId:'event-one',bindingId:'binding-one',revision:3}}]};
  return {rows:[{result:{completed:true}}]};
 },release(value){released.push(value);}};}};
 const quota={async consume({kind,signal}){signal.throwIfAborted();reservations.push(kind);return options.quota?options.quota(kind):true;}};
 const fetchImpl=async(url,init)=>{calls.push(url.includes('oauth2')?'oauth':'fcm');assert.equal(init.redirect,'error');
  if(url.includes('oauth2'))return Response.json({access_token:'synthetic-access-token-only',token_type:'Bearer',expires_in:3600});
  if(options.fcm)return options.fcm(init);
  return Response.json({name:'projects/fixture-project/messages/synthetic'});
 };
 const args={enabled:true,pool,quota,projectId:'fixture-project',key:credential,email:'sender@fixture-project.iam.gserviceaccount.com',kid:'synthetic',
  subtle:{sign:async()=>new Uint8Array(256)},fetchImpl,adapterTimeoutMs:100,budgetMs:1000};
 return {dispatcher:createScheduledNotificationDispatcher({...args,...options.args}),calls,reservations,released,args};
}
test('disabled and missing dependencies have no I/O',async()=>{
 let calls=0;const d=createScheduledNotificationDispatcher({pool:{connect(){calls++;}},quota:{consume(){calls++;}}});
 assert.equal((await d.scheduled()).state,'NOT_RUN');assert.equal(calls,0);
});
test('authorized scheduled batch rechecks SQL and sends only bounded generic payload',async()=>{
 const f=fixture();const r=await f.dispatcher.scheduled();assert.equal(r.accepted,1);assert.deepEqual(f.calls,['connect','claim','connect','check','oauth','fcm','connect','finish']);
 assert.deepEqual(f.reservations,['database','database','oauth','fcm','database']);assert.equal(JSON.stringify(r).includes('synthetic-target'),false);
});
test('durable shared quota exhaustion before a query or send fails closed',async()=>{
 for(const kind of ['database','oauth','fcm']){const f=fixture({quota:k=>k!==kind});const r=await f.dispatcher.scheduled();assert.notEqual(r.accepted,1);assert.equal(f.calls.includes(kind==='database'?'claim':kind),false);}
});
test('revoked authorization is never sent',async()=>{
 const f=fixture({check:()=>({rows:[{result:{allowed:false,reason:'access-or-binding-changed'}}]})});const r=await f.dispatcher.scheduled();assert.equal(r.cancelled,1);assert.equal(f.calls.includes('oauth'),false);assert.equal(f.calls.includes('fcm'),false);
});
test('external cancellation during hung claim fences late completion and sends nothing',async()=>{
 let resolve;const f=fixture({claim:()=>new Promise(r=>{resolve=r})});const abort=new AbortController();const running=f.dispatcher.scheduled({signal:abort.signal});await tick();abort.abort();assert.equal((await running).state,'UNAVAILABLE');resolve({rows:[{result:[{id:42,leaseId:'synthetic-lease'}]}]});await tick();await tick();assert.equal(f.calls.includes('check'),false);assert.equal(f.calls.includes('fcm'),false);
});
test('cancellation during hung authorization check prevents late delivery and settlement',async()=>{
 let resolve;const f=fixture({check:()=>new Promise(r=>{resolve=r})});const abort=new AbortController();const running=f.dispatcher.scheduled({signal:abort.signal});while(!resolve)await tick();abort.abort();assert.equal((await running).state,'UNAVAILABLE');resolve({rows:[{result:{allowed:true,providerTarget:{type:'legacyToken',value:'synthetic-target'},eventId:'event-one',bindingId:'binding-one',revision:3}}]});await tick();await tick();assert.equal(f.calls.includes('fcm'),false);assert.equal(f.calls.includes('finish'),false);
});
test('cancellation during in-flight FCM never settles a late acceptance or retries',async()=>{
 let resolve;const f=fixture({fcm:()=>new Promise(r=>{resolve=r})});const abort=new AbortController();const running=f.dispatcher.scheduled({signal:abort.signal});while(!resolve)await tick();abort.abort();assert.equal((await running).state,'UNAVAILABLE');resolve(Response.json({name:'projects/fixture-project/messages/synthetic'}));await tick();await tick();assert.equal(f.calls.filter(x=>x==='fcm').length,1);assert.equal(f.calls.includes('finish'),false);
});
test('hung operation is bounded and concurrent invocation cannot duplicate a batch',async()=>{
 let resolve;const f=fixture({claim:()=>new Promise(r=>{resolve=r}),args:{budgetMs:30,adapterTimeoutMs:15}});const first=f.dispatcher.scheduled();while(!resolve)await tick();assert.equal((await f.dispatcher.scheduled()).state,'BUSY');assert.notEqual((await first).accepted,1);resolve({rows:[{result:[]}]});await tick();
});
test('late database acquisition after cancel is destroyed without query',async()=>{
 let resolve,releases=0,queries=0;const f=fixture({args:{pool:{connect:()=>new Promise(r=>{resolve=r})}}});const abort=new AbortController();const first=f.dispatcher.scheduled({signal:abort.signal});while(!resolve)await tick();abort.abort();assert.equal((await first).state,'UNAVAILABLE');resolve({query(){queries++},release(destroy){assert.equal(destroy,true);releases++;}});await tick();await tick();assert.equal(releases,1);assert.equal(queries,0);
});
test('close fences active work and prevents future scheduling',async()=>{
 let resolve;const f=fixture({claim:()=>new Promise(r=>{resolve=r})});const pending=f.dispatcher.scheduled();while(!resolve)await tick();f.dispatcher.close();assert.equal((await pending).state,'UNAVAILABLE');assert.equal((await f.dispatcher.scheduled()).state,'NOT_RUN');resolve({rows:[{result:[]}]});
});
test('late quota approval after per-operation timeout cannot issue a query on a released client',async()=>{
 let approve;const f=fixture({quota:kind=>kind==='database'?new Promise(resolve=>{approve=resolve}):true,args:{budgetMs:200,adapterTimeoutMs:15}});
 const running=f.dispatcher.scheduled();while(!approve)await tick();const result=await running;assert.notEqual(result.accepted,1);approve(true);await tick();await tick();
 assert.equal(f.calls.includes('claim'),false);assert.equal(f.calls.includes('check'),false);assert.equal(f.calls.includes('fcm'),false);assert.equal(f.released.length,1);assert.equal(f.released[0],true);
});
test('cancellation after quota approval but before the fetch continuation prevents external I/O',async()=>{
 const abort=new AbortController();let approved;const f=fixture({quota:kind=>kind==='oauth'?new Promise(resolve=>{approved=resolve}):true});
 const running=f.dispatcher.scheduled({signal:abort.signal});while(!approved)await tick();approved(true);queueMicrotask(()=>abort.abort());
 assert.equal((await running).state,'UNAVAILABLE');await tick();assert.equal(f.calls.includes('oauth'),false);assert.equal(f.calls.includes('fcm'),false);
});
test('aborting a stalled response body cancels its reader and does not settle the lease',async()=>{
 let cancelled=0;const stream=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled++;}});
 const f=fixture({fcm:()=>new Response(stream,{headers:{'Content-Type':'application/json'}})});const abort=new AbortController();const running=f.dispatcher.scheduled({signal:abort.signal});
 while(!f.calls.includes('fcm'))await tick();await tick();abort.abort();assert.equal((await running).state,'UNAVAILABLE');await tick();
 assert.equal(cancelled,1);assert.equal(f.calls.includes('finish'),false);
});
