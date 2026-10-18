const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
function nativeClient(initial){
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;
 let current=initial,reads=0,request;
 w.Native={local(action){assert.equal(action,'session');reads++;return JSON.stringify({ok:true,data:{profile:current}})},api(action,payload,id){request=id;if(action==='logout')current=null}};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 return{dom,w,setProfile:p=>{current=p},reads:()=>reads,reply(body,status=200){w.onApiResponse(JSON.stringify({id:request,status,body}))},event(type,data){w.onGateEvent(JSON.stringify({type,data}))}};
}
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
