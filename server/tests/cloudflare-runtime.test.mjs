import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareVoiceRuntime } from '../workers/cloudflare-voice.mjs';
import { RelayCore } from '../relay-v1/src/core.mjs';
import { clockResponse } from '../relay-v1/src/route.mjs';

const ids=Array.from({length:9},(_,i)=>`${i+1}`.padStart(8,'0')+'-1111-4111-8111-111111111111');
const [publisher,listener,leaseId,operationId,sessionId,dutyId,requestId,controllerIdentity,grantId]=ids;
const origin='https://relay.fixture.invalid',actor='a'.repeat(64),caps=['clock-v1','staged-grant-v1','scoped-control-v1'];
function fixture(extra={}) {
 let time=1700000000000,metadata=null,connected=0,ended=0,opened=0,minted=0,closed=0;
 const events=[],queries=[],peers=new Map();let pending=[];
 const operation={state:'granting',operationId,sessionId,dutyId,identity:publisher,leaseId,generation:7,
  expiresAt:new Date(time+15000).toISOString(),revoke:[],serverTime:time};
 const expectedPlan={provider:'navrang-relay-v1',publisherIdentity:publisher,leaseId,generation:7,
  roomId:'nr_'+leaseId.replaceAll('-',''),origin,expiresAt:operation.expiresAt};
 const core=new RelayCore({load:()=>structuredClone(metadata),save:value=>{metadata=structuredClone(value);}},peers,()=>time,()=>grantId);
 function peer(id,subject,role,send=()=>{}) {
  let live=true;return {id,subject,role,room:expectedPlan.roomId,version:1,jti:'synthetic_'+id,expires:time+300000,
   open:()=>live,close:()=>{live=false;},persist(){},send};
 }
 const speaker=peer('native_speaker',publisher,'speaker'),received=[];
 core.connect(speaker);core.connect(peer('native_listener',listener,'listener',data=>received.push(data)));
 const issuer={configured:()=>true,mintCredential:async(plan,input)=>{minted++;return {credential:{...plan,identity:input.identity,role:input.role,token:'synthetic-native-token'}};},
  mintControllerCredential:async(plan,input)=>{minted++;return {credential:{...plan,identity:input.identity,role:'controller',token:'synthetic-controller-token'}};}};
 const connector={clock:async input=>{events.push('probe');return clockResponse(core,new Request(input.url,{headers:input.headers}));},
  connect:async input=>{opened++;events.push('controller-connect');
   const p=peer('private_controller',controllerIdentity,'controller',data=>input.onMessage(data));core.connect(p);
   return {send:data=>{events.push(JSON.parse(data).type);core.message(p,data);},close:()=>{closed++;core.disconnect(p);input.onClose();}};
  }};
 const pool={end:async()=>{ended++;},connect:async()=>{connected++;return {release(){},query:async query=>{
  queries.push(query);const [action,raw,token]=query.values,p=JSON.parse(raw);events.push(action);
  if(query.text.includes('$3::text'))assert.equal(token,actor);else assert.equal(query.values.length,2);
  let result;
  if(action==='floor-prepare'||action==='relay-operation')result=structuredClone(operation);
  else if(action==='relay-plan'){operation.plan=structuredClone(p.plan);operation.expiresAt=p.plan.expiresAt;result=structuredClone(operation);}
  else if(action==='relay-commit'){assert.ok(core.state.prepared);assert.equal(core.state.grant,null);assert.equal(p.receipt.grantId,core.state.prepared.grantId);operation.state='active';result=structuredClone(operation);}
  else if(action==='relay-receive')result={...operation,state:'speaking',identity:publisher};
  else if(action==='voice-release'){
   operation.state='revoking';pending=[{operation:'revoke',commandId:requestId,operationId,room:sessionId,identity:publisher,generation:8,plan:operation.plan}];
   result={state:'revoking'};
  } else if(action==='controller-claim')result={claimed:true};
  else if(action==='controller-poll')result={commands:structuredClone(pending)};
  else if(action==='controller-relay-ack'){
   assert.equal(core.state.grant,null);assert.equal(p.generation,8);assert.equal(p.plan.generation,7);assert.equal(p.receipt.generation,7);
   assert.equal(p.receipt.forwardingStopped,true);assert.equal(p.receipt.mediaTerminationVerified,true);pending=[];result={state:'acked'};
  } else if(action==='controller-heartbeat')result={observed:true};
  else if(action==='controller-release')result={released:true};
  else throw Error('Unexpected private action '+action);
  return {rows:[{result}]};
 }};}};
 const qualification=()=>({configured:true,leaseEnforced:true,workerDeathVerified:true,revocationVerified:true,
  revocationMode:'guarded-admission',workerAt:time,capabilities:caps});
 const runtime=createCloudflareVoiceRuntime({pool,issuer,connector,origin,controllerIdentity,controllerId:controllerIdentity,enabled:true,
  qualification,clock:()=>time,relayOptions:{timeoutMs:50,nonce:()=> 'a'.repeat(32)},...extra});
 return {runtime,pool,issuer,connector,core,speaker,received,expectedPlan,events,queries,operation,
  advance:ms=>{time+=ms;},counts:()=>({connected,ended,opened,minted,closed})};
}
function frame(g){const b=new ArrayBuffer(44),bytes=new Uint8Array(b),v=new DataView(b);bytes.set([78,86,82,71,1,1,0,40]);
 v.setUint32(8,g.epoch);v.setUint32(12,1);v.setBigUint64(16,BigInt(g.deadline));bytes.set(g.grantId.replaceAll('-','').match(/../g).map(x=>parseInt(x,16)),24);bytes.fill(0xa5,40);return b;}

test('runtime construction performs no database, issuer or transport work; absent opt-in stays disabled',async()=>{
 const f=fixture({enabled:false});assert.deepEqual(f.counts(),{connected:0,ended:0,opened:0,minted:0,closed:0});
 assert.equal((await f.runtime.service.handle('voice-floor',{sessionId,requestId},actor)).status,503);
 assert.equal((await f.runtime.readiness()).configured,false);assert.equal(f.counts().connected,0);
 f.runtime.close();assert.equal(f.counts().ended,0,'borrowed pool ownership is retained by caller');
});

test('persistent runtime composes actual staged Core, SQL service, private controller and exact durable cleanup',async()=>{
 const f=fixture();
 const admission=await f.runtime.service.handle('voice-floor',{sessionId,requestId},actor);
 assert.equal(admission.state,'prepared');assert.deepEqual(f.operation.plan,f.expectedPlan);assert.equal(f.counts().opened,0);
 assert.equal(f.core.state.grant,null);
 const activated=await f.runtime.service.handle('voice-floor',{phase:'commit',sessionId,operationId,generation:7},actor);
 assert.equal(activated.state,'active');assert.equal(f.counts().opened,1);assert.equal(f.counts().minted,2);
 assert(f.events.indexOf('relay-commit')<f.events.indexOf('activate'));
 assert.equal(f.core.message(f.speaker,frame(f.core.state.grant)),1);
 assert.equal(f.received.filter(x=>x instanceof ArrayBuffer).length,1);
 assert.equal((await f.runtime.service.handle('voice-release',{sessionId,leaseId},actor)).state,'revoking');
 assert.deepEqual(await f.runtime.controller.cycle(),{state:'CLEANUP_ONLY',acked:1});
 assert.equal(f.core.state.grant,null);assert.equal(f.counts().opened,1,'cleanup uses same exact receipt owner');
 assert.equal(f.queries.some(q=>q.values[0]==='controller-ack'),false);
 assert.equal(f.queries.filter(q=>q.values[0]==='controller-relay-ack').length,1);
 f.runtime.close();f.runtime.close();assert.equal(f.counts().closed,1);assert.equal(f.counts().ended,0);
});

test('closed runtime fences service and cleanup entry points without touching the borrowed pool',async()=>{
 const f=fixture();f.runtime.close();
 assert.equal((await f.runtime.service.handle('voice-release',{sessionId,leaseId},actor)).status,503);
 assert.deepEqual(await f.runtime.controller.cycle(),{state:'STOPPED',acked:0});
 await assert.rejects(f.runtime.run({signal:new AbortController().signal}),/closed/);
 assert.equal(f.counts().connected,0);assert.equal(f.counts().ended,0);
});

test('persistent run requires explicit shutdown and closes relay owner after durable owner release',async()=>{
 const f=fixture();await assert.rejects(f.runtime.run(),/shutdown signal/);
 const shutdown=new AbortController(),observed=[];
 await f.runtime.run({signal:shutdown.signal,onCycle:value=>{observed.push(value);shutdown.abort();}});
 assert.deepEqual(observed,[{state:'CLEANUP_ONLY',acked:0}]);
 assert.equal(f.queries.at(-1).values[0],'controller-release');
 assert.equal((await f.runtime.readiness()).configured,false);assert.equal(f.counts().ended,0);
});

test('closing runtime aborts a pending SQL acquisition and destroys a late connection without delayed query',async()=>{
 let provide,queried=false,released=0;
 const pool={connect:()=>new Promise(resolve=>{provide=resolve;})};
 const f=fixture({pool});
 const pending=f.runtime.service.handle('voice-floor',{sessionId,requestId},actor);
 await new Promise(resolve=>setImmediate(resolve));f.runtime.close();
 assert.equal((await pending).status,503);
 provide({query:async()=>{queried=true;},release:()=>{released++;}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(queried,false);assert.equal(released,1);
});

test('nested tuning options cannot replace the private store, transport or explicit disabled opt-in',async()=>{
 let illicit=0;const f=fixture({enabled:false,serviceOptions:{rpc:async()=>{illicit++;},relay:{readiness:()=>({configured:true})}},relayOptions:{enabled:true}});
 assert.equal((await f.runtime.service.handle('voice-floor',{sessionId,requestId},actor)).status,503);
 assert.equal(illicit,0);assert.equal(f.counts().connected,0);f.runtime.close();
});
