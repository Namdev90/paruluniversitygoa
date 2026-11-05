const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function setup(role='admin'){
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 const profile={role,name:'Synthetic User',active:true,checkerId:role==='admin'?null:'fixture-staff',scanner:true,station:'checker',expiresAt:'2030-01-01T00:00:00Z'};
 w.sessionStorage.setItem('navrang-session',JSON.stringify({token:'a'.repeat(64),profile}));
 let reply={ok:true,...profile},status=200,wall=1000,mono=0;
 w.Date.now=()=>wall;Object.defineProperty(w.performance,'now',{value:()=>mono});
 w.fetch=async()=>new Response(JSON.stringify(reply),{status,headers:{'Content-Type':'application/json'}});
 for(const name of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+name,'utf8'));
 return{w,dom,profile,respond:(body,code=200)=>{reply=body;status=code},clock:(a,b)=>{wall=a;mono=b}};
}
for(const role of ['admin','checker']){
 test(role+' retains its existing credential after an infrastructure 401 and can validate again',async()=>{
  const t=setup(role);try{
   t.respond({message:'Invalid JWT'},401);
   await assert.rejects(t.w.GateClient.api('me'),e=>e.status===503);
   assert.equal(t.w.GateClient.profile()?.role,role);
   assert.ok(t.w.sessionStorage.getItem('navrang-session'));
   t.respond({ok:true,...t.profile});await t.w.GateClient.api('me');
   assert.equal(t.w.GateClient.profile().role,role);
  }finally{t.w.close()}
 });
 test(role+' clears a definitively expired server session',async()=>{
  const t=setup(role);try{
   t.respond({ok:false,error:'Sign in again. Your session expired.'},401);
   await assert.rejects(t.w.GateClient.api('me'),e=>e.status===401);
   assert.equal(t.w.GateClient.profile(),null);
   assert.equal(t.w.sessionStorage.getItem('navrang-session'),null);
  }finally{t.w.close()}
 });
 test(role+' survives offline and throttled validation without creating a replacement session',async()=>{
  const t=setup(role);try{
   const saved=t.w.sessionStorage.getItem('navrang-session');
   t.respond({ok:false,error:'Busy'},429);await assert.rejects(t.w.GateClient.api('me'));
   t.w.fetch=async()=>{throw Error('Offline')};await assert.rejects(t.w.GateClient.api('me'));
   assert.equal(t.w.sessionStorage.getItem('navrang-session'),saved);
  }finally{t.w.close()}
 });
}
test('a valid server response can identify clock skew without extending real expiry or deleting credentials',async()=>{
 const t=setup();try{
  const p={...t.profile,expiresAt:'2026-10-25T00:00:00Z'};
  t.clock(Date.parse('2026-10-26T00:00:00Z'),0);t.respond({ok:true,...p});await t.w.GateClient.api('me');
  assert.equal(t.w.GateClient.sessionExpired(),false,'fresh server confirmation was ignored because the device clock is ahead');
  t.clock(Date.parse('2026-10-26T00:00:31Z'),31000);
  assert.equal(t.w.GateClient.sessionExpired(),true,'stale clock-skew confirmation cannot authorize private views indefinitely');
  assert.ok(t.w.GateClient.profile(),'needing verification must not erase the credential');
 }finally{t.w.close()}
});
test('fresh validation cannot postpone an expiry that occurs afterward',async()=>{
 const t=setup();try{
  const p={...t.profile,expiresAt:new Date(2000).toISOString()};
  t.clock(1000,0);t.respond({ok:true,...p});await t.w.GateClient.api('me');
  t.clock(2001,1001);
  assert.equal(t.w.GateClient.sessionExpired(),true);
 }finally{t.w.close()}
});
test('explicit logout still clears the browser session',async()=>{
 const t=setup();try{t.respond({ok:true,signedOut:true});await t.w.GateClient.signOut();assert.equal(t.w.GateClient.profile(),null)}
 finally{t.w.close()}
});
test('restoring a native profile is not mistaken for fresh server validation',()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile:{role:'admin',name:'Synthetic',active:true,expiresAt:'2020-01-01T00:00:00Z'}}})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{assert.equal(w.GateClient.sessionExpired(),true);assert.ok(w.GateClient.profile())}finally{w.close()}
});
test('a local expiry indication hides private views without calling full logout',async()=>{
 const asset=name=>fs.readFileSync(root+'/app/assets/'+name,'utf8');
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let expired=false,expiryTick,signouts=0;
 w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};
 w.setInterval=(callback,ms)=>{if(ms===100)expiryTick=callback;return 0};
 w.eval(asset('core.js'));w.eval(asset('live-core.js'));
 const p={role:'admin',name:'Synthetic Admin',active:true,expiresAt:'2030-01-01T00:00:00Z'};
 w.GateClient={native:false,profile:()=>p,sessionExpired:()=>expired,on:()=>{},finishGoogle:async()=>{},feedback:()=>{},
  local:async()=>({entries:[],stats:{},localCount:0}),api:async action=>action==='me'?p:{googleEnabled:true},
  sync:async()=>({dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]}),signOut:async()=>{signouts++}};
 w.eval(asset('pagination.js'));w.eval(asset('gate.js'));
 try{
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  w.document.getElementById('registration-rows').innerHTML='<tr><td>Private fixture</td></tr>';
  expired=true;w.Date.now=()=>Date.parse('2031-01-01T00:00:00Z');expiryTick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(signouts,0,'a local clock indication revoked the encrypted session');
  assert.equal(w.document.getElementById('registration-rows').textContent,'');
  assert.equal(w.document.getElementById('view-account').hidden,false);
 }finally{w.close()}
});
test('a native session recovered after startup leaves the login view without a new login',async()=>{
 const asset=name=>fs.readFileSync(root+'/app/assets/'+name,'utf8');
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let current=null,listener;w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};
 w.eval(asset('core.js'));w.eval(asset('live-core.js'));
 w.GateClient={native:true,profile:()=>current,on:fn=>{listener=fn},finishGoogle:async()=>{},feedback:()=>{},
  readiness:()=>({}),local:async()=>({entries:[],stats:{},localCount:0}),api:async action=>action==='me'?current:{googleEnabled:true},
  sync:async()=>({dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]})};
 w.eval(asset('pagination.js'));w.eval(asset('gate.js'));
 try{
  await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.body.dataset.route,'login');
  current={role:'admin',name:'Synthetic Admin',active:true};
  listener({type:'profile',data:current});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.document.body.dataset.route,'admin');
 }finally{w.close()}
});
