const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function nativeClient(initial){
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 let current=initial,reads=0,request;
 w.Native={local(action){assert.equal(action,'session');reads++;return JSON.stringify({ok:true,data:{profile:current}})},api(action,payload,id){request=id;if(action==='logout')current=null}};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 return{dom,w,setProfile:p=>{current=p},reads:()=>reads,reply(body,status=200){w.onApiResponse(JSON.stringify({id:request,status,body}))},event(type,data){w.onGateEvent(JSON.stringify({type,data}))}};
}

test('native admin reconciliation reads the authorized RAM projection without another HTTP request',async()=>{
 const t=nativeClient({role:'admin',name:'Namdev',active:true});try{
  const calls=[];t.w.Native.local=(action,payload)=>{calls.push(action);return JSON.stringify({ok:true,data:action==='session'?{generation:7,profile:{role:'admin',name:'Namdev',active:true}}:{ownerGeneration:7,dataRevision:12,cursor:4,records:[{id:'TICKET01'}],entries:[],stats:{total:1},checkers:[]}})};
  t.w.Native.api=()=>{throw Error('Native UI started a duplicate HTTP request')};
  const value=await t.w.GateClient.sync({dataRevision:-1,afterSeq:0});
  assert.equal(value.records[0].id,'TICKET01');assert.ok(calls.includes('admin-snapshot'));
 }finally{t.dom.window.close()}
});

test('native cached admin data is rejected and cleared after canonical role or identity changes',async()=>{
 for(const change of ['role','identity']){
  const t=nativeClient({role:'admin',name:'Namdev',active:true});try{
   let snapshotRead=false;
   t.w.Native.local=(action)=>JSON.stringify({ok:true,data:action==='session'?{generation:snapshotRead&&change==='identity'?8:7,profile:snapshotRead&&change==='role'?{role:'checker',checkerId:'staff',name:'Staff',active:true,scanner:true}:{role:'admin',name:'Namdev',active:true}}:(snapshotRead=true,{ownerGeneration:7,dataRevision:1,cursor:0,records:[{id:'PRIVATE1'}],entries:[],stats:{},checkers:[]})});
   const events=[];t.w.GateClient.on(e=>events.push(e.type));
   await assert.rejects(t.w.GateClient.sync({dataRevision:-1,afterSeq:0}),/access|sign-in|identity/i);
   assert.ok(events.includes(change==='identity'?'auth':'profile'));
  }finally{t.dom.window.close()}
 }
});
test('private invalidation refreshes canonical access before notifying dependent views',()=>{
 const t=nativeClient({role:'admin',name:'Namdev',active:true});try{
  assert.equal(t.w.GateClient.profile().role,'admin');const events=[];t.w.GateClient.on(e=>events.push(e));
  t.setProfile({role:'checker',checkerId:'synthetic',name:'Staff',active:false,scanner:false});
  t.event('data-invalidated',{domain:'helpdesk'});
  assert.equal(t.w.GateClient.profile().active,false);
  assert.equal(events[0].type,'profile','dependent private view was notified before canonical role loss');
  assert.equal(events.at(-1).type,'data-invalidated');assert.equal(t.reads(),2,'hint must use a local vault read, not HTTP');
 }finally{t.dom.window.close()}
});

test('private find-me revisions emit one scoped metadata hint without coordinates',async()=>{
 const person='00000000-0000-4000-8000-000000000001',event='00000000-0000-4000-8000-000000000008';
 const t=nativeClient({role:'checker',checkerId:person,active:true,scanner:true});try{
  const hints=[];t.w.GateClient.on(e=>{if(e.type==='locator-invalidated')hints.push(e.data)});
  const feed=(revision,kind='find-me')=>({ok:true,revision,activeIds:[event],items:[{id:event,revision,kind}]});
  let pending=t.w.GateClient.api('notifications-feed');t.reply(feed(10));await pending;await Promise.resolve();
  assert.equal(hints.length,1);assert.equal(hints[0].principal,person);assert.equal(hints[0].eventId,'O9KL3');
  assert.deepEqual(Object.keys(hints[0]).sort(),['eventId','principal','revision']);
  pending=t.w.GateClient.api('notifications-feed');t.reply(feed(10));await pending;await Promise.resolve();assert.equal(hints.length,1);
  pending=t.w.GateClient.api('notifications-feed');t.reply(feed(11,'announcement'));await pending;await Promise.resolve();assert.equal(hints.length,1);
  pending=t.w.GateClient.api('notifications-feed');t.reply(feed(12));await pending;await Promise.resolve();assert.equal(hints.length,2);
 }finally{t.dom.window.close()}
});

test('native one-shot location bridge resolves only its bounded operation result',async()=>{
 const t=nativeClient({role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',active:true,scanner:true});try{
  const calls=[];t.w.Native.locator=(action,payload)=>calls.push({action,payload:JSON.parse(payload)});
  assert.equal(typeof t.w.GateClient.locatorSample,'function');
  const pending=t.w.GateClient.locatorSample({});const command=calls[0];assert.equal(command.action,'sample');assert.match(command.payload.operationId,/^[0-9a-f-]{36}$/);
  t.w.onNativeLocatorResult(JSON.stringify({operationId:command.payload.operationId,ok:true,fix:{latitude:15.49,longitude:73.82,accuracy:20,capturedAt:'2026-10-25T17:30:00.000Z'}}));
  const fix=await pending;assert.equal(fix.latitude,15.49);assert.equal(calls.length,1);
 }finally{t.dom.window.close()}
});
test('aborting one-shot location sends one cancellation and ignores late coordinates',async()=>{
 const t=nativeClient({role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',active:true,scanner:true});try{
  const calls=[];t.w.Native.locator=(action,payload)=>calls.push({action,payload:JSON.parse(payload)});
  assert.equal(typeof t.w.GateClient.locatorSample,'function');const controller=new t.w.AbortController();
  const pending=t.w.GateClient.locatorSample({signal:controller.signal}),rejected=assert.rejects(pending,/cancel|abort/i);
  controller.abort();await rejected;assert.equal(calls.filter(x=>x.action==='cancel').length,1);
  t.w.onNativeLocatorResult(JSON.stringify({operationId:calls[0].payload.operationId,ok:true,fix:{latitude:15.49,longitude:73.82,accuracy:20,capturedAt:'2026-10-25T17:30:00.000Z'}}));
  assert.equal(calls.length,2);
 }finally{t.dom.window.close()}
});
test('one-shot location cancels immediately when canonical access is lost',async()=>{
 const t=nativeClient({role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',active:true,scanner:true});try{
  const calls=[];t.w.Native.locator=(action,payload)=>calls.push({action,payload:JSON.parse(payload)});
  assert.equal(typeof t.w.GateClient.locatorSample,'function');const pending=t.w.GateClient.locatorSample({}),rejected=assert.rejects(pending,/access|sign-in/i);
  t.setProfile(null);t.event('auth',{});await rejected;assert.equal(calls.at(-1).action,'cancel');
 }finally{t.dom.window.close()}
});
test('malformed native coordinates cannot become a share-once sample',async()=>{
 const t=nativeClient({role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',active:true,scanner:true});try{
  let operation;t.w.Native.locator=(action,payload)=>{operation=JSON.parse(payload).operationId};
  assert.equal(typeof t.w.GateClient.locatorSample,'function');const pending=t.w.GateClient.locatorSample({}),rejected=assert.rejects(pending,/location|sample/i);
  t.w.onNativeLocatorResult(JSON.stringify({operationId:operation,ok:true,fix:{latitude:91,longitude:73.82,accuracy:20,capturedAt:'2026-10-25T17:30:00.000Z'}}));await rejected;
 }finally{t.dom.window.close()}
});
test('repeated native UI profile checks use one bridge read and cannot mutate cached permissions',()=>{
 const t=nativeClient({role:'checker',name:'Raju',active:true,scanner:false,station:'helpdesk'});try{
  for(let i=0;i<100;i++)assert.equal(t.w.GateClient.profile().scanner,false);
  assert.equal(t.reads(),1,'rendering repeatedly crossed the synchronous Android bridge');
  t.w.GateClient.profile().scanner=true;
  assert.equal(t.w.GateClient.profile().scanner,false,'a caller changed the cached permissions');
 }finally{t.dom.window.close()}
});
test('native profile events and API completions refresh the cached canonical session',async()=>{
 const original={role:'checker',checkerId:'staff',name:'Raju',active:true,scanner:true,station:'checker'},t=nativeClient(original);try{
  assert.equal(t.w.GateClient.profile().scanner,true);
  const reassigned={...original,scanner:false,helpdesk:true,station:'helpdesk'};
  t.setProfile(reassigned);t.event('profile',reassigned);
  assert.equal(t.w.GateClient.profile().scanner,false);
  const request=t.w.GateClient.api('me');t.setProfile({...reassigned,name:'Raju Naik'});t.reply({ok:true,...reassigned,name:'Raju Naik'});await request;
  assert.equal(t.w.GateClient.profile().name,'Raju Naik','API-only refresh stayed stale');
  t.setProfile(null);t.event('auth',{});t.event('profile',original);
  assert.equal(t.w.GateClient.profile(),null,'a queued old event resurrected the signed-out profile');
 }finally{t.dom.window.close()}
});
test('native logout clears the displayed identity before its network acknowledgement',async()=>{
 const t=nativeClient({role:'admin',name:'namdev',active:true});try{
  assert.equal(t.w.GateClient.profile().role,'admin');
  const pending=t.w.GateClient.signOut();assert.equal(t.w.GateClient.profile(),null);
  t.reply({ok:true,signedOut:true});await pending;
 }finally{t.dom.window.close()}
});
test('native API completion checks canonical permissions before a queued profile event arrives',async()=>{
 const t=nativeClient({role:'admin',name:'namdev',active:true});try{
  const request=t.w.GateClient.api('helpdesk-export'),denied=assert.rejects(request,e=>e.status===403&&/access changed/.test(e.message));
  t.setProfile(null);t.reply({ok:true,csv:'private synthetic contact'});await denied;
  assert.equal(t.w.GateClient.profile(),null);
 }finally{t.dom.window.close()}
});
test('a failed forced-region request retries future calls with automatic region selection',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window,seen=[];
 w.fetch=async(url)=>{seen.push(url);return new Response(JSON.stringify(seen.length===1?{ok:false,error:'Region unavailable'}:{ok:true,googleEnabled:false}),{status:seen.length===1?503:200,headers:{'Content-Type':'application/json'}})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{await assert.rejects(w.GateClient.api('config'),/Region unavailable/);await w.GateClient.api('config');assert.ok(seen[0].includes('forceFunctionRegion=ap-south-1'));assert.equal(seen[1].includes('forceFunctionRegion'),false)}finally{w.close()}
});

test('Google provider errors in query or fragment explain setup without exposing credentials or codes',async()=>{
 for(const suffix of ['?error=server_error&error_description=Unable+to+exchange+external+code%3A+SECRET-CODE','#error=server_error&error_code=unexpected_failure']){
  const dom=new JSDOM('',{url:'https://gate.test/'+suffix,runScripts:'outside-only'}),w=dom.window;w.sessionStorage.setItem('navrang-pkce','test-only');
  for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
  try{await assert.rejects(w.GateClient.finishGoogle(),e=>/client secret/.test(e.message)&&!/cancelled|SECRET-CODE/.test(e.message));assert.equal(w.sessionStorage.getItem('navrang-pkce'),null);assert.equal(w.location.href,'https://gate.test/')}finally{w.close()}
 }
});
test('scan audio plays a bundled sample even when an old caller passes mute false',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;let started=0,paths=[];
 w.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={}}decodeAudioData(){return Promise.resolve({})}createBufferSource(){return{connect(){},start(){started++},stop(){}}}createGain(){return{gain:{},connect(){}}}};
 w.fetch=async url=>{paths.push(url);return{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{w.GateClient.feedback('scan',false);await new Promise(r=>setImmediate(r));assert.equal(started,1);assert.deepEqual(paths,['audio/scan.ogg']);w.GateClient.feedback('scan',false);await new Promise(r=>setImmediate(r));assert.equal(started,2);assert.equal(paths.length,1)}finally{w.close()}
});

test('the Android bridge rejects late private responses after its auth session changes',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;let request;
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile:{role:'admin',active:true}}}),api:(action,payload,id)=>request=id};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{
  const pending=w.GateClient.api('helpdesk-export'),denied=assert.rejects(pending,/Sign-in changed/);
  w.onGateEvent(JSON.stringify({type:'auth',data:null}));w.onApiResponse(JSON.stringify({id:request,status:200,body:{ok:true,csv:'private test contact'}}));await denied;
 }finally{w.close()}
});

test('the Android bridge rejects a late private response after station permission changes',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;let request,profile={role:'checker',checkerId:'staff',active:true,helpdesk:true,scanner:false,station:'helpdesk'};
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile}}),api:(action,payload,id)=>request=id};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{
  const pending=w.GateClient.api('helpdesk-list'),denied=assert.rejects(pending,e=>e.status===403&&/access changed/.test(e.message));profile={...profile,helpdesk:false,scanner:true,station:'checker'};
  w.onGateEvent(JSON.stringify({type:'profile',data:profile}));w.onApiResponse(JSON.stringify({id:request,status:200,body:{ok:true,records:[{details:{email:'private@example.invalid'}}]}}));await denied;
 }finally{w.close()}
});


test('browser update status does not invent an installed Android version',()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{assert.equal(w.GateClient.native,false);assert.equal(w.GateClient.update().currentVersion,null);assert.match(w.GateClient.update().message,/Android app/)}finally{w.close()}
});
