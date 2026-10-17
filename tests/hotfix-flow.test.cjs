// Exercise the real UI + client + Help Desk together, including native callback ordering.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),asset=name=>fs.readFileSync(path.join(root,'app/assets',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let n=0;n<40;n++){if(predicate())return;await tick()}throw Error('UI operation did not finish')}
function nativeApp(initial){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[];
 let profile=initial,intercept;const stats={ownScans:3,totalEntries:20};
 w.matchMedia=()=>({matches:true});w.setInterval=()=>0;
 const reply=(id,body)=>w.onApiResponse(JSON.stringify({id,status:200,body:{ok:true,...body}}));
 const emit=(type,data)=>w.onGateEvent(JSON.stringify({type,data}));
 w.Native={
  local(action){return JSON.stringify({ok:true,data:action==='session'?{profile}:{dataRevision:-1,cursor:0,records:{},entries:[],stats,pending:0,localCount:0}})},
  api(action,value,id){const payload=JSON.parse(value);calls.push({action,payload});queueMicrotask(()=>{
   if(intercept?.(action,payload,id))return;
   if(action==='config')reply(id,{googleEnabled:true});
   else if(action==='me')reply(id,profile);
   else if(action==='sync')reply(id,profile.role==='admin'?{dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]}:{staffSummary:true,scanner:profile.scanner,dataRevision:-1,cursor:0,records:null,entries:[],stats});
   else if(action==='helpdesk-list')reply(id,{records:[],total:0,stats:{total:0,pending:0,approved:0}});
   else reply(id,{saved:true});
  })},feedback(){},readiness(){return '{}'},update(){return '{}'},destination(){return 'home'},scan(){calls.push({action:'camera'})},submit(id){calls.push({action:'submit',id})}
 };
 for(const name of ['live-core.js','desk-core.js','config.js','client.js','desk.js','gate.js'])w.eval(asset(name));
 return{dom,w,calls,$:id=>w.document.getElementById(id),reply,emit,setProfile:p=>{profile=p},intercept:f=>{intercept=f}};
}
const admin={role:'admin',name:'namdev',active:true};
test('admin can open the station chooser and switch to either working view',async()=>{
 const t=nativeApp(admin),{$}=t;try{
  await until(()=>t.calls.some(c=>c.action==='sync'));await tick();
  $('station-nav').click();assert.equal($('view-station').hidden,false,'station chooser bounced back to admin');
  $('station-helpdesk').click();await tick();assert.equal($('view-desk').hidden,false);
  $('station-nav').click();$('station-checker').click();await tick();assert.equal($('view-home').hidden,false);assert.ok(t.calls.some(c=>c.action==='camera'));
 }finally{await tick();t.dom.window.close()}
});
test('native background profile arrival during name save does not leave the dialog stuck',async()=>{
 const first={role:'checker',checkerId:'synthetic',name:'Raju',method:'google',nameConfirmed:false,active:true,station:'checker',scanner:true,helpdesk:false};
 const t=nativeApp(first),{$,w}=t;try{
  await until(()=>t.calls.some(c=>c.action==='me'));await tick();$('skip-intro').click();
  // Opening after the intro models the real native profile event and name form.
  $('change-name').click();assert.equal($('name-dialog').open,true);
  t.intercept((action,payload,id)=>{if(action!=='checker-profile')return false;const next={...first,name:payload.name,nameConfirmed:true};t.setProfile(next);t.emit('profile',next);t.reply(id,{saved:true});return true});
  $('real-name').value='Raju Naik';$('name-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();await tick();
  assert.equal($('name-dialog').open,false,'successful save left a mandatory dialog open');assert.equal($('view-home').hidden,false);assert.doesNotMatch($('notice').textContent,/access changed/);
 }finally{await tick();t.dom.window.close()}
});
test('native station save accepts its own background profile transition',async()=>{
 const first={role:'checker',checkerId:'synthetic',name:'Raju',method:'google',nameConfirmed:true,active:true,station:'',scanner:true,helpdesk:true};
 const t=nativeApp(first),{$}=t;try{
  await until(()=>t.calls.some(c=>c.action==='me'));await tick();
  t.intercept((action,payload,id)=>{if(action!=='staff-request')return false;const next={...first,station:payload.station};t.setProfile(next);t.emit('profile',next);t.reply(id,{requested:payload.station});return true});
  $('station-helpdesk').click();await tick();await tick();assert.equal($('view-desk').hidden,false);assert.doesNotMatch($('notice').textContent,/access changed/);assert.equal($('switch-station').hidden,true);
 }finally{await tick();t.dom.window.close()}
});
test('native self-profile acknowledgements remain blocked after identity changes',async()=>{
 const first={role:'checker',checkerId:'synthetic',name:'Raju',method:'google',nameConfirmed:true,active:true,station:'checker',scanner:true,helpdesk:false};
 const t=nativeApp(first);let deliver;try{
  await until(()=>t.calls.some(c=>c.action==='me'));await tick();
  t.intercept((action,payload,id)=>{if(action!=='checker-profile')return false;deliver=()=>t.reply(id,{saved:true});return true});
  const save=t.w.GateClient.api('checker-profile',{name:'Raju Naik'}),rejection=assert.rejects(save,/Sign-in changed/);await until(()=>deliver);
  const other={...first,checkerId:'different-synthetic',name:'Other checker'};t.setProfile(other);t.emit('auth',other);deliver();await rejection;
 }finally{await tick();t.dom.window.close()}
});
test('native private Help Desk results remain blocked after station access changes',async()=>{
 const first={role:'checker',checkerId:'synthetic',name:'Raju',active:true,station:'helpdesk',scanner:false,helpdesk:true};
 const t=nativeApp(first);let deliver;try{
  await until(()=>t.calls.some(c=>c.action==='me'));await tick();
  t.intercept((action,payload,id)=>{if(action!=='helpdesk-export')return false;deliver=()=>t.reply(id,{csv:'synthetic private contact'});return true});
  const result=t.w.GateClient.api('helpdesk-export'),rejection=assert.rejects(result,e=>e.status===403&&/access changed/.test(e.message));await until(()=>deliver);
  const next={...first,station:'checker',scanner:true,helpdesk:false};t.setProfile(next);t.emit('profile',next);deliver();await rejection;
 }finally{await tick();t.dom.window.close()}
});
