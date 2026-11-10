const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),ORIGIN='https://gate.test',ACCESS='a'.repeat(64),REFRESH='b'.repeat(64),NEW_ACCESS='c'.repeat(64);
const modulePromise=import('../server/functions/navrang-gate/browser-gateway.mjs');
async function setup(){
 const {createBrowserGateway,COOKIE}=await modulePromise,now=Date.now(),jar=new Map(),calls=[],requests=[],releaseMe=[];let offline=false,waitSync,releaseSync,waitMe=false;
 const profile={role:'admin',active:true,scanner:true,expiresAt:new Date(now+900000).toISOString()},family='00000000-0000-4000-8000-000000000001';
 const gateway=createBrowserGateway({origin:ORIGIN,clock:()=>now,call:async value=>{
  calls.push({action:value.action,payload:value.payload,token:value.token});
  if(waitSync&&value.action==='sync')return await new Promise(resolve=>releaseSync=resolve);
  if(waitMe&&value.action==='me')return await new Promise(resolve=>releaseMe.push(resolve));
  if(['login','checker-login','google-login'].includes(value.action))return {status:200,body:{ok:true,token:ACCESS,refreshToken:REFRESH,refreshFamilyId:family,refreshExpiresAt:new Date(now+7*86400000).toISOString(),absoluteExpiresAt:new Date(now+30*86400000).toISOString(),profile}};
  if(value.action==='session-refresh')return {status:200,body:{ok:true,token:NEW_ACCESS,refreshFamilyId:family,refreshExpiresAt:new Date(now+7*86400000).toISOString(),absoluteExpiresAt:new Date(now+30*86400000).toISOString(),profile}};
  if(value.action==='logout')return {status:200,body:{ok:true,signedOut:true}};
  return {status:200,body:{ok:true,...profile}};
 }});
 const dom=new JSDOM('',{url:ORIGIN+'/',runScripts:'outside-only'}),w=dom.window;
 let tail=Promise.resolve();w.navigator.locks={request:(name,options,work)=>{const next=tail.then(()=>{if(options.signal?.aborted)throw Error('Aborted');return work();});tail=next.catch(()=>{});return next;}};
 w.AbortController=global.AbortController;
 w.fetch=async(url,options)=>{
  requests.push({url,body:options.body,credentials:options.credentials});if(offline)throw Error('Offline');
  const headers={...options.headers,Origin:ORIGIN};if(jar.size)headers.Cookie=[...jar].map(([key,value])=>key+'='+value).join('; ');
  const result=await gateway(new Request(new URL(url,ORIGIN),{method:options.method,headers,body:options.body,signal:options.signal}));
  for(const line of result.headers.getSetCookie()){
   const item=line.split(';')[0],at=item.indexOf('='),key=item.slice(0,at),value=item.slice(at+1);
   if(/Max-Age=0(?:;|$)/.test(line))jar.delete(key);else jar.set(key,value);
  }
  // Real Fetch does not expose HttpOnly Set-Cookie to frontend code.
  return new Response(await result.text(),{status:result.status,headers:{'Content-Type':'application/json'}});
 };
 w.eval(fs.readFileSync(ROOT+'/app/assets/browser-session.js','utf8'));
 const cleared=[],profiles=[];
 const create=()=>w.NavrangBrowserSession.create({base:'/navrang',onClear:value=>cleared.push(value),onProfile:p=>profiles.push(p)});
 const session=create();
 return {w,dom,session,create,jar,COOKIE,calls,requests,cleared,profiles,offline:value=>offline=value,
  holdSync:()=>waitSync=true,releaseSync:()=>releaseSync({status:200,body:{ok:true,records:[{name:'Private fixture'}]}}),
  holdMe:()=>waitMe=true,releaseMe:(index,p)=>releaseMe[index]({status:200,body:{ok:true,...profile,...p}}),setProfile:p=>Object.assign(profile,p),
  loadClient:()=>{for(const file of ['live-core.js','config.js'])w.eval(fs.readFileSync(ROOT+'/app/assets/'+file,'utf8'));w.NavrangConfig.gateway='/navrang';w.eval(fs.readFileSync(ROOT+'/app/assets/client.js','utf8'));return w.GateClient;},
  login:()=>session.request('login',{username:'fixture',password:'synthetic-input'})};
}
function noStoredCredentials(t){
 for(const storage of [t.w.localStorage,t.w.sessionStorage])for(let i=0;i<storage.length;i++){
  const value=storage.getItem(storage.key(i));assert.ok(!value.includes(ACCESS)&&!value.includes(REFRESH)&&!value.includes(NEW_ACCESS));assert.ok(!value.includes('expiresAt'));
 }
 assert.equal(t.w.sessionStorage.getItem('navrang-session'),null);assert.equal(t.w.document.cookie,'');
 for(const request of t.requests){assert.equal(request.credentials,'same-origin');assert.ok(!request.url.includes(ACCESS)&&!request.body.includes(REFRESH));}
}
test('browser login keeps only a public in-memory profile, never credentials in web storage',async()=>{
 const t=await setup();try{await t.login();assert.equal(t.session.profile().role,'admin');noStoredCredentials(t);const copy=t.session.profile();copy.role='checker';assert.equal(t.session.profile().role,'admin');}finally{t.session.dispose();t.w.close();}
});
test('cold restoration validates the retained HttpOnly session without another login',async()=>{
 const t=await setup();let next;try{await t.login();t.session.dispose();next=t.create();assert.equal(next.profile(),null);await next.restore();assert.equal(next.profile().role,'admin');assert.equal(t.calls.filter(x=>x.action==='login').length,1);noStoredCredentials(t);}finally{next?.dispose();t.w.close();}
});
test('access expiry renews the existing family and concurrent requests rotate once',async()=>{
 const t=await setup();try{await t.login();t.jar.delete(t.COOKIE.access);await Promise.all([t.session.request('me'),t.session.request('me')]);assert.equal(t.calls.filter(x=>x.action==='session-refresh').length,1);assert.equal(t.session.profile().role,'admin');assert.equal(t.jar.get(t.COOKIE.access),NEW_ACCESS);noStoredCredentials(t);}finally{t.session.dispose();t.w.close();}
});
test('transient connection loss retains the public profile and private cookie session',async()=>{
 const t=await setup();try{await t.login();const before=new Map(t.jar);t.offline(true);await assert.rejects(t.session.request('me'),e=>e.status===503);assert.equal(t.session.profile().role,'admin');assert.deepEqual(t.jar,before);noStoredCredentials(t);}finally{t.session.dispose();t.w.close();}
});
test('offline explicit logout clears private UI immediately and persists only a nonsecret retry intent',async()=>{
 const t=await setup();let next;try{await t.login();t.offline(true);const result=await t.session.logout();assert.equal(result.revocationPending,true);assert.equal(t.session.profile(),null);assert.ok(t.cleared.length);noStoredCredentials(t);
  t.session.dispose();next=t.create();await next.restore();assert.equal(next.profile(),null);t.offline(false);await next.restore();assert.equal(next.profile(),null);assert.equal(t.jar.size,0);assert.equal(t.calls.filter(x=>x.action==='logout').length,1);
 }finally{next?.dispose();t.w.close();}
});
test('a late authorized response cannot restore private data after logout',async()=>{
 const t=await setup();try{await t.login();t.holdSync();const pending=t.session.request('sync',{dataRevision:0,afterSeq:0});await new Promise(resolve=>setImmediate(resolve));await t.session.logout();t.releaseSync();await assert.rejects(pending,e=>e.status===409);assert.equal(t.session.profile(),null);}finally{t.session.dispose();t.w.close();}
});
test('cross-tab logout notification clears the profile and does not automatically restore it',async()=>{
 const t=await setup();try{await t.login();const before=t.calls.length;t.w.dispatchEvent(new t.w.StorageEvent('storage',{key:'navrang-browser-auth-v1',newValue:'logout:fixture'}));await new Promise(resolve=>setImmediate(resolve));assert.equal(t.session.profile(),null);assert.equal(t.calls.length,before);assert.equal(t.cleared.at(-1).external,true);}finally{t.session.dispose();t.w.close();}
});
test('browser coordination is required and cannot fall back to unsafe refresh races',async()=>{
 const t=await setup();try{t.w.navigator.locks=undefined;assert.throws(()=>t.create(),e=>e.status===503);assert.equal(t.calls.length,0);}finally{t.session.dispose();t.w.close();}
});
test('a late older account validation cannot restore permissions after a newer one',async()=>{
 const t=await setup();try{await t.login();t.holdMe();const old=t.session.request('me'),fresh=t.session.request('me');await new Promise(resolve=>setImmediate(resolve));
  t.releaseMe(1,{role:'checker',scanner:false,checkerId:'synthetic-staff'});await fresh;t.releaseMe(0,{role:'admin',scanner:true});await assert.rejects(old,e=>e.status===409);assert.equal(t.session.profile().role,'checker');
 }finally{t.session.dispose();t.w.close();}
});
test('a data reply authorized before actual grant loss cannot become visible afterward',async()=>{
 const t=await setup();try{await t.login();t.holdSync();const old=t.session.request('sync',{dataRevision:0,afterSeq:0});await new Promise(resolve=>setImmediate(resolve));
  t.setProfile({role:'checker',scanner:false,checkerId:'synthetic-staff'});await t.session.request('me');t.releaseSync();await assert.rejects(old,e=>e.status===403);assert.equal(t.session.profile().role,'checker');
 }finally{t.session.dispose();t.w.close();}
});
test('GateClient uses protected cookies for login, cold restore and explicit logout',async()=>{
 const t=await setup();try{let client=t.loadClient();await client.api('login',{username:'fixture',password:'synthetic-input'});assert.equal(client.profile().role,'admin');
  client=t.loadClient();assert.equal(client.profile(),null);await client.restoreSession();assert.equal(client.profile().role,'admin');assert.equal(t.calls.filter(x=>x.action==='login').length,1);
  await client.signOut();assert.equal(client.profile(),null);assert.equal(t.jar.size,0);noStoredCredentials(t);
 }finally{t.session.dispose();t.w.close();}
});
test('GateClient never treats a transient cookie-gateway failure as sign-out',async()=>{
 const t=await setup();try{const client=t.loadClient();await client.api('login',{username:'fixture',password:'synthetic-input'});t.offline(true);await assert.rejects(client.api('me'),e=>e.status===503);assert.equal(client.profile().role,'admin');noStoredCredentials(t);}finally{t.session.dispose();t.w.close();}
});
