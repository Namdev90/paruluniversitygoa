(function(){
 'use strict';
 const C=GateClient,D=NavrangDeskCore,$=id=>document.getElementById(id);
 const fields=['name','email','phone','quantity'];
 let offset=0,total=0,rows=[],selected=null,editing=null,locked=false,pending=null,loading=false,generation=0,paint='',searchTimer;
 const pageSize=()=>Math.max(1,Math.min(5,Math.floor((innerHeight-440)/70)));
 const admin=()=>C.profile()?.role==='admin';
 const allowed=()=>!!C.profile()?.active&&(admin()||C.profile()?.helpdesk===true);
 const identity=()=>C.profile()?.checkerId||C.profile()?.role;
 const scope=()=>JSON.stringify([identity(),admin(),allowed()]);let accessScope=scope();
 const current=(version,who,privileged=false)=>version===generation&&who===identity()&&allowed()&&(!privileged||admin());
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
 function closeReview(){const d=$('desk-review-dialog');if(d.close)d.close();else d.removeAttribute('open');selected=null;for(const id of ['desk-review-name','desk-review-details','desk-review-message'])$(id).textContent='';$('desk-confirm-existing').checked=false;$('desk-approve').disabled=$('desk-reject').disabled=false;}
 function showReview(){const d=$('desk-review-dialog');if(d.showModal)d.showModal();else d.setAttribute('open','')}
 const feedback=kind=>C.feedback?.(kind,true);
 const when=at=>new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(at));
 function message(text){$('desk-form-message').textContent=text;}
 function showPanel(list){$('desk-form-panel').hidden=list;$('desk-list-panel').hidden=!list;$('desk-new').classList.toggle('selected',!list);$('desk-saved').classList.toggle('selected',list);if(list)refresh(true);}
 function paintForm(){
  $('desk-fields').disabled=locked||!!pending;$('desk-submit').hidden=locked;$('desk-close-record').hidden=!editing;
  $('desk-form-title').textContent=editing?(locked?'Saved registration':'Edit pending record'):'New registration';
  $('desk-submit').textContent=pending?'Retry same save':editing?'Save changes to server':'Save to server';
  $('desk-bill').textContent='Registration fee · ₹'+((Number($('desk-quantity').value)||1)*100).toLocaleString('en-IN');
 }
 function values(){const data={};for(const key of fields)data[key]=$('desk-'+key).value;data.quantity=Number(data.quantity);return data;}
 function reset(){editing=null;locked=false;pending=null;$('desk-form').reset();$('desk-form').dataset.pending='false';message('');paintForm();}
 function displayRecord(record){
  editing=record;locked=!admin()||record.status!=='pending';pending=null;
  for(const key of fields)$('desk-'+key).value=record.details[key]??(key==='quantity'?1:'');
  message(record.ticket_id+' · '+record.status+' · recorded by '+record.created_by_name+' · '+when(record.created_at)+' IST');showPanel(false);paintForm();
 }
 async function refresh(force=false){
  if(accessScope!==scope())clear();
  const yes=allowed();$('desk-denied').hidden=yes;$('desk-workspace').hidden=!yes;$('desk-export').hidden=!admin();
  if(!yes){clear();return}if(loading||(!force&&($('view-desk').hidden||$('desk-list-panel').hidden)))return;
  loading=true;const requestGeneration=generation,who=identity();
  try{
   const result=await C.api('helpdesk-list',{offset,limit:pageSize(),search:$('desk-search').value.trim(),status:$('desk-filter').value});
   if(!current(requestGeneration,who))return;
   rows=result.records;total=result.total;const key=JSON.stringify(result);$('desk-total').textContent=total;
   const stats=result.stats;$('desk-list-stats').textContent=stats.total+' saved · '+stats.pending+' pending · '+stats.approved+' approved';
   if(offset>=total&&offset>0){offset=Math.max(0,Math.ceil(total/pageSize())*pageSize()-pageSize());loading=false;return refresh(true)}
   if(key===paint)return;paint=key;$('desk-records').replaceChildren();
   for(const record of rows){
    const card=el('div','','desk-record'),info=el('button','','desk-record-info');info.type='button';
    info.append(el('strong',record.details.name),el('span',record.ticket_id+' · '+(record.details.quantity||1)+' person'+((record.details.quantity||1)>1?'s':'')),el('small',record.status+' · '+record.created_by_name+' · '+when(record.created_at)+' IST'));info.onclick=()=>displayRecord(record);card.append(info);
    if(admin()&&record.status==='pending'){const review=el('button','Review','button secondary');review.onclick=()=>openReview(record);card.append(review);}
    $('desk-records').append(card);
   }
   if(!rows.length)$('desk-records').append(el('p','No saved records match this view.','empty'));
   $('desk-page').textContent=(Math.floor(offset/pageSize())+1)+' / '+Math.max(1,Math.ceil(total/pageSize()));$('desk-prev').disabled=offset===0;$('desk-next-page').disabled=offset+pageSize()>=total;
  }catch(e){if(current(requestGeneration,who))$('desk-list-stats').textContent=e.message;}
  finally{if(requestGeneration===generation)loading=false;}
 }
 function clear(){
  generation++;accessScope=scope();loading=false;paint='';rows=[];offset=0;total=0;clearTimeout(searchTimer);reset();closeReview();$('desk-records').replaceChildren();
  $('desk-search').value='';$('desk-filter').selectedIndex=0;$('desk-total').textContent='0';$('desk-list-stats').textContent='';$('desk-page').textContent='1 / 1';$('desk-prev').disabled=$('desk-next-page').disabled=true;
  $('desk-form-panel').hidden=false;$('desk-list-panel').hidden=true;$('desk-new').classList.add('selected');$('desk-saved').classList.remove('selected');$('desk-submit').disabled=$('desk-export').disabled=false;
 }
 function openReview(record){
  if(!admin())return;selected=record;$('desk-review-name').textContent=record.details.name;
  const d=record.details;$('desk-review-details').textContent=[record.ticket_id,d.email,d.phone,'Quantity: '+(d.quantity||1)+' · expected ₹'+((d.quantity||1)*100),'Recorded by '+record.created_by_name+' · '+when(record.created_at)+' IST'].join('\n');
  $('desk-confirm-existing').checked=false;$('desk-review-message').textContent='';showReview();
 }
 async function review(status,button){
  if(!admin()||!selected||button.disabled)return;
  if(status==='approved'&&!$('desk-confirm-existing').checked){$('desk-review-message').textContent='Verify the student and payment, then tick the confirmation.';return}
  $('desk-approve').disabled=$('desk-reject').disabled=true;const requestGeneration=generation,who=identity();
  try{await C.api('helpdesk-review',{id:selected.id,version:selected.version,status,confirmExisting:$('desk-confirm-existing').checked,confirmPayment:$('desk-confirm-existing').checked});if(!current(requestGeneration,who,true))return;closeReview();feedback('success');await refresh(true);if(current(requestGeneration,who,true))C.sync().catch(()=>{});}
  catch(e){if(current(requestGeneration,who,true))$('desk-review-message').textContent=e.message;}
  finally{if(requestGeneration===generation)$('desk-approve').disabled=$('desk-reject').disabled=false;}
 }
 $('desk-new').onclick=()=>{if(pending){showPanel(false);return}reset();showPanel(false)};$('desk-saved').onclick=()=>showPanel(true);
 $('desk-close-record').onclick=()=>{reset();showPanel(true)};
 $('desk-quantity-down').onclick=()=>{if(locked||pending)return;$('desk-quantity').value=Math.max(1,(Number($('desk-quantity').value)||1)-1);paintForm()};
 $('desk-quantity-up').onclick=()=>{if(locked||pending)return;$('desk-quantity').value=Math.min(20,(Number($('desk-quantity').value)||1)+1);paintForm()};$('desk-quantity').oninput=paintForm;
 $('desk-form').onsubmit=async event=>{
  event.preventDefault();const button=$('desk-submit');if(button.disabled||locked||!allowed())return;
  try{if(!pending){const details=D.normalize(values());pending={action:editing?'helpdesk-edit':'helpdesk-save',payload:editing?{id:editing.id,version:editing.version,details}:{requestId:NavrangLive.uuid(),details}}}}
  catch(e){message(e.message);return}
  button.disabled=true;message('Saving to server… Keep this page open.');$('desk-fields').disabled=true;
  const request=pending,requestGeneration=generation,who=identity();$('desk-form').dataset.pending='true';
  try{
   const result=await C.api(request.action,request.payload);if(!current(requestGeneration,who))return;
   reset();message('✓ Saved on server · '+result.registration.ticket_id+' · pending admin verification.');feedback('success');paint='';offset=0;
  }catch(e){
   if(!current(requestGeneration,who))return;
   // A timeout may mean the server committed. Retrying the exact request is safe.
   if(e.status&&e.status<500){pending=null;paintForm();message(e.message)}
   else{message('Delivery is unconfirmed. Retry this same save to recover its server receipt. '+e.message);button.textContent='Retry same save';$('desk-fields').disabled=true;}
  }finally{if(requestGeneration===generation)button.disabled=false;}
 };
 $('desk-prev').onclick=()=>{offset=Math.max(0,offset-pageSize());refresh(true)};$('desk-next-page').onclick=()=>{offset+=pageSize();refresh(true)};
 $('desk-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{offset=0;refresh(true)},250)};$('desk-filter').onchange=()=>{offset=0;refresh(true)};
 $('desk-review-close').onclick=()=>closeReview();$('desk-approve').onclick=()=>review('approved',$('desk-approve'));$('desk-reject').onclick=()=>review('rejected',$('desk-reject'));
 $('desk-export').onclick=async()=>{if(!admin())return;const button=$('desk-export'),requestGeneration=generation,who=identity();button.disabled=true;try{const result=await C.api('helpdesk-export');if(!current(requestGeneration,who,true))return;C.save(result.filename,'text/csv',result.csv);$('desk-list-stats').textContent=result.count+' server records prepared for the college export.';}catch(e){if(current(requestGeneration,who,true))$('desk-list-stats').textContent=e.message}finally{if(requestGeneration===generation)button.disabled=false}};
 window.addEventListener('resize',()=>{offset=0;paint='';refresh(true)});paintForm();setInterval(()=>{if(!document.hidden)refresh()},2500);
 rootInstall();function rootInstall(){globalThis.NavrangDesk={refresh,clear,allowed,hasDraft:()=>!locked&&(!!pending||(editing?fields.some(k=>String(editing.details[k]??(k==='quantity'?1:''))!==$('desk-'+k).value):['name','email','phone'].some(k=>$('desk-'+k).value.trim())))};}
})();
