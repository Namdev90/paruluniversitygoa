import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../functions/navrang-gate/handler.mjs';
import {validateRequest} from '../functions/navrang-gate/security.mjs';

function makeHandler(rpc){
 return createHandler({rpc,googleUser:async()=>null,googleEnabled:async()=>false});
}
function post(handler,action,payload={},authorized=true){
 return handler(new Request('https://example.test/gate',{method:'POST',
  headers:authorized?{Authorization:'Bearer '+'a'.repeat(64)}:{},
  body:JSON.stringify({action,payload})}));
}
test('report access requires a signed-in Navrang session',async()=>{
 let calls=0;const handler=makeHandler(async()=>{calls++;return{allowed:true}});
 const response=await post(handler,'reports-export',{kind:'all'},false);
 assert.equal(response.status,401);assert.equal(calls,0);
});
test('invalid report kinds and untrusted teacher permission requests are rejected',()=>{
 assert.throws(()=>validateRequest({action:'reports-export',payload:{kind:'all;drop table'}}));
 assert.throws(()=>validateRequest({action:'reports-grant',payload:{checkerId:'bad',enabled:true}}));
 assert.throws(()=>validateRequest({action:'reports-grant',payload:{checkerId:'12345678-1234-1234-9234-123456789abc',enabled:'true'}}));
 assert.doesNotThrow(()=>validateRequest({action:'reports-export',payload:{kind:'resolved'}}));
});
test('account refresh exposes only the report permission returned by protected RPC',async()=>{
 let calls=[];const handler=makeHandler(async(action,payload,hash)=>{
  calls.push(action);
  if(action==='me')return{role:'checker',active:true,name:'Faculty'};
  if(action==='reports-access')return{allowed:false};
  throw new Error('unexpected RPC');
 });
 const response=await post(handler,'me');
 const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.reports,false);
 assert.deepEqual(calls,['me','reports-access']);
});
test('server errors from report RPC are not treated as successful exports',async()=>{
 const handler=makeHandler(async(action)=>{
  assert.equal(action,'reports-export');
  return{error:'Teacher reports permission required.',status:403};
 });
 const response=await post(handler,'reports-export',{kind:'all'});
 assert.equal(response.status,403);const body=await response.json();assert.equal(body.ok,false);
});
