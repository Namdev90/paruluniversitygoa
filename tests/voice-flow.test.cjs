const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../app/assets/voice.js'),'utf8');
const notifications=fs.readFileSync(path.join(__dirname,'../app/assets/notifications.js'),'utf8');
const admin={role:'admin',active:true},staff={role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',active:true,scanner:true};
const state=(name='idle',overrides={})=>({available:true,ready:['listening','requesting','talking'].includes(name),state:name,microphone:name==='talking',canTalk:['listening','requesting','talking'].includes(name),message:'Native public status',...overrides});
function fixture({initial=state(),profile=admin,integration=false,missingBridge=false}={}){
 const dom=new JSDOM('<header class="topbar"><div class="top-actions"></div></header><main></main>',{url:'https://fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,listeners=new Set(),calls=[];let current=profile,snapshot=initial,handler;
 const C={profile:()=>current,on:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},api:async()=>{throw Error('No API calls allowed in voice fixture.')}};
 if(!missingBridge)C.voice=(action,payload)=>{calls.push({action,payload:JSON.parse(JSON.stringify(payload))});if(handler)return handler(action,payload);if(action==='join')snapshot=state('listening');if(action==='press')snapshot=state('requesting');if(action==='release'||action==='cancel')snapshot=state('listening');if(action==='leave')snapshot=state('closed');return snapshot};
 w.eval(source);if(integration)w.eval(notifications);
 const api=integration?w.NavrangNotificationCenter.mount({client:C,autoStart:false,poll:false}):w.NavrangVoice.mount({client:C,container:w.document.querySelector('main')});
 const show=()=>integration?api.open():api.show(),hide=()=>integration?api.close():api.hide();
 const emit=event=>{for(const fn of [...listeners])fn(event)};
 return{dom,w,api,C,calls,show,hide,$:id=>w.document.getElementById('notification-voice-'+id),actions:()=>calls.map(c=>c.action),setState:value=>{snapshot=value},setHandler:fn=>{handler=fn},event:emit,setProfile:(value,type='auth')=>{current=value;emit({type})},close:()=>{api.destroy();w.close()}};
}
function pointer(f,type,id=1,extra={}){const event=new f.w.Event(type,{bubbles:true,cancelable:true});Object.assign(event,{pointerId:id,button:0,isPrimary:true,...extra});f.$('talk').dispatchEvent(event);return event;}
function key(f,type,value=' ',extra={}){const event=new f.w.KeyboardEvent(type,{key:value,bubbles:true,cancelable:true,...extra});f.$('talk').dispatchEvent(event);return event;}
function listen(f){f.show();f.$('join').click();assert.equal(f.$('talk').disabled,false);}

test('disabled build reports unavailable and opening never joins or requests microphone',()=>{
 const f=fixture({initial:state('unavailable',{available:false,ready:false,canTalk:false})});try{f.show();assert.deepEqual(f.actions(),['status']);assert.match(f.$('status').textContent,/unavailable/i);for(const id of ['join','leave','talk'])assert.equal(f.$(id).disabled,true);f.$('join').click();pointer(f,'pointerdown');key(f,'keydown');assert.deepEqual(f.actions(),['status']);}finally{f.close()}
});
test('browser without native bridge stays unavailable without fallback media APIs',()=>{
 const f=fixture({missingBridge:true});try{f.show();assert.equal(f.$('talk').disabled,true);assert.match(f.$('status').textContent,/unavailable/);assert.deepEqual(f.actions(),[]);assert.equal(f.w.navigator.mediaDevices,undefined);}finally{f.close()}
});
test('available transport can join before receive connection is ready',()=>{
 const f=fixture();try{f.show();assert.equal(f.$('join').disabled,false);assert.equal(f.$('talk').disabled,true);f.setHandler(action=>action==='join'?state('joining'):state());f.$('join').click();assert.equal(f.$('join').disabled,true);assert.equal(f.$('leave').disabled,false);assert.match(f.$('status').textContent,/Joining/);assert.equal(f.$('talk').disabled,true);}finally{f.close()}
});
test('explicit join listens and pointer press release is momentary',()=>{
 const f=fixture();try{listen(f);assert.deepEqual(f.actions(),['status','join']);pointer(f,'pointerdown');assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');f.setState(state('talking'));f.event({type:'voice'});assert.equal(f.$('talk').getAttribute('aria-pressed'),'true');pointer(f,'pointerup');assert.deepEqual(f.actions(),['status','join','press','status','release']);assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');assert.ok(f.calls.every(c=>Object.keys(c.payload).length===0));}finally{f.close()}
});
test('pointer repeats, secondary touches and synthesized clicks cannot start another press',()=>{
 const f=fixture();try{listen(f);pointer(f,'pointerdown',3);pointer(f,'pointerdown',4);pointer(f,'pointerup',4);assert.equal(f.actions().filter(a=>a==='release').length,0);pointer(f,'pointerup',3);f.$('talk').click();pointer(f,'pointerdown',5,{isPrimary:false});pointer(f,'pointerdown',6,{button:2});assert.equal(f.actions().filter(a=>a==='press').length,1);assert.equal(f.actions().filter(a=>a==='release').length,1);}finally{f.close()}
});
for(const type of ['pointercancel','lostpointercapture'])test(type+' immediately cancels pending or active talk',()=>{
 const f=fixture();try{listen(f);pointer(f,'pointerdown',7);pointer(f,type,7);assert.equal(f.actions().at(-1),'cancel');pointer(f,'pointerup',7);assert.equal(f.actions().filter(a=>a==='release').length,0);}finally{f.close()}
});
for(const value of [' ','Enter'])test('keyboard '+JSON.stringify(value)+' holds once and releases on keyup',()=>{
 const f=fixture();try{listen(f);const first=key(f,'keydown',value);key(f,'keydown',value,{repeat:true});key(f,'keydown',value);assert.equal(first.defaultPrevented,true);assert.equal(f.actions().filter(a=>a==='press').length,1);key(f,'keyup',value);f.$('talk').click();assert.equal(f.actions().filter(a=>a==='release').length,1);assert.equal(f.actions().filter(a=>a==='press').length,1);}finally{f.close()}
});
test('mixed pointer and keyboard input cannot replace the active hold',()=>{
 const f=fixture();try{listen(f);pointer(f,'pointerdown');key(f,'keydown');key(f,'keyup');assert.equal(f.actions().at(-1),'press');pointer(f,'pointerup');assert.equal(f.actions().at(-1),'release');}finally{f.close()}
});
for(const lifecycle of ['window-blur','pagehide','button-blur','offline','hidden','hide','auth','profile','destroy'])test(lifecycle+' stops talk and ignores a late talking event',()=>{
 const f=fixture();let destroyed=false;try{listen(f);key(f,'keydown');
  if(lifecycle==='window-blur')f.w.dispatchEvent(new f.w.Event('blur'));
  if(lifecycle==='pagehide')f.w.dispatchEvent(new f.w.Event('pagehide'));
  if(lifecycle==='button-blur')f.$('talk').dispatchEvent(new f.w.Event('blur'));
  if(lifecycle==='offline'){Object.defineProperty(f.w.navigator,'onLine',{configurable:true,value:false});f.w.dispatchEvent(new f.w.Event('offline'));}
  if(lifecycle==='hidden'){Object.defineProperty(f.w.document,'hidden',{configurable:true,value:true});f.w.document.dispatchEvent(new f.w.Event('visibilitychange'));}
  if(lifecycle==='hide')f.hide();
  if(lifecycle==='auth')f.setProfile(staff);
  if(lifecycle==='profile')f.setProfile({...admin,active:false},'profile');
  if(lifecycle==='destroy'){f.api.destroy();destroyed=true;}
  assert.equal(f.actions().at(-1),['offline','auth','profile'].includes(lifecycle)?'leave':'cancel');f.setState(state('closed'));f.event({type:'voice',data:state('talking')});if(!destroyed)assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');assert.equal(f.actions().filter(a=>a==='press').length,1);
 }finally{f.close()}
});
test('late event payload cannot replace current native state or leak credentials',()=>{
 const f=fixture();try{listen(f);f.setState(state('closed'));f.event({type:'voice',data:{...state('talking'),token:'PRIVATE_TOKEN',roomUrl:'PRIVATE_ROOM'}});assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');assert.equal(f.$('talk').disabled,true);assert.doesNotMatch(f.w.document.body.textContent,/PRIVATE_TOKEN|PRIVATE_ROOM/);assert.equal(f.actions().at(-1),'status');}finally{f.close()}
});
test('unknown fields and malformed native snapshots fail closed',()=>{
 const f=fixture();try{f.show();for(const value of [{...state('listening'),token:'secret'},state('idle',{canTalk:true}),state('listening',{microphone:true}),state('listening',{ready:false}),{...state('idle'),message:'x'.repeat(241)},null]){f.setState(value);f.event({type:'voice',data:state('listening')});assert.equal(f.$('talk').disabled,true);assert.equal(f.$('join').disabled,true);assert.doesNotMatch(f.w.document.body.textContent,/secret/);}}finally{f.close()}
});
test('native failure during press requests cancellation and does not display a server error',()=>{
 const f=fixture();try{listen(f);f.setHandler(action=>{if(action==='press')throw Error('PRIVATE_PROVIDER_SECRET');return state('closed')});pointer(f,'pointerdown');assert.deepEqual(f.actions().slice(-2),['cancel','cancel']);assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');assert.doesNotMatch(f.w.document.body.textContent,/PRIVATE_PROVIDER_SECRET/);}finally{f.close()}
});
test('revocation during an active hold cancels and cannot resume automatically',()=>{
 const f=fixture();try{listen(f);pointer(f,'pointerdown');f.setState(state('unavailable',{available:false,ready:false,canTalk:false}));f.event({type:'voice'});assert.equal(f.actions().at(-1),'cancel');f.setState(state('listening'));f.event({type:'voice'});assert.equal(f.actions().filter(a=>a==='press').length,1);assert.equal(f.$('talk').getAttribute('aria-pressed'),'false');}finally{f.close()}
});
test('inactive, expired and unauthorized profiles cannot query or join voice',()=>{
 for(const profile of [null,{...admin,active:false},{...staff,scanner:false,reports:false,helpdesk:false},{...admin,expiresAt:'2020-01-01T00:00:00Z'}]){const f=fixture({profile});try{f.show();f.$('join').click();assert.deepEqual(f.actions(),[]);assert.equal(f.$('talk').disabled,true);}finally{f.close()}}
});
test('notification center integrates show, close, Escape and teardown without auto join',()=>{
 const f=fixture({integration:true});try{assert.ok(f.w.document.querySelector('#notifications-center #notification-voice'));assert.deepEqual(f.actions(),[]);f.show();assert.deepEqual(f.actions(),['status']);f.$('join').click();key(f,'keydown');f.w.document.getElementById('notifications-center').dispatchEvent(new f.w.Event('cancel'));assert.equal(f.actions().at(-1),'cancel');f.hide();f.show();assert.equal(f.actions().filter(a=>a==='join').length,1);f.api.destroy();assert.equal(f.w.document.getElementById('notification-voice'),null);}finally{f.close()}
});
test('controls have accessible labels, status semantics and reusable existing layout classes',()=>{
 const f=fixture();try{f.show();assert.equal(f.$('status').getAttribute('role'),'status');assert.equal(f.$('talk').getAttribute('aria-describedby'),'notification-voice-help notification-voice-status');assert.equal(f.$('talk').type,'button');assert.ok(f.$('join').parentElement.classList.contains('notification-item-actions'));assert.ok(f.w.document.getElementById('notification-voice').classList.contains('notification-live'));}finally{f.close()}
});
