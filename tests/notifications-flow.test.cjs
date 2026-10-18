const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const modulePath=path.join(__dirname,'../app/assets/notifications.js');
const stamp='2026-10-19T00:00:00.000Z',hash='a'.repeat(64);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const admin={role:'admin',name:'Synthetic Administrator',active:true,reports:true,scanner:true,helpdesk:true};
const faculty={role:'checker',checkerId:id(99),name:'Synthetic Faculty',active:true,reports:true,scanner:false,helpdesk:false,method:'google'};
const item=n=>({id:id(n),revision:n,kind:'announcement',title:'Notice '+n,body:'Synthetic event '+n,at:stamp,read:false,destination:'account'});
const feed=(numbers,revision=Math.max(0,...numbers),dashboard=null)=>({revision,serverTime:stamp,items:numbers.map(item),activeIds:numbers.map(id),dashboard});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(profile=admin){
 const dom=new JSDOM('<header class="topbar"><div class="top-actions"></div></header><nav><button data-view="account">Account</button><button data-view="reports" hidden>Reports</button><button data-view="admin" hidden>Admin</button></nav>',{url:'https://fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,listeners=new Set(),calls=[];let current=profile,handler=()=>feed([]),destination='';
 for(const b of w.document.querySelectorAll('[data-view]'))b.onclick=()=>{destination=b.dataset.view};
 const client={profile:()=>current,on:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},api:async(action,payload={})=>{calls.push({action,payload});return handler(action,payload)}};
 w.eval(fs.readFileSync(modulePath,'utf8'));
 const api=w.NavrangNotificationCenter.mount({client,autoStart:false,poll:false,now:()=>Date.parse(stamp)});
 return{dom,w,api,calls,$:id=>w.document.getElementById(id),setHandler:fn=>{handler=fn},setProfile:(p,type='auth')=>{current=p;for(const fn of listeners)fn({type})},event:e=>{for(const fn of listeners)fn(e)},destination:()=>destination,close:()=>{api.destroy();dom.window.close()}};
}
function compose(f){f.$('notifications-compose-toggle').click();f.$('notification-title').value='Synthetic meeting';f.$('notification-title').dispatchEvent(new f.w.Event('input',{bubbles:true}));f.$('notification-body').value='Fixture-only message';f.$('notification-body').dispatchEvent(new f.w.Event('input',{bubbles:true}));}

test('authoritative five IDs prune stale feed items and read retains the item',async()=>{
 const f=fixture();try{
  f.setHandler(action=>action==='notifications-feed'?feed([5,4,3,2,1]):{read:true});await f.api.refresh();
  assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);
  assert.equal(f.$('notifications-items').firstElementChild.dataset.notificationId,id(5));
  f.setHandler(action=>action==='notifications-feed'?feed([6,5,4,3,2],6):{read:true});await f.api.refresh();
  assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);
  assert.equal(f.w.document.querySelector('[data-notification-id="'+id(1)+'"]'),null);
  f.w.document.querySelector('[data-notification-id="'+id(6)+'"] [data-mark-read]').click();await settle();
  assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);
  assert.equal(f.w.document.querySelector('[data-notification-id="'+id(6)+'"]').dataset.read,'true');
  f.event({type:'notification-dismissed',data:{id:id(6)}});f.api.close();f.api.open();
  assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);
 }finally{f.close()}
});

test('live card stays separate from five items with explicit hide and restore',async()=>{
 const f=fixture();try{
  const dashboard={revision:1,generatedAt:stamp,status:'live',totals:{attended:793},hidden:false};
  f.setHandler(action=>action==='notifications-feed'?feed([5,4,3,2,1],5,dashboard):{hidden:true});await f.api.refresh();
  assert.equal(f.$('notifications-live').hidden,false);assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);
  f.$('notifications-hide-live').click();await settle();assert.equal(f.$('notifications-live').hidden,true);assert.equal(f.$('notifications-restore-live').hidden,false);
  f.setHandler(()=>({hidden:false}));f.$('notifications-restore-live').click();await settle();assert.equal(f.$('notifications-live').hidden,false);
  assert.deepEqual(f.calls.filter(c=>c.action==='notifications-dashboard').map(c=>c.payload.hidden),[true,false]);
 }finally{f.close()}
});

test('administrator must preview exact template and audience before an explicit send',async()=>{
 const f=fixture();try{
  f.setHandler(action=>action==='notifications-preview'?{recipientCount:3,previewHash:hash}:action==='notifications-send'?{sent:true}:feed([]));compose(f);
  assert.equal(f.$('notification-send').disabled,true);f.$('notification-send').click();assert.equal(f.calls.length,0);
  f.$('notification-preview').click();await settle();assert.equal(f.$('notification-send').disabled,false);assert.match(f.$('notification-preview-result').textContent,/3 recipients/);
  f.$('notification-send').click();await settle();const sent=f.calls.find(c=>c.action==='notifications-send');
  assert.ok(sent);assert.equal(sent.payload.previewHash,hash);assert.equal(sent.payload.template.type,'announcement');assert.equal(sent.payload.template.title,'Synthetic meeting');assert.equal(sent.payload.audience.type,'everyone');assert.match(sent.payload.requestId,/^[0-9a-f-]{36}$/);assert.equal(f.$('notification-send').disabled,true);
 }finally{f.close()}
});

test('editing previewed content or receiving changed recipients requires a fresh preview',async()=>{
 const f=fixture();try{
  f.setHandler(action=>action==='notifications-preview'?{recipientCount:2,previewHash:hash}:action==='notifications-send'?{previewChanged:true,recipientCount:4,previewHash:'b'.repeat(64)}:feed([]));compose(f);f.$('notification-preview').click();await settle();
  f.$('notification-title').value='Changed draft';f.$('notification-title').dispatchEvent(new f.w.Event('input',{bubbles:true}));assert.equal(f.$('notification-send').disabled,true);
  f.$('notification-preview').click();await settle();f.$('notification-send').click();await settle();assert.equal(f.$('notification-send').disabled,true);assert.match(f.$('notification-compose-status').textContent,/changed.*preview|preview.*again/i);
  assert.equal(f.calls.filter(c=>c.action==='notifications-send').length,1);
 }finally{f.close()}
});

test('late feed and preview responses cannot populate a new or revoked identity',async()=>{
 const f=fixture();try{
  const old=deferred();f.setHandler(()=>old.promise);const request=f.api.refresh();f.setProfile(faculty);old.resolve(feed([1]));await request;await settle();
  assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,0);assert.equal(f.$('notifications-compose-toggle').hidden,true);
  f.setProfile(admin);compose(f);const preview=deferred();f.setHandler(action=>action==='notifications-preview'?preview.promise:feed([]));f.$('notification-preview').click();f.setProfile(null);preview.resolve({recipientCount:3,previewHash:hash});await settle();
  assert.equal(f.$('notifications-button').hidden,true);assert.equal(f.$('notification-send').disabled,true);assert.equal(f.$('notification-preview-result').textContent,'');
 }finally{f.close()}
});

test('faculty cannot open or send with the administrator composer',async()=>{
 const f=fixture(faculty);try{
  assert.equal(f.$('notifications-compose-toggle').hidden,true);f.$('notifications-compose-toggle').click();assert.equal(f.$('notification-composer').hidden,true);
  f.$('notification-title').value='Spoof';f.$('notification-preview').click();f.$('notification-send').click();await settle();assert.equal(f.calls.some(c=>['notifications-preview','notifications-send'].includes(c.action)),false);
 }finally{f.close()}
});

test('notification content is plain text and destinations use only existing authorized navigation',async()=>{
 const f=fixture();try{
  const first={...item(1),title:'<img src=x onerror=alert(1)>',body:'<b>Plain text</b>',destination:'javascript:alert(1)'};
  f.setHandler(action=>action==='notifications-feed'?{...feed([1]),items:[first]}:{read:true});await f.api.refresh();
  assert.equal(f.$('notifications-items').querySelector('img,b'),null);assert.match(f.$('notifications-items').textContent,/<b>Plain text<\/b>/);assert.equal(f.$('notifications-items').querySelector('[data-open-notification]'),null);
  f.setHandler(action=>action==='notifications-feed'?feed([2]):{read:true});await f.api.refresh();f.w.document.querySelector('[data-open-notification]').click();await settle();assert.equal(f.destination(),'account');
 }finally{f.close()}
});

test('unavailable transport is an error and an oversized feed cannot masquerade as five valid items',async()=>{
 const f=fixture();try{
  f.setHandler(()=>{throw Error('Communications not configured.')});await f.api.refresh();assert.match(f.$('notifications-status').textContent,/unavailable|not configured/i);assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,0);
  f.setHandler(()=>feed([6,5,4,3,2,1],6));await f.api.refresh();assert.match(f.$('notifications-status').textContent,/incomplete|invalid/i);assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,0);
 }finally{f.close()}
});

test('delta feed uses the authoritative five IDs without losing unchanged items',async()=>{
 const f=fixture();try{
  f.setHandler(()=>feed([5,4,3,2,1]));await f.api.refresh();f.setHandler(()=>({revision:6,serverTime:stamp,items:[item(6)],activeIds:[6,5,4,3,2].map(id),dashboard:null}));await f.api.refresh();
  assert.deepEqual([...f.$('notifications-items').children].map(n=>n.dataset.notificationId),[6,5,4,3,2].map(id));
 }finally{f.close()}
});

test('server revocation clears private contents and closes the center immediately',async()=>{
 const f=fixture();try{
  f.setHandler(()=>feed([1]));await f.api.refresh();f.api.open();assert.equal(f.$('notifications-center').open,true);
  f.setHandler(()=>{throw Object.assign(Error('Access revoked.'),{status:403})});await f.api.refresh();
  assert.equal(f.$('notifications-center').open,false);assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,0);assert.equal(f.$('notification-preview-result').textContent,'');assert.equal(f.$('notifications-compose-toggle').hidden,true);
 }finally{f.close()}
});

test('a stale preview after draft edits cannot enable sending',async()=>{
 const f=fixture();try{
  compose(f);const pending=deferred();f.setHandler(()=>pending.promise);f.$('notification-preview').click();f.$('notification-body').value='Edited while waiting';f.$('notification-body').dispatchEvent(new f.w.Event('input',{bubbles:true}));pending.resolve({recipientCount:3,previewHash:hash});await settle();
  assert.equal(f.$('notification-send').disabled,true);assert.equal(f.$('notification-preview-result').textContent,'');
 }finally{f.close()}
});

test('retry after an ambiguous send reuses the original idempotency request ID',async()=>{
 const f=fixture();try{
  let attempts=0;f.setHandler(action=>{if(action==='notifications-preview')return{recipientCount:2,previewHash:hash};if(action==='notifications-send'){if(++attempts===1)throw Error('Connection interrupted.');return{sent:true}}return feed([])});compose(f);f.$('notification-preview').click();await settle();
  f.$('notification-send').click();await settle();assert.equal(f.$('notification-send').disabled,false);f.$('notification-send').click();await settle();const requests=f.calls.filter(c=>c.action==='notifications-send');assert.equal(requests.length,2);assert.equal(requests[0].payload.requestId,requests[1].payload.requestId);
 }finally{f.close()}
});

test('off-duty users refresh normally while hidden or offline surfaces do not poll',async()=>{
 const f=fixture({...faculty,onDuty:false});try{
  f.setHandler(()=>feed([1]));await f.api.refresh();assert.equal(f.calls.length,1);
  Object.defineProperty(f.w.document,'hidden',{configurable:true,value:true});await f.api.refresh();assert.equal(f.calls.length,1);
  Object.defineProperty(f.w.document,'hidden',{configurable:true,value:false});Object.defineProperty(f.w.navigator,'onLine',{configurable:true,value:false});await f.api.refresh();assert.equal(f.calls.length,1);
  Object.defineProperty(f.w.navigator,'onLine',{configurable:true,value:true});await f.api.refresh();assert.equal(f.calls.length,2);
 }finally{f.close()}
});

test('all six template types and selected roles match the strict server contract',async()=>{
 const {validateCommunication,TEMPLATE_TYPES}=await import('../server/functions/navrang-gate/communications-contract.mjs');
 const f=fixture();try{
  f.setHandler(()=>({recipientCount:4,previewHash:hash}));compose(f);
  assert.deepEqual([...f.$('notification-type').options].map(o=>o.value),TEMPLATE_TYPES);
  f.$('notification-audience').value='roles';f.$('notification-audience').dispatchEvent(new f.w.Event('change',{bubbles:true}));for(const input of f.$('notification-audience-roles').querySelectorAll('input'))input.checked=['faculty','helpdesk'].includes(input.value);
  for(const type of TEMPLATE_TYPES){f.$('notification-type').value=type;f.$('notification-type').dispatchEvent(new f.w.Event('change',{bubbles:true}));if(type==='meeting'){f.$('notification-meeting-location').value='Synthetic hall';f.$('notification-meeting-time').value='2026-10-20T09:00';}f.$('notification-preview').click();await settle();const request=f.calls.filter(c=>c.action==='notifications-preview').at(-1);const validated=validateCommunication(request.action,JSON.parse(JSON.stringify(request.payload)));assert.equal(validated.template.type,type);assert.deepEqual(validated.audience,{type:'roles',roles:['faculty','helpdesk']});assert.equal(f.$('notification-send').disabled,false);}
 }finally{f.close()}
});

test('refresh preserves keyboard focus on a notification that remains authorized',async()=>{
 const f=fixture();try{f.setHandler(()=>feed([2,1]));await f.api.refresh();f.api.open();const target=f.w.document.querySelector('[data-notification-id="'+id(2)+'"] [data-open-notification]');target.focus();await f.api.refresh();assert.equal(f.w.document.activeElement.closest('[data-notification-id]')?.dataset.notificationId,id(2));}finally{f.close()}
});

test('pinned administrator announcement is separate from five items and only an admin can end it',async()=>{
 for(const profile of [admin,faculty]){const f=fixture(profile);try{
  const pinned={id:id(42),title:'Synthetic pinned announcement',body:'<b>Plain announcement text</b>',at:stamp};let ended=false;
  f.setHandler(action=>{if(action==='notifications-end'){ended=true;return{ended:true}}return feed([5,4,3,2,1],ended?6:5,{revision:ended?2:1,generatedAt:stamp,status:'live',totals:{ownScans:8,totalEntries:793},hidden:false,announcement:ended?null:pinned})});
  await f.api.refresh();assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);assert.match(f.$('notifications-live-announcement').textContent,/Synthetic pinned announcement/);assert.equal(f.$('notifications-live-announcement').querySelector('b'),null);assert.match(f.$('notifications-live').textContent,/My scans/);
  assert.equal(f.$('notifications-end-live').hidden,profile!==admin);f.$('notifications-end-live').click();await settle();await settle();
  if(profile===admin){assert.equal(f.calls.find(c=>c.action==='notifications-end').payload.id,id(42));assert.equal(f.$('notifications-live-announcement').hidden,true);assert.equal(f.w.document.querySelectorAll('[data-notification-id]').length,5);}
  else assert.equal(f.calls.some(c=>c.action==='notifications-end'),false);
 }finally{f.close()}}
});

test('late end acknowledgement cannot refresh or change the next account',async()=>{
 const f=fixture();try{
  const old=deferred(),pinned={id:id(42),title:'Private pinned notice',body:'Synthetic only',at:stamp};f.setHandler(action=>action==='notifications-end'?old.promise:feed([] ,1,{revision:1,generatedAt:stamp,status:'live',totals:{},hidden:false,announcement:pinned}));await f.api.refresh();f.$('notifications-end-live').click();f.setProfile(faculty);const before=f.calls.length;old.resolve({ended:true});await settle();assert.equal(f.calls.length,before);assert.equal(f.$('notifications-live-announcement').textContent.includes('Private pinned notice'),false);assert.equal(f.$('notifications-end-live').hidden,true);
 }finally{f.close()}
});

test('malformed pinned announcements fail closed and header integration cleans up on destroy',async()=>{
 const f=fixture();try{
  assert.equal(f.w.document.querySelector('.topbar').classList.contains('has-notification-center'),true);f.setHandler(()=>feed([],1,{revision:1,generatedAt:stamp,status:'live',totals:{},hidden:false,announcement:{id:id(42),title:'Synthetic',body:'Synthetic',at:'invalid'}}));await f.api.refresh();assert.match(f.$('notifications-status').textContent,/incomplete pinned announcement/);assert.equal(f.$('notifications-live-announcement').hidden,true);f.api.destroy();assert.equal(f.w.document.querySelector('.topbar').classList.contains('has-notification-center'),false);
 }finally{f.close()}
});

test('structured meeting metadata survives feed/read roundtrip and renders plain IST details',async()=>{
 const f=fixture(faculty);try{
  const meeting={location:'Synthetic <b>Hall</b>',time:'2026-10-19T08:00:00+00:00'},notice={...item(1),kind:'meeting',meeting};f.setHandler(action=>action==='notifications-feed'?{...feed([1]),items:[notice]}:{read:true});await f.api.refresh();
  const details=f.$('notifications-items').querySelector('.notification-meeting-details');assert.match(details.textContent,/Location: Synthetic <b>Hall<\/b>/);assert.equal(details.querySelector('b'),null);assert.equal(details.querySelector('time').dateTime,'2026-10-19T08:00:00.000Z');assert.match(details.querySelector('time').textContent,/IST$/);
  f.$('notifications-items').querySelector('[data-mark-read]').click();await settle();assert.match(f.$('notifications-items').querySelector('.notification-meeting-details').textContent,/Synthetic/);
 }finally{f.close()}
});

test('invalid or unrequested meeting metadata fails closed',async()=>{
 for(const meeting of [{location:'x'.repeat(121)},{time:'tomorrow'},{time:'2026-02-31T08:00:00Z'},{location:42},{location:'Synthetic',privateContact:'not authorized'}]){const f=fixture();try{f.setHandler(()=>({...feed([1]),items:[{...item(1),meeting}]}));await f.api.refresh();assert.match(f.$('notifications-status').textContent,/incomplete meeting details/);assert.equal(f.$('notifications-items').childElementCount,0);}finally{f.close()}}
});

test('delivery summary is administrator-only even if a server accidentally includes it for staff',async()=>{
 const delivery={queued:91931,failed:91932,providerAccepted:91933,expiredFailures:91934};
 for(const profile of [admin,faculty]){const f=fixture(profile);try{
  f.setHandler(()=>feed([],1,{revision:1,generatedAt:stamp,status:'live',totals:{totalEntries:793},hidden:false,delivery}));await f.api.refresh();assert.equal(f.$('notifications-delivery-status').hidden,profile!==admin);
  if(profile===admin){assert.match(f.$('notifications-delivery-status').textContent,/Queued: 91931/);assert.match(f.$('notifications-delivery-status').textContent,/Accepted by provider: 91933/);f.setProfile(faculty);assert.equal(f.$('notifications-delivery-status').textContent,'');}
  else for(const value of Object.values(delivery))assert.equal(f.$('notifications-center').textContent.includes(String(value)),false);
 }finally{f.close()}}
});

test('administrator delivery counters reject nonnumeric values',async()=>{
 const f=fixture();try{f.setHandler(()=>feed([],1,{revision:1,generatedAt:stamp,status:'live',totals:{},hidden:false,delivery:{queued:'9',failed:0,providerAccepted:0,expiredFailures:0}}));await f.api.refresh();assert.match(f.$('notifications-status').textContent,/incomplete delivery status/);assert.equal(f.$('notifications-delivery-status').hidden,true);}finally{f.close()}
});

test('canonical template types survive preview/send/feed and emergency labels are not duplicated',async()=>{
 const f=fixture();try{
  let sent=null;f.setHandler((action,payload)=>{if(action==='notifications-preview')return{recipientCount:2,previewHash:hash};if(action==='notifications-send'){sent=payload.template;return{sent:true}}return{...feed([1]),items:[{...item(1),templateType:sent.type,urgency:sent.urgency}]}});compose(f);
  for(const type of [...f.$('notification-type').options].map(o=>o.value)){f.$('notification-type').value=type;f.$('notification-type').dispatchEvent(new f.w.Event('change',{bubbles:true}));f.$('notification-preview').click();await settle();f.$('notification-send').click();await settle();await f.api.refresh();const label=f.$('notifications-items').querySelector('.notification-kind').textContent;assert.match(label,new RegExp(type==='call-request'?'Call request':type==='live-broadcast'?'Live broadcast':type[0].toUpperCase()+type.slice(1)));if(type==='emergency')assert.equal(label,'Emergency');}
 }finally{f.close()}
});

test('unknown notification type or urgency fails closed while null metadata is accepted',async()=>{
 for(const metadata of [{templateType:'unknown'},{urgency:'critical'},{templateType:'emergency',urgency:'normal'}]){const f=fixture();try{f.setHandler(()=>({...feed([1]),items:[{...item(1),...metadata}]}));await f.api.refresh();assert.match(f.$('notifications-status').textContent,/incomplete notification type details/);assert.equal(f.$('notifications-items').childElementCount,0);}finally{f.close()}}
 const f=fixture();try{f.setHandler(()=>({...feed([1]),items:[{...item(1),templateType:null,urgency:null,meeting:null}]}));await f.api.refresh();assert.equal(f.$('notifications-items').childElementCount,1);}finally{f.close()}
});

test('pinned announcements retain structured metadata without duplicating emergency urgency',async()=>{
 const f=fixture();try{f.setHandler(()=>feed([],1,{revision:1,generatedAt:stamp,status:'live',totals:{},hidden:false,announcement:{id:id(42),title:'Synthetic response',body:'Synthetic only',at:stamp,templateType:'emergency',urgency:'emergency',meeting:null}}));await f.api.refresh();assert.equal(f.$('notifications-live-announcement').querySelector('.notification-kind').textContent,'Emergency');}finally{f.close()}
});

test('older in-flight feed cannot undo an acknowledged read or dashboard visibility change',async()=>{
 for(const action of ['read','hide']){const f=fixture();try{
  const dashboard={revision:1,generatedAt:stamp,status:'live',totals:{},hidden:false};f.setHandler(()=>feed([1],1,dashboard));await f.api.refresh();const old=deferred();f.setHandler(name=>name==='notifications-feed'?old.promise:{read:true,hidden:true,revision:2});const pending=f.api.refresh();
  f.$(action==='read'?'notification-read-'+id(1):'notifications-hide-live').click();await settle();old.resolve(feed([1],1,dashboard));await pending;
  if(action==='read')assert.equal(f.$('notifications-items').firstElementChild.dataset.read,'true');else assert.equal(f.$('notifications-live').hidden,true);
  f.setHandler(()=>({...feed([2,1],2,action==='hide'?{...dashboard,hidden:true}:dashboard),items:[item(2),{...item(1),read:action==='read'}]}));await f.api.refresh();assert.equal(f.calls.filter(c=>c.action==='notifications-feed').at(-1).payload.afterRevision,1);assert.equal(f.$('notifications-items').childElementCount,2);
 }finally{f.close()}}
});

test('revoked staff lose cached private items but retain only their own access-change notices',async()=>{
 const f=fixture(faculty);try{
  f.setHandler(()=>feed([1]));await f.api.refresh();f.api.open();const old=deferred();f.setHandler(()=>old.promise);const pending=f.api.refresh();f.setProfile({...faculty,active:false},'profile');assert.equal(f.$('notifications-center').open,false);assert.equal(f.$('notifications-items').childElementCount,0);old.resolve(feed([1]));await pending;
  const access={...item(2),kind:'access-change',title:'Your access changed',body:'Contact the administrator.'};f.setHandler(action=>action==='notifications-read'?{read:true,revision:3}:{revision:2,serverTime:stamp,activeIds:[id(2),id(3)],items:[access,{...item(3),kind:'ticket-check',body:{private:'must not render'}}],dashboard:{malformed:'private dashboard must be ignored'}});await f.api.refresh();
  assert.equal(f.$('notifications-button').hidden,false);assert.equal(f.$('notifications-items').childElementCount,1);assert.match(f.$('notifications-items').textContent,/Your access changed/);assert.equal(f.$('notifications-live').hidden,true);assert.equal(f.$('notifications-compose-toggle').hidden,true);assert.equal(f.$('notifications-center').textContent.includes('must not render'),false);f.$('notifications-items').querySelector('[data-mark-read]').click();await settle();assert.equal(f.$('notifications-items').firstElementChild.dataset.read,'true');assert.equal(f.calls.filter(c=>c.action==='notifications-read').at(-1).payload.id,id(2));
 }finally{f.close()}
});
