// Functional DOM/IndexedDB regressions; no rendered-browser claim or hosted mutation.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),asset=n=>fs.readFileSync(ROOT+'/app/assets/'+n,'utf8');
const pause=()=>new Promise(r=>setImmediate(r));
async function until(f){for(let i=0;i<100;i++){if(f())return;await pause()}throw Error('DOM work did not complete')}
function client(factory=new IDBFactory()){
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.indexedDB=factory;w.AbortController=AbortController;
 for(const n of ['live-core.js','config.js','client.js'])w.eval(asset(n));return {dom,w};
}
const session=(token,name)=>({token,profile:{role:'checker',checkerId:name,name,active:true,method:'code'}});
const reply=b=>new Response(JSON.stringify({ok:true,...b}),{headers:{'Content-Type':'application/json'}});
test('a delayed profile refresh cannot restore sign-out or overwrite a newer login',async()=>{
 const {dom,w}=client();try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify(session('old','Old checker')));let release;
  w.fetch=async(_url,o)=>{const {action}=JSON.parse(o.body);if(action==='me')return new Promise(r=>release=()=>r(reply(session('old','Old checker').profile)));if(action==='checker-login')return reply(session('new','New checker'));return reply({signedOut:true})};
  let old=w.GateClient.api('me').catch(()=>null);await w.GateClient.signOut();release();await old;assert.equal(w.GateClient.profile(),null,'old me resurrected a signed-out identity');
  w.sessionStorage.setItem('navrang-session',JSON.stringify(session('old','Old checker')));old=w.GateClient.api('me').catch(()=>null);await w.GateClient.api('checker-login',{code:'test'});release();await old;assert.equal(w.GateClient.profile().name,'New checker','old me overwrote a newer identity');
 }finally{dom.window.close()}
});
test('student data stays in memory, stale sync cannot replace newer data, and a fresh tab has no roster',async()=>{
 const factory=new IDBFactory(),a=client(factory),b=client(factory);try{
  await Promise.all([a.w.GateClient.local('snapshot'),b.w.GateClient.local('snapshot')]);
  const newer={dataRevision:2,cursor:2,records:[{id:'DEMO0002',name:'New'}],entries:[],stats:{total:1},source:'new'};
  const older={dataRevision:1,cursor:1,records:[{id:'DEMO0001',name:'Old'}],entries:[],stats:{total:9},source:'old'};
  a.w.fetch=async()=>reply(newer);await a.w.GateClient.sync();a.w.fetch=async()=>reply(older);await a.w.GateClient.sync();
  let saved=await a.w.GateClient.local('snapshot');assert.equal(saved.dataRevision,2);assert.equal(saved.cursor,2);assert.equal(saved.stats.total,1);assert.equal((await a.w.GateClient.local('lookup',{id:'DEMO0002'})).record.name,'New');
  assert.equal((await b.w.GateClient.local('snapshot')).localCount,0,'a fresh tab inherited a persistent roster');
  const entry={ticketId:'DEMO0002',seq:2,name:'Student',checker:'Original',checkerId:'checker',at:'2026-10-16T12:00:00Z',deviceId:'phone'};
  a.w.fetch=async()=>reply({...newer,entries:[entry]});await a.w.GateClient.sync();
  a.w.fetch=async()=>reply({...newer,entries:[{...entry,checker:'Changed'}]});await assert.rejects(a.w.GateClient.sync(),/Conflicting entry history/);
  assert.equal((await a.w.GateClient.local('lookup',{id:'DEMO0002'})).entry.checker,'Original');
  await assert.rejects(a.w.GateClient.local('backup'),/server-only/);
  assert.equal((await factory.databases()).length,0,'client created a persistent student database');
 }finally{a.dom.window.close();b.dom.window.close()}
});
test('name-only edits preserve quantity, unknown refunds and arbitrary payment descriptions',async t=>{
 for(const variation of [{quantity:2},{refund:null},{description:'Organizer payment under review'},{amount:null}])await t.test(JSON.stringify(variation),async()=>{
  const original={id:'DEMO0001',name:'Synthetic Student',amount:100,quantity:1,refund:0,description:'Transaction completed successfully',eligible:false,reason:'Review',...variation};
  const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/#admin',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
  w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};let saved;
  w.NavrangWorkbook={};w.NavrangPackage={};w.eval(asset('live-core.js'));
  w.GateClient={native:false,profile:()=>({role:'admin',name:'namdev',active:true}),on:()=>{},finishGoogle:async()=>{},local:async()=>({entries:[],stats:{},localCount:1}),api:async(action,p)=>{if(action==='upsert')saved=p.records[0];return{googleEnabled:false}},sync:async()=>({dataRevision:1,cursor:0,records:[original],entries:[],stats:{},checkers:[]})};
  try{w.eval(asset('gate.js'));await until(()=>w.document.querySelector('#registration-rows .table-link'));
   w.document.querySelector('#registration-rows td:last-child button').click();w.document.getElementById('edit-name').value='Corrected name';
   w.document.getElementById('ticket-editor').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await until(()=>saved);
   assert.equal(saved.name,'Corrected name');for(const key of ['amount','quantity','refund','description'])assert.equal(saved[key],original[key],key+' changed without organizer input');
  }finally{await pause();await pause();dom.window.close()}
 });
});

test('an in-flight roster sync cannot restore student data after checker access is revoked',async()=>{
 const {dom,w}=client();let deliver;try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify({...session('same','Raju'),profile:{...session('same','Raju').profile,scanner:true,helpdesk:false}}));
  w.fetch=async(_url,o)=>JSON.parse(o.body).action==='sync'?new Promise(r=>deliver=()=>r(reply({dataRevision:3,cursor:0,records:[{id:'DEMO0001',name:'Synthetic Student'}],entries:[],stats:{total:1}}))):reply({...session('same','Raju').profile,scanner:false,helpdesk:true});
  const pending=w.GateClient.sync();await until(()=>deliver);await w.GateClient.api('me');deliver();await assert.rejects(pending,/access changed/);assert.equal((await w.GateClient.local('snapshot')).localCount,0);
 }finally{dom.window.close()}
});

test('an expired current session clears temporary student data and returns to signed out',async()=>{
 const {dom,w}=client();try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify({token:'expired',profile:{role:'admin',name:'namdev',active:true}}));
  w.fetch=async()=>reply({dataRevision:1,cursor:0,records:[{id:'DEMO0001',name:'Temporary student'}],entries:[],stats:{total:1}});
  await w.GateClient.sync();assert.equal((await w.GateClient.local('snapshot')).localCount,1);
  const events=[];w.GateClient.on(e=>events.push(e));
  w.fetch=async()=>new Response(JSON.stringify({ok:false,error:'Session expired.'}),{status:401});
  await assert.rejects(w.GateClient.api('me'),e=>e.status===401);
  assert.equal(w.GateClient.profile(),null);assert.equal(w.sessionStorage.getItem('navrang-session'),null);
  assert.equal((await w.GateClient.local('snapshot')).localCount,0);assert.equal(events.filter(e=>e.type==='auth'&&e.data===null).length,1);
 }finally{dom.window.close()}
});

test('a delayed old-session denial or a failed login cannot sign out a newer valid session',async()=>{
 const {dom,w}=client();let deliver;try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify(session('old','Old checker')));
  w.fetch=async(_url,o)=>JSON.parse(o.body).action==='me'?new Promise(r=>deliver=()=>r(new Response(JSON.stringify({ok:false,error:'Expired'}),{status:401}))):reply(session('new','New checker'));
  const old=w.GateClient.api('me').catch(()=>null);await w.GateClient.api('checker-login',{code:'test'});deliver();await old;
  assert.equal(w.GateClient.profile().name,'New checker');
  w.fetch=async()=>new Response(JSON.stringify({ok:false,error:'Wrong code'}),{status:401});
  await assert.rejects(w.GateClient.api('checker-login',{code:'wrong'}));assert.equal(w.GateClient.profile().name,'New checker');
 }finally{dom.window.close()}
});

test('a privileged API response cannot return private content after sign-out',async()=>{
 const {dom,w}=client();let deliver;try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify(session('old','Raju')));
  w.fetch=async(_url,o)=>JSON.parse(o.body).action==='helpdesk-export'?new Promise(r=>deliver=()=>r(reply({csv:'private test contact'}))):reply({signedOut:true});
  const exportResult=w.GateClient.api('helpdesk-export');const denied=assert.rejects(exportResult,/Sign-in changed/);await w.GateClient.signOut();deliver();await denied;
 }finally{dom.window.close()}
});

test('sign-out is immediate on a slow connection and its late receipt cannot erase a newer login',async()=>{
 const {dom,w}=client();let deliver;try{
  w.sessionStorage.setItem('navrang-session',JSON.stringify(session('old','Old checker')));
  w.fetch=async(_url,o)=>JSON.parse(o.body).action==='logout'?new Promise(r=>deliver=()=>r(reply({signedOut:true}))):reply(session('new','New checker'));
  const logout=w.GateClient.signOut();assert.equal(w.GateClient.profile(),null);
  await w.GateClient.api('checker-login',{code:'test'});deliver();await logout;assert.equal(w.GateClient.profile().name,'New checker');
 }finally{dom.window.close()}
});

test('a staff summary clears old rosters and entry history and retains only the two allowed counters',async()=>{
 const {dom,w}=client();try{
  w.fetch=async()=>reply({dataRevision:1,cursor:0,records:[{id:'DEMO0001',name:'Old cached student'}],entries:[],stats:{total:1124}});await w.GateClient.sync();
  w.sessionStorage.setItem('navrang-session',JSON.stringify({...session('staff','Raju'),profile:{...session('staff','Raju').profile,station:'helpdesk',scanner:false,helpdesk:true}}));
  w.fetch=async()=>reply({staffSummary:true,scanner:false,dataRevision:-1,cursor:0,records:null,entries:[],stats:{ownScans:7,totalEntries:200,total:1124,remaining:900}});await w.GateClient.sync();
  const s=await w.GateClient.local('snapshot');assert.equal(s.localCount,0);assert.equal(s.entries.length,0);assert.equal((await w.GateClient.local('lookup',{id:'DEMO0001'})).record,undefined);assert.equal(JSON.stringify(s.stats),JSON.stringify({ownScans:7,totalEntries:200}));
  w.fetch=async()=>reply(w.GateClient.profile());await w.GateClient.api('me');assert.equal((await w.GateClient.local('snapshot')).stats.totalEntries,200,'a profile refresh cleared the permitted counters');
  w.fetch=async()=>reply({dataRevision:1,records:[{id:'DEMO0001',name:'Should not load'}],entries:[],stats:{total:1124}});await assert.rejects(w.GateClient.sync(),/Only your scan summary/);assert.equal((await w.GateClient.local('snapshot')).localCount,0);
 }finally{dom.window.close()}
});
