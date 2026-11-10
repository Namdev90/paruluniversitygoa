(function(root){
 'use strict';
 const $=id=>document.getElementById(id);
 function mount({client:C}){
  if(!$('view-login')||!C)return null;
  const card=document.querySelector('.login-card'),signin=$('signin-panel'),admin=$('admin-signin');
  const input=$('checker-code'),keypad=$('staff-keypad');
  let stage='signin';
  function paint(){
   signin.hidden=stage!=='signin';admin.hidden=stage!=='admin';card.dataset.authStage=stage;
  }
  function go(next){
   if(stage===next)return;
   root.NavrangMotion?.cancel();
   stage=next;paint();
   const panel=stage==='admin'?admin:signin;
   panel.querySelector('h2').focus();
   root.NavrangMotion?.enter(panel,{y:stage==='signin'?-6:6});
  }
  for(const key of ['1','2','3','4','5','6','7','8','9','0','A','B','C','D','E','F','NG-','-','⌫','Clear']){
   const button=document.createElement('button');
   button.type='button';button.className='button secondary';button.textContent=key;
   if(key==='⌫')button.setAttribute('aria-label','Delete last character');
   if(key==='Clear')button.setAttribute('aria-label','Clear staff code');
   button.addEventListener('mousedown',event=>event.preventDefault());
   button.onclick=()=>{
    const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
    if(key==='Clear')input.value='';
    else if(key==='⌫')input.setRangeText('',start===end?Math.max(0,start-1):start,end,'end');
    else if(input.value.length-(end-start)+key.length<=input.maxLength)input.setRangeText(key,start,end,'end');
   };
   keypad.append(button);
  }
  const api={stage:()=>stage,reset(){stage='signin';paint()},back(){
   if(stage!=='admin')return false;
   go('signin');return true;
  }};
  $('show-admin-login').onclick=()=>go('admin');$('show-checker-login').onclick=()=>api.back();
  paint();return api;
 }
 root.AuthFlow={mount};root.NavrangAuth=mount({client:root.GateClient});
})(globalThis);
