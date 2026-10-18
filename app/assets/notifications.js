/* The server owns recipients, ordering and retention. This view keeps no durable private cache. */
(function(root){
 'use strict';
 const templateTypes={announcement:'Announcement',emergency:'Emergency',meeting:'Meeting','call-request':'Call request',update:'Update','live-broadcast':'Live broadcast'};
 const audienceRoles={administrator:'Administrators',checker:'Checkers',faculty:'Faculty',helpdesk:'Help Desk'};
 const destinations=new Set(['home','station','desk','entries','reports','admin','account']);
 const totalNames={attended:'Admitted',admitted:'Admitted',registered:'Registrations',registeredAttended:'From registration master',organizerConfirmed:'Organizer confirmed',eligible:'Eligible',noShow:'No verified entry',blocked:'Blocked',serverIssues:'Issue attempts',issueTickets:'Tickets with issues',duplicateAttempts:'Duplicate attempts',pendingHelpDesk:'Pending Help Desk',activeStaff:'Active staff',onDuty:'On duty',listeners:'Connected listeners',totalEntries:'Total entries',ownScans:'My scans'};
 const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
 const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
 const textValue=(value,maximum)=>typeof value==='string'&&value.length<=maximum;
 function parseMeetingTime(value){
  if(typeof value!=='string')throw Error('The server returned incomplete meeting details.');
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);if(!parts||!validTime(value))throw Error('The server returned incomplete meeting details.');
  const [year,month,day,hour,minute,second]=parts.slice(1).map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||date.getUTCSeconds()!==second)throw Error('The server returned incomplete meeting details.');return new Date(value).toISOString();
 }
 function messageMetadata(value){
  let meeting=null;if(value.meeting!==undefined&&value.meeting!==null){const details=value.meeting;if(!details||typeof details!=='object'||Array.isArray(details)||Object.keys(details).some(key=>!['location','time'].includes(key))||details.location!==undefined&&!textValue(details.location,120))throw Error('The server returned incomplete meeting details.');meeting={};if(details.location!==undefined)meeting.location=details.location;if(details.time!==undefined)meeting.time=parseMeetingTime(details.time);}
  const templateType=value.templateType??null,urgency=value.urgency??null;
  if(templateType!==null&&!Object.prototype.hasOwnProperty.call(templateTypes,templateType)||urgency!==null&&!['normal','urgent','emergency'].includes(urgency)||templateType==='emergency'&&urgency!==null&&urgency!=='emergency')throw Error('The server returned incomplete notification type details.');
  return{meeting,templateType,urgency};
 }
 function mount({client:C=root.GateClient,poll=true,autoStart=true,pollMs=5000,now=()=>Date.now()}={}){
  const doc=root.document,actions=doc?.querySelector('.top-actions');if(!C||!actions||doc.getElementById('notifications-button'))return null;
  let epoch=0,identity='',revision=0,feedRevision=0,items=[],dashboard=null,serverTime='',receivedAt=0,stale=true,destroyed=false,timer=null,inFlight=null,failures=0;
  let preview=null,composeEpoch=0,sending=false,previewing=false,liveBusy=false,endBusy=false;const readBusy=new Set();
  pollMs=Math.max(5000,Number.isFinite(pollMs)?pollMs:5000);
  const make=(tag,text,cls)=>{const n=doc.createElement(tag);if(text!==undefined&&text!==null)n.textContent=String(text);if(cls)n.className=cls;return n};
  const button=(id,label,cls='button quiet')=>{const n=make('button',label,cls);n.id=id;n.type='button';return n};
  const errorMessage=error=>textValue(error?.message,240)?error.message:'Please try again.';
  function profileKey(){
   const p=C.profile();if(!p||!['admin','checker'].includes(p.role)||typeof p.active!=='boolean'||p.role==='admin'&&!p.active)return '';
   for(const value of [p.expiresAt,p.accessExpiresAt].filter(Boolean)){const at=Date.parse(value);if(!Number.isFinite(at)||now()>=at)return '';}
   return JSON.stringify([p.role,p.checkerId||'',p.active,p.scanner!==false,p.helpdesk===true,p.reports===true,p.station||'',p.expiresAt||'',p.accessExpiresAt||'']);
  }
  const current=(version,who)=>!destroyed&&version===epoch&&who===identity&&who===profileKey();
  const isAdmin=()=>!!identity&&identity===profileKey()&&C.profile()?.role==='admin'&&C.profile()?.active===true;
  const isInactive=()=>!!identity&&identity===profileKey()&&C.profile()?.role==='checker'&&C.profile()?.active===false;
  const runnable=()=>!destroyed&&!!identity&&identity===profileKey()&&!doc.hidden&&root.navigator?.onLine!==false;
  const cancelTimer=()=>{if(timer!==null)root.clearTimeout(timer);timer=null};
  function schedule(delay=pollMs){cancelTimer();if(poll&&runnable())timer=root.setTimeout(()=>{timer=null;refresh()},delay);}
  function close(){if(center.open&&typeof center.close==='function')center.close();center.removeAttribute('open');opener.setAttribute('aria-expanded','false');}
  function open(){if(!identity||identity!==profileKey())return;opener.setAttribute('aria-expanded','true');if(!center.open){if(typeof center.showModal==='function')center.showModal();else center.setAttribute('open','');}if(autoStart)refresh();}
  const opener=button('notifications-button',null,'notifications-button icon-button');opener.setAttribute('aria-label','Notifications');opener.setAttribute('aria-haspopup','dialog');opener.setAttribute('aria-controls','notifications-center');opener.setAttribute('aria-expanded','false');
  const bell=make('span','🔔','notification-bell');bell.setAttribute('aria-hidden','true');const badge=make('span','','notification-badge');badge.hidden=true;opener.append(bell,badge);opener.onclick=open;actions.append(opener);const topbar=actions.closest('.topbar');topbar?.classList.add('has-notification-center');
  const center=make('dialog',null,'notification-center');center.id='notifications-center';center.setAttribute('aria-labelledby','notifications-title');
  const heading=make('div',null,'notification-heading'),title=make('h2','Notifications');title.id='notifications-title';const closeButton=button('notifications-close','Close');closeButton.onclick=()=>{close();if(!opener.hidden)opener.focus()};heading.append(title,closeButton);
  const status=make('p','Sign in to view notifications.','notification-status');status.id='notifications-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const retry=button('notifications-refresh','Refresh');retry.onclick=()=>refresh();
  const live=make('section',null,'notification-live');live.id='notifications-live';live.setAttribute('aria-labelledby','notifications-live-title');
  const liveHeading=make('div',null,'notification-heading'),liveTitle=make('h3','Pinned dashboard');liveTitle.id='notifications-live-title';const hideLive=button('notifications-hide-live','Hide live card');liveHeading.append(liveTitle,hideLive);
  const liveState=make('p','','notification-live-state'),liveTotals=make('dl',null,'notification-live-totals'),deliverySummary=make('p',null,'notification-delivery'),liveAnnouncement=make('section',null,'notification-live-announcement');deliverySummary.id='notifications-delivery-status';deliverySummary.hidden=true;deliverySummary.setAttribute('aria-label','Administrator delivery status');liveAnnouncement.id='notifications-live-announcement';liveAnnouncement.setAttribute('aria-labelledby','notifications-live-announcement-title');
  const announcementTitle=make('h4');announcementTitle.id='notifications-live-announcement-title';const announcementBody=make('p',null,'notification-message'),announcementExtras=make('div',null,'notification-announcement-details'),announcementTime=make('time'),endLive=button('notifications-end-live','End pinned announcement','button secondary');endLive.hidden=true;endLive.onclick=endAnnouncement;liveAnnouncement.append(announcementTitle,announcementBody,announcementExtras,announcementTime,endLive);live.append(liveHeading,liveState,liveAnnouncement,liveTotals,deliverySummary);
  const restoreLive=button('notifications-restore-live','Restore live card');restoreLive.hidden=true;hideLive.onclick=()=>setDashboardHidden(true);restoreLive.onclick=()=>setDashboardHidden(false);
  const listTitle=make('h3','Five most recent'),list=make('ol',null,'notification-items');list.id='notifications-items';list.setAttribute('aria-label','Recent notifications');const empty=make('p','No recent notifications.','notification-empty');empty.id='notifications-empty';
  const composeToggle=button('notifications-compose-toggle','Create announcement','button secondary');composeToggle.hidden=true;composeToggle.setAttribute('aria-controls','notification-composer');composeToggle.setAttribute('aria-expanded','false');
  const form=make('form',null,'notification-composer');form.id='notification-composer';form.hidden=true;
  const formHeading=make('h3','Administrator announcement');
  function field(label,id,type='text',maximum){const l=make('label',label),input=make(type==='textarea'?'textarea':type==='select'?'select':'input');input.id=id;l.htmlFor=id;if(type!=='select'&&type!=='textarea')input.type=type;if(maximum)input.maxLength=maximum;form.append(l,input);return input;}
  function options(select,values){for(const [value,label]of Object.entries(values)){const option=make('option',label);option.value=value;select.append(option)}}
  form.append(formHeading);const type=field('Type','notification-type','select');options(type,templateTypes);
  const draftTitle=field('Title','notification-title','text',100);draftTitle.required=true;
  const body=field('Message','notification-body','textarea',1000);body.rows=3;
  const urgency=field('Urgency','notification-urgency','select');options(urgency,{normal:'Normal',urgent:'Urgent',emergency:'Emergency'});
  const meeting=make('fieldset',null,'notification-meeting');meeting.append(make('legend','Meeting details'));
  const meetingLocation=make('input');meetingLocation.id='notification-meeting-location';meetingLocation.maxLength=120;const meetingLocationLabel=make('label','Location');meetingLocationLabel.htmlFor=meetingLocation.id;
  const meetingTime=make('input');meetingTime.id='notification-meeting-time';meetingTime.type='datetime-local';const meetingTimeLabel=make('label','Meeting time');meetingTimeLabel.htmlFor=meetingTime.id;meeting.append(meetingLocationLabel,meetingLocation,meetingTimeLabel,meetingTime);form.append(meeting);
  const audience=field('Audience','notification-audience','select');options(audience,{everyone:'Everyone',roles:'Selected roles'});
  const roles=make('fieldset',null,'notification-audience-roles');roles.id='notification-audience-roles';roles.append(make('legend','Recipients'));const roleInputs=[];
  for(const [value,label]of Object.entries(audienceRoles)){const line=make('label',null,'notification-role-choice'),input=make('input');input.type='checkbox';input.value=value;line.append(input,make('span',label));roles.append(line);roleInputs.push(input)}form.append(roles);
  const composeStatus=make('p','','notification-compose-status');composeStatus.id='notification-compose-status';composeStatus.setAttribute('role','status');composeStatus.setAttribute('aria-live','polite');
  const previewResult=make('section',null,'notification-preview-result');previewResult.id='notification-preview-result';previewResult.setAttribute('aria-label','Announcement preview');previewResult.hidden=true;
  const formActions=make('div',null,'notification-form-actions'),previewButton=button('notification-preview','Preview recipients','button secondary'),send=button('notification-send','Send announcement','button primary');send.disabled=true;formActions.append(previewButton,send);form.append(composeStatus,previewResult,formActions);
  center.append(heading,status,retry,live,restoreLive,listTitle,list,empty,composeToggle,form);doc.body.append(center);
  center.addEventListener('close',()=>opener.setAttribute('aria-expanded','false'));
  function invalidatePreview(message='Preview again after changing the announcement.'){composeEpoch++;preview=null;previewResult.replaceChildren();previewResult.hidden=true;send.disabled=true;if(message)composeStatus.textContent=message;}
  function paintComposer(){
   const admin=isAdmin();composeToggle.hidden=!admin;if(!admin){form.hidden=true;composeToggle.setAttribute('aria-expanded','false');}
   meeting.hidden=type.value!=='meeting';roles.hidden=audience.value!=='roles';
   if(type.value==='emergency')urgency.value='emergency';urgency.disabled=sending||type.value==='emergency';
   previewButton.disabled=!admin||sending||previewing;send.disabled=!admin||sending||!preview||preview.recipientCount===0;
  }
  composeToggle.onclick=()=>{if(!isAdmin())return;form.hidden=!form.hidden;composeToggle.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)draftTitle.focus()};
  for(const event of ['input','change'])form.addEventListener(event,()=>{invalidatePreview();paintComposer()});
  form.onsubmit=event=>{event.preventDefault();if(isAdmin())previewAnnouncement()};previewButton.onclick=previewAnnouncement;send.onclick=sendAnnouncement;
  function clearState(){
   epoch++;cancelTimer();inFlight=null;readBusy.clear();revision=0;feedRevision=0;items=[];dashboard=null;serverTime='';receivedAt=0;stale=true;failures=0;liveBusy=false;endBusy=false;previewing=false;sending=false;
   invalidatePreview('');form.reset();composeStatus.textContent='';form.hidden=true;composeToggle.setAttribute('aria-expanded','false');for(const input of form.querySelectorAll('input,select,textarea,button'))input.disabled=false;send.disabled=true;retry.disabled=false;close();
  }
  function clear(){clearState();identity=profileKey();render();}
  function synchronizeIdentity(force=false){const next=profileKey();if(force||next!==identity){clearState();identity=next;render();return true}return false;}
  function messageExtras(value){
   if(!value)return[];const nodes=[],kind=value.templateType?templateTypes[value.templateType]:'',level=value.urgency==='urgent'?'Urgent':value.urgency==='emergency'?'Emergency':'';
   const label=[kind,level].filter((text,index,array)=>text&&array.indexOf(text)===index).join(' · ');if(label)nodes.push(make('p',label,'notification-kind'));
   if(value.meeting){const details=make('div',null,'notification-meeting-details');if(value.meeting.location!==undefined)details.append(make('p','Location: '+value.meeting.location));if(value.meeting.time){const at=make('time','Meeting: '+new Date(value.meeting.time).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST');at.dateTime=value.meeting.time;details.append(at)}if(details.childElementCount)nodes.push(details);}
   return nodes;
  }
  function render(){
   const focused=doc.activeElement,focusedRow=focused?.closest?.('[data-notification-id]'),focusedId=focusedRow?.dataset.notificationId,focusedOpen=focused?.hasAttribute?.('data-open-notification');
   opener.hidden=!identity;const unread=items.filter(item=>!item.read).length;badge.textContent=String(unread);badge.hidden=!unread;opener.setAttribute('aria-label',unread?'Notifications, '+unread+' unread':'Notifications');
   live.hidden=!dashboard||dashboard.hidden===true;restoreLive.hidden=!dashboard||dashboard.hidden!==true;hideLive.disabled=restoreLive.disabled=liveBusy;
   liveTotals.replaceChildren();liveAnnouncement.hidden=!dashboard?.announcement;announcementTitle.textContent=dashboard?.announcement?.title||'';announcementBody.textContent=dashboard?.announcement?.body||'';announcementExtras.replaceChildren(...messageExtras(dashboard?.announcement));announcementTime.textContent=dashboard?.announcement?new Date(dashboard.announcement.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST':'';announcementTime.dateTime=dashboard?.announcement?.at||'';endLive.hidden=!isAdmin()||!dashboard?.announcement;endLive.disabled=endBusy;
   deliverySummary.hidden=!isAdmin()||!dashboard?.delivery;deliverySummary.textContent=!deliverySummary.hidden?'Delivery · Queued: '+dashboard.delivery.queued+' · Failed: '+dashboard.delivery.failed+' · Accepted by provider: '+dashboard.delivery.providerAccepted+' · Expired failures: '+dashboard.delivery.expiredFailures:'';
   if(dashboard){
    const elapsed=Math.max(0,now()-receivedAt)+Math.max(0,Date.parse(serverTime)-Date.parse(dashboard.generatedAt));
    const fresh=!stale&&elapsed<=15000&&root.navigator?.onLine!==false;
    liveState.textContent=(fresh&&dashboard.status==='live'?'Live':'Last known state')+' · '+new Date(dashboard.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST';
    for(const [key,value]of Object.entries(dashboard.totals)){if(!Object.prototype.hasOwnProperty.call(totalNames,key))continue;liveTotals.append(make('dt',totalNames[key]),make('dd',value));}
   }
   list.replaceChildren();for(const item of items){
    const line=make('li',null,'notification-item');line.tabIndex=-1;line.dataset.notificationId=item.id;line.dataset.read=String(item.read);const h=make('h4',item.title),message=make('p',item.body,'notification-message'),time=make('time',new Date(item.at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST');time.dateTime=item.at;
    const controls=make('div',null,'notification-item-actions');if(!item.read){const read=button('notification-read-'+item.id,'Mark read');read.dataset.markRead='';read.disabled=readBusy.has(item.id);read.onclick=()=>markRead(item.id);controls.append(read)}
    if(destinationControl(item.destination)){const openItem=button('notification-open-'+item.id,'Open');openItem.dataset.openNotification='';openItem.disabled=readBusy.has(item.id);openItem.onclick=async()=>{const version=epoch,who=identity;if(await markRead(item.id)&&current(version,who)){const target=destinationControl(item.destination);if(target){close();target.click()}}};controls.append(openItem)}
    line.append(h,message,...messageExtras(item),time,controls);list.append(line);
   }
   empty.hidden=items.length>0;paintComposer();if(!identity)status.textContent='Sign in to view notifications.';
   if(focusedId&&center.open){const row=[...list.children].find(n=>n.dataset.notificationId===focusedId);let target=row?.querySelector(focusedOpen?'[data-open-notification]':'[data-mark-read]')||row?.querySelector('button')||row||closeButton;if(target.disabled)target=row||closeButton;target.focus({preventScroll:true});}
  }
  function destinationControl(value){if(!destinations.has(value))return null;return [...doc.querySelectorAll('[data-view]')].find(button=>button.dataset.view===value&&!button.disabled&&!button.hidden&&!button.closest('[hidden]')&&button.getAttribute('aria-disabled')!=='true')||null;}
  function checkedFeed(result){
   const value=result?.feed||result;if(!value||!Number.isSafeInteger(value.revision)||value.revision<0||!validTime(value.serverTime)||!Array.isArray(value.items)||value.items.length>5||!Array.isArray(value.activeIds)||value.activeIds.length>5||value.activeIds.some(id=>!validId(id))||new Set(value.activeIds).size!==value.activeIds.length)throw Error('The server returned an incomplete notification feed.');
   const restricted=isInactive(),updated=new Map(items.filter(item=>!restricted||item.kind==='access-change').map(item=>[item.id,item])),newIds=new Set();for(const item of value.items){
    if(restricted&&item?.kind!=='access-change')continue;
    if(!item||!validId(item.id)||newIds.has(item.id)||!value.activeIds.includes(item.id)||!Number.isSafeInteger(item.revision)||item.revision<0||item.revision>value.revision||!textValue(item.kind,64)||!textValue(item.title,100)||!textValue(item.body,1000)||!validTime(item.at)||typeof item.read!=='boolean')throw Error('The server returned an incomplete notification feed.');
    newIds.add(item.id);updated.set(item.id,{id:item.id,revision:item.revision,kind:item.kind,title:item.title,body:item.body,at:item.at,read:item.read,destination:destinations.has(item.destination)&&(!restricted||['account','station'].includes(item.destination))?item.destination:null,...messageMetadata(item)});
   }
   const activeIds=restricted?value.activeIds.filter(id=>updated.get(id)?.kind==='access-change'):value.activeIds;
   if(activeIds.some(id=>!updated.has(id)))throw Error('The server returned an incomplete notification feed.');
   let nextDashboard=null;if(!restricted&&value.dashboard!==null){const card=value.dashboard;
    if(!card||!Number.isSafeInteger(card.revision)||card.revision<0||!validTime(card.generatedAt)||!textValue(card.status,80)||typeof card.hidden!=='boolean'||!card.totals||typeof card.totals!=='object'||Array.isArray(card.totals)||Object.values(card.totals).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('The server returned an incomplete live dashboard.');
    let announcement=null;if(card.announcement!==undefined&&card.announcement!==null){const pinned=card.announcement;
     if(!pinned||typeof pinned!=='object'||Array.isArray(pinned)||Object.keys(pinned).some(key=>!['id','title','body','at','templateType','urgency','meeting'].includes(key))||!validId(pinned.id)||!textValue(pinned.title,100)||!textValue(pinned.body,1000)||!validTime(pinned.at))throw Error('The server returned an incomplete pinned announcement.');
     announcement={id:pinned.id,title:pinned.title,body:pinned.body,at:pinned.at,...messageMetadata(pinned)};
    }
    let delivery=null;if(isAdmin()&&card.delivery!==undefined){const counts=card.delivery,keys=['queued','failed','providerAccepted','expiredFailures'];if(!counts||typeof counts!=='object'||Array.isArray(counts)||Object.keys(counts).some(key=>!keys.includes(key))||keys.some(key=>!Number.isSafeInteger(counts[key])||counts[key]<0))throw Error('The server returned incomplete delivery status.');delivery=Object.fromEntries(keys.map(key=>[key,counts[key]]));}
    nextDashboard={revision:card.revision,generatedAt:card.generatedAt,status:card.status,totals:{...card.totals},hidden:card.hidden,announcement,delivery};
   }
   return{revision:value.revision,serverTime:value.serverTime,items:activeIds.map(id=>updated.get(id)),dashboard:nextDashboard};
  }
  function applyFeed(result){const candidate=result?.feed||result;if(Number.isSafeInteger(candidate?.revision)&&candidate.revision<revision)return false;const value=checkedFeed(result);revision=value.revision;feedRevision=value.revision;items=value.items;dashboard=value.dashboard;serverTime=value.serverTime;receivedAt=now();stale=false;render();return true;}
  function advanceAcknowledgedRevision(result){if(Number.isSafeInteger(result?.revision)&&result.revision>revision)revision=result.revision;}
  function accessFailure(error){if(![401,403].includes(error?.status))return false;clearState();identity='';render();status.textContent='Notification access changed. Refresh your account before retrying.';return true;}
  async function refresh(){
   synchronizeIdentity();if(!runnable()){cancelTimer();if(identity){stale=true;status.textContent=root.navigator?.onLine===false?'Offline. Showing the last known notifications.':'Notifications refresh when this app is visible.';render()}return false;}
   if(inFlight)return inFlight.promise;cancelTimer();const version=epoch,who=identity,request={promise:null};retry.disabled=true;if(!receivedAt)status.textContent='Loading notifications…';
   request.promise=(async()=>{try{const result=await C.api('notifications-feed',{afterRevision:feedRevision});if(!current(version,who))return false;if(applyFeed(result))status.textContent='Updated '+new Date(serverTime).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'})+' IST';failures=0;return true;}
    catch(error){if(current(version,who)&&!accessFailure(error)){stale=true;status.textContent='Notifications unavailable. '+errorMessage(error);failures++;render()}return false;}
    finally{if(current(version,who)&&inFlight===request){inFlight=null;retry.disabled=false;schedule(Math.min(60000,pollMs*2**Math.min(failures,4)))}}})();inFlight=request;return request.promise;
  }
  async function markRead(id){
   if(!identity||identity!==profileKey()||!items.some(item=>item.id===id))return false;if(items.find(item=>item.id===id)?.read)return true;if(readBusy.has(id))return false;
   const version=epoch,who=identity;readBusy.add(id);render();try{const result=await C.api('notifications-read',{id});if(!current(version,who))return false;advanceAcknowledgedRevision(result);items=items.map(item=>item.id===id?{...item,read:true}:item);render();return true;}
   catch(error){if(current(version,who)&&!accessFailure(error)){status.textContent='Could not mark the notification read. '+errorMessage(error);stale=true;}return false;}
   finally{if(current(version,who)){readBusy.delete(id);render()}}
  }
  async function setDashboardHidden(hidden){
   if(!dashboard||liveBusy||!identity||identity!==profileKey())return;const version=epoch,who=identity;liveBusy=true;render();
   try{const result=await C.api('notifications-dashboard',{hidden});if(!current(version,who))return;advanceAcknowledgedRevision(result);dashboard={...dashboard,hidden};status.textContent=hidden?'Live card hidden. Restore it at any time.':'Live card restored.';render();}
   catch(error){if(current(version,who)&&!accessFailure(error))status.textContent='Could not change the live card. '+errorMessage(error);}
   finally{if(current(version,who)){liveBusy=false;render();if(center.open)(dashboard?.hidden?restoreLive:hideLive).focus()}}
  }
  async function endAnnouncement(){
   if(!isAdmin()||endBusy||!dashboard?.announcement)return;const version=epoch,who=identity,id=dashboard.announcement.id;endBusy=true;render();status.textContent='Ending the pinned announcement…';
   try{await C.api('notifications-end',{id});if(!current(version,who)||!isAdmin())return;const previous=inFlight?.promise;if(previous)await previous;if(current(version,who))await refresh();}
   catch(error){if(current(version,who)&&!accessFailure(error))status.textContent='Could not end the pinned announcement. '+errorMessage(error);}
   finally{if(current(version,who)){endBusy=false;render()}}
  }
  function draft(){
   const title=draftTitle.value.trim(),message=body.value.replace(/\r\n?/g,'\n').trim();if(!title||title.length>100||message.length>1000)throw Error('Add a title up to 100 characters and a message up to 1000 characters.');
   const selectedType=type.value;if(!Object.prototype.hasOwnProperty.call(templateTypes,selectedType))throw Error('Choose an announcement type.');
   const template={type:selectedType,title,body:message,urgency:selectedType==='emergency'?'emergency':urgency.value};
   if(selectedType==='meeting'){
    if(meetingLocation.value.trim())template.meetingLocation=meetingLocation.value.trim();if(meetingLocation.value.length>120)throw Error('Use a shorter meeting location.');
    if(meetingTime.value){const at=new Date(meetingTime.value);if(!Number.isFinite(at.getTime()))throw Error('Choose a valid meeting time.');template.meetingTime=at.toISOString();}
   }
   let selectedAudience;if(audience.value==='everyone')selectedAudience={type:'everyone'};else{const selected=roleInputs.filter(input=>input.checked).map(input=>input.value).sort();if(!selected.length)throw Error('Select at least one audience role.');selectedAudience={type:'roles',roles:selected};}
   return{template,audience:selectedAudience};
  }
  function checkedPreview(result){if(!result||!Number.isSafeInteger(result.recipientCount)||result.recipientCount<0||typeof result.previewHash!=='string'||!/^[a-f0-9]{64}$/.test(result.previewHash))throw Error('The server returned an incomplete audience preview.');return{recipientCount:result.recipientCount,previewHash:result.previewHash};}
  async function previewAnnouncement(){
   if(!isAdmin()||previewing||sending)return;let snapshot;try{snapshot=draft()}catch(error){composeStatus.textContent=error.message;return;}invalidatePreview('Preparing audience preview…');const version=epoch,who=identity,edit=composeEpoch,fingerprint=JSON.stringify(snapshot);previewing=true;paintComposer();
   try{const result=await C.api('notifications-preview',snapshot);if(!current(version,who)||edit!==composeEpoch||!isAdmin()||fingerprint!==JSON.stringify(draft()))return;preview={...checkedPreview(result),snapshot,fingerprint,requestId:requestId()};previewResult.replaceChildren(make('h4',snapshot.template.title),make('p',snapshot.template.body),make('p','Audience: '+(snapshot.audience.type==='everyone'?'Everyone':snapshot.audience.roles.map(role=>audienceRoles[role]).join(', '))),make('p',preview.recipientCount+' recipients'));
    if(snapshot.template.meetingLocation)previewResult.append(make('p','Location: '+snapshot.template.meetingLocation));if(snapshot.template.meetingTime)previewResult.append(make('p','Time: '+new Date(snapshot.template.meetingTime).toLocaleString('en-IN')));previewResult.hidden=false;composeStatus.textContent=preview.recipientCount?'Review this message and its audience, then choose Send announcement.':'No authorized recipients. Change the audience and preview again.';
   }catch(error){if(current(version,who)&&edit===composeEpoch&&!accessFailure(error)){preview=null;composeStatus.textContent='Preview unavailable. '+errorMessage(error)}}
   finally{if(current(version,who)){previewing=false;paintComposer()}}
  }
  function requestId(){if(root.crypto?.randomUUID)return root.crypto.randomUUID();if(root.NavrangLive?.uuid)return root.NavrangLive.uuid();const bytes=new Uint8Array(16);if(root.crypto?.getRandomValues)root.crypto.getRandomValues(bytes);else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const value=Array.from(bytes,n=>n.toString(16).padStart(2,'0')).join('');return value.slice(0,8)+'-'+value.slice(8,12)+'-'+value.slice(12,16)+'-'+value.slice(16,20)+'-'+value.slice(20);}
  async function sendAnnouncement(){
   if(!isAdmin()||!preview||sending||preview.recipientCount===0)return;let snapshot;try{snapshot=draft()}catch(error){invalidatePreview(error.message);return;}if(JSON.stringify(snapshot)!==preview.fingerprint){invalidatePreview();return;}
   const version=epoch,who=identity,approved=preview;sending=true;for(const input of form.querySelectorAll('input,select,textarea,button'))input.disabled=true;paintComposer();composeStatus.textContent='Sending this announcement…';
   try{const result=await C.api('notifications-send',{requestId:approved.requestId,...snapshot,previewHash:approved.previewHash});if(!current(version,who)||!isAdmin())return;
    if(result?.previewChanged===true||result?.changedPreview===true||result?.code==='preview_changed'){invalidatePreview('The audience changed. Preview again before sending.');return;}
    if(result?.sent!==true&&!validId(result?.eventId)&&!validId(result?.id))throw Error('The server did not confirm that the announcement was saved.');
    invalidatePreview('Announcement queued for delivery. Device receipt is not yet confirmed.');if(autoStart)refresh();
   }catch(error){if(current(version,who)&&!accessFailure(error)){if(error?.status===409)invalidatePreview('The audience changed. Preview again before sending.');else composeStatus.textContent='Announcement could not be confirmed. Retry sends this same reviewed announcement once. '+errorMessage(error);}}
   finally{if(current(version,who)){sending=false;for(const input of form.querySelectorAll('input,select,textarea,button'))input.disabled=false;paintComposer()}}
  }
  const onVisibility=()=>{if(!runnable()){cancelTimer();stale=true;render()}else refresh()};
  const onOffline=()=>{cancelTimer();stale=true;if(identity)status.textContent='Offline. Showing the last known notifications.';render()};
  doc.addEventListener('visibilitychange',onVisibility);root.addEventListener('online',onVisibility);root.addEventListener('offline',onOffline);
  const unsubscribe=C.on(event=>{
   if(['auth','profile'].includes(event.type)){const changed=synchronizeIdentity(event.type==='auth');if(changed&&autoStart&&runnable())refresh();else if(!runnable())cancelTimer();}
   else if(['notification','notifications','push'].includes(event.type)&&autoStart&&runnable())refresh();
  });
  synchronizeIdentity();if(autoStart&&runnable())refresh();
  return{refresh,open,close,clear,destroy(){if(destroyed)return;destroyed=true;epoch++;cancelTimer();if(typeof unsubscribe==='function')unsubscribe();doc.removeEventListener('visibilitychange',onVisibility);root.removeEventListener('online',onVisibility);root.removeEventListener('offline',onOffline);close();center.remove();opener.remove();topbar?.classList.remove('has-notification-center');}};
 }
 root.NavrangNotificationCenter={mount};if(root.GateClient)root.NavrangNotifications=mount();
})(globalThis);
