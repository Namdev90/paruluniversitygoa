(function(root){
 'use strict';
 const C=root.GateClient,E=root.NavrangReportExport,$=id=>document.getElementById(id);
 const kinds={all:'All registrations',attended:'Confirmed attendees',absent:'Eligible with no verified entry',
  blocked:'Ineligible / blocked',issues:'Server-recorded entry issues',resolved:'Issues resolved by admission',
  unresolved:'Issues without verified entry',duplicates:'Duplicate scan attempts',
  activity:'Gate activity by hour and checker',helpdesk:'Help Desk cases',pending:'Pending Help Desk cases'};
 let generation=0,summary=null,loadedBy='',pending=false;
 const permitted=()=>{const p=C.profile();return !!p&&(p.role==='admin'||p.active===true&&p.reports===true);};
 const identity=()=>{const p=C.profile();return [p?.role||'',p?.checkerId||'',p?.reports===true,p?.active===true].join(':');};
 const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=String(value);if(cls)e.className=cls;return e;};
 function status(message){$('report-status').textContent=message;}
 function clear(){generation++;summary=null;loadedBy='';pending=false;$('report-stats').replaceChildren();$('report-teachers').replaceChildren();$('report-manage').hidden=true;status('Sign in with an approved reporting account.');for(const id of ['report-csv','report-xlsx','report-pdf'])$(id).disabled=true;}
 function renderSummary(s){
  const values=[['Registered',s.registered],['Eligible',s.eligible],['Attended',s.attended],
   ['No verified entry',s.noShow],['Blocked',s.blocked],['Server issues',s.serverIssues],
   ['Duplicate attempts',s.duplicateAttempts],['Pending Help Desk',s.pendingHelpDesk]];
  const wrap=$('report-stats');wrap.replaceChildren();
  for(const [label,value] of values){const item=text('article','', 'report-stat');item.append(text('span',label),text('strong',value??'—'));wrap.append(item);}
  $('report-csv').disabled=$('report-xlsx').disabled=$('report-pdf').disabled=false;
  $('report-caveat').textContent='No verified entry does not prove absence. Only server-recorded QR problems are counted; unsent or lost offline scans cannot be verified. Last generated: '+new Date(s.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST.';
 }
 async function loadMembers(seq,who){
  if(C.profile()?.role!=='admin')return;
  const result=await C.api('reports-members');
  if(seq!==generation||who!==identity())return;
  $('report-manage').hidden=false;const wrap=$('report-teachers');wrap.replaceChildren();
  for(const member of result.members){
   const line=text('div','', 'report-member'),info=text('div','');
   info.append(text('strong',member.name),text('small',member.email||'Verified Google account'));
   if(member.scanner||member.helpdesk)info.append(text('small','Disable Checker/Help Desk access first.'));
   const button=text('button',member.teacher?'Revoke reports':'Approve reports','button secondary');
   const next=!member.teacher;button.type='button';button.disabled=next&&(member.scanner||member.helpdesk);
   button.onclick=async()=>{if(button.disabled||!permitted()||C.profile().role!=='admin')return;button.disabled=true;
    try{await C.api('reports-grant',{checkerId:member.id,enabled:next});
     if(seq===generation&&who===identity()){status('Teacher access updated. The teacher can refresh their account.');await loadMembers(seq,who);}}
    catch(err){if(seq===generation)status(err.message);}finally{button.disabled=false;}};
   line.append(info,button);wrap.append(line);
  }
  if(!result.members.length)wrap.append(text('p','Teachers appear here after signing in with Google for the first time.'));
 }
 async function refresh(){
  if(!permitted()){clear();return;}
  const seq=++generation,who=identity();loadedBy=who;status('Loading the latest server totals…');
  $('report-manage').hidden=true;
  try{
   const r=await C.api('reports-summary');if(seq!==generation||who!==identity()||!permitted())return;
   summary=r.stats;renderSummary(summary);
   status('Live report ready. Select a dataset and download it.');
   if(C.profile().role==='admin')await loadMembers(seq,who);
  }catch(err){if(seq===generation){status(err.message);for(const id of ['report-csv','report-xlsx','report-pdf'])$(id).disabled=true;}}
 }
 async function download(format){
  if(pending||!permitted())return;pending=true;
  const seq=generation,who=identity();const controls=['report-csv','report-xlsx','report-pdf'];for(const id of controls)$(id).disabled=true;
  try{
   // Refresh server-side identity before any personal-data export.
   const current=await C.api('me');
   if(seq!==generation||who!==identity()||!permitted()||current.reports!==true)throw Error('Reporting access changed. Sign in again.');
   const date=new Date().toISOString().slice(0,10);
   if(format==='pdf'){
    if(!summary)throw Error('Refresh your report first.');
    const bytes=E.pdf(summary);
    C.saveReport('Navrang-Attendance-Summary-'+date+'.pdf','application/pdf',bytes);
   }else{
    const kind=$('report-kind').value;
    if(!Object.prototype.hasOwnProperty.call(kinds,kind))throw Error('Choose a valid report.');
    status('Collecting '+kinds[kind]+' from the server…');
    const result=await C.api('reports-export',{kind});
    if(seq!==generation||who!==identity()||!permitted())throw Error('Access changed during export.');
    const bytes=format==='csv'?new TextEncoder().encode(E.csv(result.rows)):E.xlsx(result.rows,'Navrang '+kind);
    const ext=format==='csv'?'csv':'xlsx',mime=format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    C.saveReport('Navrang-'+kind+'-'+date+'.'+ext,mime,bytes);
    status(result.count+' records prepared in '+format.toUpperCase()+'. Choose a save location.');
   }
  }catch(err){if(seq===generation)status(err.message);}
  finally{pending=false;if(seq===generation&&permitted()&&summary)for(const id of controls)$(id).disabled=false;}
 }
 $('report-refresh').onclick=refresh;
 for(const format of ['csv','xlsx','pdf'])$('report-'+format).onclick=()=>download(format);
 C.on(e=>{if(e.type==='auth'||e.type==='profile')clear();});
 root.NavrangReports={refresh,clear};
})(globalThis);
