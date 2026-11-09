import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceControl, voiceReadiness} from '../functions/navrang-gate/voice-control.mjs';

const now = 100000;
const configured = {configured:true,revocationMode:'cloud-explicit-cutoff',revocationVerified:true,workerAt:now,leaseEnforced:true,workerDeathVerified:true};
test('fresh worker cannot replace relay lease and worker-death evidence',()=>{for(const state of [{...configured,leaseEnforced:false},{...configured,workerDeathVerified:false}])assert.equal(voiceReadiness(state,now).ready,false)});
test('missing relay, stale worker and unverified revocation fail closed', () => {
 for (const state of [{},{...configured,workerAt:now-3001},{...configured,revocationVerified:false},{...configured,revocationMode:'self-host-ttl'}]) {
  assert.equal(voiceReadiness(state,now).ready,false);
 }
 assert.equal(voiceReadiness(configured,now).ready,true);
});
function fixture({failRevoke=false,failGrant=false,commitError=false}={}) {
 const calls=[];
 const operation={operationId:'op',sessionId:'session',generation:3,identity:'new-identity',room:'private-room',leaseId:'lease',expiresAt:new Date(now+15000).toISOString(),revoke:[{room:'staff-room',identity:'old-identity'}]};
 const rpc=async(action,payload,token)=>{
  calls.push({action,payload,token});
  if(action==='floor-prepare')return operation;
  if(action==='floor-commit')return commitError?{error:'Stale generation',status:409}:{...operation,state:'active'};
  if(action==='floor-fail')return {state:'revoking'};
  throw Error('Unexpected RPC');
 };
 const relay={readiness:()=>configured,
  revoke:async(command)=>{calls.push({action:'revoke',command});if(failRevoke)throw Error('provider secret must not leak');return {revoked:true};},
  grant:async(command)=>{calls.push({action:'grant',command});if(failGrant)throw Error('provider secret must not leak');return {granted:true,leaseEnforced:true,leaseId:command.leaseId,generation:command.generation,expiresAt:command.expiresAt};}};
 return {calls,control:createVoiceControl({rpc,relay,clock:()=>now})};
}
test('old publishing permission is revoked before a new microphone grant',async()=>{
 const {control,calls}=fixture();const result=await control.acquire({sessionId:'session',requestId:'req'},'session-hash');
 assert.equal(result.state,'active');assert.deepEqual(calls.map(x=>x.action),['floor-prepare','revoke','grant','floor-commit']);
 assert.equal(calls[1].command.strict,true);assert.equal(calls[1].command.cutoff,100);
 assert.equal(calls[2].command.generation,3);
});
test('failed preemption never grants another publisher or leaks provider messages',async()=>{
 const {control,calls}=fixture({failRevoke:true});const result=await control.acquire({sessionId:'session',requestId:'req'},'session-hash');
 assert.equal(result.status,503);assert(!JSON.stringify(result).includes('secret'));
 assert(!calls.some(x=>x.action==='grant'));assert(calls.some(x=>x.action==='floor-fail'));
});
test('failed commit compensates grant and retains durable failure state',async()=>{
 const {control,calls}=fixture({commitError:true});const result=await control.acquire({sessionId:'session',requestId:'req'},'session-hash');
 assert.equal(result.status,503);assert.deepEqual(calls.map(x=>x.action),['floor-prepare','revoke','grant','floor-commit','revoke','floor-fail']);
});
test('an ambiguous timed-out grant is compensated even without provider acknowledgement',async()=>{
 const {control,calls}=fixture({failGrant:true});
 assert.equal((await control.acquire({sessionId:'session',requestId:'req'},'hash')).status,503);
 assert.deepEqual(calls.map(x=>x.action),['floor-prepare','revoke','grant','revoke','floor-fail']);
});
test('unconfigured provider does not prepare floor state or issue a token',async()=>{
 let called=false;
 const control=createVoiceControl({rpc:async()=>{called=true;},clock:()=>now});
 assert.equal((await control.acquire({},'hash')).status,503);assert.equal(called,false);
 assert.equal(control.transportEvidence,'NOT_RUN');
});
test('readiness adapter exceptions are redacted',async()=>{
 const control=createVoiceControl({rpc:async()=>{throw Error('must not call');},relay:{readiness:()=>{throw Error('secret');},revoke(){},grant(){}}});
 const result=await control.acquire({},'hash');assert.equal(result.status,503);assert(!JSON.stringify(result).includes('secret'));
});
test('hung grant times out and is quarantined rather than hanging the action',async()=>{
 const calls=[];
 const operation={operationId:'op',room:'room',identity:'speaker',generation:1,leaseId:'lease',expiresAt:new Date(now+15000).toISOString(),revoke:[]};
 const rpc=async(action,payload)=>{calls.push({action,payload});return action==='floor-prepare'?operation:{};};
 const relay={readiness:()=>configured,grant:()=>new Promise(()=>{}),revoke:async()=>({revoked:true})};
 const result=await createVoiceControl({rpc,relay,clock:()=>now,relayTimeoutMs:10}).acquire({},'hash');
 assert.equal(result.status,503);assert.equal(calls.find(x=>x.action==='floor-fail').payload.ambiguousGrant,true);
});
test('all revocations finish before any grant including multiple rooms',async()=>{
 const calls=[];let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const rpc=async(action)=>action==='floor-prepare'?{operationId:'op',sessionId:'new',room:'target',identity:'new',generation:2,leaseId:'lease',expiresAt:new Date(now+15000).toISOString(),revoke:[{room:'one',identity:'a'},{room:'two',identity:'b'}]}:{state:'active',leaseId:'lease',generation:2,expiresAt:new Date(now+15000).toISOString()};
 const relay={readiness:()=>configured,revoke:async({identity})=>{calls.push(identity);if(identity==='b')await waiting;return {revoked:true};},grant:async command=>{calls.push('grant');return {granted:true,leaseEnforced:true,leaseId:command.leaseId,generation:command.generation,expiresAt:command.expiresAt};}};
 const operation=createVoiceControl({rpc,relay,clock:()=>now}).acquire({},'hash');
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['a','b']);release();await operation;assert.deepEqual(calls,['a','b','grant']);
});
test('missing or expired authoritative lease never reaches relay grant',async()=>{
 for(const expiresAt of [undefined,'invalid',new Date(now).toISOString(),new Date(now+16000).toISOString()]) {
  let granted=false;
  const control=createVoiceControl({clock:()=>now,rpc:async action=>action==='floor-prepare'?{operationId:'op',room:'room',identity:'member',generation:1,leaseId:'lease',expiresAt}:{},
   relay:{readiness:()=>configured,revoke:async()=>({revoked:true}),grant:async()=>{granted=true;}}});
  assert.equal((await control.acquire({},'hash')).status,503);assert.equal(granted,false);
 }
});
test('provider permission update without exact relay-enforced lease receipt never commits',async()=>{
 const actions=[];
 const control=createVoiceControl({clock:()=>now,rpc:async action=>{actions.push(action);return action==='floor-prepare'?{operationId:'op',room:'room',identity:'member',generation:1,leaseId:'lease',expiresAt:new Date(now+15000).toISOString()}:{};},
  relay:{readiness:()=>configured,revoke:async()=>({revoked:true}),grant:async()=>({granted:true})}});
 assert.equal((await control.acquire({},'hash')).status,503);assert(!actions.includes('floor-commit'));assert(actions.includes('floor-fail'));
});
test('expiry during commit or mismatched committed lease is compensated and never returned active',async()=>{
 for(const scenario of ['expired','wrong-lease','wrong-generation','wrong-expiry']) {
  let current=now;const actions=[];
  const operation={operationId:'op',room:'room',identity:'member',generation:1,leaseId:'lease',expiresAt:new Date(now+1000).toISOString()};
  const control=createVoiceControl({clock:()=>current,rpc:async action=>{
   actions.push(action);if(action==='floor-prepare')return operation;
   if(action==='floor-commit'){
    if(scenario==='expired')current=now+1001;
    return {...operation,state:'active',...(scenario==='wrong-lease'?{leaseId:'other'}:scenario==='wrong-generation'?{generation:2}:scenario==='wrong-expiry'?{expiresAt:new Date(now+2000).toISOString()}:{})};
   }
   return {};
  },relay:{readiness:()=>({...configured,workerAt:current}),
   revoke:async()=>{actions.push('revoke');return {revoked:true};},
   grant:async()=>({...operation,granted:true,leaseEnforced:true})}});
  assert.equal((await control.acquire({},'hash')).status,503);
  assert.deepEqual(actions,['floor-prepare','floor-commit','revoke','floor-fail']);
 }
});
