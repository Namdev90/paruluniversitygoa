/* Shared app-owned picker. The original select remains the form/data authority. */
(() => {
 'use strict';
 const controls=new WeakMap();let active=null,dialog,list,title,cancel,sequence=0;
 const text=(el,value)=>{if(el.textContent!==value)el.textContent=value};
 const disabled=s=>s.disabled||s.matches(':disabled');
 const label=s=>s.getAttribute('aria-label')||[...(s.labels||[])].map(l=>l.textContent.trim()).join(' ')||'Choose an option';
 const unavailable=s=>!s.isConnected||disabled(s)||s.hidden||Boolean(s.parentElement?.closest('[hidden],[inert],[aria-hidden="true"]'))||Boolean(s.…925 tokens truncated…nt('span');mark.className='navrang-select-check';mark.setAttribute('aria-hidden','true');b.append(name,mark);
   if(o.selected&&!b.disabled)selected=b;
   b.onclick=()=>{
    if(active!==s||unavailable(s)||b.disabled)return;
    const current=[...s.options].indexOf(o);if(current<0||o.disabled||o.closest('optgroup:disabled')){close();return}
    const changed=s.selectedIndex!==current;s.selectedIndex=current;s.removeAttribute('aria-invalid');refresh(s);close();
    if(changed){s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}))}
   };list.append(b);
  });
  const b=controls.get(s);b.setAttribute('aria-expanded','true');dialog.showModal();
  const focus=selected||list.querySelector('button:not(:disabled)')||cancel;focus.tabIndex=0;focus.focus();focus.scrollIntoView?.({block:'nearest'});
 }
 function upgrade(s){
  if(controls.has(s)||s.multiple||s.size>1)return;
  const b=document.createElement('button');b.type='button';b.className='button secondary navrang-select-trigger';b.setAttribute('aria-haspopup','listbox');b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','navrang-select-dialog');
  if(!s.id)s.id='navrang-selector-'+(++sequence);
  b.id=s.id+'-trigger';controls.set(s,b);s.classList.add('navrang-select-source');s.tabIndex=-1;s.setAttribute('aria-hidden','true');s.after(b);b.onclick=()=>open(s);
  s.addEventListener('change',()=>refresh(s));s.addEventListener('input',()=>refresh(s));
  s.addEventListener('focus',()=>b.focus());s.addEventListener('invalid',e=>{e.preventDefault();b.setAttribute('aria-invalid','true');b.focus();open(s)});
  refresh(s);
 }
 // Preserve normal DOM setters while reflecting programmatic changes in the visible trigger.
 for(const property of ['value','selectedIndex']){
  const descriptor=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,property);
  if(descriptor?.get&&descriptor?.set&&descriptor.configurable)Object.defineProperty(HTMLSelectElement.prototype,property,{...descriptor,set(value){descriptor.set.call(this,value);refresh(this)}});
 }
 function scan(){if(!globalThis.document?.documentElement)return;document.querySelectorAll('select').forEach(s=>{upgrade(s);refresh(s)});if(active&&unavailable(active))close()}
 let scheduled=false;
 function schedule(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;scan()})}
 new MutationObserver(records=>{if(active&&records.some(r=>r.target===active||active.contains(r.target)))close();schedule()}).observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','inert','aria-hidden','selected','label','value']});
 document.addEventListener('click',e=>{const l=e.target.closest?.('label');if(!l)return;const s=l.control;if(s&&controls.has(s)){e.preventDefault();open(s)}},true);
 document.addEventListener('reset',()=>requestAnimationFrame(scan),true);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close()});
 globalThis.NavrangMenus=Object.freeze({closeTop:close,refresh:scan});
 scan();
})();
