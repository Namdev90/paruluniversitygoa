/* Native owns authorization, audio and credentials. This panel sends user intent only. */
(function(root){
 'use strict';
 const states=new Set(['unavailable','idle','joining','listening','requesting','talking','closed']);
 const fields=new Set(['available','ready','state','microphone','canTalk','message']);
 const unavailable=()=>({available:false,ready:false,state:'unavailable',microphone:false,canTalk:false,message:'Voice is unavailable in this build.'});
 function checked(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!fields.has(key))||!states.has(value.state)||
   ['available','ready','microphone','canTalk'].some(key=>typeof value[key]!=='boolean')||typeof value.message!=='string'||value.message.length>240||
   value.ready&&!value.available||value.microphone&&(!value.available||!value.ready||value.state!=='talking')||value.canTalk&&(!value.available||!value.ready||!['listening','requesting','talking'].includes(value.state)))return unavailable();
  return{available:value.available,ready:value.ready,state:value.state,microphone:value.microphone,canTalk:value.canTalk,message:value.message};
 }
 function mount({client:C=root.GateClient,container}={}){
  const doc=root.document;if(!doc||!C||!container||doc.getElementById('notification-voice'))return null;
  let visible=false,destroyed=false,scope='',held=null,snapshot=unavailable();
  const make=(tag,text,cls)=>{const node=doc.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node};
  const button=(id,label,cls='button quiet')=>{const node=make('button',label,cls);node.id=id;node.type='button';return node};
  const panel=make('section',null,'notification-live');panel.id='notification-voice';panel.setAttribute('aria-labelledby','notification-voice-title');
  const heading=make('h3','Voice');heading.id='notification-voice-title';
  const status=make('p',null,'notification-live-state');status.id='notification-voice-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');
  const help=make('p','Hold Talk, Space or Enter to speak. Release or leave the panel to stop.');help.id='notification-voice-help';
  const controls=make('div',null,'notification-item-actions'),join=button('notification-voice-join','Go on duty and join','button secondary'),leave=button('notification-voice-leave','Leave voice'),talk=button('notification-voice-talk','Hold to talk','button primary');
  talk.setAttribute('aria-describedby',help.id+' '+status.id);talk.setAttribute('aria-pressed','false');talk.style.touchAction='none';
  controls.append(join,leave,talk);panel.append(heading,status,help,controls);container.append(panel);
  function identity(){
   const p=C.profile?.();if(!p?.active||!['admin','checker'].includes(p.role)||p.role==='checker'&&p.scanner===false&&!p.helpdesk&&!p.reports)return '';
   for(const value of [p.expiresAt,p.accessExpiresAt].filter(Boolean)){const at=Date.parse(value);if(!Number.isFinite(at)||Date.now()>=at)return '';}
   return JSON.stringify([p.role,p.checkerId||'',p.active,p.scanner!==false,!!p.helpdesk,!!p.reports,p.station||'',p.expiresAt||'',p.accessExpiresAt||'']);
  }
  const usable=()=>!destroyed&&visible&&!!scope&&scope===identity()&&!doc.hidden&&root.navigator?.onLine!==false;
  function render(){
   const available=usable()&&snapshot.available,allowed=available&&snapshot.ready,joined=['joining','listening','requesting','talking'].includes(snapshot.state);
   join.disabled=!available||!['idle','closed'].includes(snapshot.state);leave.disabled=!usable()||!joined;talk.disabled=!allowed||!(snapshot.canTalk||held);
   talk.setAttribute('aria-pressed',String(usable()&&snapshot.microphone));
   help.hidden=!available;controls.hidden=!available&&!joined;
   const messages={unavailable:'Voice is unavailable in this build.',idle:'Voice is off. Join when you are ready.',joining:'Joining voice. Microphone is off.',listening:'Listening. Microphone is off.',requesting:'Requesting a turn. Microphone is off.',talking:'Microphone is on. Release Talk to stop.',closed:'Voice is disconnected. Join again when you are ready.'};
   status.textContent=!visible?'Voice is off.':!scope?'Sign in with approved staff access to use voice.':root.navigator?.onLine===false?'Voice is disconnected while offline.':!snapshot.available?'Voice is unavailable. No audio is connected.':messages[snapshot.state];
  }
  function invoke(action){
   if(typeof C.voice!=='function')return unavailable();
   try{return checked(C.voice(action,{}))}catch{if(action!=='cancel'&&action!=='status')try{C.voice('cancel',{})}catch{}return unavailable()}
  }
  function readStatus(){if(!usable())return;snapshot=invoke('status');if(held&&(!snapshot.available||!snapshot.ready||!['requesting','talking'].includes(snapshot.state)))stop('cancel');else render();}
  function stop(action='release',force=false){
   const previous=held;held=null;
   if(previous?.kind==='pointer')try{if(talk.hasPointerCapture?.(previous.id))talk.releasePointerCapture(previous.id)}catch{}
   if(previous||force)snapshot=invoke(action);render();
  }
  function cancel(action='cancel'){stop(action,true);snapshot=unavailable();render();}
  function press(input){
   if(held||!usable()||talk.disabled||!snapshot.available||!snapshot.ready||!snapshot.canTalk)return;
   held=input;snapshot=invoke('press');
   if(!snapshot.available||!snapshot.ready){stop('cancel',true);return;}render();
  }
  join.onclick=()=>{if(!usable()||join.disabled)return;stop();snapshot=invoke('join');render()};
  leave.onclick=()=>{if(!usable()||leave.disabled)return;stop();snapshot=invoke('leave');render()};
  talk.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false)return;event.preventDefault();press({kind:'pointer',id:event.pointerId});if(held?.kind==='pointer'&&held.id===event.pointerId)try{talk.setPointerCapture(event.pointerId)}catch{}});
  const pointerUp=event=>{if(held?.kind==='pointer'&&held.id===event.pointerId){event.preventDefault();stop()}};
  const pointerCancel=event=>{if(held?.kind==='pointer'&&held.id===event.pointerId)stop('cancel')};
  const keyDown=event=>{if(![' ','Enter'].includes(event.key))return;event.preventDefault();if(!event.repeat)press({kind:'key',key:event.key})};
  const keyUp=event=>{if(held?.kind==='key'&&held.key===event.key){event.preventDefault();stop()}};
  talk.addEventListener('keydown',keyDown);talk.addEventListener('click',event=>event.preventDefault());
  talk.addEventListener('lostpointercapture',pointerCancel);talk.addEventListener('contextmenu',event=>{event.preventDefault();stop('cancel')});
  talk.addEventListener('blur',()=>{if(held)stop('cancel')});
  root.addEventListener('pointerup',pointerUp);root.addEventListener('pointercancel',pointerCancel);root.addEventListener('keyup',keyUp);
  const onBlur=()=>{if(visible)cancel()},onOffline=()=>{if(visible)cancel('leave')},onVisibility=()=>{if(doc.hidden){if(visible)cancel()}else readStatus()};
  root.addEventListener('blur',onBlur);root.addEventListener('pagehide',onBlur);root.addEventListener('offline',onOffline);doc.addEventListener('visibilitychange',onVisibility);
  const unsubscribe=C.on?.(event=>{
   if(destroyed)return;
   if(event.type==='auth'||event.type==='profile'&&scope!==identity()){cancel('leave');scope='';render();}
   // Query current native state instead of trusting a queued event payload from
   // a previous account, press, join or closed panel. Status never starts audio.
   else if(event.type==='voice')readStatus();
  });
  render();
  return{
   show(){if(destroyed)return;visible=true;scope=identity();readStatus();render()},
   hide(){if(destroyed)return;if(visible||held)cancel();visible=false;scope='';snapshot=unavailable();render()},
   destroy(){if(destroyed)return;this.hide();destroyed=true;if(typeof unsubscribe==='function')unsubscribe();root.removeEventListener('pointerup',pointerUp);root.removeEventListener('pointercancel',pointerCancel);root.removeEventListener('keyup',keyUp);root.removeEventListener('blur',onBlur);root.removeEventListener('pagehide',onBlur);root.removeEventListener('offline',onOffline);doc.removeEventListener('visibilitychange',onVisibility);panel.remove()}
  };
 }
 root.NavrangVoice={mount};
})(globalThis);
