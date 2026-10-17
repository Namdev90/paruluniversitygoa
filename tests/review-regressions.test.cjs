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
