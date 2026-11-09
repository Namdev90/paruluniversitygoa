import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBrowserGateway,COOKIE} from '../functions/navrang-gate/browser-gateway.mjs';

const ORIGIN='https://gate.test',NOW=Date.parse('2026-10-25T00:00:00Z');
const ACCESS='a'.repeat(64),REFRESH='b'.repeat(64),NEXT='d'.repeat(64),NEW_ACCESS='c'.repeat(64);
const FAMILY='00000000-0000-4000-8000-000000000001';
const profile={role:'admin',active:true,scanner:true,expiresAt:new Date(NOW+900000).toISOString()};
const bundle=()=>({ok:true,token:ACCESS,refreshToken:REFRESH,refreshFamilyId:FAMILY,
 refreshExpiresAt:new Date(NOW+7*86400000).toISOString(),absoluteExpiresAt:new Date(NOW+30*86400000).toISOString(),profile});
function fixture(){
 let uuid=10,offline=false,respond;const calls=[],jar=new Map();
 const gateway=createBrowserGateway({origin:ORIGIN,clock:()=>NOW,newSecret:()=>NEXT,
  newUUID:()=>`00000000-0000-4000-8000-${String(++uuid).padStart(12,'0')}`,
  call:async request=>{calls.push(structuredClone({...request,signal:undefined}));if(offline)throw Error('synthetic offline');
   if(respond)return respond(request);
   if(['login','checker-login','google-login'].includes(request.action))return {status:200,body:bundle()};
   if(request.action==='session-refresh'){const fresh=bundle();delete fresh.refreshToken;fresh.token=NEW_ACCESS;return {status:200,body:fresh};}
   if(request.action==='logout')return {status:200,body:{ok:true,signedOut:true}};
   return {status:200,body:{ok:true,...profile}};}});
 const request=async(path,body={},options={})=>{
  const headers={Origin:ORIGIN,'X-Navrang-Request':'1','Content-Type':'application/json',...options.headers};
  if(jar.size)headers.Cookie=[...jar].map(([key,value])=>key+'='+value).join('; ');
  const result=await gateway(new Request(ORIGIN+'/navrang'+path,{method:options.method||'POST',headers,body:options.method==='GET'?undefined:JSON.stringify(body)}));
  if(options.apply!==false)for(const line of result.headers.getSetCookie()){
   const item=line.split(';')[0],at=item.indexOf('='),key=item.slice(0,at),value=item.slice(at+1);
   if(/Max-Age=0(?:;|$)/.test(line))jar.delete(key);else jar.set(key,value);
  }
  return result;
 };
 const login=()=>request('/api',{action:'login',payload:{username:'fixture',password:'synthetic-input'}});
 return {calls,jar,request,login,offline:value=>offline=value,respond:value=>respond=value};
}
test('login uses existing renewal protocol and returns only a public profile with strict cookies',async()=>{
 const f=fixture(),response=await f.login(),body=await response.text();assert.equal(response.status,200);
 assert.equal(f.calls[0].payload.authProtocol,1);assert.match(f.calls[0].payload.installationId,/^browser-/);
 assert.equal(f.jar.get(COOKIE.access),ACCESS);assert.ok(f.jar.has(COOKIE.refresh));
 for(const line of response.headers.getSetCookie()){
  assert.match(line,/; Secure/);assert.match(line,/; HttpOnly/);assert.match(line,/; SameSite=Strict/);assert.match(line,/; Path=\//);assert.doesNotMatch(line,/Domain=/);
 }
 for(const secret of [ACCESS,REFRESH])assert.ok(!body.includes(secret));
 assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('a cold browser can validate the existing access cookie without sending a token in its body',async()=>{
 const f=fixture();await f.login();f.calls.length=0;
 const response=await f.request('/api',{action:'me',payload:{}});assert.equal(response.status,200);
 assert.equal(f.calls[0].token,ACCESS);assert.deepEqual(f.calls[0].payload,{});assert.equal((await response.json()).role,'admin');
});
test('missing access requests renewal locally and two-phase commit rotates the existing family',async()=>{
 const f=fixture();await f.login();f.jar.delete(COOKIE.access);f.calls.length=0;
 let response=await f.request('/api',{action:'me',payload:{}});assert.equal(response.status,401);assert.equal((await response.json()).code,'RENEW_REQUIRED');assert.equal(f.calls.length,0);
 response=await f.request('/session/prepare');const text=await response.text();assert.equal(response.status,200);assert.ok(!text.includes(REFRESH)&&!text.includes(NEXT));
 response=await f.request('/session/commit');assert.equal(response.status,200);assert.equal(f.jar.get(COOKIE.access),NEW_ACCESS);assert.ok(!f.jar.has(COOKIE.pending));
 const rotate=f.calls.find(call=>call.action==='session-refresh');assert.equal(rotate.payload.refreshToken,REFRESH);assert.equal(rotate.payload.nextRefreshHash,createHash('sha256').update(NEXT).digest('hex'));assert.match(rotate.payload.requestId,/^[a-f0-9-]{36}$/);
 assert.ok(!(await response.text()).includes(NEXT));
});
test('an uncertain renewal retries exactly the same successor hash, request ID and installation',async()=>{
 const f=fixture();await f.login();await f.request('/session/prepare');
 assert.equal((await f.request('/session/commit',{}, {apply:false})).status,200);
 assert.equal((await f.request('/session/commit')).status,200);
 const rotations=f.calls.filter(call=>call.action==='session-refresh');assert.equal(rotations.length,2);assert.deepEqual(rotations[0].payload,rotations[1].payload);
});
test('offline commit preserves pending proof and the existing refresh cookie',async()=>{
 const f=fixture();await f.login();await f.request('/session/prepare');const pending=f.jar.get(COOKIE.pending),refresh=f.jar.get(COOKIE.refresh);f.offline(true);
 assert.equal((await f.request('/session/commit')).status,503);assert.equal(f.jar.get(COOKIE.pending),pending);assert.equal(f.jar.get(COOKIE.refresh),refresh);
});
test('logout clears active cookies while retaining only a non-authenticating revocation proof until acknowledged',async()=>{
 const f=fixture();await f.login();f.offline(true);let response=await f.request('/logout');assert.equal(response.status,503);
 assert.ok(!f.jar.has(COOKIE.access)&&!f.jar.has(COOKIE.refresh)&&f.jar.has(COOKIE.revoke));
 f.offline(false);f.calls.length=0;response=await f.request('/api',{action:'me',payload:{}});assert.equal(response.status,403);assert.equal(f.calls.length,0);
 response=await f.request('/logout');assert.equal(response.status,200);assert.equal(f.jar.size,0);assert.equal(f.calls[0].action,'logout');assert.equal(f.calls[0].payload.refreshToken,REFRESH);
});
test('unknown infrastructure 401 retains cookies while authoritative refresh rejection clears them',async()=>{
 const f=fixture();await f.login();const saved=new Map(f.jar);f.respond(()=>({status:401,body:{message:'Invalid JWT'}}));
 let response=await f.request('/api',{action:'me',payload:{}});assert.equal(response.status,503);assert.deepEqual(f.jar,saved);
 f.respond(()=>({status:401,body:{ok:false,error:'Sign in again. Your session expired.'}}));await f.request('/session/prepare');
 response=await f.request('/session/commit');assert.equal(response.status,401);assert.equal((await response.json()).code,'AUTH_REVOKED');assert.equal(f.jar.size,0);
});
test('cross-origin, missing custom header and raw Authorization never reach the backend',async()=>{
 const f=fixture();for(const headers of [{Origin:'https://other.test'},{'X-Navrang-Request':''},{Authorization:'Bearer '+ACCESS}]){
  assert.equal((await f.request('/api',{action:'config',payload:{}},{headers})).status,403);
 }assert.equal(f.calls.length,0);
});
test('caller refresh credentials, direct renewal and browser voice routes are not accepted',async()=>{
 const f=fixture();for(const action of ['session-refresh','voice-floor','duty-join'])assert.ok((await f.request('/api',{action,payload:{}})).status>=400);
 assert.equal((await f.request('/api',{action:'login',payload:{username:'fixture',password:'synthetic-input',refreshToken:REFRESH}})).status,400);assert.equal(f.calls.length,0);
});
test('legacy backend cannot be mistaken for renewable login',async()=>{
 const f=fixture();f.respond(request=>request.action==='logout'?{status:200,body:{ok:true,signedOut:true}}:{status:200,body:{ok:true,token:ACCESS,profile}});
 const response=await f.login();assert.equal(response.status,503);assert.ok(!f.jar.has(COOKIE.access)&&!f.jar.has(COOKIE.refresh));assert.equal(f.calls.at(-1).action,'logout');
});
test('credentials embedded in unexpected response fields are redacted and never logged/returned',async()=>{
 const f=fixture();await f.login();f.respond(()=>({status:200,body:{ok:true,...profile,token:ACCESS,refreshToken:REFRESH,note:ACCESS}}));
 const text=await (await f.request('/api',{action:'me',payload:{}})).text();assert.ok(!text.includes(ACCESS)&&!text.includes(REFRESH));
});
