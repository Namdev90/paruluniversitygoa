(function(){
 'use strict';
 const C=GateClient,D=NavrangDeskCore,$=id=>document.getElementById(id);
 const fields=['name','email','phone','quantity'];
 let offset=0,total=null,rows=[],selected=null,editing=null,locked=false,pending=null,loading=false,generation=0,searchTimer,refreshQueued=false,reviewGeneration=0,listRevision=0,listQuery='',listChanged=false;
 let rowCache=new Map();
 const listBatchSize=8; // Existing server contract caps each role-scoped request at eight records.
 const admin=()=>C.profile()?.role==='admin';
 const allowed=()=>!!C.profile()?.active&&(admin()||C.profile()?.helpdesk===true&&(C.profile()?.station==null||C.profile().station==='helpdesk'));
 const identity=()=>C.profile()?.checkerId||C.profile()?.role;
 const scope=()=>JSON.stringify([identity(),admin(),allowed()]);let accessScope=scope();
 const current=(version,who,privileged=false)=>version===generation&&who===identity()&&accessScope===scope()&&allowed()&&(!privileged||admin());
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 function closeReview(){reviewGeneration++;const d=$('desk-review-dialog');if(d.close)d.close();else d.removeAttribute('open');selected=null;for(const id of ['desk-review-name','desk-review-details','desk-review-message'])$(id).textContent='';$('desk-confirm-existing').checked=false;$('desk-approve').disabled=$('desk-reject').disabled=false;}
 function showReview(){const d=$('desk-review-dialog');if(d.showModal)d.showModal();else d.setAttribute('open','')}
 const feedback=kind=>C.feedback?.(kind,true);
 const when=at=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
 function message(text){$('desk-form-message').textContent=text;}
 function showPanel(list){$('view-desk').classList.toggle('desk-list-mode',list);$('desk-form-panel').hidden=list;$('desk-list-panel').hidden=!list;$('desk-new').classList.toggle('selected',!list);$('desk-saved').classList.toggle('selected',list);if(list)refresh(true);}
 function paintForm(){
  $('desk-fields').disabled=locked||!!pending;$('desk-submit').hidden=locked;$('desk-close-record').hidden=!editing;
  $('desk-form').dataset.pending=String(!!pending);for(const id of ['desk-new','desk-saved','desk-close-record'])$(id).disabled=!!pending;
  $('desk-form-title').textContent=editing?(locked?'Saved registration':'Edit pending record'):'New registration';
  $('desk-submit').textContent=pending?'Retry same save':editing?'Save changes to server':'Save to server';
  $('desk-bill').textContent='Registration fee · ₹'+((Number($('desk-quantity').value)||1)*100).toLocaleString('en-IN');
 }
 function values(){const data={};for(const key of fields)data[key]=$('desk-'+key).value;data.quantity=Number(data.quantity);return data;}
 function reset(){editing=null;locked=false;pending=null;$('desk-form').reset();$('desk-form').dataset.pending='false';message('');paintForm();}
 function displayRecord(record){
  if(pending){showPanel(false);return}
  editing=record;locked=!admin()||record.status!=='pending';pending=null;
  for(const key of fields)$('desk-'+key).value=record.details[key]??(key==='quantity'?1:'');
  message(record.ticket_id+' · '+record.status+' · recorded by '+record.created_by_name+' · '+when(record.created_at)+' IST');showPanel(false);paintForm();
 }
 function queryKey(){return JSON.stringify([$('desk-search').value.trim(),$('desk-filter').value])}
 function listStatus(){
  $('desk-list-status').textContent=total===null?'Loading saved records…':rows.length+' loaded · '+total+' matching server records'+(listChanged?' · Records changed. Refresh to continue.':offset<total?' · Scroll for more':'');
  $('desk-records').setAttribute('aria-busy',String(loading));
 }
 function resetRecords(){listRevision++;rows=[];rowCache.clear();offset=0;total=null;listChanged=false;listQuery=queryKey();$('desk-records').replaceChildren();$('desk-records').scrollTop=0;listStatus()}
 function recordCard(record){
  const card=el('div','','desk-record'),info=el('button','','desk-record-info');info.type='button';
  info.append(el('strong',record.details.name),el('span',record.ticket_id+' · '+(record.details.quantity||1)+' person'+((record.details.quantity||1)>1?'s':'')),el('small',record.status+' · '+record.created_by_name+' · '+when(record.created_at)+' IST'));info.onclick=()=>displayRecord(record);card.append(info);
  if(admin()&&record.status==='pending'){const review=el('button','Review','button secondary');review.onclick=()=>openReview(record);card.append(review)}
  card.dataset.recordId=record.id;return card;
 }
 function paintRecords(){
  const body=$('desk-records'),top=body.getBoundingClientRect().top,anchor=body.scrollTop>0?[...body.children].find(row=>row.getBoundingClientRect().bottom>top+1):null,anchorId=anchor?.dataset.recordId,anchorTop=anchor?.getBoundingClientRect().top;
  const active=document.activeElement,activeCard=body.contains(active)?active.closest('[data-record-id]'):null,activeId=activeCard?.dataset.recordId,activeIndex=activeCard?[...activeCard.querySelectorAll('button')].indexOf(active):-1;
  const cache=new Map(),cards=rows.map(record=>{const signature=JSON.stringify(record),old=rowCache.get(record.id),card=old?.signature===signature?old.card:recordCard(record);cache.set(record.id,{card,signature});return card});
  for(let i=0;i<cards.length;i++)if(body.children[i]!==cards[i])body.insertBefore(cards[i],body.children[i]||null);
  while(body.children.length>cards.length)body.lastElementChild.remove();
  rowCache=cache;
  if(!rows.length)body.append(el('p','No saved records match this view.','empty'));
  if(anchorId&&cache.has(anchorId))body.scrollTop+=cache.get(anchorId).card.getBoundingClientRect().top-anchorTop;
  if(activeId&&activeIndex>=0&&document.activeElement!==active&&cache.has(activeId))cache.get(activeId).card.querySelectorAll('button')[activeIndex]?.focus({preventScroll:true});
  listStatus();
 }
 async function refresh(force=false,append=false){
  if(accessScope!==scope())clear();
  const yes=allowed();$('desk-denied').hidden=yes;$('desk-workspace').hidden=!yes;$('desk-export').hidden=!admin();
  if(!yes){clear();return}if(queryKey()!==listQuery)resetRecords();
  if(loading){if(force&&!append)refreshQueued=true;return}if(!force&&($('view-desk').hidden||$('desk-list-panel').hidden))return;
  if(append&&(listChanged||offset>=total))return;
  if(append&&offset>100000){listChanged=true;listStatus();return}
  loading=true;refreshQueued=false;listStatus();const requestGeneration=generation,requestRevision=listRevision,who=identity(),query={offset:append?offset:0,limit:listBatchSize,search:$('desk-search').value.trim(),status:$('desk-filter').value};let painted=false;
  try{
   const result=await C.api('helpdesk-list',query);
   if(!current(requestGeneration,who))return;
   if(requestRevision!==listRevision||query.search!==$('desk-search').value.trim()||query.status!==$('desk-filter').value){refreshQueued=true;return}
   const records=result.records,previousTotal=total;total=result.total;$('desk-total').textContent=total;
   const stats=result.stats;$('desk-list-stats').textContent=stats.total+' saved · '+stats.pending+' pending · '+stats.approved+' approved';
   // Offset pagination has no snapshot token. Never silently continue through a
   // changed ordering/count: keep the current scroll position and ask for refresh.
   if(append){
    const seen=new Set(rows.map(r=>r.id));
    if(total!==previousTotal||records.some(r=>seen.has(r.id))||!records.length&&offset<total){listChanged=true;listStatus();return}
    rows.push(...records);offset+=records.length;
   }else if(rows.length>listBatchSize){
    if(total!==previousTotal||records.length!==Math.min(listBatchSize,rows.length)||records.some((r,i)=>r.id!==rows[i].id)){listChanged=true;listStatus();return}
    rows.splice(0,records.length,...records);
   }else{rows=records;offset=records.length;listChanged=false}
   paintRecords();painted=true;
  }catch(e){if(current(requestGeneration,who)&&requestRevision===listRevision)$('desk-list-stats').textContent=e.message;}
  finally{if(requestGeneration===generation){loading=false;listStatus();if(refreshQueued){refreshQueued=false;refresh(true)}else if(painted)requestAnimationFrame(fillVisibleList)}}
 }
 function fillVisibleList(){const box=$('desk-records');if(!$('view-desk').hidden&&!$('desk-list-panel').hidden&&box.clientHeight>0&&box.scrollHeight<=box.clientHeight)loadMore()}
 function loadMore(){if(!loading&&allowed()&&!listChanged&&offset<total)refresh(true,true)}
 function clear(){
  generation++;accessScope=scope();loading=false;refreshQueued=false;clearTimeout(searchTimer);reset();closeReview();
  $('desk-search').value='';$('desk-filter').selectedIndex=0;$('desk-total').textContent='0';$('desk-list-stats').textContent='';resetRecords();$('desk-list-status').textContent='';
  $('view-desk').classList.remove('desk-list-mode');$('desk-form-panel').hidden=false;$('desk-list-panel').hidden=true;$('desk-new').classList.add('selected');$('desk-saved').classList.remove('selected');$('desk-submit').disabled=$('desk-export').disabled=false;
 }
 function openReview(record){
  if(!admin())return;reviewGeneration++;selected=record;$('desk-review-name').textContent=record.details.name;
  const d=record.details;$('desk-review-details').textContent=[record.ticket_id,d.email,d.phone,'Quantity: '+(d.quantity||1)+' · expected ₹'+((d.quantity||1)*100),'Recorded by '+record.created_by_name+' · '+when(record.created_at)+' IST'].join('\n');
  $('desk-confirm-existing').checked=false;$('desk-review-message').textContent='';$('desk-approve').disabled=$('desk-reject').disabled=false;showReview();
 }
 async function review(status,button){
  if(!admin()||!selected||button.disabled)return;
  if(status==='approved'&&!$('desk-confirm-existing').checked){$('desk-review-message').textContent='Verify the student and payment, then tick the confirmation.';return}
  $('desk-approve').disabled=$('desk-reject').disabled=true;const requestGeneration=generation,who=identity(),reviewVersion=reviewGeneration;
  try{await C.api('helpdesk-review',{id:selected.id,version:selected.version,status,confirmExisting:$('desk-confirm-existing').checked,confirmPayment:$('desk-confirm-existing').checked});if(!current(requestGeneration,who,true))return;if(reviewVersion===reviewGeneration)closeReview();feedback('success');await refresh(true);if(current(requestGeneration,who,true))C.sync().catch(()=>{});}
  catch(e){if(current(requestGeneration,who,true)&&reviewVersion===reviewGeneration)$('desk-review-message').textContent=e.message;}
  finally{if(requestGeneration===generation&&reviewVersion===reviewGeneration)$('desk-approve').disabled=$('desk-reject').disabled=false;}
 }
 $('desk-new').onclick=()=>{if(pending){showPanel(false);return}reset();showPanel(false)};$('desk-saved').onclick=()=>showPanel(true);
 $('desk-close-record').onclick=()=>{reset();showPanel(true)};
 $('desk-quantity-down').onclick=()=>{if(locked||pending)return;$('desk-quantity').value=Math.max(1,(Number($('desk-quantity').value)||1)-1);paintForm()};
 $('desk-quantity-up').onclick=()=>{if(locked||pending)return;$('desk-quantity').value=Math.min(20,(Number($('desk-quantity').value)||1)+1);paintForm()};$('desk-quantity').oninput=paintForm;
 $('desk-form').onsubmit=async event=>{
  event.preventDefault();const button=$('desk-submit');if(button.disabled||locked||!allowed())return;
  try{if(!pending){const details=D.normalize(values());pending={action:editing?'helpdesk-edit':'helpdesk-save',payload:editing?{id:editing.id,version:editing.version,details}:{requestId:NavrangLive.uuid(),details}}}}
  catch(e){message(e.message);return}
  button.disabled=true;message('Saving to server… Keep this page open.');paintForm();
  const request=pending,requestGeneration=generation,who=identity();$('desk-form').dataset.pending='true';
  try{
   const result=await C.api(request.action,request.payload);if(!current(requestGeneration,who))return;
   reset();message('✓ Saved on server · '+result.registration.ticket_id+' · pending admin verification.');feedback('success');resetRecords();
  }catch(e){
   if(!current(requestGeneration,who))return;
   // A timeout may mean the server committed. Retrying the exact request is safe.
   if(e.status&&e.status<500){pending=null;paintForm();message(e.message)}
   else{message('Delivery is unconfirmed. Retry this same save to recover its server receipt. '+e.message);button.textContent='Retry same save';$('desk-fields').disabled=true;}
  }finally{if(requestGeneration===generation)button.disabled=false;}
 };
 $('desk-refresh').onclick=()=>{resetRecords();refresh(true)};
 $('desk-records').addEventListener('scroll',()=>{const box=$('desk-records');if(box.clientHeight>0&&box.scrollHeight-box.scrollTop-box.clientHeight<160)loadMore()},{passive:true});
 $('desk-records').addEventListener('focusin',event=>{const card=event.target.closest('[data-record-id]');if(card&&[...$('desk-records').children].indexOf(card)>=rows.length-2)loadMore()});
 $('desk-search').oninput=()=>{clearTimeout(searchTimer);resetRecords();searchTimer=setTimeout(()=>refresh(true),250)};$('desk-filter').onchange=()=>{resetRecords();refresh(true)};
 $('desk-review-close').onclick=()=>closeReview();$('desk-approve').onclick=()=>review('approved',$('desk-approve'));$('desk-reject').onclick=()=>review('rejected',$('desk-reject'));
 $('desk-export').onclick=async()=>{if(!admin())return;const button=$('desk-export'),requestGeneration=generation,who=identity();button.disabled=true;try{const result=await C.api('helpdesk-export');if(!current(requestGeneration,who,true))return;C.save(result.filename,'text/csv',result.csv);$('desk-list-stats').textContent=result.count+' server records prepared for the college export.';}catch(e){if(current(requestGeneration,who,true))$('desk-list-stats').textContent=e.message}finally{if(requestGeneration===generation)button.disabled=false}};
 window.addEventListener('resize',fillVisibleList);paintForm();setInterval(()=>{if(!document.hidden)refresh()},2500);
 rootInstall();function rootInstall(){globalThis.NavrangDesk={refresh,clear,allowed,hasDraft:()=>!locked&&(!!pending||(editing?fields.some(k=>String(editing.details[k]??(k==='quantity'?1:''))!==$('desk-'+k).value):['name','email','phone'].some(k=>$('desk-'+k).value.trim())))};}
})();
