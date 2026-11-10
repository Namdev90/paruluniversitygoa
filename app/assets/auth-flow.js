/* Sign-in leads directly to the stations authorized by the server. */
(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 function mount({client:C,onStageChange=()=>{}}){
  if(!$('view-login')||!C)return null;
  let stage='signin',operation='',channel='',preferBrowser=false,sequence=0;
  const card=document.querySelector('.login-card'),brand=card.querySelector('.combined-brand-login');
  const signin=$('signin-panel'),admin=$('admin-signin'),adminLink=$('show-admin-login'),code=$('code-login');
  const google=$('google-signin'),status=$('google-status');
  function paint(){
   const pending=!!operation;
   signin.hidden=stage!=='signin';admin.hidden=stage!=='admin';
   google.disabled=pending;adminLink.disabled=pending;code.inert=pending;
   google.setAttribute('aria-busy',String(pending));
   card.dataset.authStage=stage;onStageChange(stage);
  }
  function go(next){
   if(operation||stage===next)return;
   const motion=root.NavrangMotion;
   const from=motion&&!motion.reduced()?brand?.getBoundingClientRect():null;
   motion?.cancel();
   stage=next;paint();
   const panel=stage==='admin'?admin:signin;
   panel.querySelector('h2').focus();
   if(from)motion.morph(brand,from);
   motion?.enter(panel,{y:stage==='signin'?-6:6});
  }
  function reset({preservePending=false}={}){
   if(preservePending&&operation)return;
   operation=channel='';preferBrowser=false;stage='signin';status.textContent='';paint();
  }
  function finish(op,message=''){
   if(operation!==op)return;
   operation=channel='';status.textContent=message;paint();
  }
  async function openBrowser(op){
   if(operation!==op||channel==='browser'||C.profile())return;
   preferBrowser=true;channel='browser';status.textContent='Opening Google in your browser…';
   try{
    if(await C.googleBrowserLogin(op)===false)finish(op,'Complete sign-in in your browser.');
   }catch(error){finish(op,error?.message||'Browser sign-in could not start.')}
  }
  const api={stage:()=>stage,reset,back:()=>{
   if(operation)return true;
   if(stage==='admin'){go('signin');return true}
   if(!code.open)return false;
   code.open=false;code.querySelector('summary').focus();return true;
  }};
  adminLink.onclick=()=>go('admin');$('show-checker-login').onclick=()=>api.back();
  google.onclick=async()=>{
   if(operation||stage!=='signin'||C.profile())return;
   const op=operation=root.crypto?.randomUUID?.()||'login-'+Date.now()+'-'+(++sequence);
   channel=C.native?'native':'web';status.textContent='';paint();
   if(C.native&&preferBrowser){await openBrowser(op);return}
   try{
    const tracked=await C.googleLogin(op);
    if(channel==='web'||(channel==='native'&&tracked===false))finish(op);
   }catch(error){
    if(operation!==op)return;
    if(channel==='native')await openBrowser(op);
    else if(channel==='web')finish(op,error?.message||'Google sign-in could not start. Try again or use a staff code.');
   }
  };
  C.on(e=>{
   if(e.type==='auth'&&C.profile()){reset();return}
   if(e.type!=='credential'||!operation||e.data?.operationId!==operation)return;
   const {operationId:op,phase}=e.data;
   // The legacy host opens the browser directly for a tracked Google request.
   if(phase==='browser-opened'){finish(op,'Complete sign-in in your browser.');return}
   if(phase==='browser-failed'){finish(op,e.data.message||'Browser sign-in could not start. Try again or use a staff code.');return}
   if(channel==='native'){
    if(phase==='failed'||phase==='unavailable')void openBrowser(op);
    else if(phase==='cancelled'){
     // A cancelled sheet stays closed. Another tap can use the browser instead.
     preferBrowser=true;finish(op);
    }else if(phase==='completed')finish(op);
   }
  });
  paint();return api;
 }
 root.AuthFlow={mount};root.NavrangAuth=mount({client:root.GateClient});
})(globalThis);
