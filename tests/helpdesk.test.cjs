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
