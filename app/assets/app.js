(function(){
 'use strict';
 const C=NavrangCore,S=NavrangStore,W=NavrangWorkbook,$=id=>document.getElementById(id);let state,preview,selectedId=null,busy=false;
 const time=s=>new Date(s).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 function notice(message){$('notice').textContent=message;$('notice').hidden=false;}
 function feedback(status){if(window.Native&&typeof Native.feedback==='function')Native.feedback(status);}
 function clearResult(){selectedId=null;$('result').hidden=true;$('admit').hidden=true;}
 async function refresh(){
  state=await S.read();if(!state)throw Error('Local data is unavailable.');
  $('operator').value=state.operatorName;$('device-label').textContent='Device '+state.deviceId.slice(-8)+' · name attached to every entry';
  $('total-count').textContent=Object.keys(state.records).length;$('eligible-count').textContent=Object.values(state.records).filter(r=>r.eligible).length;$('admitted-count').textContent=Object.keys(state.admissions).length;
  const last=state.imports[state.imports.length-1];$('file-label').textContent=last?last.source+' · imported '+time(last.at)+' · '+last.blocked+' blocked or need review':'Import the original Easebuzz .xlsx export to begin.';
  const entries=Object.values(state.admissions).sort((a,b)=>b.at.localeCompare(a.at));$('recent').replaceChildren();$('empty-log').hidden=entries.length>0;
  for(const a of entries.slice(0,20)){const li=document.createElement('li'),n=document.createElement('strong'),d=document.createElement('span');n.textContent=a.name+' · '+a.ticketId;d.textContent=a.checker+' · '+time(a.at);li.append(n,d);$('recent').append(li);}
 }
 function show(r){
  const box=$('result');box.hidden=false;box.className='result '+r.code;$('admit').hidden=true;$('result-kicker').textContent=r.id||'TICKET CHECK';$('result-name').textContent=r.record?r.record.name:r.entry?r.entry.name:'';
  const labels={ready:'Payment matched',admitted:'Entry confirmed',duplicate:'Already admitted',blocked:'Do not admit',not_found:'Not in this file',invalid:'Invalid ticket QR'};$('result-title').textContent=labels[r.code]||'Needs review';
  if(r.code==='ready'){$('result-detail').textContent='Check their university ID, then confirm entry. One entry only on this phone.';$('admit').hidden=false;$('admit').disabled=busy;}
  else if(r.entry)$('result-detail').textContent=(r.code==='duplicate'?'No re-entry. ':'Saved on this phone. ')+r.entry.checker+' · '+time(r.entry.at);
  else $('result-detail').textContent=r.message||'Ask the help desk to review this transaction.';
 }
 async function lookup(value){try{await refresh();selectedId=String(value).trim();show(C.inspectTicket(state,selectedId));}catch(e){notice(e.message);}}
 $('save-operator').onclick=async()=>{try{const name=$('operator').value.trim();if(!name||name.length>80)throw Error('Enter your checker name, up to 80 characters.');await S.mutate(s=>({state:{...s,operatorName:name},result:true}));await refresh();notice('Checker name saved.');}catch(e){notice(e.message);}};
 $('excel-file').onchange=async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;preview=null;$('preview').hidden=true;
  try{notice('Reading Excel on this device…');if(file.size>8*1024*1024)throw Error('Choose an Excel file smaller than 8 MB.');await new Promise(r=>setTimeout(r,25));const bytes=await file.arrayBuffer();const batch=W.parse(bytes);preview={batch,name:file.name};$('preview-text').textContent=batch.total+' transactions · '+batch.eligible+' eligible · '+batch.blocked+' blocked/review'+(batch.duplicates?' · '+batch.duplicates+' repeated rows ignored':'')+'. Existing entries will be kept.';$('preview').hidden=false;notice('File checked. Review the counts, then apply it.');}catch(e){notice(e.message||'Could not read this Excel file. Previous data is unchanged.');}
 };
 $('cancel-import').onclick=()=>{preview=null;$('preview').hidden=true;notice('Import cancelled. Previous data is unchanged.');};
 $('apply-import').onclick=async()=>{
  if(!preview||busy)return;busy=true;$('apply-import').disabled=true;const p=preview;
  try{await S.mutate(s=>({state:C.applyImport(s,p.batch,p.name,new Date().toISOString()),result:true}));preview=null;$('preview').hidden=true;clearResult();await refresh();notice('Excel updated. Existing entry history was kept.');}catch(e){notice(e.message);}finally{busy=false;$('apply-import').disabled=false;}
 };
 $('lookup').onclick=()=>lookup($('ticket-id').value);$('ticket-id').onkeydown=e=>{if(e.key==='Enter')lookup($('ticket-id').value);};
 $('scan').onclick=()=>{if(window.Native&&typeof Native.scan==='function')Native.scan();else notice('Camera scanning is available in the Android app. Use the Transaction ID field for this browser test.');};
 window.onNativeScan=value=>{$('ticket-id').value=value;lookup(value);};window.onNativeError=message=>notice(message);window.onNativeSaved=name=>notice('Saved '+name+'.');
 $('admit').onclick=async()=>{
  if(busy||!selectedId)return;const id=selectedId;busy=true;$('admit').disabled=true;
  try{const result=await S.mutate(s=>C.admit(s,id,s.operatorName,new Date().toISOString()));await refresh();show(result);feedback(result.code);}catch(e){notice(e.message);$('admit').hidden=true;}finally{busy=false;$('admit').disabled=false;}
 };
 async function save(name,mime,text){
  if(window.Native&&typeof Native.saveText==='function'){Native.saveText(name,mime,text);return;}
  const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 $('export-csv').onclick=async()=>{try{await refresh();await save('Navrang-Entries-'+state.deviceId.slice(-8)+'.csv','text/csv',C.csv(state));}catch(e){notice(e.message);}};
 $('export-backup').onclick=async()=>{try{await refresh();await save('Navrang-Backup-'+state.deviceId.slice(-8)+'.json','application/json',JSON.stringify(state,null,2));}catch(e){notice(e.message);}};
 (async()=>{const existing=await S.read();if(!existing)await S.mutate(s=>({state:s,result:true}));await refresh();})().catch(e=>{notice(e.message);for(const id of ['save-operator','scan','lookup','apply-import','export-csv','export-backup'])$(id).disabled=true;});
})();
