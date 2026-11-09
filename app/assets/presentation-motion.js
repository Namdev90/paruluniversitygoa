(function(root){
 'use strict';
 const running=new Map(),easing='cubic-bezier(.22,1,.36,1)';
 const media=root.matchMedia?.('(prefers-reduced-motion: reduce)');
 const reduced=()=>document.hidden||media?.matches||root.NavrangReducedMotion===true;
 const selected=()=>document.querySelector('#main-nav button[aria-current="page"]:not([hidden])');
 let generation=0;

 function cancel(){
  generation++;
  for(const [animation,finish] of running){animation.cancel();finish()}
 }

 function play(element,frames,duration,cleanup){
  if(reduced()||!element?.animate){cleanup?.();return}
  const animation=element.animate(frames,{duration,easing});
  const finish=()=>{
   if(running.delete(animation))cleanup?.();
  };
  running.set(animation,finish);
  animation.onfinish=animation.oncancel=finish;
 }

 function enter(element,{x=0,y=6}={}){
  if(!element||element.closest('[hidden]'))return;
  play(element,[{opacity:.86,transform:`translate3d(${x}px,${y}px,0)`},{opacity:1,transform:'none'}],160);
 }

 function morph(element,from,box=element.getBoundingClientRect(),cleanup){
  if(!from?.width||!from.height||!box.width||!box.height){cleanup?.();return}
  play(element,[
   {transformOrigin:'top left',transform:`translate3d(${from.left-box.left}px,${from.top-box.top}px,0) scale(${from.width/box.width},${from.height/box.height})`},
   {transformOrigin:'top left',transform:'none'},
  ],185,cleanup);
 }

 function moveSelection(from,to){
  const nav=to.parentElement,box=to.getBoundingClientRect(),rail=nav.getBoundingClientRect();
  if(!from.width||!from.height||!box.width||!box.height||!to.animate)return;
  const marker=document.createElement('span');
  marker.className='nav-motion-marker';
  marker.setAttribute('aria-hidden','true');
  Object.assign(marker.style,{left:`${box.left-rail.left-nav.clientLeft}px`,top:`${box.top-rail.top-nav.clientTop}px`,width:`${box.width}px`,height:`${box.height}px`});
  nav.append(marker);
  nav.dataset.moving='true';
  morph(marker,from,box,()=>{marker.remove();delete nav.dataset.moving});
 }

 function navigate(commit,{sensitive=false}={}){
  const route=document.body.dataset.route;
  const before=sensitive||reduced()?null:selected();
  const from=before&&(document.querySelector('#main-nav>.nav-motion-marker')||before).getBoundingClientRect();
  cancel();
  const current=generation;
  commit();
  if(sensitive||reduced()||current!==generation||route===document.body.dataset.route)return;
  const panel=document.querySelector('main .view:not([hidden])'),after=selected();
  if(before&&after&&before!==after&&from.width){
   const forward=Boolean(before.compareDocumentPosition(after)&Node.DOCUMENT_POSITION_FOLLOWING);
   enter(panel,{x:forward?12:-12,y:0});
   moveSelection(from,after);
  }else enter(panel);
 }

 root.NavrangMotion={
  navigate,enter,morph,cancel,reduced,
  dismiss(element,done){play(element,[{opacity:1},{opacity:0}],150,done)},
  setReducedMotion(value){
   root.NavrangReducedMotion=value===true;
   document.body.dataset.reducedMotion=String(root.NavrangReducedMotion);
   if(root.NavrangReducedMotion)cancel();
  },
 };
 root.GateClient?.on(e=>{if(e.type==='auth'||e.type==='profile')cancel()});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
 media?.addEventListener?.('change',()=>{if(media.matches)cancel()});
})(globalThis);
