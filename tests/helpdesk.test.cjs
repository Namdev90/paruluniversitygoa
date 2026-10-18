const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{webcrypto}=require('node:crypto'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),asset=n=>fs.readFileSync(root+'/app/assets/'+n,'utf8'),D=require('../app/assets/desk-core.js');
const details={name:'Test Student',email:'test@example.invalid',phone:'+91 9999999999',quantity:1};
const pause=()=>new Promise(r=>setImmediate(r));
test('help desk validates the four requested details and strips client-supplied privileges and payment authorization',()=>{
 const saved=D.normalize({...details,eligible:true,status:'approved',created_by_name:'namdev',email:'TEST@EXAMPLE.INVALID'});
 assert.equal(saved.email,'test@example.invalid');for(const key of ['eligible','status','created_by_name'])assert.equal(key in saved,false);
 for(const change of [{phone:'123'},{email:''},{email:'broken'},{quantity:0},{quantity:1.5},{quantity:21},{quantity:'1'},{name:''}])assert.throws(()=>D.normalize({...details,...change}));
});
test('college CSV preserves details, audit identity and review status and neutralizes spreadsheet formulas',()=>{
 const csv=D.csv([{id:'case-1',created_at:'2026-10-17T01:00:00Z',created_by_name:'Raju',status:'pending',details:{...details,name:'=1+1',notes:'Hello, "college"\nsecond line',phone:'+919999999999'}}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=1+1"'));assert.ok(csv.includes('"\'+919999999999"'));assert.ok(csv.includes('"Quantity"'));assert.ok(!csv.includes('Hello, '));assert.ok(csv.includes('"Raju"'));assert.ok(csv.includes('"pending"'));assert.ok(csv.includes('"Mobile number"'));assert.ok(!csv.includes('"Student ID"'));
});
test('help desk handler blocks anonymous export and rejects malformed save before protected RPC',async()=>{
 const {createHandler}=await import('../server/functions/navrang-gate/handler.mjs');let called=[];
 const h=createHandler({rpc:async(a,p)=>{called.push({a,p});return{registration:{id:'saved'}}},googleUser:async()=>null,googleEnabled:async()=>true});
 const post=(action,payload,authenticated=false)=>h(new Request('https://test.invalid',{method:'POST',headers:authenticated?{Authorization:'Bearer '+'a'.repeat(64)}:{},body:JSON.stringify({action,payload})}));
 assert.equal((await post('helpdesk-export',{})).status,401);assert.equal(called.length,0);
 const requestId='12345678-1234-4234-9234-123456789abc';
 assert.equal((await post('helpdesk-save',{requestId,details:{...details,phone:'123'}},true)).status,400);assert.equal(called.length,0);
 assert.equal((await post('helpdesk-save',{requestId,details:{...details,eligible:true,status:'approved'}},true)).status,200);assert.equal(called[0].p.details.eligible,undefined);assert.equal(called[0].p.details.status,undefined);
 assert.equal((await post('helpdesk-list',{offset:0,limit:10000},true)).status,400);
});
function desk(profile={role:'checker',name:'Raju',checkerId:'desk-1',active:true,helpdesk:true}){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});
 let calls=[],behavior=async()=>({records:[],total:0,stats:{total:0,pending:0,approved:0},registration:{ticket_id:'HDABCDEF'}});
 w.GateClient={profile:()=>profile,native:false,feedback:()=>{},api:async(a,p)=>{calls.push({a,p:JSON.parse(JSON.stringify(p||{}))});return behavior(a,p)},save:()=>calls.push({a:'file-save'}),sync:async()=>({})};
 w.eval(asset('live-core.js'));w.eval(asset('desk-core.js'));w.eval(asset('desk.js'));
 for(const [key,value]of Object.entries(details))w.document.getElementById('desk-'+key).value=value??'';
 return{dom,w,calls,setBehavior:f=>behavior=f,setProfile:p=>profile=p};
}
test('an uncertain help desk save retries the identical request and only clears the form after server receipt',async()=>{
 const t=desk(),{w,dom,calls}=t;let saves=0;
 t.setBehavior(async action=>{if(action==='helpdesk-save'&&++saves===1)throw Error('Connection lost');return{registration:{ticket_id:'HDABCDEF'}}});
 try{
  const form=w.document.getElementById('desk-form');await form.onsubmit({preventDefault(){}});
  assert.equal(w.document.getElementById('desk-name').value,details.name);assert.match(w.document.getElementById('desk-form-message').textContent,/unconfirmed/);
  w.document.getElementById('desk-name').value='Must not change retry';await form.onsubmit({preventDefault(){}});
  const requests=calls.filter(c=>c.a==='helpdesk-save');assert.equal(requests.length,2);assert.deepEqual(requests[0].p,requests[1].p);assert.equal(w.document.getElementById('desk-name').value,'');assert.match(w.document.getElementById('desk-form-message').textContent,/Saved on server/);
  assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 }finally{dom.window.close()}
});
test('desk checker can read own saved detail pages but cannot edit, review or export them',async()=>{
 const t=desk(),{w,dom,calls}=t;
 t.setBehavior(async()=>({records:[{id:'case-1',ticket_id:'HDABCDEF',created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details,status:'pending',version:1}],total:1,stats:{total:1,pending:1,approved:0}}));
 try{
  await w.NavrangDesk.refresh(true);assert.equal(w.document.getElementById('desk-export').hidden,true);assert.equal(w.document.querySelectorAll('#desk-records .button').length,0);
  w.document.querySelector('.desk-record-info').click();assert.equal(w.document.getElementById('desk-name').matches(':disabled'),true);assert.equal(w.document.getElementById('desk-submit').hidden,true);
  w.document.getElementById('desk-export').click();w.document.getElementById('desk-approve').click();await pause();assert.ok(!calls.some(c=>['helpdesk-export','helpdesk-edit','helpdesk-review'].includes(c.a)));
 }finally{dom.window.close()}
});
test('admin approval requires an explicit confirmation and posts the current version',async()=>{
 const t=desk({role:'admin',name:'namdev',active:true}),{w,dom,calls}=t;
 const record={id:'12345678-1234-4234-9234-123456789abc',ticket_id:'HDABCDEF',created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details:{...details,paymentStatus:'paid',amount:100},status:'pending',version:4};
 t.setBehavior(async action=>action==='helpdesk-list'?{records:[record],total:1,stats:{total:1,pending:1,approved:0}}:{saved:true});
 try{
  await w.NavrangDesk.refresh(true);w.document.querySelector('#desk-records .button').click();w.document.getElementById('desk-approve').click();assert.ok(!calls.some(c=>c.a==='helpdesk-review'));
  w.document.getElementById('desk-confirm-existing').checked=true;w.document.getElementById('desk-approve').click();await pause();assert.deepEqual(calls.find(c=>c.a==='helpdesk-review').p,{id:record.id,version:4,status:'approved',confirmExisting:true,confirmPayment:true});
 }finally{await pause();dom.window.close()}
});

test('help desk exposes only four entry fields and updates the quantity fee preview',()=>{const {w,dom}=desk();try{
 const ids=[...w.document.querySelectorAll('#desk-fields input')].map(e=>e.id);assert.deepEqual(ids,['desk-name','desk-email','desk-phone','desk-quantity']);
 assert.equal(w.document.getElementById('desk-email').required,true);w.document.getElementById('desk-quantity-up').click();assert.equal(w.document.getElementById('desk-quantity').value,'2');assert.match(w.document.getElementById('desk-bill').textContent,/₹200/);
 for(let i=0;i<4;i++)w.document.getElementById('desk-quantity-down').click();assert.equal(w.document.getElementById('desk-quantity').value,'1');
 assert.deepEqual(Object.keys(D.normalize({...details,eligible:true,paymentStatus:'paid',amount:100})),['name','email','phone','quantity']);
 }finally{dom.window.close()}});

test('revoking Help Desk access clears forms, pending saves and saved contacts from the screen',async()=>{
 const t=desk(),{w,dom}=t;try{
  t.setBehavior(async()=>{throw Error('Connection lost')});await w.document.getElementById('desk-form').onsubmit({preventDefault(){}});
  assert.equal(w.NavrangDesk.hasDraft(),true);
  w.document.getElementById('desk-records').textContent=details.email;w.document.getElementById('desk-search').value=details.phone;
  t.setProfile({role:'checker',checkerId:'desk-1',name:'Raju',active:true,helpdesk:false});await w.NavrangDesk.refresh(true);
  for(const key of ['name','email','phone'])assert.equal(w.document.getElementById('desk-'+key).value,'');
  assert.equal(w.NavrangDesk.hasDraft(),false);assert.equal(w.document.getElementById('desk-form').dataset.pending,'false');assert.equal(w.document.getElementById('desk-records').textContent,'');assert.equal(w.document.getElementById('desk-search').value,'');assert.equal(w.document.getElementById('desk-workspace').hidden,true);
 }finally{dom.window.close()}
});

test('an admin downgrade closes and scrubs the privileged Help Desk review',async()=>{
 const t=desk({role:'admin',name:'namdev',active:true}),{w,dom}=t;
 t.setBehavior(async()=>({records:[{id:'case-1',ticket_id:'HDABCDEF',created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details,status:'pending',version:1}],total:1,stats:{total:1,pending:1,approved:0}}));
 try{
  await w.NavrangDesk.refresh(true);w.document.querySelector('#desk-records .button').click();w.document.getElementById('desk-confirm-existing').checked=true;
  assert.equal(w.document.getElementById('desk-review-dialog').open,true);
  t.setProfile({role:'checker',checkerId:'desk-1',name:'Raju',active:true,helpdesk:true});await w.NavrangDesk.refresh(true);
  assert.equal(w.document.getElementById('desk-review-dialog').open,false);assert.equal(w.document.getElementById('desk-review-details').textContent,'');assert.equal(w.document.getElementById('desk-review-name').textContent,'');assert.equal(w.document.getElementById('desk-confirm-existing').checked,false);
 }finally{dom.window.close()}
});

test('an export finishing after sign-out or admin downgrade cannot download contacts',async()=>{
 for(const profile of [null,{role:'checker',checkerId:'desk-1',name:'Raju',active:true,helpdesk:true}]){
  const t=desk({role:'admin',name:'namdev',active:true}),{w,dom,calls}=t;let deliver;
  try{
   t.setBehavior(async()=>new Promise(r=>deliver=()=>r({filename:'contacts.csv',csv:details.email,count:1})));
   const download=w.document.getElementById('desk-export').onclick();t.setProfile(profile);w.NavrangDesk.clear();deliver();await download;
   assert.ok(!calls.some(c=>c.a==='file-save'));assert.ok(!w.document.getElementById('desk-list-stats').textContent.includes('prepared'));
  }finally{dom.window.close()}
 }
});

test('a changed Help Desk search is fetched after an in-flight page and never shows the stale rows',async()=>{
 const t=desk(),{w,dom,calls}=t;let deliver;
 try{
  t.setBehavior(async(action,payload)=>payload.search==='Newest'?{records:[],total:0,stats:{total:0,pending:0,approved:0}}:new Promise(r=>deliver=()=>r({records:[{id:'old',ticket_id:'HDABCDEF',created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details,status:'pending',version:1}],total:1,stats:{total:1,pending:1,approved:0}})));
  const first=w.NavrangDesk.refresh(true);w.document.getElementById('desk-search').value='Newest';await w.NavrangDesk.refresh(true);deliver();await first;await pause();
  assert.equal(calls.filter(c=>c.a==='helpdesk-list').length,2);assert.equal(calls.at(-1).p.search,'Newest');assert.ok(!w.document.getElementById('desk-records').textContent.includes(details.name));assert.equal(w.document.getElementById('desk-total').textContent,'0');
 }finally{dom.window.close()}
});

test('an unconfirmed save locks record navigation until its identical request is resolved',async()=>{
 const t=desk(),{w,dom,calls}=t;let attempt=0;
 try{
  t.setBehavior(async()=>{if(++attempt===1)throw Error('Connection lost');return{registration:{ticket_id:'HDABCDEF'}}});
  const form=w.document.getElementById('desk-form');await form.onsubmit({preventDefault(){}});
  for(const id of ['desk-new','desk-saved','desk-close-record'])assert.equal(w.document.getElementById(id).disabled,true,id+' allowed an uncertain save to be discarded');
  w.document.getElementById('desk-new').click();w.document.getElementById('desk-saved').click();assert.equal(w.document.getElementById('desk-name').value,details.name);assert.equal(form.dataset.pending,'true');
  await form.onsubmit({preventDefault(){}});assert.deepEqual(calls[0].p,calls[1].p);assert.equal(form.dataset.pending,'false');for(const id of ['desk-new','desk-saved','desk-close-record'])assert.equal(w.document.getElementById(id).disabled,false);
 }finally{dom.window.close()}
});

test('a rejected save unlocks navigation without keeping a false pending marker',async()=>{
 const t=desk(),{w,dom}=t;try{
  t.setBehavior(async()=>{const e=Error('Already saved');e.status=409;throw e});await w.document.getElementById('desk-form').onsubmit({preventDefault(){}});
  assert.equal(w.document.getElementById('desk-form').dataset.pending,'false');assert.equal(w.document.getElementById('desk-saved').disabled,false);assert.equal(w.document.getElementById('desk-name').value,details.name);
 }finally{dom.window.close()}
});

test('a completed review cannot close or overwrite a newer record review dialog',async()=>{
 const t=desk({role:'admin',name:'namdev',active:true}),{w,dom}=t;let deliver;
 const records=[1,2].map(n=>({id:'case-'+n,ticket_id:'HDABCDE'+n,created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details:{...details,name:'Student '+n},status:'pending',version:1}));
 t.setBehavior(async action=>action==='helpdesk-list'?{records,total:2,stats:{total:2,pending:2,approved:0}}:new Promise(r=>deliver=()=>r({saved:true})));
 try{
  await w.NavrangDesk.refresh(true);w.document.querySelectorAll('#desk-records .button')[0].click();w.document.getElementById('desk-confirm-existing').checked=true;w.document.getElementById('desk-approve').click();
  w.document.getElementById('desk-review-close').click();w.document.querySelectorAll('#desk-records .button')[1].click();deliver();await pause();await pause();
  assert.equal(w.document.getElementById('desk-review-dialog').open,true);assert.equal(w.document.getElementById('desk-review-name').textContent,'Student 2');assert.equal(w.document.getElementById('desk-review-message').textContent,'');
 }finally{dom.window.close()}
});

function scrollDesk(t){const box=t.w.document.getElementById('desk-records');Object.defineProperty(box,'clientHeight',{configurable:true,value:300});Object.defineProperty(box,'scrollHeight',{configurable:true,value:3000});box.scrollTop=2800;box.dispatchEvent(new t.w.Event('scroll'));return box;}
function deskRows(count=19){return Array.from({length:count},(_,n)=>({id:'case-'+n,ticket_id:'HD'+String(n).padStart(6,'0'),created_by_name:'Raju',created_at:'2026-10-17T01:00:00Z',details:{...details,name:'Student '+n},status:'pending',version:1}));}
function listReply(records,query){const matches=records.filter(r=>!query.search||r.details.name.includes(query.search));return{records:matches.slice(query.offset,query.offset+query.limit),total:matches.length,stats:{total:records.length,pending:records.length,approved:0}};}

test('Help Desk appends authorized eight-row batches with honest loaded/server counts and stable cards',async()=>{
 const t=desk(),{w,dom,calls}=t,records=deskRows();t.setBehavior(async(action,query)=>listReply(records,query));try{
  await w.NavrangDesk.refresh(true);const first=w.document.querySelector('.desk-record');assert.equal(w.document.querySelectorAll('.desk-record').length,8);assert.match(w.document.getElementById('desk-list-status').textContent,/8 loaded · 19 matching server records/);
  const box=scrollDesk(t);await pause();assert.equal(w.document.querySelectorAll('.desk-record').length,16);assert.equal(w.document.querySelector('.desk-record'),first);const top=box.scrollTop;
  await w.NavrangDesk.refresh(true);assert.equal(w.document.querySelector('.desk-record'),first);assert.equal(box.scrollTop,top);assert.equal(w.document.querySelectorAll('.desk-record').length,16);
  scrollDesk(t);await pause();assert.equal(w.document.querySelectorAll('.desk-record').length,19);assert.match(w.document.getElementById('desk-list-status').textContent,/19 loaded · 19 matching server records/);assert.ok(!w.document.getElementById('desk-list-status').textContent.includes('Scroll for more'));assert.ok(calls.filter(c=>c.a==='helpdesk-list').every(c=>c.p.limit===8));
  w.dispatchEvent(new w.Event('resize'));await pause();assert.equal(w.document.querySelectorAll('.desk-record').length,19);
 }finally{await pause();dom.window.close()}
});

test('Help Desk search runs on the server and fences an older in-flight append',async()=>{
 const t=desk(),{w,dom,calls}=t,records=deskRows();let deliver;t.setBehavior(async(action,query)=>query.offset?new Promise(resolve=>deliver=()=>resolve(listReply(records,query))):listReply(records,query));try{
  await w.NavrangDesk.refresh(true);scrollDesk(t);await pause();const input=w.document.getElementById('desk-search');input.value='Student 18';input.dispatchEvent(new w.Event('input'));await w.NavrangDesk.refresh(true);deliver();await pause();await pause();
  assert.equal(w.document.querySelectorAll('.desk-record').length,1);assert.match(w.document.getElementById('desk-records').textContent,/Student 18/);assert.match(w.document.getElementById('desk-list-status').textContent,/1 loaded · 1 matching server records/);assert.equal(calls.filter(c=>c.a==='helpdesk-list').at(-1).p.search,'Student 18');
 }finally{await pause();dom.window.close()}
});

test('Help Desk detects changed offset ordering and requires refresh rather than silently duplicating or skipping rows',async()=>{
 const t=desk(),{w,dom,calls}=t,records=deskRows();t.setBehavior(async(action,query)=>listReply(records,query));try{
  await w.NavrangDesk.refresh(true);scrollDesk(t);await pause();const first=w.document.querySelector('.desk-record');records.unshift({...records[0],id:'new-record',ticket_id:'HD999999',details:{...details,name:'New arrival'}});await w.NavrangDesk.refresh(true);
  assert.equal(w.document.querySelectorAll('.desk-record').length,16);assert.equal(w.document.querySelector('.desk-record'),first);assert.match(w.document.getElementById('desk-list-status').textContent,/16 loaded · 20 matching server records · Records changed/);
  const count=calls.length;scrollDesk(t);await pause();assert.equal(calls.length,count);w.document.getElementById('desk-refresh').click();await pause();assert.equal(w.document.querySelectorAll('.desk-record').length,8);assert.match(w.document.querySelector('.desk-record').textContent,/New arrival/);assert.equal(w.document.getElementById('desk-records').scrollTop,0);
 }finally{await pause();dom.window.close()}
});

test('Help Desk revocation discards an in-flight appended page and prevents cached rows returning',async()=>{
 const t=desk(),{w,dom}=t,records=deskRows();let deliver;t.setBehavior(async(action,query)=>query.offset?new Promise(resolve=>deliver=()=>resolve(listReply(records,query))):listReply(records,query));try{
  await w.NavrangDesk.refresh(true);scrollDesk(t);await pause();t.setProfile(null);w.NavrangDesk.clear();deliver();await pause();scrollDesk(t);await pause();assert.equal(w.document.getElementById('desk-records').children.length,0);assert.equal(w.document.getElementById('desk-search').value,'');
 }finally{await pause();dom.window.close()}
});

test('Help Desk viewport filling stops after a failed append instead of retrying every animation frame',async()=>{
 const t=desk(),{w,dom,calls}=t,records=deskRows(),frames=[];w.requestAnimationFrame=callback=>frames.push(callback);t.setBehavior(async(action,query)=>{if(query.offset)throw Error('Offline');return listReply(records,query)});try{
  w.document.getElementById('view-desk').hidden=false;w.document.getElementById('desk-list-panel').hidden=false;const box=w.document.getElementById('desk-records');Object.defineProperty(box,'clientHeight',{value:1000});Object.defineProperty(box,'scrollHeight',{value:500});
  await w.NavrangDesk.refresh(true);assert.equal(frames.length,1);frames.shift()();await pause();assert.equal(calls.filter(c=>c.a==='helpdesk-list').length,2);assert.equal(frames.length,0);assert.match(w.document.getElementById('desk-list-stats').textContent,/Offline/);assert.equal(box.getAttribute('aria-busy'),'false');
 }finally{await pause();dom.window.close()}
});

test('Help Desk rejects a stale admin page if the same account loses its admin role before response',async()=>{
 const t=desk({role:'admin',checkerId:'same-user',name:'Administrator',active:true}),{w,dom}=t;let deliver;t.setBehavior(async(action,query)=>new Promise(resolve=>deliver=()=>resolve(listReply(deskRows(),query))));try{
  const pending=w.NavrangDesk.refresh(true);t.setProfile({role:'checker',checkerId:'same-user',name:'Staff',active:true,helpdesk:true,station:'helpdesk'});deliver();await pending;assert.equal(w.document.getElementById('desk-records').children.length,0);
 }finally{await pause();dom.window.close()}
});

test('Help Desk enables bounded list mode only while showing saved records',async()=>{
 const t=desk(),{w,dom}=t;try{w.document.getElementById('desk-saved').click();await pause();assert.equal(w.document.getElementById('view-desk').classList.contains('desk-list-mode'),true);w.document.getElementById('desk-new').click();assert.equal(w.document.getElementById('view-desk').classList.contains('desk-list-mode'),false);w.document.getElementById('desk-saved').click();await pause();w.NavrangDesk.clear();assert.equal(w.document.getElementById('view-desk').classList.contains('desk-list-mode'),false)}finally{await pause();dom.window.close()}
});
