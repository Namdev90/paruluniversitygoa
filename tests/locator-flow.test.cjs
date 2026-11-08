const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const modulePath=path.join(__dirname,'../app/assets/locator.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const now=Date.parse('2026-10-25T17:30:00Z');
const staff={role:'checker',checkerId:id(1),name:'Synthetic Volunteer',active:true,scanner:true,helpdesk:false};
const admin={role:'admin',name:'Synthetic Administrator',active:true};
const status={eventId:'O9KL3',disclosureVersion:1,location:true,findMe:true,onDuty:true,version:1,expiresAt:new Date(now+1800000).toISOString()};
const request={requestId:id(8),volunteerId:id(1),administrator:'Namdev',delivery:'queued',state:'queued',expiresAt:new Date(now+120000).toISOString()};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(profile=staff,{adminHost=false,...options}={}){
 const dom=new JSDOM('<main><section id="view-account"></section>'+(adminHost?'<div id="admin-locator-host"></div>':'')+'</main>',{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,listeners=new Set(),calls=[];let current=profile;
 let handler=(action)=>action==='locator-status'?(profile.role==='admin'?{administrator:true,assigned:true}:status):{items:[]};
 const client={profile:()=>current,on:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},api:async(action,payload)=>{calls.push({action,payload});return handler(action,payload)}};
 if(fs.existsSync(modulePath))w.eval(fs.readFileSync(modulePath,'utf8'));
 assert.equal(typeof w.NavrangLocator?.mount,'function','The approved locator UI must exist');
 const component=w.NavrangLocator.mount({client,now:()=>now,...options});
 return {w,dom,calls,component,$:key=>w.document.getElementById(key),setHandler:fn=>handler=fn,setProfile:p=>{current=p;for(const fn of listeners)fn({type:'profile'})},event:e=>{for(const fn of listeners)fn(e)},close:()=>{component.destroy();dom.window.close()}};
}
test('post-login disclosure starts with separate unchecked choices and makes no permission requests',async()=>{
 let nativeCalls=0;const f=fixture(staff,{autoStart:false,onShareOnce:()=>nativeCalls++});
 try{
  f.setHandler(action=>action==='locator-status'?{...status,disclosureVersion:0,location:false,findMe:false,onDuty:false}:status);
  await f.component.refresh();
  assert.ok(f.$('locator-consent-dialog').open);
  assert.equal(f.$('locator-location-consent').checked,false);assert.equal(f.$('locator-findme-consent').checked,false);
  assert.match(f.$('locator-disclosure').textContent,/assigned event administrators/i);
  assert.match(f.$('locator-disclosure').textContent,/two minutes/i);
  assert.equal(nativeCalls,0);assert.equal(f.calls.some(x=>x.action==='locator-duty'),false);
  f.$('locator-continue-without').click();await tick();
  const sent=f.calls.find(x=>x.action==='locator-consent');assert.equal(sent.payload.location,false);assert.equal(sent.payload.findMe,false);
  assert.ok(f.$('view-account'));assert.equal(nativeCalls,0);
 }finally{f.close()}
});
test('choosing find-me alone does not opt into location or automatically start duty',async()=>{
 const f=fixture(staff,{autoStart:false});try{
  f.setHandler(action=>action==='locator-status'?{...status,disclosureVersion:0,location:false,findMe:false,onDuty:false}:{...status,location:false,findMe:true,onDuty:false});
  await f.component.refresh();f.$('locator-findme-consent').checked=true;f.$('locator-save-consent').click();await tick();
  const sent=f.calls.find(x=>x.action==='locator-consent');assert.equal(sent.payload.location,false);assert.equal(sent.payload.findMe,true);
  assert.equal(f.calls.some(x=>x.action==='locator-duty'||x.action==='locator-fix'),false);
 }finally{f.close()}
});
test('unchanged profiles and repeated refresh calls coalesce without adding a polling timer',async()=>{
 const f=fixture(staff,{autoStart:false});try{
  let resolve;f.setHandler(action=>action==='locator-status'?new Promise(r=>resolve=r):{items:[]});
  const one=f.component.refresh(),two=f.component.refresh();assert.equal(f.calls.length,1);resolve(status);await Promise.all([one,two]);
  const count=f.calls.length;f.setProfile({...staff});await tick();assert.equal(f.calls.length,count);
 }finally{f.close()}
});
test('role loss clears private requests and late responses cannot restore them',async()=>{
 const f=fixture(staff,{autoStart:false});try{
  let resolve;f.setHandler(action=>action==='locator-status'?status:new Promise(r=>resolve=r));
  const pending=f.component.refresh();await tick();f.setProfile(null);resolve({items:[request]});await pending;
  assert.equal(f.$('locator-panel'),null);assert.equal(f.$('locator-consent-dialog'),null);assert.doesNotMatch(f.w.document.body.textContent,/Namdev|Synthetic Volunteer/);
 }finally{f.close()}
});
test('Stop cancels a pending one-shot fix before any coordinates reach the server',async()=>{
 let resolve,signal;const f=fixture(staff,{autoStart:false,onShareOnce:options=>{signal=options.signal;return new Promise(r=>resolve=r)}});try{
  f.setHandler(action=>action==='locator-status'?status:action==='locator-stop'?{...status,onDuty:false}:{items:[]});
  await f.component.refresh();f.$('locator-share-once').click();await tick();assert.equal(signal.aborted,false);
  f.$('locator-stop').click();await tick();assert.equal(signal.aborted,true);
  resolve({latitude:15.49,longitude:73.82,accuracy:20,capturedAt:new Date(now).toISOString()});await tick();
  assert.equal(f.calls.some(x=>x.action==='locator-fix'),false);assert.match(f.$('locator-status').textContent,/off duty|stopped/i);
 }finally{f.close()}
});
test('find-me sound is voluntary, once-only and distinct from a device acknowledgement',async()=>{
 let sounds=0;const f=fixture(staff,{autoStart:false,onSound:()=>sounds++});try{
  f.setHandler(action=>action==='locator-status'?status:action==='locator-inbox'?{items:[request]}:{...request,state:'device-acknowledged',performAction:true});
  await f.component.refresh();assert.match(f.$('locator-inbox').textContent,/Namdev is trying to find you/);assert.equal(sounds,0);
  f.w.document.querySelector('[data-locator-sound]').click();await tick();assert.equal(sounds,1);
  f.w.document.querySelector('[data-locator-sound]').click();await tick();assert.equal(sounds,1);
  assert.equal(f.calls.filter(x=>x.action==='locator-respond').length,1);assert.doesNotMatch(f.$('locator-inbox').textContent,/found you/i);
  assert.equal(request.state,'queued','Rendering/actions must not mutate caller-owned feed objects');
 }finally{f.close()}
});
test('administrator roster fetches coordinates only for the one selected volunteer',async()=>{
 const f=fixture(admin,{autoStart:false});try{
  f.setHandler(action=>action==='locator-status'?{administrator:true,assigned:true}:action==='locator-roster'?{items:[{volunteerId:id(1),name:'First',location:true,findMe:true},{volunteerId:id(2),name:'Second',location:true,findMe:true}]}:{volunteerId:id(2),fix:null});
  await f.component.refresh();assert.equal(f.calls.some(x=>x.action==='locator-view'),false);
  f.w.document.querySelector('[data-locator-person="'+id(2)+'"]').click();await tick();
  const views=f.calls.filter(x=>x.action==='locator-view');assert.equal(views.length,1);assert.equal(views[0].payload.volunteerId,id(2));
  assert.match(f.$('locator-selected').textContent,/no current shared location/i);
 }finally{f.close()}
});
test('administrator Find Me has one dedicated host and volunteers keep Account consent',async()=>{
 const f=fixture(admin,{autoStart:false,adminHost:true});try{
  f.setHandler(action=>action==='locator-status'?{administrator:true,assigned:true}:action==='locator-roster'?{items:[{volunteerId:id(1),name:'Synthetic private volunteer',location:true,findMe:true}]}:{fix:null});
  await f.component.refresh();
  const retainedControl=f.$('locator-roster').querySelector('button');
  assert.equal(f.$('locator-panel').parentElement,f.$('admin-locator-host'));
  assert.equal(f.$('view-account').childElementCount,0);
  f.setProfile(staff);retainedControl.click();await tick();
  assert.equal(f.calls.some(x=>x.action==='locator-view'),false);
  assert.equal(f.$('admin-locator-host').childElementCount,0);
  assert.equal(f.$('locator-panel').parentElement,f.$('view-account'));
  assert.ok(f.$('locator-consent-dialog'));
 }finally{f.close()}
});
test('loss of event assignment removes selected coordinates and roster immediately',async()=>{
 const f=fixture(admin,{autoStart:false});try{
  let assigned=true;
  f.setHandler(action=>action==='locator-status'?{administrator:true,assigned}:action==='locator-roster'?{items:[{volunteerId:id(1),name:'Private volunteer',location:true,findMe:true}]}:{volunteerId:id(1),fix:{latitude:15.49,longitude:73.82,accuracy:20,capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()}});
  await f.component.refresh();f.w.document.querySelector('[data-locator-person]').click();await tick();assert.match(f.$('locator-selected').textContent,/15.490000/);
  assigned=false;await f.component.refresh();
  assert.equal(f.$('locator-selected').childElementCount,0);assert.equal(f.$('locator-roster').childElementCount,0);assert.doesNotMatch(f.$('locator-panel').textContent,/Private volunteer|15.490000/);
 }finally{f.close()}
});
test('scoped find-me invalidation reconciles acknowledgement for the selected administrator',async()=>{
 const f=fixture(admin,{autoStart:false});try{
  let current={...request};
  f.setHandler(action=>action==='locator-status'?{administrator:true,assigned:true,request:current}:action==='locator-roster'?{items:[{volunteerId:id(1),name:'Selected',location:false,findMe:true}]}:current);
  await f.component.refresh();f.w.document.querySelector('[data-locator-person]').click();await tick();
  [...f.$('locator-selected').querySelectorAll('button')].find(b=>b.textContent==='Request find-me').click();await tick();
  assert.match(f.$('locator-selected').textContent,/queued/);
  current={...request,state:'device-acknowledged',delivery:'sent'};
  f.event({type:'locator-invalidated',data:{eventId:'O9KL3',principal:'admin',revision:2}});await tick();await tick();
  assert.match(f.$('locator-selected').textContent,/Device acknowledged/);
 }finally{f.close()}
});
test('hidden find-me hints coalesce into one foreground reconciliation',async()=>{
 const f=fixture(staff,{autoStart:false});try{
  await f.component.refresh();const count=f.calls.length;
  Object.defineProperty(f.w.document,'hidden',{value:true,configurable:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));
  for(let i=1;i<=3;i++)f.event({type:'locator-invalidated',data:{eventId:'O9KL3',principal:staff.checkerId,revision:i}});
  await tick();assert.equal(f.calls.length,count);
  Object.defineProperty(f.w.document,'hidden',{value:false,configurable:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));await tick();await tick();
  assert.equal(f.calls.filter(x=>x.action==='locator-status').length,2);
 }finally{f.close()}
});
test('explicit locator permission denial clears private data without signing out station work',async()=>{
 const f=fixture(admin,{autoStart:false});try{
  let denied=false;
  f.setHandler(action=>{if(denied)throw Object.assign(Error('Event access removed'),{status:403});return action==='locator-status'?{administrator:true,assigned:true}:action==='locator-roster'?{items:[{volunteerId:id(1),name:'Private volunteer',location:true,findMe:true}]}:{volunteerId:id(1),fix:{latitude:15.49,longitude:73.82,accuracy:20,capturedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()}}});
  await f.component.refresh();f.w.document.querySelector('[data-locator-person]').click();await tick();assert.match(f.$('locator-selected').textContent,/15.490000/);
  denied=true;await f.component.refresh();
  assert.equal(f.$('locator-selected').childElementCount,0);assert.equal(f.$('locator-roster').childElementCount,0);assert.ok(f.$('view-account'));
 }finally{f.close()}
});

test('optional actions stay disabled until a successful initial duty-status response',async()=>{
 let samples=0;const f=fixture(staff,{autoStart:false,onShareOnce:()=>samples++});
 try{
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once'])assert.equal(f.$(id).disabled,true,id);
  assert.match(f.$('locator-status').textContent,/not been confirmed/i);
  assert.equal(f.$('locator-stop').hidden,true);
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once'])f.$(id).click();
  assert.equal(f.calls.length,0);assert.equal(samples,0);assert.equal(f.$('locator-consent-dialog').open,false);
  let release;f.setHandler(()=>new Promise(resolve=>release=resolve));
  const pending=f.component.refresh();
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once'])assert.equal(f.$(id).disabled,true,id);
  release({...status,onDuty:false});await pending;
  assert.equal(f.$('locator-review-consent').disabled,false);assert.equal(f.$('locator-start-duty').disabled,false);
  assert.equal(f.$('locator-share-once').disabled,true);assert.equal(samples,0);
 }finally{f.close()}
});

test('missing locator service keeps station work usable and optional actions off until retry succeeds',async()=>{
 const f=fixture(staff,{autoStart:false});
 try{
  f.setHandler(()=>{throw Object.assign(Error('Unsupported action'),{status:400})});await f.component.refresh();
  assert.ok(f.$('view-account'));assert.match(f.$('locator-message').textContent,/Unsupported action/);
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once']){assert.equal(f.$(id).disabled,true,id);f.$(id).click()}
  assert.deepEqual(f.calls.map(x=>x.action),['locator-status']);
  f.setHandler(action=>action==='locator-status'?status:{items:[]});await f.component.refresh();
  assert.equal(f.$('locator-review-consent').disabled,false);assert.equal(f.$('locator-share-once').disabled,false);
  assert.equal(f.$('locator-stop').hidden,false);assert.match(f.$('locator-status').textContent,/On duty/);assert.equal(f.$('locator-message').textContent,'');
 }finally{f.close()}
});

test('a replacement identity cannot reuse the previous duty readiness',async()=>{
 const f=fixture(staff,{autoStart:false});
 try{
  await f.component.refresh();assert.equal(f.$('locator-share-once').disabled,false);
  f.setProfile({...staff,checkerId:id(2),name:'Other synthetic volunteer'});
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once'])assert.equal(f.$(id).disabled,true,id);
  assert.match(f.$('locator-status').textContent,/not been confirmed/i);assert.equal(f.$('locator-stop').hidden,true);
 }finally{f.close()}
});

for(const denialStatus of [401,403])test(`duty-status ${denialStatus} closes an open optional consent dialog without changing station identity`,async()=>{
 const f=fixture(staff,{autoStart:false});
 try{
  const disclosure={...status,disclosureVersion:0,onDuty:false,location:false,findMe:false};
  f.setHandler(()=>disclosure);await f.component.refresh();
  assert.equal(f.$('locator-consent-dialog').open,true);
  f.setHandler(()=>{throw Object.assign(Error('Optional duty access denied'),{status:denialStatus})});
  await f.component.refresh();
  assert.equal(f.$('locator-consent-dialog').open,false);
  assert.equal(f.$('locator-consent-dialog').hasAttribute('open'),false);
  assert.ok(f.$('view-account'));assert.equal(f.$('locator-refresh').disabled,false);
  for(const id of ['locator-review-consent','locator-start-duty','locator-share-once'])assert.equal(f.$(id).disabled,true,id);
  f.$('locator-review-consent').click();assert.equal(f.$('locator-consent-dialog').open,false);
  assert.deepEqual(f.calls.map(x=>x.action),['locator-status','locator-status']);
  // A later successful read can offer consent again, without any implicit opt-in.
  f.setHandler(()=>disclosure);await f.component.refresh();
  assert.equal(f.$('locator-consent-dialog').open,true);
  assert.equal(f.$('locator-location-consent').checked,false);
  assert.equal(f.$('locator-findme-consent').checked,false);
  assert.equal(f.calls.some(x=>x.action==='locator-consent'||x.action==='locator-duty'),false);
 }finally{f.close()}
});
