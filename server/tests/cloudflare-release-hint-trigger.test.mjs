import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareReleaseHintTrigger} from '../cloudflare-platform/release-hint-trigger.mjs';
const release={versionCode:19,sha256:'a'.repeat(64)};
const actor={trusted:'test-release-operator'};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture(overrides={}){
 const claims=new Map(),calls=[],posts=[];
 const ledger={async reserve(value){calls.push('reserve');const previous=claims.get(value.versionCode);if(previous)return previous===value.sha256?'duplicate':'unavailable';claims.set(value.versionCode,value.sha256);return 'claimed';},
  async finish(value,outcome){calls.push('finish:'+outcome);}};
 const options={enabled:true,projectId:'fixture-project',accessToken:async()=>{calls.push('token');return 'synthetic-token';},
  authorize:async(context,value)=>{calls.push('authorize');return context===actor;},ledger,
  fetchImpl:async(url,request)=>{calls.push('send');posts.push({url,request});return Response.json({name:'synthetic-result'});},...overrides};
 return{trigger:createCloudflareReleaseHintTrigger(options),calls,posts,claims,ledger};
}
test('disabled or incomplete dependencies cause no side effects',async()=>{
 const f=fixture({enabled:false});assert.equal(f.trigger.configured(),false);
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'UNAVAILABLE'});assert.deepEqual(f.calls,[]);
 assert.deepEqual(await createCloudflareReleaseHintTrigger().publish(release,actor),{state:'UNAVAILABLE'});
});
test('authorized exact immutable release publishes only public metadata and durable-claims once',async()=>{
 const f=fixture();assert.deepEqual(await f.trigger.publish(release,actor),{state:'ACCEPTED'});
 assert.deepEqual(f.calls,['authorize','reserve','authorize','token','authorize','send','finish:accepted']);
 assert.equal(f.posts.length,1);const body=JSON.parse(f.posts[0].request.body);
 assert.deepEqual(body.message.data,{kind:'app-release',versionCode:'19',sha256:'a'.repeat(64)});
 assert.equal(body.message.topic,'navrang-public-releases-v1');assert.equal(f.posts[0].request.redirect,'error');
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});assert.equal(f.posts.length,1);
 assert.deepEqual(await f.trigger.publish({...release,sha256:'b'.repeat(64)},actor),{state:'UNAVAILABLE'});assert.equal(f.posts.length,1);
});
test('unauthorized, invalid, extra-field and accessor payloads never reserve or send',async()=>{
 const f=fixture();for(const value of [{...release,actor:'admin'},{...release,sha256:'A'.repeat(64)},{...release,versionCode:0},null,
  Object.defineProperty({sha256:'a'.repeat(64)},'versionCode',{get(){throw Error('should not run');},enumerable:true})]){
  assert.deepEqual(await f.trigger.publish(value,actor),{state:'UNAVAILABLE'});
 }
 assert.deepEqual(await f.trigger.publish(release,{}),{state:'UNAVAILABLE'});assert.deepEqual(f.calls,['authorize']);
});
test('concurrent calls and a new process cannot publish an already reserved release',async()=>{
 const gate=deferred(),f=fixture({fetchImpl:async()=>{await gate.promise;return Response.json({name:'ok'});}});
 const first=f.trigger.publish(release,actor);await turn();
 const second=await f.trigger.publish(release,actor);assert.deepEqual(second,{state:'ALREADY_CLAIMED'});
 const next=fixture({ledger:f.ledger});assert.deepEqual(await next.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});
 gate.resolve();assert.deepEqual(await first,{state:'ACCEPTED'});
});
test('revocation after reservation fences send and abandoned reservation stays claimed',async()=>{
 let checks=0;const f=fixture({authorize:async()=>++checks===1});
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'UNAVAILABLE'});assert.equal(f.posts.length,0);
 assert.equal(f.claims.get(19),release.sha256);assert.deepEqual(f.calls,['reserve']);
});
test('cancellation during authorization or reserve never results in a late send',async()=>{
 for(const phase of ['authorization','reserve']){
  const gate=deferred(),aborter=new AbortController();let f;
  if(phase==='authorization')f=fixture({authorize:async()=>{await gate.promise;return true;}});
  else f=fixture({ledger:{reserve:async()=>{await gate.promise;return 'claimed';},finish:async()=>{throw Error('unexpected');}}});
  const work=f.trigger.publish(release,actor,{signal:aborter.signal});await turn();aborter.abort();
  assert.deepEqual(await work,{state:'UNAVAILABLE'});gate.resolve();await turn();assert.equal(f.posts.length,0);
 }
});
test('provider failure and timeout retain durable claim and do not retry',async()=>{
 const f=fixture({fetchImpl:async()=>new Response('{}',{status:503,headers:{'content-type':'application/json'}})});
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'UNAVAILABLE'});assert.equal(f.calls.at(-1),'finish:unknown');
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});
 const gate=deferred(),slow=fixture({timeoutMs:20,fetchImpl:async()=>{await gate.promise;return Response.json({name:'late'});}});
 assert.deepEqual(await slow.trigger.publish(release,actor),{state:'UNAVAILABLE'});gate.resolve();await turn();
 assert.deepEqual(await slow.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});
});
test('closing during blocked authorization immediately fences late work',async()=>{
 const gate=deferred(),f=fixture({authorize:async()=>{await gate.promise;return true;}});
 const pending=f.trigger.publish(release,actor);await turn();f.trigger.close();
 assert.deepEqual(await pending,{state:'UNAVAILABLE'});gate.resolve();await turn();assert.equal(f.posts.length,0);assert.equal(f.trigger.configured(),false);
});

test('late noncooperative credential provider never causes a send after timeout',async()=>{
 const gate=deferred(),f=fixture({timeoutMs:20,accessToken:async()=>{await gate.promise;return 'late-token';}});
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'UNAVAILABLE'});
 gate.resolve();await turn();assert.equal(f.posts.length,0);
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});
});
test('oversized provider response is bounded and can never count as acceptance',async()=>{
 const f=fixture({fetchImpl:async()=>new Response('x'.repeat(16385),{status:200})});
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'UNAVAILABLE'});
 assert.deepEqual(await f.trigger.publish(release,actor),{state:'ALREADY_CLAIMED'});
});

test('actor revoked while token is pending cannot initiate FCM send',async()=>{
 const gate=deferred();let allowed=true;const f=fixture({authorize:async()=>allowed,accessToken:async()=>{await gate.promise;return 'synthetic-token';}});
 const pending=f.trigger.publish(release,actor);await turn();allowed=false;gate.resolve();
 assert.deepEqual(await pending,{state:'UNAVAILABLE'});assert.equal(f.posts.length,0);
});
test('closing aborts an unresponsive response body stream',async()=>{
 let canceled=false;const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){canceled=true;}});
 const f=fixture({fetchImpl:async()=>new Response(body,{status:200})});const pending=f.trigger.publish(release,actor);
 await turn();f.trigger.close();assert.deepEqual(await pending,{state:'UNAVAILABLE'});await turn();assert.equal(canceled,true);
});
