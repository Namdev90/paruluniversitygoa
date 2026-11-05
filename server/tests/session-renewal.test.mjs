import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../functions/navrang-gate/handler.mjs';
import {sha256,validateRequest} from '../functions/navrang-gate/security.mjs';
const id='12345678-1234-4234-9234-123456789abc',device='fixture-device';
const profile={role:'checker',checkerId:id,name:'Synthetic',active:true,scanner:true,station:'checker'};
function fixture(renewalEnabled=true){
 const calls=[];
 const rpc=async(action,p,hash)=>{
  calls.push({action,p,hash});
  if(action==='budget')return{allowed:true};
  if(action==='checker-credentials')return{id,active:true};
  if(action==='reports-access')return{allowed:false};
  if(action==='session-create')return p.refreshHash?{profile,refreshFamilyId:id,refreshExpiresAt:'2026-11-01T00:00:00Z',absoluteExpiresAt:'2026-11-24T00:00:00Z'}:profile;
  if(action==='session-refresh')return{profile,refreshFamilyId:id,refreshExpiresAt:'2026-11-01T00:00:00Z',absoluteExpiresAt:'2026-11-24T00:00:00Z'};
  return{signedOut:true};
 };
 const handler=createHandler({rpc,googleUser:async()=>null,googleEnabled:async()=>false,renewalEnabled});
 return{calls,send:async(action,payload)=>handler(new Request('https://fixture.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,payload})}))};
}
test('renewable login follows existing identity checks and exposes only hashes to SQL',async()=>{
 const f=fixture(),response=await f.send('checker-login',{code:'SYNTHETIC',authProtocol:1,installationId:device}),body=await response.json();
 assert.equal(response.status,200);assert.match(body.token,/^[a-f0-9]{64}$/);assert.match(body.refreshToken,/^[a-f0-9]{64}$/);
 assert.notEqual(body.token,body.refreshToken);assert.equal(body.refreshFamilyId,id);
 const create=f.calls.find(call=>call.action==='session-create');
 assert.equal(create.p.refreshHash,await sha256(body.refreshToken));assert.equal(create.p.installationId,device);
 assert.ok(!JSON.stringify(f.calls).includes(body.token));assert.ok(!JSON.stringify(f.calls).includes(body.refreshToken));
 assert.ok(f.calls.findIndex(c=>c.action==='checker-credentials')<f.calls.findIndex(c=>c.action==='session-create'));
});
test('legacy login keeps compatible shape without an unusable refresh credential',async()=>{
 const f=fixture(),body=await(await f.send('checker-login',{code:'SYNTHETIC'})).json();
 assert.equal(body.profile.role,'checker');assert.equal(body.refreshToken,undefined);
 assert.equal(f.calls.find(c=>c.action==='session-create').p.refreshHash,undefined);
});
test('refresh hashes the credential and rejects caller-selected identity or access hash',async()=>{
 const f=fixture(),secret='b'.repeat(64),next='c'.repeat(64);
 const response=await f.send('session-refresh',{refreshToken:secret,nextRefreshHash:next,requestId:id,installationId:device});
 assert.equal(response.status,200);const body=await response.json();assert.match(body.token,/^[a-f0-9]{64}$/);
 const call=f.calls.find(c=>c.action==='session-refresh');assert.equal(call.p.refreshHash,await sha256(secret));assert.equal(call.p.nextRefreshHash,next);
 assert.equal(call.p.hash,await sha256(body.token));assert.equal(call.hash,'');assert.ok(!JSON.stringify(f.calls).includes(secret));
 for(const extra of [{role:'admin'},{checkerId:id},{hash:'d'.repeat(64)},{refreshFamilyId:id}]){
  assert.throws(()=>validateRequest({action:'session-refresh',payload:{refreshToken:secret,nextRefreshHash:next,requestId:id,installationId:device,...extra}}));
 }
});
test('malformed refresh fails before any database or identity call',async()=>{
 const f=fixture(),response=await f.send('session-refresh',{refreshToken:'bad',nextRefreshHash:'c'.repeat(64),requestId:id,installationId:device});
 assert.equal(response.status,400);assert.equal(f.calls.length,0);
});
test('issuance can stay disabled during rollout without advertising unusable credentials',async()=>{
 const f=fixture(false),body=await(await f.send('checker-login',{code:'SYNTHETIC',authProtocol:1,installationId:device})).json();
 assert.equal(typeof body.refreshToken,'undefined');
 assert.equal(f.calls.find(call=>call.action==='session-create').p.refreshHash,undefined);
});
