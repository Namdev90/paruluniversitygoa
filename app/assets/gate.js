(function(){
 'use strict';
 const C=GateClient,L=NavrangLive,$=id=>document.getElementById(id);
 let view='home',adminTab='registrations',selected=null,syncBusy=false,syncAgain=false,resultTimer=null,queueTimer=null,held=false,lastResult=null,queuedResults=[],introEnded=false,staffSelected=null;
 if(location.hash==='#desk')C.destination?.('desk');
 const pendingResults=new Map(),pendingAcknowledged=new Set();
 let model=emptyModel(),uiGeneration=0,pollRun=0,previousRole=C.profile()?.role||'';function emptyModel(){return{dataRevision:-1,cursor:0,records:{},entries:{},stats:{},checkers:[]}}
 const titles={home:'Navrang Gate',entries:'Entry log',account:'Your station',admin:'Admin console',login:'Navrang Gate',desk:'Help Desk',station:'Choose your station',reports:'Teacher Reports'};
 const initials=name=>(name||'NG').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
 const when=at=>at?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at)):'—';
 const money=amount=>amount==null?'Review':'₹'+Number(amount).toLocaleString('en-IN',{maximumFractionDigits:2});
 const exactId=raw=>/^[A-Za-z0-9]{8}$/.test(raw.trim())?raw.trim().toUpperCase():null;
 const hasValue=value=>value!==null&&value!==undefined&&String(value).trim()!=='';
 const fullWhen=at=>at&&Number.isFinite(Date.parse(at))?new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(at))+' IST':hasValue(at)?String(at):'';
 function paymentDetails(record){if(!record)return[];return[['Amount',hasValue(record.amount)?money(record.amount):''],['Quantity',record.quantity],['Refund',hasValue(record.refund)?money(record.refund):''],['Payment status',record.description],['Payment date and time',fullWhen(record.paymentAt)],['Payment method',record.paymentMethod],['Payment reference',record.paymentReference],['Eligibility issue',record.eligible===false?record.reason:'']].filter(([,value])=>hasValue(value))}
 function receiptDetails(entry){if(!entry||!['checker','checkerId','at','actualAdmittedAt','observedScanAt','source','seq','note','admissionBasis'].some(key=>hasValue(entry[key])))return[];const correction=entry.admissionBasis==='organizer_confirmed';return[['Entry basis',correction?'Organizer-confirmed attendance':'Server-confirmed entry'],[correction?'Recorded by':'Checked by',entry.checker],[correction?'Correction recorded':'Confirmed entry',fullWhen(correction?entry.at:entry.actualAdmittedAt||entry.at)],['Observed scan',correction?fullWhen(entry.observedScanAt):''],['Physical entry',correction?fullWhen(entry.actualAdmittedAt):''],['Checker ID',entry.checkerId],['Receipt source',entry.source],['Receipt number',entry.seq],['Entry note',entry.note]].filter(([,value])=>hasValue(value))}

 const expired=p=>!!p&&[p.accessExpiresAt,p.expiresAt].filter(Boolean).some(value=>{const at=Date.parse(value);return !Number.isFinite(at)||Date.now()>=at});
 const isAdmin=()=>C.profile()?.role==='admin'&&!expired(C.profile());const data=()=>model;
 function station(p=C.profile()){if(!p)return '';if(p.station!=null)return p.station;return p.scanner!==false&&!p.helpdesk?'checker':p.scanner===false&&p.helpdesk?'helpdesk':'';}
 const canScan=()=>!!C.profile()?.active&&!expired(C.profile())&&(isAdmin()||station()==='checker'&&C.profile()?.scanner!==false);
 const canDesk=()=>!!C.profile()?.active&&!expired(C.profile())&&(isAdmin()||station()==='helpdesk'&&C.profile()?.helpdesk===true);
 const canReports=()=>isAdmin()||!!C.profile()?.active&&!expired(C.profile())&&C.profile()?.reports===true;
 const assignedView=()=>isAdmin()?'admin':needsName(C.profile())?'station':canScan()?'home':canDesk()?'desk':canReports()?'reports':'station';
 const listViews=new Map(); // Only already-authorized RAM records enter the paginated lists.
 function feedback(kind){if(typeof C.feedback==='function')C.feedback(kind,true);}
 let noticeTimer;function notice(text){clearTimeout(noticeTimer);$('notice').textContent=text;$('notice').hidden=false;if(!/client ID|client secret|organizer.s attention/i.test(text))noticeTimer=setTimeout(()=>{$('notice').hidden=true},9000)}
 function connection(online,text){$('connection').classList.toggle('online',online);$('connection').querySelector('span').textContent=text||(online?'Live':'Offline');}
 function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n}
 function show(id,modal=true){const d=$(id);if(d.open){if(!modal||d.dataset.modal==='true')return;close(id)}d.dataset.modal=String(modal);if(modal&&d.showModal)d.showModal();else if(d.show)d.show();else d.setAttribute('open','')}
 function close(id){const d=$(id);if(d.close)d.close();else d.removeAttribute('open');delete d.dataset.modal}
 async function busy(button,work){if(button.disabled)return;const generation=uiGeneration;button.disabled=true;button.setAttribute('aria-busy','true');try{return await work()}catch(e){if(generation===uiGeneration)notice(e.message)}finally{button.disabled=false;button.removeAttribute('aria-busy');if(button===$('manual-submit'))button.disabled=held||!canScan()||needsName(C.profile())}}
 function destination(){return C.destination?.()||'home'}
 function needsName(p){return p?.role==='checker'&&p.method==='google'&&p.nameConfirmed===false&&!p.reports}
 function renderAuth(){
  const p=C.profile(),admin=isAdmin();if(previousRole==='admin'&&!admin){uiGeneration++;pollRun++;syncBusy=false;syncAgain=false;clearAdminView()}previousRole=p?.role||'';document.body.classList.toggle('login-mode',!p||view==='login');$('main-nav').hidden=!p;$('admin-nav').hidden=!admin;
  if(!canScan()&&lastResult){queuedResults=[];releaseResult();}
  $('scan').disabled=!canScan()||needsName(p)||held;$('manual-submit').disabled=!canScan()||needsName(p)||held;
  $('scan-nav').hidden=!canScan();$('entries-nav').hidden=!admin;$('desk-nav').hidden=!canDesk();$('reports-nav').hidden=!canReports();$('switch-station').hidden=!admin;document.querySelector('[data-view=station]').hidden=!admin&&(canScan()||canDesk()||canReports());$('name-form').querySelector('button').textContent=needsName(p)||!station()?'Save name & choose station':'Save real name';
  $('home-stats').classList.toggle('staff-stats',!admin);$('home-total-label').textContent=admin?'Registered':'My scans';$('home-entered-label').textContent=admin?'Entered':'Total entries';$('home-remaining-card').hidden=!admin;$('device-strip').hidden=!admin;$('desk-staff-stats').hidden=admin||!p?.active;
  $('account').textContent=initials(p?.name);$('welcome').textContent=p?'Welcome, '+p.name.split(' ')[0]+'.':'Ready to welcome.';
  if(p){$('checker-name').textContent=p.name;$('checker-access').textContent=admin?'Administrator · all stations':p.active?[(p.scanner!==false?'Checker':''),(p.helpdesk?'Help Desk':''),(p.reports?'Teacher Reports':'')].filter(Boolean).join(' + ')+' · '+(p.method==='google'?'Google verified':'assigned staff code'):'Waiting for Namdev to assign access.';}
  $('change-name').hidden=p?.role!=='checker'||p.method!=='google';$('admin-role-message').textContent=p&&!admin?'Administrator credentials are required here.':'';
  if(!p&&view!=='login')setView('login');
  if(p&&(['admin','entries'].includes(view)&&!admin||['home','entries'].includes(view)&&(!canScan()||needsName(p))||view==='desk'&&(!canDesk()||needsName(p))||view==='reports'&&!canReports()||view==='station'&&!admin&&!needsName(p)&&(canScan()||canDesk()||canReports())))setView(assignedView());
  paintStations();
  if(needsName(p)&&introEnded&&!$('name-dialog').open){$('real-name').value=p.name==='Checker'?'':p.name;show('name-dialog')}
 }
 function setView(next){const commit=()=>commitView(next);return globalThis.NavrangMotion?globalThis.NavrangMotion.navigate(commit,{sensitive:!C.profile()||next==='login'}):commit();}
 function commitView(next){
  if(!titles[next])next='home';if(!C.profile())next='login';if(C.profile()&&!isAdmin()&&(next==='admin'||next==='entries'||next==='station'&&(station()||canReports())&&(canScan()||canDesk()||canReports())))next=assignedView();if(C.profile()&&((next==='home'&&!canScan())||(next==='desk'&&!canDesk())||(next==='reports'&&!canReports())||needsName(C.profile())&&next!=='account'))next=assignedView();view=next;document.body.dataset.route=next;
  for(const name of Object.keys(titles))$('view-'+name).hidden=name!==next;
  for(const b of document.querySelectorAll('[data-view]')){const active=b.dataset.view===next;b.classList.toggle('selected',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}document.querySelector('main').scrollTop=0;
  $('page-title').textContent=titles[next];history.replaceState(null,'','#'+next);renderAuth();if(next==='admin')renderAdmin();if(next==='entries')renderLocal();if(next==='desk')globalThis.NavrangDesk?.refresh(true);if(next==='reports')globalThis.NavrangReports?.refresh();
 }
 function paintStations(){const p=C.profile();if(!p)return;const chosen=station();$('station-title').textContent='Your station, '+p.name.split(' ')[0]+'.';$('station-copy').textContent=needsName(p)?'Save your real name to continue.':chosen&&!isAdmin()?'Station saved. Only Namdev can change it.':'Choose your station once. Namdev controls later changes.';
  for(const role of ['checker','helpdesk']){const allowed=!!p.active&&(isAdmin()||(role==='checker'?p.scanner!==false:p.helpdesk===true)),requested=p.requestedRole===role,b=$('station-'+role);b.hidden=!isAdmin()&&!!chosen&&chosen!==role;b.classList.toggle('ready',allowed);b.classList.toggle('requested',!allowed&&requested);b.disabled=needsName(p)||!isAdmin()&&!!chosen&&!allowed;$('station-'+role+'-status').textContent=allowed?'Access approved':requested?'Awaiting Namdev’s approval':'Admin approval required';$('station-'+role+'-action').textContent=allowed?(role==='checker'?'Start scanning →':'Open Help Desk →'):chosen?'Station saved':'Choose this station →';}
  $('station-message').textContent=(p.accessExpiresAt?'Temporary access · until '+when(p.accessExpiresAt)+' IST. ':'')+(chosen?'Your '+(chosen==='checker'?'Checker':'Help Desk')+' station is saved. Only Namdev can change it in Admin → Staff.':'Your first choice is saved to your account. Choosing a station does not grant permission.');
 }
 async function chooseStation(role){const button=$('station-'+role);await busy(button,async()=>{if(needsName(C.profile()))return;if(!isAdmin()){if(station()){if(station()!==role){notice('Only Namdev can change your saved station.');return}}else{await C.api('staff-request',{station:role});await C.api('me')}}const allowed=role==='checker'?canScan():canDesk();setView(assignedView());if(!allowed){paintStations();feedback('pending');return}C.destination?.(role==='checker'?'home':'desk');setView(role==='checker'?'home':'desk');feedback('transition');if(role==='checker'&&C.native)C.scan()});paintStations()}
 $('station-checker').onclick=()=>chooseStation('checker');$('station-helpdesk').onclick=()=>chooseStation('helpdesk');$('switch-station').onclick=()=>{if(isAdmin())setView('station')};
 function afterSignIn(){globalThis.NavrangAuth?.reset();uiGeneration++;pollRun++;syncBusy=false;syncAgain=false;renderAuth();setView(assignedView());globalThis.NavrangDesk?.refresh();poll(true)}
 function setAdminTab(next){adminTab=next;for(const b of document.querySelectorAll('[data-admin-tab]')){const yes=b.dataset.adminTab===next;b.classList.toggle('selected',yes);b.setAttribute('aria-selected',String(yes));b.tabIndex=yes?0:-1;$('admin-'+b.dataset.adminTab).hidden=!yes}}
 for(const tab of document.querySelectorAll('[data-admin-tab]'))tab.addEventListener('keydown',e=>{const tabs=[...document.querySelectorAll('[data-admin-tab]')],index=tabs.indexOf(tab);let target;if(e.key==='ArrowRight')target=tabs[(index+1)%tabs.length];else if(e.key==='ArrowLeft')target=tabs[(index-1+tabs.length)%tabs.length];else if(e.key==='Home')target=tabs[0];else if(e.key==='End')target=tabs.at(-1);if(target){e.preventDefault();setAdminTab(target.dataset.adminTab);target.focus()}});setAdminTab(adminTab);
 // Pagination searches the complete authorized RAM collection, never a broader server scope.
 function updateList(target,items,options){
  let state=listViews.get(target);
  if(!state){
   const body=$(target),scroller=body.closest('.rows-scroll')||body,pager=node('div',undefined,'compact-pager'),previous=node('button','← Previous','button quiet'),label=node('span','1 / 1'),next=node('button','Next →','button quiet');
   previous.type=next.type='button';previous.id=target+'-previous';next.id=target+'-next';previous.setAttribute('aria-controls',target);next.setAttribute('aria-controls',target);label.setAttribute('role','status');pager.setAttribute('aria-label','List pages');pager.append(previous,label,next);$(options.status).before(pager);
   state={body,scroller,items:[],cache:new Map(),page:0,query:null,options:null,pager,previous,next,label};
   previous.onclick=()=>{state.page--;paintList(state)};next.onclick=()=>{state.page++;paintList(state)};listViews.set(target,state);
   if(globalThis.ResizeObserver){state.observer=new ResizeObserver(()=>{if(isAdmin()&&state.options){state.size=0;paintList(state)}});state.observer.observe(scroller);}
  }
  if(state.query!==options.query){state.size=0;state.page=0;state.scroller.scrollTop=0}
  state.items=items;state.options=options;state.query=options.query;paintList(state);
 }
 function paintList(state){
  const {body,scroller,options,items}=state,active=document.activeElement,activeRow=body.contains(active)?active.closest('[data-list-key]'):null;
  const activeKey=activeRow?.dataset.listKey,activeIndex=activeRow?[...activeRow.querySelectorAll('button,a,input,select')].indexOf(active):-1;
  scroller.classList.remove('list-condensed');
  const header=body.closest('table')?.querySelector('thead')?.getBoundingClientRect().height||0;
  const available=scroller.clientHeight-header;
  let size=state.size||6,part,cache;
  function draw(){
   part=globalThis.NavrangPages.pageItems(items,{page:state.page,size});
   cache=new Map();const wanted=part.items.map(item=>{const key=String(options.key(item)),signature=options.signature?options.signature(item):JSON.stringify(item),old=state.cache.get(key);const row=old?.signature===signature?old.row:options.draw(item);row.dataset.listKey=key;cache.set(key,{row,signature});return row;});
   for(let i=0;i<wanted.length;i++)if(body.children[i]!==wanted[i])body.insertBefore(wanted[i],body.children[i]||null);
   while(body.children.length>wanted.length)body.lastElementChild.remove();
  }
  draw();
  if(available>0){
   // Re-measure the newly drawn page, including wrapped names and warnings.
   // Keep a conservative size across Next so tall later rows cannot skip items.
   for(let pass=0;pass<12;pass++){
    const height=Math.max(0,...[...body.children].map(n=>n.getBoundingClientRect().height));
    const next=height>0?Math.max(1,Math.min(size,Math.floor(available/height))):size;
    if(next===size)break;size=next;draw();
   }
  }
  const tallest=Math.max(0,...[...body.children].map(n=>n.getBoundingClientRect().height));scroller.classList.toggle('list-condensed',available>0&&size===1&&tallest>available);
  state.size=size;state.page=part.page;state.cache=cache;
  if(activeKey&&activeIndex>=0&&document.activeElement!==active&&cache.has(activeKey))cache.get(activeKey).row.querySelectorAll('button,a,input,select')[activeIndex]?.focus({preventScroll:true});
  state.previous.disabled=part.page===0;state.next.disabled=part.page===part.pages-1;state.label.textContent=(part.page+1)+' / '+part.pages;state.pager.hidden=part.pages===1;scroller.scrollTop=0;
  $(options.status).textContent=options.summary+' · Page '+(part.page+1)+' of '+part.pages;
 }
 const searchIndexes=new Map();
 function searchIndex(kind,source,sort,text){let cached=searchIndexes.get(kind);if(!cached||cached.source!==source){cached={source,rows:Object.values(source).sort(sort).map(row=>({row,text:text(row).toLowerCase()}))};searchIndexes.set(kind,cached)}return cached.rows}
 function clearLists(){searchIndexes.clear();for(const state of listViews.values()){state.items=[];state.cache.clear();state.page=0;state.query=null;state.pager.hidden=true;state.body.replaceChildren();state.scroller.scrollTop=0;$(state.options.status).textContent=''}}
 function showEntry(e){if(!isAdmin())return;selected=null;$('dialog-name').textContent=e.name||e.ticketId;const dl=$('dialog-details');dl.replaceChildren();for(const [label,value]of [['Ticket',e.ticketId],...receiptDetails(e)].filter(([,v])=>hasValue(v)))dl.append(node('dt',label),node('dd',value));$('edit-student').hidden=true;show('student-dialog')}
 function entryRow(e){const tr=node('tr'),values=[e.name,e.ticketId,e.checker,e.admissionBasis==='organizer_confirmed'?'Correction recorded '+when(e.at)+' IST · physical entry time unknown':when(e.actualAdmittedAt||e.at)+' IST · confirmed entry'];values.forEach((value,index)=>{const cell=node('td');if(index===0){const b=node('button',value,'table-link');b.type='button';b.onclick=()=>showEntry(e);cell.append(b)}else cell.append(node('span',value,'cell-text'));tr.append(cell)});return tr}
 function renderEntries(target,search,status,empty){
  const loaded=isAdmin()?searchIndex('entries',model.entries,(a,b)=>b.seq-a.seq,e=>[e.name,e.ticketId,e.checker].join(' ')):[],q=$(search).value.trim().toLowerCase();
  const entries=loaded.filter(e=>e.text.includes(q)).map(e=>e.row);
  updateList(target,entries,{query:q,key:e=>e.ticketId,draw:entryRow,status,summary:(q?entries.length+' results · ':'')+loaded.length+' loaded · '+(model.stats.admitted??'unknown')+' server total'});
  $(empty).hidden=!!entries.length;$(empty).textContent=q?'No loaded entries match your search.':'No confirmed entries yet.';
 }
 async function renderLocal(){const generation=uiGeneration;try{const s=await C.local('snapshot');if(generation!==uiGeneration||!C.profile())return;const admin=isAdmin();$('home-total').textContent=admin?s.stats.total??s.localCount:s.stats.ownScans??'—';$('home-entered').textContent=admin?s.stats.admitted??'—':s.stats.totalEntries??'—';$('home-remaining').textContent=admin?s.stats.remaining??'—':'—';$('desk-own-scans').textContent=s.stats.ownScans??'—';$('desk-total-entries').textContent=s.stats.totalEntries??'—';$('cache-count').textContent=admin?s.localCount:0;$('pending-count').textContent=s.pending;$('sync-time').textContent=s.lastSync?'Synced '+when(s.lastSync)+' IST':'Awaiting shared update';renderEntries('recent-entries','recent-search','entry-coverage','entries-empty')}catch(e){if(generation===uiGeneration)notice(e.message)}}
 function clearPending(id){clearTimeout(pendingResults.get(id)?.timer);pendingResults.delete(id);queuedResults=queuedResults.filter(r=>r.code!=='pending'||r.id!==id)}
 function handoffQueuedResult(){
  if(held||queueTimer!==null||!queuedResults.length)return;
  const generation=uiGeneration;
  queueTimer=setTimeout(()=>{queueTimer=null;if(generation===uiGeneration&&!held){const next=queuedResults.shift();if(next)result(next)}},200);
 }
 function releaseResult(){
  if(held&&lastResult?.code==='pending'&&lastResult.id){pendingAcknowledged.add(lastResult.id);clearPending(lastResult.id)}
  clearTimeout(resultTimer);held=false;lastResult=null;close('result-popup');renderAuth();handoffQueuedResult();
 }
 function holdResult(){if(!lastResult)return;if(lastResult.code==='pending')feedback('pending');held=true;show('result-popup',true);$('help-desk').hidden=false;$('close-result').textContent='Send to help desk · acknowledge';renderAuth()}
 function result(r){
  if(!canScan())return;
  const pending=r.code==='pending';
  if(pending&&r.id){
   if(pendingAcknowledged.has(r.id))return;
   let warning=pendingResults.get(r.id);
   if(warning)warning.result=r;
   else{
    warning={result:r,expired:false,timer:null};pendingResults.set(r.id,warning);
    // A ticket owns its deadline, even while a different result is displayed.
    warning.timer=setTimeout(()=>{warning.timer=null;warning.expired=true;if(pendingResults.get(r.id)===warning)result(warning.result)},2500);
   }
  }else if(r.id){clearPending(r.id);pendingAcknowledged.delete(r.id)}
  const overdue=pending&&r.id&&pendingResults.get(r.id).expired;
  if(held){
   if(!pending&&r.id&&r.id===lastResult?.id&&lastResult?.code==='pending'){held=false;close('result-popup')}
   else{
    if(!pending||overdue&&r.id!==lastResult?.id){const index=pending?queuedResults.findIndex(q=>q.code==='pending'&&q.id===r.id):-1;if(index<0)queuedResults.push(r);else queuedResults[index]=r}
    return;
   }
  }
  clearTimeout(resultTimer);lastResult=r;const good=r.code==='admitted',dup=r.code==='duplicate',popup=$('result-popup');
  popup.dataset.state=good?'confirmed':pending?'pending':dup?'duplicate':'issue';$('result-symbol').textContent=good?'✓':pending?'…':dup?'↺':'!';popup.classList.toggle('pending',pending);popup.classList.toggle('error',!good&&!pending);$('help-desk').hidden=true;
  $('result-kicker').textContent=good?'SERVER RECEIPT SAVED':pending?'AWAITING SERVER':'HELP DESK REQUIRED';
  $('result-title').textContent=good?'✓ Entry confirmed':dup?'Already entered':pending?'Awaiting confirmation':'Entry not allowed';
  const e=r.entry,record=r.record;$('result-name').textContent=e?.name||record?.name||r.id||'Ticket issue';
  const details=[['Ticket',r.id||e?.ticketId||record?.id],...paymentDetails(record),['Registration source',record?.source],...receiptDetails(e)].filter(([,value])=>hasValue(value));$('result-details').textContent=[...details.map(([label,value])=>label+': '+value),e?(good?'Entry saved. Ready for the next QR.':'One entry only. No re-entry.'):r.message||'The ticket could not be verified.'].join('\n');
  $('close-result').textContent=pending?'Close · still not confirmed':'Next student';show('result-popup',false);if(!pending)feedback(good?'success':dup?'duplicate':['invalid','not_found'].includes(r.code)?'invalid':'issue');
  if(!good&&!pending||overdue)holdResult();else if(good)resultTimer=setTimeout(releaseResult,1500);
  renderAuth();renderLocal();if(isAdmin())renderAdmin();handoffQueuedResult();
 }
 function filteredRecords(){const m=data(),q=$('student-search').value.trim().toLowerCase(),filter=$('payment-filter').value;return searchIndex('students',m.records,(a,b)=>a.name.localeCompare(b.name),r=>r.name+' '+r.id).filter(({row:r,text})=>(!q||text.includes(q))&&(filter==='all'||filter==='eligible'&&r.eligible||filter==='blocked'&&!r.eligible||filter==='entered'&&m.entries[r.id])).map(item=>item.row)}
 function registrationRow(r){const tr=node('tr'),name=node('td'),open=node('button',r.name,'table-link');open.type='button';open.onclick=()=>showStudent(r.id);name.append(open,node('span',r.id,'cell-secondary'));const pay=node('td');pay.append(node('span',r.eligible?'Paid':'Issue','badge '+(r.eligible?'green':'red')));const status=node('td');status.append(node('span',data().entries[r.id]?'In':'—','badge '+(data().entries[r.id]?'green':'')));const action=node('td'),edit=node('button','Edit','table-link');edit.onclick=()=>editTicket(r);action.append(edit);const amount=node('td',money(r.amount));pay.dataset.label='Paid';amount.dataset.label='Amount';status.dataset.label='Entry';action.dataset.label='Manage';tr.append(name,pay,amount,status,action);return tr}
 function renderRegistrations(){if(!isAdmin())return;const records=filteredRecords();updateList('registration-rows',records,{query:JSON.stringify([$('student-search').value.trim().toLowerCase(),$('payment-filter').value]),key:r=>r.id,signature:r=>JSON.stringify([r,!!data().entries[r.id]]),draw:registrationRow,status:'registration-count',summary:records.length+' results · '+Object.keys(model.records).length+' loaded · '+(model.stats.total??'unknown')+' server total'});$('registrations-empty').hidden=!!records.length}
 function showStudent(id){if(!isAdmin())return;$('edit-student').hidden=false;const r=data().records[id];if(!r)return;selected=id;const e=data().entries[id];$('dialog-name').textContent=r.name;const dl=$('dialog-details');dl.replaceChildren();const details=[['Ticket',id],['Eligibility',r.eligible===true?'Eligible':r.eligible===false?r.reason||'Blocked':''],...paymentDetails(r),['Entry',e?'Entered · no re-entry':'Not entered'],...receiptDetails(e),['Registration source',r.source],['Current registration dataset',data().source]].filter(([,value])=>hasValue(value));for(const [label,value]of details)dl.append(node('dt',label),node('dd',value));show('student-dialog')}
 function editTicket(r){if(!isAdmin())return;$('edit-id').value=r.id;$('edit-name').value=r.name;$('edit-amount').value=r.amount??'';$('edit-quantity').value=r.quantity??'';$('edit-refund').value=r.refund??'';const status=$('edit-status');for(const o of [...status.options])if(o.dataset.custom)o.remove();if(![...status.options].some(o=>o.value===r.description)){const o=node('option',r.description||'Unknown');o.value=r.description;o.dataset.custom='true';status.append(o)}status.value=r.description;show('edit-dialog')}
 let adminPaint='';
 function staffRow(ck){const expired=ck.accessExpiresAt&&Date.parse(ck.accessExpiresAt)<=Date.now(),row=node('div',undefined,'checker-row'),avatar=node('span',initials(ck.name),'checker-avatar'),info=node('div');info.append(node('strong',ck.name),node('small',(ck.method==='google'?'Google · ':'Code · ')+(expired?'Expired':ck.active?[ck.scanner!==false?'Checker':'',ck.helpdesk?'Help Desk':''].filter(Boolean).join(' + ')||'No station':'Access disabled')+' · '+ck.entries+' entries'));if(ck.requestedRole)info.append(node('small','Requested: '+(ck.requestedRole==='helpdesk'?'Help Desk':'Checker'),'staff-request'));if(ck.accessExpiresAt)info.append(node('small','Temporary · until '+when(ck.accessExpiresAt)+' IST'));const manage=node('button','Manage access','button secondary');manage.onclick=()=>openStaff(ck);row.append(avatar,info,manage);return row}
 function renderStaff(){if(!isAdmin())return;const all=[...(model.checkers||[])].sort((a,b)=>Number(!!b.requestedRole)-Number(!!a.requestedRole)||Number(a.active)-Number(b.active)||a.name.localeCompare(b.name)),q=$('staff-search').value.trim().toLowerCase(),crew=all.filter(c=>[c.name,c.method,c.station,c.requestedRole,c.active?'active':'disabled',c.helpdesk?'help desk':'',c.scanner!==false?'checker':''].join(' ').toLowerCase().includes(q));
  updateList('checker-list',crew,{query:q,key:c=>c.id,signature:c=>JSON.stringify([c,!!c.accessExpiresAt&&Date.parse(c.accessExpiresAt)<=Date.now()]),draw:staffRow,status:'staff-count',summary:crew.length+' staff'+(q?' matching · '+all.length+' loaded':'')});
  $('staff-empty').hidden=!!crew.length;$('staff-empty').textContent=q?'No staff match your search.':'Google checkers appear here after completing sign-in.';
 }
 function renderAdmin(){if(!isAdmin())return;const m=data(),s=m.stats,key=JSON.stringify([m.dataRevision,m.cursor,s,m.checkers,$('student-search').value,$('payment-filter').value,$('entry-search').value,$('staff-search').value]);if(key===adminPaint)return;adminPaint=key;for(const[key,id]of[['total','total'],['eligible','eligible'],['admitted','admitted'],['remaining','remaining'],['lastMinute','minute'],['blocked','blocked'],['duplicateAttempts','duplicates'],['blockedAttempts','refused']])$('stat-'+id).textContent=s[key]??'—';renderRegistrations();renderEntries('all-entry-rows','entry-search','all-entry-count','all-entry-empty');renderStaff();$('namu-message').textContent='Live control · '+(s.admitted??0)+' entered · '+(m.checkers||[]).filter(c=>c.active&&(!c.accessExpiresAt||Date.parse(c.accessExpiresAt)>Date.now())).length+' active staff.';
 }
 async function poll(force){
  if(!C.profile())return;
  if(syncBusy){if(force)syncAgain=true;return;}
  const generation=uiGeneration,run=++pollRun,current=()=>generation===uiGeneration&&!!C.profile();
  syncBusy=true;
  try{
   if(!isAdmin()&&!C.profile().active){await C.api('me');if(!current())return;renderAuth();connection(true,C.profile()?.active?'Signed in':'Awaiting access');return}
   if(C.native&&!isAdmin()){await renderLocal();return}
   let updates=await C.sync(isAdmin()?{dataRevision:force?-1:model.dataRevision,afterSeq:model.cursor}:undefined);
   if(!current())return;
   if(!C.profile()?.active){await C.api('me');if(!current())return;renderAuth()}
   if(isAdmin()){
    model=L.merge(model,updates);
    while(updates.hasMore){updates=await C.sync({dataRevision:model.dataRevision,afterSeq:model.cursor});if(!current()||!isAdmin())return;model=L.merge(model,updates)}
    renderAdmin();
   }
   connection(true);await renderLocal();
  }catch(e){
   if(!current())return;
   connection(false,e.status===403?'Access blocked':e.status===401?'Sign in':'Offline');
   if(e.status===401||e.status===403){notice(e.message);try{await C.api('me');if(current())renderAuth()}catch{}}
  }finally{if(run===pollRun){syncBusy=false;if(syncAgain){syncAgain=false;poll(true)}}}
 }
 function clearAdminView(){
  model=emptyModel();adminPaint='';selected=staffSelected=null;clearLists();
  for(const id of ['student-dialog','edit-dialog','code-dialog','staff-dialog','password-dialog'])close(id);
  for(const id of ['ticket-editor','create-checker-form','staff-access-form','change-password-form'])$(id).reset();
  for(const id of ['registration-rows','all-entry-rows','recent-entries','checker-list','dialog-details'])$(id).replaceChildren();
  for(const id of ['dialog-name','new-checker-code','staff-detail'])$(id).textContent='';$('new-code-panel').hidden=true;
  for(const id of ['student-search','entry-search','recent-search','staff-search'])$(id).value='';$('payment-filter').selectedIndex=0;
  for(const id of ['stat-total','stat-eligible','stat-admitted','stat-remaining','stat-minute','stat-blocked','stat-duplicates','stat-refused'])$(id).textContent='—';
 }

 async function signIn(button,action,payload){await busy(button,async()=>{await C.api(action,payload);$('notice').hidden=true;$('checker-code').value='';feedback('success');afterSignIn();})}
 for(const b of document.querySelectorAll('[data-view]'))b.onclick=()=>{if(b.dataset.view==='desk'||b.dataset.view==='home')C.destination?.(b.dataset.view);setView(b.dataset.view)};for(const b of document.querySelectorAll('[data-admin-tab]'))b.onclick=()=>setAdminTab(b.dataset.adminTab);
 document.addEventListener('click',e=>{if(e.target.closest('button,summary'))feedback('tap')});
 $('account').onclick=()=>setView('account');$('scan').onclick=()=>{if(!held&&canScan()&&!needsName(C.profile()))C.scan()};
 $('show-admin-login').onclick=()=>{$('signin-panel').hidden=true;$('admin-signin').hidden=false};$('show-checker-login').onclick=()=>{$('admin-signin').hidden=true;$('signin-panel').hidden=false};
 $('google-browser-signin').hidden=!C.native;$('google-browser-signin').onclick=()=>busy($('google-browser-signin'),()=>C.googleBrowserLogin());
 $('google-signin').onclick=()=>busy($('google-signin'),()=>C.googleLogin());$('checker-form').onsubmit=e=>{e.preventDefault();signIn(e.submitter||$('checker-form').querySelector('button'),'checker-login',{code:$('checker-code').value})};$('admin-form').onsubmit=e=>{e.preventDefault();signIn(e.submitter||$('admin-form').querySelector('button'),'login',{username:$('admin-username').value,password:$('admin-password').value}).finally(()=>$('admin-password').value='')};
 function clearSessionView(){
  uiGeneration++;pollRun++;syncBusy=false;syncAgain=false;model=emptyModel();adminPaint='';selected=staffSelected=null;clearLists();queuedResults=[];held=false;lastResult=null;for(const warning of pendingResults.values())clearTimeout(warning.timer);pendingResults.clear();pendingAcknowledged.clear();clearTimeout(resultTimer);clearTimeout(queueTimer);queueTimer=null;clearTimeout(noticeTimer);
  for(const d of document.querySelectorAll('dialog[open]'))close(d.id);
  for(const id of ['checker-form','admin-form','manual-form','name-form','ticket-editor','create-checker-form','staff-access-form','change-password-form'])$(id).reset();
  for(const o of $('edit-status').querySelectorAll('[data-custom]'))o.remove();
  for(const id of ['registration-rows','all-entry-rows','recent-entries','checker-list','dialog-details'])$(id).replaceChildren();
  for(const id of ['dialog-name','result-name','result-details','new-checker-code','checker-name','checker-access','staff-detail','station-message','notice'])$(id).textContent='';
  for(const id of ['student-search','entry-search','recent-search','staff-search'])$(id).value='';$('payment-filter').selectedIndex=0;
  for(const id of ['home-total','home-entered','home-remaining','desk-own-scans','desk-total-entries','stat-total','stat-eligible','stat-admitted','stat-remaining','stat-minute','stat-blocked','stat-duplicates','stat-refused'])$(id).textContent='—';
  $('cache-count').textContent=$('pending-count').textContent='0';$('sync-time').textContent='Awaiting shared update';$('station-title').textContent='Choose your station';$('registration-count').textContent='0 results';
  $('new-code-panel').hidden=true;$('notice').hidden=true;$('signin-panel').hidden=false;$('admin-signin').hidden=true;globalThis.NavrangDesk?.clear();setView('login');globalThis.NavrangAuth?.reset({preservePending:true});connection(false,'Sign in');
 }
 async function signOut(){
  close('name-dialog');const pending=$('classic-signout-pending'),retry=$('classic-signout-retry'),message=$('classic-signout-message');
  if(C.native&&pending){pending.hidden=false;retry.hidden=true;message.textContent='Clearing this device’s private session.';}
  try{await C.signOut();if(pending)pending.hidden=true;}
  catch(e){if(C.native&&pending){message.textContent='Sign-out could not be saved. Private access is blocked. Retry before signing in again.';retry.hidden=false;}else notice(e.message||'Sign-out could not complete.');}
 }
 if($('classic-signout-retry'))$('classic-signout-retry').onclick=signOut;
 const confirmSignOut=()=>{if(C.profile())show('signout-confirm')};$('sign-out').onclick=confirmSignOut;$('name-signout').onclick=confirmSignOut;
 $('cancel-signout').onclick=()=>close('signout-confirm');$('confirm-signout').onclick=()=>{close('signout-confirm');busy($('sign-out'),signOut)};
 $('change-name').onclick=()=>{$('real-name').value=C.profile()?.name||'';show('name-dialog')};$('name-dialog').addEventListener('cancel',e=>{if(needsName(C.profile()))e.preventDefault()});
 $('name-form').onsubmit=e=>{e.preventDefault();busy(e.submitter||$('name-form').querySelector('button'),async()=>{const name=$('real-name').value.trim().replace(/\s+/g,' ');if(!/^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,39}$/u.test(name))throw Error('Enter your real name using letters, up to 40 characters.');await C.api('checker-profile',{name});await C.api('me');close('name-dialog');renderAuth();setView(assignedView());feedback('success');poll(true)})};
 $('manual-form').onsubmit=e=>{e.preventDefault();if(held||!canScan()||needsName(C.profile()))return;const id=exactId($('ticket-id').value);if(!id){result({code:'invalid',id,message:'Use the exact eight-character Transaction ID from the ticket email.'});return}busy($('manual-submit'),async()=>{await C.submit(id)})};
 $('close-result').onclick=releaseResult;$('result-popup').addEventListener('cancel',e=>{e.preventDefault()});
 $('admin-refresh').onclick=()=>poll(true);$('student-search').oninput=$('payment-filter').onchange=()=>renderRegistrations();$('entry-search').oninput=()=>renderEntries('all-entry-rows','entry-search','all-entry-count','all-entry-empty');$('recent-search').oninput=()=>renderEntries('recent-entries','recent-search','entry-coverage','entries-empty');$('staff-search').oninput=()=>renderStaff();
 $('close-student').onclick=()=>close('student-dialog');$('edit-student').onclick=()=>{close('student-dialog');if(selected)editTicket(data().records[selected])};$('close-editor').onclick=()=>close('edit-dialog');$('add-registration').onclick=()=>editTicket({id:'',name:'',amount:100,quantity:1,refund:0,description:'Transaction completed successfully'});
 if($('import-registration')){
  $('import-registration').hidden=!C.native;
  $('import-registration').onclick=()=>{if(!isAdmin())return;if(typeof globalThis.Native?.importRegistrations==='function')globalThis.Native.importRegistrations();else notice('Use the updated Android app to import organizer files.');};
 }
 $('ticket-editor').onsubmit=e=>{e.preventDefault();if(!isAdmin())return;busy(e.submitter||$('ticket-editor').querySelector('button'),async()=>{const generation=uiGeneration,r={id:exactId($('edit-id').value),name:$('edit-name').value.trim(),amount:$('edit-amount').value===''?null:Number($('edit-amount').value),quantity:$('edit-quantity').value===''?null:Number($('edit-quantity').value),refund:$('edit-refund').value===''?null:Number($('edit-refund').value),description:$('edit-status').value};if(!r.id)throw Error('Use an exact eight-character ticket ID.');if(!r.name)throw Error('Enter the student name.');if(r.amount!==null&&(!Number.isFinite(r.amount)||r.amount<0)||r.quantity!==null&&(!Number.isInteger(r.quantity)||r.quantity<=0)||r.refund!==null&&(!Number.isFinite(r.refund)||r.refund<0))throw Error('Enter numeric non-negative amount/refund and a positive whole quantity, or leave unknown values blank.');await C.api('upsert',{eventId:'O9KL3',source:'Admin manual update',records:[r]});if(generation!==uiGeneration||!isAdmin())return;await poll(true);if(generation!==uiGeneration||!isAdmin())return;close('edit-dialog');notice('Registration saved to the shared database.');feedback('success')})};
 $('open-code').onclick=()=>{if(isAdmin()){$('new-code-panel').hidden=true;$('new-checker-code').textContent='';show('code-dialog')}};$('close-code').onclick=()=>close('code-dialog');$('create-checker-form').onsubmit=e=>{e.preventDefault();if(!isAdmin())return;busy(e.submitter||$('create-checker-form').querySelector('button'),async()=>{const generation=uiGeneration,name=$('new-checker-name').value.trim();const r=await C.api('staff-create',{name,scanner:$('new-checker-role').value!=='helpdesk',helpdesk:$('new-checker-role').value!=='checker'}),code=r.code;if(generation!==uiGeneration||!isAdmin())return;await poll(true);if(generation!==uiGeneration||!isAdmin())return;$('new-checker-code').textContent=code;$('new-code-panel').hidden=false;$('new-checker-name').value=''})};$('copy-code').onclick=()=>busy($('copy-code'),async()=>{if(C.copy)await C.copy($('new-checker-code').textContent);else if(navigator.clipboard)await navigator.clipboard.writeText($('new-checker-code').textContent);else notice('Use the Android app or HTTPS portal to copy this code.')});
 function openStaff(ck){if(!isAdmin())return;staffSelected=ck;$('staff-name').value=ck.name;$('staff-active').checked=ck.active;$('staff-role').value=ck.scanner!==false&&ck.helpdesk?'both':ck.scanner!==false?'checker':ck.helpdesk?'helpdesk':ck.requestedRole||'none';$('staff-detail').textContent=(ck.method==='google'?'Google verified account':'Assigned code account')+(ck.requestedRole?' · requested '+(ck.requestedRole==='checker'?'Checker':'Help Desk'):'')+(ck.accessExpiresAt?' · expires '+when(ck.accessExpiresAt)+' IST':'');show('staff-dialog')}
 $('close-staff').onclick=()=>close('staff-dialog');$('staff-access-form').onsubmit=e=>{e.preventDefault();if(!isAdmin()||!staffSelected)return;busy(e.submitter||$('staff-access-form').querySelector('button'),async()=>{const generation=uiGeneration,role=$('staff-role').value,active=$('staff-active').checked,name=$('staff-name').value.trim().replace(/\s+/g,' ');if(active&&role==='none')throw Error('Assign a station or disable access.');await C.api('staff-update',{id:staffSelected.id,name,active,scanner:['checker','both'].includes(role),helpdesk:['helpdesk','both'].includes(role)});if(generation!==uiGeneration||!isAdmin())return;close('staff-dialog');await poll(true);if(generation!==uiGeneration||!isAdmin())return;notice(name+' · access saved on server.');feedback('success')})};
 $('password-open').onclick=()=>{if(isAdmin())show('password-dialog')};$('close-password').onclick=()=>close('password-dialog');$('change-password-form').onsubmit=e=>{e.preventDefault();if(!isAdmin())return;busy(e.submitter||$('change-password-form').querySelector('button'),async()=>{const generation=uiGeneration;await C.api('admin-password',{password:$('new-admin-password').value});if(generation!==uiGeneration||!isAdmin())return;$('new-admin-password').value='';close('password-dialog');notice('Admin password changed. Other admin sessions were signed out.')})};

 function renderReadiness(action='status'){const state=C.readiness?.(action)||{};globalThis.NavrangReducedMotion=state.reducedMotion===true;globalThis.NavrangMotion?.setReducedMotion(globalThis.NavrangReducedMotion);$('readiness-panel').hidden=!C.native;$('readiness-status').textContent=[state.camera?'Camera ready':'Camera permission needed',state.notifications?'Notifications ready':'Notifications permission needed',state.fullVolume?'Full media volume':'Volume limited by device',state.vibration?'Strong scan vibration':'No vibration hardware',state.adaptiveBrightness?'Adaptive brightness':'System brightness'].join(' · ');}
 $('readiness-permissions').onclick=()=>renderReadiness('permissions');$('readiness-settings').onclick=()=>renderReadiness('settings');$('readiness-volume').onclick=()=>renderReadiness('volume');renderReadiness();
  let updateState={};
 function renderUpdate(state){updateState=state||{};$('app-version').textContent=C.native?'Version '+(state.currentVersion||'0.7.8'):'Android app updates';$('update-message').textContent=state.downloading?'Downloading update · '+(state.progress||0)+'%':state.message||'Your app is up to date.';$('automatic-updates').textContent=!C.native?'Automatic updates are available in the Android app.':state.automatic?'Automatic checks and downloads: always on. Android confirms installation.':'Automatic updates are unavailable in this build.';$('update-notifications').hidden=state.notifications||!C.native;$('install-update').hidden=!state.installing&&(!state.available||state.downloading);$('install-update').textContent=state.installing?'Finish app update':state.ready?'Install '+state.versionName:'Download '+state.versionName;$('update-banner').hidden=!state.available&&!state.installing;$('update-banner-text').textContent=state.installing?'Android app update unfinished':state.downloading?'Updating download · '+(state.progress||0)+'%':state.ready?'Version '+state.versionName+' ready':'New version '+state.versionName;}
 function updateAction(action,value=true){if(typeof C.update==='function')renderUpdate(C.update(action,value));}
 $('check-update').onclick=()=>updateAction('check');$('install-update').onclick=()=>updateAction(updateState.installing||updateState.ready?'install':'download');$('update-notifications').onclick=()=>updateAction('notifications');$('open-update').onclick=()=>setView('account');updateAction('status');setInterval(()=>{if(!document.hidden)updateAction('background')},300000);
 C.on(e=>{if(e.type==='result'){result(e.data)}else if(e.type==='error'||e.type==='notice')notice(e.data.message);else if(e.type==='sync'){renderAuth();renderLocal();if(C.native&&!isAdmin())connection(true)}else if(e.type==='registrations-imported'){if(isAdmin())poll(true)}else if(e.type==='connection')connection(false,e.data.status===403?'Access blocked':'Offline');else if(e.type==='update'){renderUpdate(e.data)}else if(e.type==='readiness'){renderReadiness()}else if(e.type==='profile'){renderAuth();globalThis.NavrangDesk?.refresh()}else if(e.type==='auth'){if(C.profile()){afterSignIn();feedback('success')}else clearSessionView()}});

 let startY=null,startX=0;const pull=$('pull-to-scan');pull.addEventListener('touchstart',e=>{if(!e.target.closest('button,input')){startY=e.touches[0].clientY;startX=e.touches[0].clientX}},{passive:true});pull.addEventListener('touchend',e=>{if(startY!==null){const dy=e.changedTouches[0].clientY-startY,dx=e.changedTouches[0].clientX-startX;if(dy>70&&dy>Math.abs(dx)*2&&!held&&canScan()&&!needsName(C.profile())){C.scan()}}startY=null},{passive:true});

 globalThis.onBackRequested=async()=>{if(held||$('result-popup').open)return;if(globalThis.NavrangMenus?.closeTop())return;const dialog=[...document.querySelectorAll('dialog[open]')].find(d=>d.id!=='name-dialog'&&d.id!=='exit-dialog');if(dialog){close(dialog.id);return;}if(view==='login'&&globalThis.NavrangAuth?.back())return;if($('exit-dialog').open)return;const snapshot=await C.local('snapshot').catch(()=>({pending:0})),draft=globalThis.NavrangDesk?.hasDraft();$('exit-message').textContent=snapshot.pending?String(snapshot.pending)+' scan(s) are still awaiting server confirmation. Keep the app open until they finish.':draft?'Your Help Desk form has unsaved details. Save it before closing. Confirmed entries are already stored on the server.':'Confirmed entries are safely stored on the server. Your station will be ready when you return.';show('exit-dialog');feedback('close')};
 $('exit-keep').onclick=()=>close('exit-dialog');$('exit-confirm').onclick=()=>{feedback('close');$('exit-dialog').classList.add('closing');setTimeout(()=>{if(C.native&&typeof Native.exit==='function')Native.exit();else{close('exit-dialog');$('exit-dialog').classList.remove('closing')}},220)};
 function endIntro(){if(introEnded)return;introEnded=true;feedback('stop-intro');$('intro').classList.add('leaving');setTimeout(()=>{$('intro').hidden=true;renderAuth();renderReadiness('startup')},globalThis.NavrangReducedMotion?0:550)}$('skip-intro').onclick=endIntro;feedback('intro');setTimeout(endIntro,(globalThis.NavrangReducedMotion||matchMedia('(prefers-reduced-motion: reduce)').matches)?100:6200);
 (async()=>{try{await C.finishGoogle()}catch(e){notice(e.message)}renderAuth();setView(C.profile()?assignedView():'login');await renderLocal();try{const cfg=await C.api('config');$('google-status').textContent=cfg.googleEnabled?'Google is available. Save your name, then choose an approved station.':'Google sign-in is unavailable. Ask Namdev for an assigned code.';$('provider-note').textContent='Manage names, approve requests and assign Checker, Help Desk or both. Only admin can change access.'}catch{connection(false)}if(C.profile()){try{await C.api('me');renderAuth()}catch(e){notice(e.message)}await poll(true)}else connection(false,'Sign in')})().catch(e=>notice(e.message));
 let expirySignOutBusy=false;setInterval(()=>{if(!document.hidden&&!expirySignOutBusy&&expired(C.profile())){expirySignOutBusy=true;signOut().finally(()=>{expirySignOutBusy=false})}},100);
 setInterval(()=>{if(!document.hidden)poll()},2000);setInterval(()=>{if(!document.hidden&&C.profile())C.api('me').then(()=>{renderAuth();globalThis.NavrangDesk?.refresh()}).catch(()=>{})},15000);window.addEventListener('resize',()=>{adminPaint='';renderLocal();if(isAdmin())renderAdmin()});
})();
