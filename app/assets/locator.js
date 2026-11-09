(function(root){
 'use strict';
 const eventId='O9KL3',validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
 const eligible=p=>p&&p.active===true&&(p.role==='admin'||p.role==='checker'&&(p.scanner===true||p.helpdesk===true));
 const signature=p=>eligible(p)?JSON.stringify([p.role,p.checkerId||'admin',p.active,p.scanner,p.helpdesk,p.name]):'';
 function mount({client,container=root.document.getElementById('settings-locator-host')||root.document.getElementById('view-account'),now=Date.now,autoStart=true,onShareOnce,onSound,onBright}={}){
  if(!client||typeof client.api!=='function'||typeof client.profile!=='function'||!container)throw Error('Locator requires an authenticated station host.');
  const doc=container.ownerDocument,owned=new Set(),performed=new Set(),intentIds=new Map();
  let generation=0,profile=null,profileKey='',alive=true,section,dialog,state={},statusKnown=false,inbox=[],roster=[],selected=null,selectedFix=null,message='',busy=false,inFlight=null,sample=null,expiryTimer=null,lastRefresh=-Infinity,dirty=false;
  const make=(tag,text,id)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;if(id)el.id=id;return el};
  const button=(text,id,fn)=>{const el=make('button',text,id);el.type='button';el.className='button secondary';el.onclick=fn;return el};
  const uuid=()=>{if(root.crypto?.randomUUID)return root.crypto.randomUUID();const bytes=new Uint8Array(16);root.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return Array.from(bytes,(v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('')};
  const identity=p=>eligible(p)&&!client.sessionExpired?.(p)?signature(p):'';
  const live=g=>alive&&g===generation&&!!profileKey&&profileKey===identity(client.profile());
  const currentRequest=id=>inbox.find(item=>item.requestId===id&&Date.parse(item.expiresAt)>now()&&!['expired','stopped','declined','found'].includes(item.state));
  const duty=()=>state.onDuty===true&&Date.parse(state.expiresAt)>now();
  function cancelSample(){sample?.abort();sample=null;}
  function closeOwned(){for(const el of owned){if(el!==section&&el!==dialog)el.remove()}for(const el of [...owned])if(el!==section&&el!==dialog)owned.delete(el)}
  function clear(){generation++;cancelSample();root.clearTimeout(expiryTimer);expiryTimer=null;section?.remove();dialog?.remove();for(const el of owned)el.remove();owned.clear();section=null;dialog=null;state={};statusKnown=false;inbox=[];roster=[];selected=null;selectedFix=null;message='';busy=false;inFlight=null;dirty=false;performed.clear();intentIds.clear();}
  function setMessage(value){message=value;const status=doc.getElementById('locator-message');if(status)status.textContent=value;}
  function showConsent(){if(!dialog||!statusKnown)return;doc.getElementById('locator-location-consent').checked=state.location===true;doc.getElementById('locator-findme-consent').checked=state.findMe===true;if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();else dialog.setAttribute('open','');root.NavrangMotion?.enter(dialog);}
  function hideConsent(){if(typeof dialog?.close==='function'&&dialog.open)dialog.close();else dialog?.removeAttribute('open');}
  function build(){
   section=make('article',undefined,'locator-panel');section.className='panel locator-panel';owned.add(section);
   container.append(section);
   section.append(make('h3',profile.role==='admin'?'Find one on-duty volunteer':'Voluntary duty & find-me'));
   section.append(make('p','Optional duty sharing is visible and expires. Missing location does not imply misconduct.','locator-purpose'));
   const status=make('p','','locator-status');status.setAttribute('role','status');section.append(status);
   const feedback=make('p','','locator-message');feedback.setAttribute('role','status');section.append(feedback);
   if(profile.role==='admin'){
    const label=make('label','Search on-duty volunteers');const search=make('input',undefined,'locator-search');search.type='search';label.append(search);search.oninput=renderRoster;
    section.append(label,make('p','','locator-roster-count'),make('div',undefined,'locator-roster'),make('article',undefined,'locator-selected'));
   }else{
    const controls=make('div');controls.className='locator-actions';
    const label=make('label','Duty duration');const duration=make('select',undefined,'locator-duration');for(const n of [15,30,60]){const option=make('option',n+' minutes');option.value=String(n);duration.append(option)}duration.value='30';label.append(duration);
    controls.append(button('Review optional choices','locator-review-consent',showConsent),label,
     button('Start duty','locator-start-duty',()=>mutate('locator-duty',{durationMinutes:Number(duration.value)})),
     button('Stop duty & sharing','locator-stop',stop),button('Share location once','locator-share-once',()=>shareOnce()));
    section.append(controls,make('div',undefined,'locator-inbox'));
    dialog=make('dialog',undefined,'locator-consent-dialog');dialog.className='locator-consent';dialog.setAttribute('aria-labelledby','locator-consent-title');owned.add(dialog);doc.body.append(dialog);
    dialog.append(make('h2','Your optional duty choices','locator-consent-title'));
    dialog.append(make('p','While you choose to be on duty, assigned event administrators can see your latest explicitly shared location, its time and accuracy. Coordinates are visible for at most two minutes. There is no location history or background tracking. Find-me lets a named administrator request one volunteer; you choose whether to respond, share once, play a short ordinary sound or open an identification screen. Duty expires within one hour. Stop ends sharing and pending requests. You can continue station work without either option.','locator-disclosure'));
    const choices=make('fieldset');choices.append(make('legend','Choose separately; both are optional'));
    for(const [id,text]of [['locator-location-consent','Allow Share location once during my duty'],['locator-findme-consent','Allow named find-me requests during my duty']]){const label=make('label');const input=make('input',undefined,id);input.type='checkbox';label.append(input,doc.createTextNode(text));choices.append(label)}
    dialog.append(choices,button('Save optional choices','locator-save-consent',()=>saveConsent(false)),button('Continue without optional features','locator-continue-without',()=>saveConsent(true)));
   }
   section.append(button('Refresh duty status','locator-refresh',()=>refresh({manual:true})));
   root.NavrangMotion?.enter(section);
  }
  function render(){
   if(!section)return;
   const active=duty(),status=doc.getElementById('locator-status');
   if(profile.role!=='admin'&&!active){cancelSample();closeOwned();inbox=[];}
   status.textContent=!statusKnown?'Duty status has not been confirmed. Optional actions are unavailable.':profile.role==='admin'?(state.assigned===true?'Only volunteers who opted in and started duty appear here.':'Event administrator assignment is not configured.'):
    active?'On duty until '+new Date(state.expiresAt).toLocaleTimeString()+'. Stop is always available.':'Off duty. Optional sharing is stopped.';
   if(profile.role!=='admin'){
    doc.getElementById('locator-review-consent').disabled=!statusKnown||busy;
    doc.getElementById('locator-start-duty').disabled=!statusKnown||busy||active||state.disclosureVersion!==1||!(state.location||state.findMe);
    const stopButton=doc.getElementById('locator-stop');stopButton.hidden=!active&&!sample;stopButton.disabled=false;
    doc.getElementById('locator-share-once').disabled=!statusKnown||busy||!active||state.location!==true||!!sample;
    renderInbox();
   }else{renderRoster();renderSelected()}
   doc.getElementById('locator-message').textContent=message;
   root.clearTimeout(expiryTimer);
   const deadlines=[state.expiresAt,...inbox.map(x=>x.expiresAt),selectedFix?.expiresAt].map(Date.parse).filter(x=>Number.isFinite(x)&&x>now());
   if(deadlines.length)expiryTimer=root.setTimeout(()=>{if(!alive)return;cancelSample();closeOwned();render()},Math.min(2147483647,Math.max(1,Math.min(...deadlines)-now())));
  }
  function renderInbox(){
   const host=doc.getElementById('locator-inbox');host.replaceChildren();if(!duty())return;
   for(const item of inbox){
    if(!validId(item.requestId)||!currentRequest(item.requestId))continue;
    const card=make('article');card.className='locator-request';card.append(make('h4',String(item.administrator||'An assigned administrator')+' is trying to find you'),make('p','You choose how to respond. This request expires at '+new Date(item.expiresAt).toLocaleTimeString()+'.'));
    if(item.state==='device-acknowledged')card.append(make('p','Your device acknowledged the request. This does not mean you have been found.'));
    for(const [choice,text,attribute]of [['acknowledged','Acknowledge','ack'],['sound','Play find-me sound','sound'],['bright','Open identification screen','bright'],['declined','Decline','decline']]){
     const control=button(text,null,()=>respond(item,choice));control.setAttribute('data-locator-'+attribute,'');control.disabled=busy||performed.has(item.requestId+':'+choice);card.append(control);
    }
    if(state.location){const share=button('Share location once',null,()=>shareOnce(item.requestId));share.disabled=busy||!!sample;card.append(share)}
    host.append(card);
   }
  }
  function renderRoster(){
   const host=doc.getElementById('locator-roster');if(!host)return;const search=(doc.getElementById('locator-search').value||'').toLocaleLowerCase();host.replaceChildren();
   const rows=roster.filter(p=>validId(p.volunteerId)&&String(p.name||'').toLocaleLowerCase().includes(search));doc.getElementById('locator-roster-count').textContent=roster.length+' on duty; '+rows.length+' matching';
   for(const person of rows){const b=button(String(person.name||'Volunteer'),null,()=>selectPerson(person));b.dataset.locatorPerson=person.volunteerId;b.setAttribute('aria-pressed',String(selected?.volunteerId===person.volunteerId));host.append(b)}
  }
  function renderSelected(){
   const host=doc.getElementById('locator-selected');if(!host)return;host.replaceChildren();if(!selected)return;
   host.append(make('h4',String(selected.name||'Selected volunteer')));
   if(selectedFix&&Date.parse(selectedFix.expiresAt)>now()){
    const f=selectedFix;host.append(make('p','Latest reported fix: '+Number(f.latitude).toFixed(6)+', '+Number(f.longitude).toFixed(6)),make('p','Accuracy ±'+Math.round(f.accuracy)+' m; captured '+new Date(f.capturedAt).toLocaleTimeString()+'. This is a single sample, not live tracking.'));
   }else host.append(make('p','No current shared location. This is not evidence of misconduct.'));
   if(selected.findMe){const find=button('Request find-me',null,()=>mutate('locator-request',{volunteerId:selected.volunteerId},result=>{selected.request=result;renderSelected()}));find.disabled=busy;host.append(find)}
   if(selected.request){
    const r=selected.request;const terminal={found:'Found, confirmed by administrator.',declined:'The volunteer declined this optional request.',stopped:'The request and sharing stopped.',expired:'The request expired. No response should be inferred.'};host.append(make('p',terminal[r.state]||(r.state==='device-acknowledged'?'Device acknowledged; finding is not yet confirmed.':r.delivery==='sent'?'Sent; device acknowledgement is pending.':'Request queued; delivery has not been confirmed.')));
    const found=button('Confirm found',null,()=>mutate('locator-found',{requestId:r.requestId},result=>{selected.request=result;renderSelected()}));found.disabled=busy||r.state==='found';host.append(found);
   }
  }
  async function selectPerson(person){
   if(!live(generation)||profile.role!=='admin')return;
   selected={...person};selectedFix=null;render();const g=generation,id=person.volunteerId;
   if(!person.location)return;
   try{const result=await client.api('locator-view',{eventId,volunteerId:id});if(live(g)&&selected?.volunteerId===id){selectedFix=result.fix||null;render()}}
   catch(e){if(live(g)&&selected?.volunteerId===id)setMessage(e.message||'Current shared location is unavailable.')}
  }
  async function mutate(action,payload,after){
   if(!live(generation)||!statusKnown||busy)return;
   const g=generation,key=action+JSON.stringify(payload),params={eventId,...payload};
   if(!params.requestId){if(!intentIds.has(key))intentIds.set(key,uuid());params.requestId=intentIds.get(key)}
   busy=true;render();
   try{const result=await client.api(action,params);if(!live(g))return;intentIds.delete(key);
    if(action==='locator-consent'||action==='locator-duty'){state=result;if(action==='locator-consent')hideConsent()}
    if(after)after(result);else if(action==='locator-consent'||action==='locator-duty')setMessage('Your optional duty choices are saved.');
   }catch(e){if(live(g))setMessage(e.message||'The server could not confirm this action. Retry when connected.')}
   finally{if(live(g)){busy=false;render()}}
  }
  async function saveConsent(decline){
   cancelSample();closeOwned();
   await mutate('locator-consent',{disclosureVersion:1,location:!decline&&doc.getElementById('locator-location-consent').checked,findMe:!decline&&doc.getElementById('locator-findme-consent').checked});
  }
  async function stop(){
   if(!live(generation))return;generation++;cancelSample();closeOwned();inbox=[];state={...state,onDuty:false};busy=false;inFlight=null;const g=generation;setMessage('Stopped on this device. Confirming server stop.');render();
   try{const result=await client.api('locator-stop',{eventId,requestId:uuid()});if(live(g)){state=result;setMessage('Off duty. Sharing and pending requests are stopped.');render()}}
   catch(e){if(live(g))setMessage('Stopped on this device. Server confirmation is pending; the last shared fix expires within two minutes.')}
  }
  async function shareOnce(requestId){
   if(!live(generation)||!statusKnown||!duty()||!state.location||sample||requestId&&!currentRequest(requestId))return;
   if(typeof onShareOnce!=='function'){setMessage('One-shot location is not available in this host. Existing station work remains available.');return;}
   const g=generation,controller=new root.AbortController();sample=controller;render();
   try{
    const fix=await onShareOnce({requestId,signal:controller.signal});
    if(!live(g)||controller.signal.aborted||!duty()||!state.location||requestId&&!currentRequest(requestId))return;
    const payload={eventId,sampleId:uuid(),latitude:fix.latitude,longitude:fix.longitude,accuracy:fix.accuracy,capturedAt:fix.capturedAt};if(requestId)payload.requestId=requestId;
    const result=await client.api('locator-fix',payload);if(live(g)&&!controller.signal.aborted)setMessage(result.saved?'One location sample was shared. It expires within two minutes.':'This sample was already handled.');
   }catch(e){if(live(g)&&!controller.signal.aborted)setMessage(e.message||'Location was not shared. You can continue station work.')}
   finally{if(sample===controller){sample=null;if(live(g))render()}}
  }
  async function respond(item,choice){
   if(!currentRequest(item.requestId)||performed.has(item.requestId+':'+choice)||busy)return;
   const g=generation;
   await mutate('locator-respond',{requestId:item.requestId,choice},result=>{
    if(!live(g)||!currentRequest(item.requestId))return;
    Object.assign(item,result);performed.add(item.requestId+':'+choice);
    if(result.performAction===true){
     if(choice==='sound'&&typeof onSound==='function')onSound({requestId:item.requestId});
     if(choice==='bright'&&typeof onBright==='function')onBright({requestId:item.requestId,administrator:item.administrator,expiresAt:item.expiresAt});
    }
    if(choice==='declined')inbox=inbox.filter(x=>x!==item);
   });
  }
  async function refresh({manual=false}={}){
   if(!live(generation))return;if(inFlight)return inFlight;if(manual&&now()-lastRefresh<5000){setMessage('Status was checked recently. Try again in a few seconds.');return;}
   const g=generation;lastRefresh=now();dirty=false;
   const operation=(async()=>{
    try{
     const value=await client.api('locator-status',{eventId});if(!live(g))return;state=value;statusKnown=true;setMessage('');
     if(profile.role==='admin'){
      if(state.assigned!==true){roster=[];selected=null;selectedFix=null;}
      else if(selected){if(value.request?.volunteerId===selected.volunteerId)selected.request=value.request;else delete selected.request;}
     }
     render();
     if(profile.role==='admin'&&state.assigned===true){const response=await client.api('locator-roster',{eventId});if(live(g)){roster=Array.isArray(response.items)?response.items:[];if(selected){const current=roster.find(x=>x.volunteerId===selected.volunteerId);if(!current){selected=null;selectedFix=null}else{selected={...selected,...current};if(!current.location)selectedFix=null}}render()}}
     else if(profile.role!=='admin'){
      if(state.disclosureVersion!==1)showConsent();
      if(duty()&&state.findMe){const response=await client.api('locator-inbox',{eventId});if(live(g)){inbox=Array.isArray(response.items)?response.items.filter(x=>validId(x.requestId)).map(x=>({...x})):[];render()}}
     }
    }catch(e){if(live(g)){if(e.status===401||e.status===403){statusKnown=false;hideConsent();cancelSample();closeOwned();roster=[];inbox=[];selected=null;selectedFix=null;state={...state,onDuty:false,assigned:false};render()}setMessage(e.message||'Optional duty service is unavailable. Existing station work remains available.')}}
    finally{if(live(g)){inFlight=null;if(dirty&&!doc.hidden)Promise.resolve().then(()=>refresh())}}
   })();inFlight=operation;return operation;
  }
  function changed(event){
   const next=client.profile(),key=identity(next);
   if(key!==profileKey){clear();profile=next;profileKey=key;if(key){build();render();if(autoStart)refresh()}return;}
   if(event?.type==='locator-invalidated'&&event.data?.eventId===eventId&&event.data?.principal===(profile.role==='admin'?'admin':profile.checkerId)){dirty=true;if(!doc.hidden)refresh();}
  }
  function visibility(){if(doc.hidden){cancelSample();closeOwned()}else if(dirty)refresh()}
  const off=typeof client.on==='function'?client.on(changed):()=>{};doc.addEventListener('visibilitychange',visibility);changed();
  return {refresh,destroy(){if(!alive)return;alive=false;off?.();doc.removeEventListener('visibilitychange',visibility);clear();profile=null;profileKey='';}};
 }
 root.NavrangLocator=Object.freeze({mount});
 if(root.GateClient&&root.document.getElementById('view-account'))root.NavrangDuty=mount({client:root.GateClient,onShareOnce:root.GateClient.locatorSample});
})(globalThis);
