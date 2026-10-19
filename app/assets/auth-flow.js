/* Sign-in stages express intent only; existing server permissions remain authoritative. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id),roles={checker:['Checker','Scan and verify entry'],helpdesk:['Help Desk','Resolve registration cases'],faculty:['Faculty','View and download reports']};
 function mount({client:C,onStageChange=()=>{}}){
  if(!$('view-login')||!C)return null;
  let stage='welcome',role='checker',pending=false,operation='',fallback=false,epoch=0;
  try{const saved=sessionStorage.getItem('navrang-login-intent');if(roles[saved])role=saved}catch{}
  const make=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
  const card=document.querySelector('.login-card'),welcome=make('div',null,'auth-welcome'),heading=make('h2','Welcome to Navrang'),staff=make('button','Staff','button primary wide'),admin=$('show-admin-login');
  welcome.id='auth-welcome';staff.id='auth-staff';staff.type='button';welcome.append(heading,staff);admin.textContent='Administrator';admin.className='button secondary wide';welcome.append(admin);
  const picker=make('div',null,'auth-roles'),title=make('h2','Choose your work'),group=make('div',null,'login-role-picker');picker.id='auth-roles';group.setAttribute('role','group');group.setAttribute('aria-label','Choose your work');picker.append(title,group);
  for(const [name,copy]of Object.entries(roles)){const b=make('button',null,'login-role');b.type='button';b.dataset.loginRole=name;b.append(make('strong',copy[0]),make('small',copy[1]));b.onclick=()=>{role=name;try{sessionStorage.setItem('navrang-login-intent',role)}catch{}go('signin')};group.append(b)}
  const back=make('button','← Back','text-button');back.type='button';back.id='auth-back';back.onclick=()=>api.back();card.prepend(back);const brand=card.querySelector('.combined-brand-login');(brand||back).after(welcome,picker);
  const originalBack=$('show-checker-login');originalBack.hidden=true;
  function paint(){
   welcome.hidden=stage!=='welcome';picker.hidden=stage!=='roles';$('signin-panel').hidden=stage!=='signin';$('admin-signin').hidden=stage!=='admin';back.hidden=stage==='welcome';
   $('signin-title').textContent=roles[role][0]+' sign-in';$('signin-copy').textContent=roles[role][1];$('code-login').hidden=role==='faculty';$('google-browser-signin').hidden=!fallback||stage!=='signin';$('google-signin').disabled=pending;$('google-signin').setAttribute('aria-busy',String(pending));
   for(const b of group.children)b.setAttribute('aria-pressed',String(b.dataset.loginRole===role));
   card.dataset.authStage=stage;onStageChange(stage);
  }
  function go(next){stage=next;paint();const focusTitle=next==='welcome'?heading:next==='roles'?title:next==='admin'?document.querySelector('#admin-signin h2'):$('signin-title');if(focusTitle){focusTitle.tabIndex=-1;focusTitle.focus?.()}}
  function reset({preservePending=false}={}){if(preservePending&&pending)return;epoch++;pending=false;operation='';fallback=false;stage='welcome';paint()}
  const api={stage:()=>stage,reset,back:()=>{if(pending)return false;if(stage==='welcome')return false;go(stage==='signin'?'roles':'welcome');return true}};
  staff.onclick=()=>go('roles');admin.onclick=()=>go('admin');originalBack.onclick=()=>go('roles');
  $('google-signin').onclick=async()=>{
   if(pending||stage!=='signin'||C.profile())return;pending=true;fallback=false;operation=root.crypto?.randomUUID?.()||'login-'+Date.now()+'-'+(++epoch);const op=operation,version=epoch;paint();
   try{await C.googleLogin(op);if(!C.native&&version===epoch&&operation===op){pending=false;paint()}}
   catch{if(version===epoch&&operation===op){pending=false;fallback=!!C.native;paint()}}
  };
  $('google-browser-signin').onclick=async()=>{if(pending||stage!=='signin'||C.profile())return;try{await C.googleBrowserLogin()}catch{fallback=true;paint()}};
  C.on(e=>{
   if(e.type==='credential'&&e.data?.operationId===operation&&operation){if(['cancelled','failed','completed'].includes(e.data.phase)){pending=false;fallback=e.data.phase!=='completed';paint()}}
   if(e.type==='auth'&&C.profile())reset();
  });
  paint();return api;
 }
 root.AuthFlow={mount};root.NavrangAuth=mount({client:root.GateClient});
})(globalThis);
