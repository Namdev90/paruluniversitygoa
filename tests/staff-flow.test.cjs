const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),asset=n=>fs.readFileSync(root+'/app/assets/'+n,'utf8'),tick=()=>new Promise(r=>setImmediate(r));
function setup(initial,{native=false,crew=[]}={}){
 let profile=initial,listener,destination='home';const calls=[],dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.matchMedia=()=>({matches:true});w.eval(asset('live-core.js'));w.NavrangDesk={refresh:()=>{},clear:()=>{},hasDraft:()=>false};
 w.GateClient={native,profile:()=>profile,on:f=>listener=f,finishGoogle:async()=>{},feedback:()=>{},destination:value=>value?(destination=value):destination,local:async()=>({entries:[],stats:{},pending:0,localCount:0}),update:()=>({}),scan:()=>calls.push({action:'camera'}),submit:()=>calls.push({action:'checkin'}),googleLogin:async()=>calls.push({action:'google-browser'}),googleBrowserLogin:async()=>calls.push({action:'google-browser-fallback'}),signOut:async()=>{calls.push({action:'logout'});profile=null;listener?.({type:'auth',data:null})},copy:async text=>calls.push({action:'copy',text}),sync:async()=>{calls.push({action:'sync'});return{dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:crew}},api:async(action,payload={})=>{calls.push({action,payload});if(action==='config')return{googleEnabled:true};if(action==='checker-profile'){profile={...profile,name:payload.name,nameConfirmed:true};return{saved:true}}if(action==='staff-request'){profile={...profile,station:payload.station,requestedRole:profile.active?'':payload.station};return{requested:payload.station}}if(action==='me')return profile;if(action==='staff-create')return{code:'NG-SYNTHETIC-CODE'};return{saved:true}}};
 w.eval(asset('pagination.js'));w.eval(asset('gate.js'));return{w,dom,calls,setProfile:p=>profile=p,event:e=>listener(e),click:id=>w.document.getElementById(id).click(),$:(id)=>w.document.getElementById(id)};
}
function realNativeSignIn(){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 let profile=null,generation=0,loginRequest;
 w.matchMedia=()=>({matches:true});w.NavrangDesk={refresh:()=>{},clear:()=>{},hasDraft:()=>false};
 const response=(id,body,identityGeneration)=>w.onApiResponse(JSON.stringify({id,status:200,body,...(identityGeneration===undefined?{}:{identityGeneration})}));
 w.Native={
  local:action=>JSON.stringify({ok:true,data:action==='session'?{generation,profile}:{entries:[],stats:{},pending:0,localCount:0}}),
  api(action,payload,id){
   if(action==='checker-login'){loginRequest=id;generation++;return;}
   queueMicrotask(()=>response(id,action==='config'?{ok:true,googleEnabled:false}:action==='me'?{ok:true,...profile}:{ok:true}));
  }
 };
 for(const file of ['live-core.js','config.js','client.js','pagination.js','gate.js','auth-flow.js'])w.eval(asset(file));
 return{dom,w,$:id=>w.document.getElementById(id),complete({eventFirst,locked=false}){
  const signedIn={role:'checker',checkerId:'synthetic-staff',name:'Synthetic Staff',method:'code',active:true,scanner:true,station:'checker',nameConfirmed:true};
  profile=locked?null:signedIn;
  const event=()=>w.onGateEvent(JSON.stringify({type:'auth',data:signedIn}));
  if(eventFirst)event();response(loginRequest,{ok:true,profile:signedIn},generation);if(!eventFirst)event();
 }};
}
for(const eventFirst of [true,false])for(const locked of [true,false])test(`real native client clears the submitted staff code (${eventFirst?'event first':'response first'}, ${locked?'locked':'unlocked'})`,async()=>{
 const t=realNativeSignIn();try{
  await tick();t.$('skip-intro').click();t.$('checker-code').value='NG-SYNTHETIC-ONLY';
  t.$('checker-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));t.complete({eventFirst,locked});
  await tick();await tick();
  assert.equal(t.$('checker-code').value,'');
  assert.equal(t.w.GateClient.profile()===null,locked);
  assert.equal(t.$('view-home').hidden,locked);
  assert.equal(t.$('checker-form').querySelector('button').disabled,false);
 }finally{t.dom.window.close()}
});
test('Google stays available; the first station choice is saved and staff cannot choose again',async()=>{
 const t=setup(null,{native:true}),{w,dom,calls,$}=t;try{await tick();t.click('google-signin');await tick();assert.ok(calls.some(c=>c.action==='google-browser'));
 t.click('skip-intro');t.setProfile({role:'checker',checkerId:'test',name:'Google name',method:'google',nameConfirmed:false,active:true,scanner:true,helpdesk:true});t.event({type:'auth'});assert.equal($('name-dialog').open,true);
 $('real-name').value='Raju';$('name-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal($('view-station').hidden,false);assert.ok(!calls.some(c=>c.action==='camera'));
 t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);assert.ok(!calls.some(c=>c.action==='camera'));
 assert.equal($('switch-station').hidden,true);t.click('switch-station');t.click('station-checker');await tick();assert.equal($('view-desk').hidden,false);assert.equal(calls.filter(c=>c.action==='staff-request').length,1);assert.equal(calls.filter(c=>c.action==='camera').length,0);t.event({type:'auth'});assert.equal($('view-desk').hidden,false);
 }finally{await tick();await tick();dom.window.close()}
});

test('staff see only their own scan count and total admissions, with no entry-list route',async()=>{
 for(const role of ['checker','helpdesk']){
  const t=setup({role:'checker',checkerId:'staff',name:'Raju',active:true,station:role,scanner:role==='checker',helpdesk:role==='helpdesk'}),{dom,calls,$,w}=t;
  try{await tick();w.GateClient.local=async()=>({stats:{ownScans:7,totalEntries:200,total:1124,remaining:900},entries:[{name:'Must stay hidden',ticketId:'DEMO0001',checker:'Other person',seq:1,at:new Date().toISOString()}],localCount:1124});t.event({type:'sync'});await tick();
   assert.equal($('home-total-label').textContent,'My scans');assert.equal($('home-entered-label').textContent,'Total entries');assert.equal($('home-total').textContent,'7');assert.equal($('home-entered').textContent,'200');assert.equal($('desk-own-scans').textContent,'7');assert.equal($('desk-total-entries').textContent,'200');
   assert.equal($('home-remaining-card').hidden,true);assert.equal($('device-strip').hidden,true);assert.equal($('entries-nav').hidden,true);assert.equal($('recent-entries').textContent,'');t.click('entries-nav');assert.equal($('view-entries').hidden,true);
  }finally{await tick();dom.window.close()}
 }
});

test('an admin reassignment moves an existing staff session to the new station',async()=>{
 const t=setup({role:'checker',checkerId:'staff',name:'Raju',active:true,station:'checker',scanner:true,helpdesk:false}),{dom,$}=t;
 try{await tick();assert.equal($('view-home').hidden,false);t.setProfile({role:'checker',checkerId:'staff',name:'Raju',active:true,station:'helpdesk',scanner:false,helpdesk:true});t.event({type:'profile'});assert.equal($('view-desk').hidden,false);assert.equal($('view-station').hidden,true);assert.equal($('switch-station').hidden,true);
 }finally{await tick();dom.window.close()}
});
test('Help Desk-only staff open their saved station directly and cannot scan or check in',async()=>{
 const t=setup({role:'checker',checkerId:'desk',name:'Raju',method:'code',active:true,scanner:false,helpdesk:true}),{w,dom,calls,$}=t;try{await tick();assert.equal($('scan-nav').hidden,true);assert.equal($('entries-nav').hidden,true);
 t.click('scan');t.click('scan-nav');$('ticket-id').value='DEMO0001';$('manual-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal($('view-desk').hidden,false);assert.ok(!calls.some(c=>['camera','checkin'].includes(c.action)));
 t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);
 }finally{dom.window.close()}
});

test('browser ticket action focuses manual entry while Android retains camera tap and downward swipe',async()=>{
 const checker={role:'checker',checkerId:'synthetic',name:'Synthetic Checker',active:true,scanner:true,station:'checker'};
 for(const native of [false,true]){
  const t=setup(checker,{native}),{w,dom,calls,$}=t;try{
   await tick();
   const cameraCalls=()=>calls.filter(call=>call.action==='camera').length;
   const swipe=()=>{
    for(const [type,touches,changedTouches]of [['touchstart',[{identifier:1,clientX:150,clientY:100}],[]],['touchend',[],[{identifier:1,clientX:150,clientY:190}]]]){
     const event=new w.Event(type,{bubbles:true});Object.assign(event,{touches,changedTouches});$('pull-to-scan').dispatchEvent(event);
    }
   };
   assert.equal($('scan-action-title').textContent,native?'Start scanning':'Enter ticket ID');
   assert.equal($('scan-action-badge').hidden,!native);
   assert.equal($('scan').getAttribute('aria-label'),native?'Open continuous QR scanner':'Enter ticket ID manually');
   t.click('scan');
   assert.equal(cameraCalls(),native?1:0);
   assert.equal(w.document.activeElement===$('ticket-id'),!native);
   assert.equal(calls.some(call=>call.action==='checkin'),false);
   $('ticket-id').blur();swipe();assert.equal(cameraCalls(),native?2:0);
   t.event({type:'result',data:{code:'blocked',id:'DEMO0001',message:'Synthetic issue'}});
   assert.equal($('scan').disabled,true);t.click('scan');swipe();assert.equal(cameraCalls(),native?2:0);
   assert.notEqual(w.document.activeElement,$('ticket-id'));
  }finally{await tick();dom.window.close()}
 }
});

test('Account Settings offers manual update checks only in the Android host',async()=>{
 for(const native of [false,true]){
  const t=setup({role:'admin',name:'Synthetic Admin',active:true},{native}),{w,dom,$}=t;try{
   await tick();const actions=[],state=native?{currentVersion:'0.9.0',automatic:true}:{message:'App updates are managed in the Android app.'};
   w.GateClient.update=action=>{actions.push(action);return state};
   w.document.querySelector('#main-nav [data-view="account"]').click();t.click('account-settings');
   assert.equal($('view-settings').hidden,false);
   assert.equal($('admin-security').hidden,false);
   assert.ok($('view-settings').contains($('password-open')));
   assert.ok($('view-settings').contains($('check-update')));
   t.event({type:'update',data:state});
   assert.equal($('app-updates').hidden,!native);
   if(native)assert.equal($('update-message').textContent,'Your app is up to date.');
   t.click('check-update');
   assert.deepEqual(actions,native?['check']:[]);
   if(native){
    t.click('account-tool-back');t.event({type:'update',data:{...state,available:true,versionName:'0.9.1'}});
    assert.equal($('view-settings').hidden,true);t.click('account-settings');
    assert.equal($('view-settings').hidden,false);
    assert.equal($('install-update').textContent,'Download 0.9.1');
   }
  }finally{await tick();dom.window.close()}
 }
});

test('a station request never self-authorizes; approved access appears on the existing session',async()=>{
 const pending={role:'checker',checkerId:'pending',name:'Raju',method:'google',nameConfirmed:true,active:false,scanner:false,helpdesk:false};const t=setup(pending),{dom,calls,$}=t;
 try{await tick();t.click('station-helpdesk');await tick();assert.equal(calls.find(c=>c.action==='staff-request').payload.station,'helpdesk');assert.equal($('station-helpdesk').disabled,true);assert.equal($('view-desk').hidden,true);assert.ok(!calls.some(c=>c.action==='sync'));
 t.setProfile({...pending,station:'helpdesk',active:true,helpdesk:true,requestedRole:''});t.event({type:'profile'});assert.equal($('station-helpdesk').disabled,false);assert.match($('station-helpdesk-action').textContent,/Open Help Desk/);t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);
 }finally{dom.window.close()}
});
test('admin assigns a requested station, saves the real name and creates a role-specific staff code',async()=>{
 const crew=[{id:'12345678-1234-4234-9234-123456789abc',name:'Raju',method:'google',active:false,scanner:false,helpdesk:false,requestedRole:'helpdesk',entries:0}];const t=setup({role:'admin',name:'namdev',active:true},{crew}),{w,dom,calls,$}=t;
 try{await tick();w.document.querySelector('#checker-list button').click();assert.equal($('staff-role').value,'helpdesk');$('staff-name').value='Raju Naik';$('staff-active').checked=true;$('staff-access-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 const saved=calls.find(c=>c.action==='staff-update');assert.equal(saved.payload.name,'Raju Naik');assert.equal(saved.payload.active,true);assert.equal(saved.payload.scanner,false);assert.equal(saved.payload.helpdesk,true);
 t.click('open-code');$('new-checker-name').value='Raju';$('new-checker-role').value='helpdesk';$('create-checker-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();const created=calls.find(c=>c.action==='staff-create');assert.equal(created.payload.scanner,false);assert.equal(created.payload.helpdesk,true);assert.equal($('new-checker-code').textContent,'NG-SYNTHETIC-CODE');t.click('copy-code');await tick();assert.ok(calls.some(c=>c.action==='copy'&&c.text==='NG-SYNTHETIC-CODE'));
 }finally{dom.window.close()}
});

test('editing dual-station staff preserves both grants and new codes can grant both stations',async()=>{
 const crew=[{id:'12345678-1234-4234-9234-123456789abc',name:'Synthetic Staff',method:'google',active:true,scanner:true,helpdesk:true,station:'checker',entries:0}];
 const t=setup({role:'admin',name:'Synthetic Administrator',active:true},{crew}),{w,dom,calls,$}=t;
 try{await tick();w.document.querySelector('#checker-list button').click();assert.equal($('staff-role').value,'both');
  $('staff-name').value='Renamed Staff';$('staff-access-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  const saved=calls.find(c=>c.action==='staff-update');assert.equal(saved.payload.scanner,true);assert.equal(saved.payload.helpdesk,true);assert.equal(saved.payload.name,'Renamed Staff');
  t.click('open-code');$('new-checker-name').value='New Staff';$('new-checker-role').value='both';$('create-checker-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  const created=calls.find(c=>c.action==='staff-create');assert.equal(created.payload.scanner,true);assert.equal(created.payload.helpdesk,true);
 }finally{dom.window.close()}
});

test('original admin control opens the native importer and refreshes after completion; staff cannot invoke it',async()=>{
 const t=setup({role:'admin',name:'Synthetic Administrator',active:true},{native:true}),{w,dom,calls,$}=t;let opened=0;
 w.Native={importRegistrations:()=>opened++};
 try{await tick();assert.equal($('import-registration').hidden,false);t.click('import-registration');assert.equal(opened,1);
  const before=calls.filter(c=>c.action==='sync').length;t.event({type:'registrations-imported',data:{}});await tick();assert.equal(calls.filter(c=>c.action==='sync').length,before+1);
  t.setProfile({role:'checker',checkerId:'synthetic',name:'Synthetic Staff',active:true,scanner:true,station:'checker'});t.event({type:'profile'});t.click('import-registration');assert.equal(opened,1);
 }finally{dom.window.close()}
});

test('manual registration rejects invalid numeric values before saving and accepts valid values',async()=>{
 const t=setup({role:'admin',name:'Synthetic Administrator',active:true}),{w,dom,calls,$}=t;
 try{await tick();t.click('add-registration');$('edit-id').value='DEMO0001';$('edit-name').value='Synthetic Student';
  const submit=async()=>{$('ticket-editor').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick()};
  for(const invalid of [{amount:'-1'},{quantity:'0'},{quantity:'1.5'},{refund:'-1'}]){
   $('edit-amount').value=invalid.amount??'100';$('edit-quantity').value=invalid.quantity??'1';$('edit-refund').value=invalid.refund??'0';await submit();assert.ok(!calls.some(c=>c.action==='upsert'));
  }
  $('edit-amount').value='100.50';$('edit-quantity').value='2';$('edit-refund').value='0';await submit();
  const saved=calls.find(c=>c.action==='upsert');assert.equal(saved.payload.records[0].amount,100.5);assert.equal(saved.payload.records[0].quantity,2);assert.equal(saved.payload.records[0].refund,0);
 }finally{dom.window.close()}
});

test('restored screens hide private rows while retaining credentials until server expiry is confirmed',async()=>{
 for(const field of ['accessExpiresAt','expiresAt']){
  const profile={role:'admin',name:'Synthetic Administrator',active:true,[field]:new Date(Date.now()+60000).toISOString()};
  const t=setup(profile),{w,dom,calls,$}=t;
  try{await tick();$('registration-rows').textContent='Synthetic private registration';t.setProfile({...profile,[field]:new Date(Date.now()-1000).toISOString()});
   for(let i=0;i<20&&$('registration-rows').textContent;i++)await new Promise(r=>setTimeout(r,20));
   assert.ok(!calls.some(c=>c.action==='logout'));assert.equal($('registration-rows').textContent,'');assert.equal($('view-account').hidden,false);assert.ok(w.GateClient.profile());
  }finally{dom.window.close()}
 }
});

test('an import completed during an active poll coalesces one immediate incremental registration refresh',async()=>{
 const t=setup({role:'admin',name:'Synthetic Administrator',active:true},{native:true}),{w,dom,$}=t;
 try{await tick();let finish,requests=[];
  w.GateClient.sync=async options=>{requests.push(options);if(requests.length===1)return await new Promise(resolve=>finish=resolve);return{dataRevision:2,cursor:0,records:[{id:'DEMO0002',name:'Imported Synthetic Student',amount:100,quantity:1,refund:0,description:'Transaction completed successfully',eligible:true}],entries:[],stats:{},checkers:[]}};
  t.click('admin-refresh');await tick();t.event({type:'registrations-imported',data:{}});t.event({type:'registrations-imported',data:{}});await tick();assert.equal(requests.length,1);
  finish({dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]});
  for(let i=0;i<25&&!$('registration-rows').textContent.includes('Imported Synthetic Student');i++)await tick();
  assert.equal(requests.length,2);assert.equal(requests[1].dataRevision,1,'reuse the known revision instead of redownloading an unchanged master');assert.match($('registration-rows').textContent,/Imported Synthetic Student/);
 }finally{dom.window.close()}
});

test('the gate uses the same single Google action on Android and the website',async()=>{
 for(const native of [true,false]){
  const t=setup(null,{native});try{
   await tick();assert.equal(t.$('google-browser-signin'),null);
   t.click('google-signin');await tick();
   assert.equal(t.calls.filter(c=>c.action==='google-browser').length,1);
  }finally{t.dom.window.close()}
 }
});
