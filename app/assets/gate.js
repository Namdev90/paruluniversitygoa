(function(){
 'use strict';
 const C=GateClient,L=NavrangLive,W=NavrangWorkbook,P=NavrangPackage,$=id=>document.getElementById(id);
 let view='home',adminTab='registrations',preview=null,previewName='',page=0,selected=null,syncBusy=false,model={dataRevision:-1,cursor:0,records:{},entries:{},stats:{},checkers:[]};
 const titles={home:'Gate home',entries:'Entry log',files:'Data & files',admin:'Admin console'};
 const initials=name=>(name||'NG').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
 const when=at=>at?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at)):'—';
 const money=amount=>amount==null?'Needs review':'₹'+Number(amount).toLocaleString('en-IN',{maximumFractionDigits:2});
 function notice(text){$('notice').textContent=text;$('notice').hidden=false;}
 function connection(online,text){$('connection').classList.toggle('online',online);$('connection').querySelector('span').textContent=text||(online?'Live · connected':'Awaiting network');}
 function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
 async function busy(button,work){if(button.disabled)return;button.disabled=true;try{return await work()}catch(e){notice(e.message)}finally{button.disabled=false}}
 function renderAuth(){
  const p=C.profile(),admin=p?.role==='admin';$('signin-panel').hidden=!!p;$('signedin-panel').hidden=!p;
  $('scan').disabled=!p?.active;$('manual-submit').disabled=!p?.active;
  $('account').textContent=initials(p?.name);$('welcome').textContent=p?'Welcome, '+p.name.split(' ')[0]+'.':'Ready to welcome.';
  if(p){$('checker-name').textContent=p.name;$('checker-access').textContent=admin?'Administrator · all stations':p.active?'Approved checker · '+(p.method==='google'?'Google account':'assigned code'):'Awaiting approval. Ask Namdev to activate your checker account.';}
  $('admin-signin').hidden=admin;$('admin-console').hidden=!admin;
  $('admin-role-message').textContent=p&&!admin?'You are signed in as a checker. Administrator credentials are required here.':'';
  $('apply-shared').disabled=!admin;$('apply-shared').textContent=admin?'Update shared database':'Admin sign-in required for shared update';
 }
 function setView(next){
  if(!titles[next])next='home';view=next;for(const name of Object.keys(titles))$('view-'+name).hidden=name!==next;
  for(const b of document.querySelectorAll('[data-view]'))b.classList.toggle('selected',b.dataset.view===next);
  $('page-title').textContent=titles[next];history.replaceState(null,'','#'+next);window.scrollTo(0,0);renderAuth();if(next==='admin'&&C.profile()?.role==='admin')poll();if(next==='entries')renderLocal();
 }
 function setAdminTab(next){adminTab=next;for(const b of document.querySelectorAll('[data-admin-tab]')){const yes=b.dataset.adminTab===next;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',String(yes));$('admin-'+b.dataset.adminTab).hidden=!yes;}}
 function fillEntries(target,entries){
  const body=$(target);body.replaceChildren();
  for(const e of entries){const tr=node('tr');tr.append(node('td',e.name),node('td',e.ticketId),node('td',e.checker),node('td',when(e.at)));body.append(tr);}
 }
 async function renderLocal(){
  try{const s=await C.local('snapshot'),p=C.profile();
   $('home-total').textContent=p?s.stats.total??s.localCount:'—';$('home-entered').textContent=p?s.stats.admitted??'—':'—';$('home-remaining').textContent=p?s.stats.remaining??'—':'—';
   $('cache-count').textContent=s.localCount;$('pending-count').textContent=s.pending;$('sync-time').textContent=s.lastSync?'Device updated '+when(s.lastSync)+' IST':'No shared update yet';
   fillEntries('recent-entries',s.entries||[]);$('entries-empty').hidden=!!s.entries?.length;
   $('legacy-note').hidden=!s.legacyCount;$('legacy-note').textContent=s.legacyCount+' previous-version entries preserved on this phone. Export them before changing devices; they are not universal server admissions.';
  }catch(e){notice(e.message)}
 }
 function result(r){
  const popup=$('result-popup'),good=r.code==='admitted',dup=r.code==='duplicate',pending=r.code==='pending';
  popup.hidden=false;popup.classList.toggle('pending',pending);popup.classList.toggle('error',!good&&!pending);
  $('result-kicker').textContent=good?'SERVER RECEIPT SAVED':pending?'REQUEST SAVED · AWAITING SERVER':'GATE CHECK';
  $('result-title').textContent=good?'✓ Entry confirmed':dup?'Already admitted':pending?'Awaiting confirmation':'Entry not confirmed';
  const entry=r.entry,record=r.record;$('result-name').textContent=entry?.name||record?.name||r.id||'';
  $('result-details').textContent=entry?[(r.id||entry.ticketId)+(record?' · '+money(record.amount):''),entry.checker+' · '+when(entry.at)+' IST',good?'Saved on server and device. Ready for the next QR.':'One entry only. No re-entry.'].join('\n'):r.message||'Visit the help desk.';
  renderLocal();
 }
 function filteredRecords(){const q=$('student-search').value.trim().toLowerCase(),filter=$('payment-filter').value;return Object.values(model.records).filter(r=>(!q||(r.name+' '+r.id).toLowerCase().includes(q))&&(filter==='all'||filter==='eligible'&&r.eligible||filter==='blocked'&&!r.eligible||filter==='entered'&&model.entries[r.id])).sort((a,b)=>a.name.localeCompare(b.name));}
 function renderRegistrations(){
  const records=filteredRecords(),pages=Math.max(1,Math.ceil(records.length/50));page=Math.min(page,pages-1);
  const body=$('registration-rows');body.replaceChildren();
  for(const r of records.slice(page*50,page*50+50)){
   const tr=node('tr'),name=node('td'),open=node('button',r.name,'table-link');open.type='button';open.onclick=()=>showStudent(r.id);name.append(open,node('span',r.id,'cell-secondary'));
   const pay=node('td');pay.append(node('span',r.eligible?'Eligible':'Blocked','badge '+(r.eligible?'green':'red')));
   const status=node('td');status.append(node('span',model.entries[r.id]?'Entered':'Not entered','badge '+(model.entries[r.id]?'green':'')));
   const action=node('td'),edit=node('button','Edit →','table-link');edit.onclick=()=>editTicket(r);action.append(edit);
   tr.append(name,pay,node('td',money(r.amount)),status,action);body.append(tr);
  }
  $('registration-count').textContent=records.length+' results';$('page-number').textContent=(page+1)+' / '+pages;$('previous-page').disabled=page===0;$('next-page').disabled=page+1>=pages;
 }
 function showStudent(id){
  selected=id;const r=model.records[id],e=model.entries[id];$('dialog-name').textContent=r.name;const dl=$('dialog-details');dl.replaceChildren();
  for(const [k,v]of [['Transaction ID',id],['Payment',r.eligible?'Eligible':r.reason],['Amount',money(r.amount)],['Payment result',r.description],['Entry',e?'Entered · no re-entry':'Not entered'],['Checked by',e?.checker||'—'],['Time · IST',e?when(e.at):'—']])dl.append(node('dt',k),node('dd',v));
  if($('student-dialog').showModal)$('student-dialog').showModal();else $('student-dialog').setAttribute('open','');
 }
 function editTicket(r){setAdminTab('updates');$('edit-id').value=r.id;$('edit-name').value=r.name;$('edit-amount').value=r.amount??'';$('edit-quantity').value=r.quantity??'';$('edit-refund').value=r.refund??'';const status=$('edit-status');for(const o of [...status.options])if(o.dataset.custom)o.remove();if(![...status.options].some(o=>o.value===r.description)){const o=node('option',r.description||'Unknown payment status');o.value=r.description;o.dataset.custom='true';status.append(o);}status.value=r.description;$('ticket-editor').scrollIntoView({behavior:'smooth',block:'center'});}
 function renderAdmin(){
  const s=model.stats;
  for(const [key,id]of [['total','total'],['eligible','eligible'],['admitted','admitted'],['remaining','remaining'],['lastMinute','minute'],['blocked','blocked'],['duplicateAttempts','duplicates'],['blockedAttempts','refused']])$('stat-'+id).textContent=s[key]??'—';
  renderRegistrations();
  const search=$('entry-search').value.toLowerCase(),all=Object.values(model.entries).sort((a,b)=>b.seq-a.seq),filtered=all.filter(e=>(e.name+' '+e.ticketId+' '+e.checker).toLowerCase().includes(search));fillEntries('all-entry-rows',filtered);$('all-entry-empty').hidden=!!filtered.length;
  const chart=$('entry-bars');chart.replaceChildren();const counts=Array(10).fill(0);for(const e of all){const age=Math.floor((Date.now()-Date.parse(e.at))/60000);if(age>=0&&age<10)counts[9-age]++;}const max=Math.max(...counts,1);for(const n of counts){const bar=node('span');bar.style.height=Math.max(3,n/max*65)+'px';bar.title=n+' entries';chart.append(bar);}
  const staff=$('checker-list');staff.replaceChildren();
  if(!model.checkers?.length)staff.append(node('p','Add your first checker, or approve a Google sign-in here.','empty'));
  for(const ck of model.checkers||[]){
   const row=node('div',undefined,'checker-row'),avatar=node('span',initials(ck.name),'checker-avatar'),info=node('div');info.append(node('strong',ck.name),node('small',(ck.method==='google'?'Google · ':'Code · ')+(ck.active?'Active':'Inactive / awaiting approval')+' · '+ck.entries+' entries'));
   const button=node('button',ck.active?'Suspend':ck.method==='google'?'Approve':'Activate','button '+(ck.active?'quiet':'secondary'));button.onclick=()=>busy(button,async()=>{await C.api('staff-update',{id:ck.id,active:!ck.active});await poll(true);notice(ck.name+(ck.active?' suspended. Existing sessions can no longer admit.':' activated.'));});row.append(avatar,info,button);staff.append(row);
  }
 }
 async function poll(force){
  if(syncBusy||!C.profile())return;
  if(C.native&&C.profile()?.role!=='admin'){await renderLocal();return;}
  syncBusy=true;
  try{
   let updates=await C.sync(C.profile()?.role==='admin'?{dataRevision:force?-1:model.dataRevision,afterSeq:model.cursor}:undefined);
   if(!C.profile()?.active){await C.api('me');renderAuth();}if(C.profile()?.role==='admin'){model=L.merge(model,updates);while(updates.hasMore){updates=await C.sync({dataRevision:model.dataRevision,afterSeq:model.cursor});model=L.merge(model,updates);}renderAdmin();}
   connection(true);await renderLocal();
  }catch(e){connection(false,e.status===403?'Approval needed':e.status===401?'Sign in again':'Awaiting network');if(e.status===401||e.status===403){notice(e.message);try{await C.api('me');renderAuth()}catch{}}}
  finally{syncBusy=false;}
 }
 function exportCsv(entries,name){C.save(name,'text/csv',L.csv(entries))}
 function stamp(){return new Date().toISOString().slice(0,16).replace(/[T:]/g,'-')}
 async function signIn(button,action,payload){
  await busy(button,async()=>{const r=await C.api(action,payload);renderAuth();notice(r.profile.active?'Signed in as '+r.profile.name+'.':'Signed in. Ask Namdev to approve your checker account.');await poll(true);if(action==='login')setView('admin');else if(r.profile.active&&C.native)C.scan();});
 }
 for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>setView(b.dataset.view);
 for(const b of document.querySelectorAll('[data-admin-tab]'))b.onclick=()=>setAdminTab(b.dataset.adminTab);
 $('account').onclick=()=>{setView(C.profile()?.role==='admin'?'admin':'home');$('signedin-panel').scrollIntoView({behavior:'smooth',block:'center'});};
 $('scan').onclick=()=>C.scan();
 $('google-signin').onclick=()=>busy($('google-signin'),()=>C.googleLogin());
 $('checker-form').onsubmit=e=>{e.preventDefault();signIn(e.submitter||$('checker-form').querySelector('button'),'checker-login',{code:$('checker-code').value});};
 $('admin-form').onsubmit=e=>{e.preventDefault();signIn(e.submitter||$('admin-form').querySelector('button'),'login',{username:$('admin-username').value,password:$('admin-password').value}).finally(()=>$('admin-password').value='');};
 $('sign-out').onclick=()=>busy($('sign-out'),async()=>{try{await C.signOut()}catch{}model={dataRevision:-1,cursor:0,records:{},entries:{},stats:{},checkers:[]};renderAuth();connection(false,'Sign in');notice('Signed out. Saved receipts and pending scans remain on the device.');});
 $('manual-form').onsubmit=e=>{e.preventDefault();const id=$('ticket-id').value.trim().toUpperCase();if(!/^[A-Z0-9]{8}$/.test(id)){notice('Enter the exact eight-character Transaction ID.');return;}busy($('manual-submit'),()=>C.submit(id));};
 $('close-result').onclick=()=>$('result-popup').hidden=true;
 $('admin-refresh').onclick=()=>poll(true);
 $('student-search').oninput=$('payment-filter').onchange=()=>{page=0;renderRegistrations();};
 $('entry-search').oninput=renderAdmin;$('previous-page').onclick=()=>{page--;renderRegistrations()};$('next-page').onclick=()=>{page++;renderRegistrations()};
 $('close-student').onclick=()=>$('student-dialog').close();$('edit-student').onclick=()=>{$('student-dialog').close();if(selected)editTicket(model.records[selected]);};
 $('data-file').onchange=async()=>{
  preview=null;$('import-preview').hidden=true;
  try{const file=$('data-file').files[0];if(!file)return;if(file.size>8*1024*1024)throw Error('Choose a file smaller than 8 MB.');preview=file.name.toLowerCase().endsWith('.json')?P.parse(await file.text()):W.parse(await file.arrayBuffer());previewName=file.name;
   $('preview-total').textContent=preview.total;$('preview-paid').textContent=preview.eligible;$('preview-blocked').textContent=preview.blocked;$('preview-source').textContent=previewName;$('import-preview').hidden=false;renderAuth();
  }catch(e){notice(e.message)}
 };
 $('apply-shared').onclick=()=>busy($('apply-shared'),async()=>{if(!preview)throw Error('Choose and validate a file first.');if(C.profile()?.role!=='admin')throw Error('Administrator sign-in is required.');await C.api('import',{eventId:'O9KL3',records:Object.values(preview.records),source:previewName});notice('Shared registration list updated. Confirmed entry history is preserved.');await poll(true);});
 $('apply-local').onclick=()=>busy($('apply-local'),async()=>{if(!preview)throw Error('Choose and validate a file first.');await C.local('import',{records:Object.values(preview.records),source:previewName});await renderLocal();notice('Offline reference saved. Shared entry confirmation still requires the server.');});
 $('download-package').onclick=()=>{try{if(!preview)throw Error('Choose a file first.');C.save('Navrang-Registrations-'+stamp()+'.json','application/json',P.encode(preview,new Date().toISOString()));}catch(e){notice(e.message)}};
 $('backup').onclick=()=>busy($('backup'),async()=>C.save('Navrang-Backup-'+stamp()+'.json','application/json',JSON.stringify(await C.local('backup'))));
 $('export-entries').onclick=()=>busy($('export-entries'),async()=>{const b=await C.local('backup');exportCsv([...b.allEntries.map(e=>({...e,scope:'server'})),...b.legacyEntries.map(e=>({...e,scope:'legacy'}))],'Navrang-Device-Entries-'+stamp()+'.csv')});
 $('export-all').onclick=()=>exportCsv(Object.values(model.entries),'Navrang-All-Entries-'+stamp()+'.csv');
 $('create-checker-form').onsubmit=e=>{e.preventDefault();busy(e.submitter||$('create-checker-form').querySelector('button'),async()=>{const r=await C.api('staff-create',{name:$('new-checker-name').value});$('new-checker-code').textContent=r.code;$('new-code-panel').hidden=false;$('new-checker-name').value='';await poll();});};
 $('copy-code').onclick=()=>busy($('copy-code'),async()=>{if(navigator.clipboard){await navigator.clipboard.writeText($('new-checker-code').textContent);notice('Checker code copied. Share it with the assigned volunteer.');}else notice('Select and copy the checker code shown above.');});
 $('go-import').onclick=()=>setView('files');
 $('ticket-editor').onsubmit=e=>{e.preventDefault();busy(e.submitter||$('ticket-editor').querySelector('button'),async()=>{await C.api('upsert',{eventId:'O9KL3',source:'Admin manual update',records:[{id:$('edit-id').value.trim().toUpperCase(),name:$('edit-name').value.trim(),amount:$('edit-amount').value===''?null:Number($('edit-amount').value),quantity:$('edit-quantity').value===''?null:Number($('edit-quantity').value),refund:$('edit-refund').value===''?null:Number($('edit-refund').value),description:$('edit-status').value}]});notice('Shared registration saved. Other checkers receive the update automatically.');await poll(true);});};
 $('change-password-form').onsubmit=e=>{e.preventDefault();busy(e.submitter||$('change-password-form').querySelector('button'),async()=>{await C.api('admin-password',{password:$('new-admin-password').value});$('new-admin-password').value='';notice('Admin password updated. Other admin sessions have been signed out.');});};
 C.on(e=>{
  if(e.type==='result')result(e.data);
  else if(e.type==='error'||e.type==='notice')notice(e.data.message);
  else if(e.type==='sync'){renderAuth();renderLocal();if(C.native&&C.profile()?.role!=='admin')connection(true);}
  else if(e.type==='connection')connection(false,e.data.status===403?'Approval needed':'Awaiting network');
  else if(e.type==='auth'){renderAuth();poll(true);}
 });
 let startY=null,startX=0;const pull=$('pull-to-scan');
 pull.addEventListener('touchstart',e=>{if(!e.target.closest('button,input')){startY=e.touches[0].clientY;startX=e.touches[0].clientX;}},{passive:true});
 pull.addEventListener('touchend',e=>{if(startY!==null){const dy=e.changedTouches[0].clientY-startY,dx=e.changedTouches[0].clientX-startX;if(dy>85&&dy>Math.abs(dx)*2)C.scan();}startY=null;},{passive:true});
 function endIntro(){$('intro').classList.add('leaving');setTimeout(()=>$('intro').hidden=true,300);}
 $('skip-intro').onclick=endIntro;
 setTimeout(endIntro,matchMedia('(prefers-reduced-motion: reduce)').matches?70:1100);
 (async()=>{
  await C.finishGoogle();renderAuth();setView(location.hash.slice(1)||'home');await renderLocal();
  try{const cfg=await C.api('config');$('google-status').textContent=cfg.googleEnabled?'Google checkers need admin approval before scanning.':'Google sign-in awaits provider setup. Assigned checker codes are ready to use.';$('provider-note').textContent=cfg.googleEnabled?'Google provider is enabled. Approve verified accounts here.':'Google provider is not yet configured. Setup instructions are included in the repository.';}catch{connection(false);}
  if(C.profile()){try{await C.api('me');renderAuth()}catch(e){notice(e.message)}await poll(true);}else connection(false,'Sign in');
 })().catch(e=>notice(e.message));
 setInterval(()=>{if(!document.hidden)poll();},2000);
})();
