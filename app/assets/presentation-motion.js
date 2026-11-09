/* Current authorized DOM only. Geometry ties choose left/top; corners use both axes. */
(function(root){
 'use strict';let running=new Set();const duration=240,easing='cubic-bezier(.2,0,.1,1)';
 const media=root.matchMedia?.('(prefers-reduced-motion: reduce)');
 const reduced=()=>document.hidden||media?.matches||root.NavrangReducedMotion===true;
 function cancel(){for(const a of running)a.cancel();running.clear()}
 function offset(rect,width,height){const x=(rect.left+rect.width/2)/Math.max(1,width),y=(rect.top+rect.height/2)/Math.max(1,height),dx=Math.min(x,1-x),dy=Math.min(y,1-y),corner=Math.abs(dx-dy)<=.12;return {x:corner||dx<dy?(x<=.5?-24:24):0,y:corner||dy<=dx?(y<=.5?-24:24):0}}
 function enter(element){if(reduced()||!element?.animate)return;const r=element.getBoundingClientRect();if(!r.width||!r.height)return;const delta=offset(r,root.innerWidth,root.innerHeight),a=element.animate([{opacity:0,transform:`translate(${delta.x}px,${delta.y}px)`},{opacity:1,transform:'none'}],{duration,easing});running.add(a);a.onfinish=()=>running.delete(a);a.oncancel=()=>running.delete(a)}
 function navigate(commit,{sensitive=false}={}){cancel();commit();if(sensitive||reduced())return;for(const panel of document.querySelectorAll('main .view:not([hidden]) > .panel,main .view:not([hidden]) > .scanner-panel'))enter(panel)}
 root.NavrangMotion={navigate,enter,offset,cancel,setReducedMotion(value){root.NavrangReducedMotion=value===true;document.body.dataset.reducedMotion=String(root.NavrangReducedMotion);if(root.NavrangReducedMotion)cancel()}};
 root.GateClient?.on(e=>{if(['auth','profile'].includes(e.type))cancel()});document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});media?.addEventListener?.('change',()=>{if(media.matches)cancel()});
})(globalThis);
