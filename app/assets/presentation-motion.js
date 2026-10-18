/* Animate current authorized DOM only. Never snapshot or retain an old private screen. */
(function(root){
 'use strict';let running=[];
 function cancel(){for(const a of running)a.cancel();running=[];}
 function navigate(commit,{sensitive=false}={}){
  cancel();const before=document.querySelector('main .view:not([hidden]) .panel')?.getBoundingClientRect();commit();
  if(sensitive||root.matchMedia?.('(prefers-reduced-motion: reduce)').matches||root.NavrangReducedMotion===true)return;
  const panel=document.querySelector('main .view:not([hidden]) .panel'),after=panel?.getBoundingClientRect();if(!panel?.animate||!before||!after||!after.width||!after.height)return;
  const dx=Math.max(-48,Math.min(48,before.left-after.left)),dy=Math.max(-40,Math.min(40,before.top-after.top));
  running.push(panel.animate([{opacity:.84,transform:`translate(${dx}px,${dy}px) scale(.97)`,borderRadius:'28px'},{opacity:1,transform:'none',borderRadius:getComputedStyle(panel).borderRadius}],{duration:400,easing:'cubic-bezier(.2,0,.1,1)'}));
 }
 root.NavrangMotion={navigate,cancel,setReducedMotion(value){root.NavrangReducedMotion=value===true;document.body.dataset.reducedMotion=String(root.NavrangReducedMotion);if(root.NavrangReducedMotion)cancel()}};
 root.GateClient?.on(e=>{if(['auth','profile'].includes(e.type))cancel()});
})(globalThis);
