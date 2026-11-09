/* Sign-in leads directly to the stations authorized by the server. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 function mount({client:C,onStageChange=()=>{}}){
  if(!$('view-login')||!C)return null;
  let stage='signin',pending=false,operation='',fallback=false,epoch=0;
  const card=document.querySelector('.login-card'),brand=card.querySelector('.combined-brand-login');
  const signin=$('signin-panel'),admin=$('admin-signin'),adminLink=$('show-admin-login'),code=$('code-login');
  const google=$('google-signin'),browser=$('google-browser-signin'),status=$('google-status');
  function paint(){
   signin.hidden=stage!=='signin';admin.hidden=stage!=='admin';
   browser.hidden=!fallback||stage!=='signin';google.disabled=pending;adminLink.disabled=pending;code.inert=pending;
   google.setAttribute('aria-busy',String(pending));
   card.dataset.authStage=stage;onStageChange(stage);
  }
  function go(next){
   if(pending||stage===next)return;
   const motion=root.NavrangMotion;
   const from=motion&&!motion.reduced()?brand?.getBoundingClientRect():null;
   motion?.cancel();
   stage=next;paint();
   const panel=stage==='admin'?admin:signin;
   panel.querySelector('h2').focus();
   if(from)motion.morph(brand,from);
   motion?.enter(panel,{y:stage==='signin'?-6:6});
  }
  function reset({preservePending=false}={}){if(preservePending&&pending)return;epoch++;pending=false;operation='';fallback=false;stage='signin';paint()}
  const api={stage:()=>stage,reset,back:()=>{
   if(pending)return false;
   if(stage==='admin'){go('signin');return true}
   if(!code.open)return false;
   code.open=false;code.querySelector('summary').focus();return true;
  }};
  adminLink.onclick=()=>go('admin');$('show-checker-login').onclick=()=>api.back();
  google.onclick=async()=>{
   if(pending||stage!=='signin'||C.profile())return;pending=true;fallback=false;operation=root.crypto?.randomUUID?.()||'login-'+Date.now()+'-'+(++epoch);const op=operation,version=epoch;paint();
   try{await C.googleLogin(op);if(!C.native&&version===epoch&&operation===op){pending=false;paint()}}
   catch(error){if(version===epoch&&operation===op){pending=false;fallback=!!C.native;status.textContent=error?.message||'Google sign-in could not start. Try again or use a staff code.';paint()}}
  };
  browser.onclick=async()=>{if(pending||stage!=='signin'||C.profile())return;try{await C.googleBrowserLogin()}catch(error){status.textContent=error?.message||'Browser sign-in could not start.'}};
  C.on(e=>{
   if(e.type==='credential'&&e.data?.operationId===operation&&operation){if(['cancelled','failed','completed'].includes(e.data.phase)){operation='';pending=false;fallback=e.data.phase!=='completed';paint()}}
   if(e.type==='auth'&&C.profile())reset();
  });
  paint();return api;
 }
 root.AuthFlow={mount};root.NavrangAuth=mount({client:root.GateClient});
})(globalThis);
