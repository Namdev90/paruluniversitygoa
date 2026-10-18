(function(root){
 'use strict';
 const C=root.GateClient,E=root.NavrangReportExport,$=id=>document.getElementById(id);
 const kinds={all:'Complete registration and attendance master',attended:'All confirmed attendees',absent:'Eligible registrations with no verified entry',blocked:'Ineligible / blocked registrations',issues:'Server-recorded entry issues',resolved:'Issues resolved by admission',unresolved:'Issues without verified entry',duplicates:'Duplicate scan attempts',activity:'Gate activity and timing evidence',helpdesk:'Help Desk cases',pending:'Pending Help Desk cases',corrections:'Admitted — registration data missing'};
 let generation=0,summary=null,loadedBy='',pending=false;
 const permitted=()=>{const p=C.profile();return !!p&&(p.role==='admin'||p.active===true&&p.reports===true);};
 const identity=()=>{const p=C.profile();return [p?.role||'',p?.checkerId||'',p?.reports===true,p?.active===true].join(':');};
 const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=String(value);if(cls)n.className=cls;return n;};
 const controls=['report-csv','report-xlsx','report-pdf'];
 const enableDownloads=value=>{for(const id of controls)$(id).disabled=!value;};
 const select=$('report-kind');select.replaceChildren();for(const [key,label] of Object.entries(kinds)){const option=text('option',label);option.value=key;select.append(option);}
 const heading=document.querySelector('#view-reports .section-title h2');if(heading)heading.textContent='Faculty reports';
 function status(message){$('report-status').textContent=message;}
 function clear(){generation++;summary=null;loadedBy='';pending=false;$('report-stats').replaceChildren();$('report-teachers').replaceChildren();$('report-manage').hidden=true;status('Sign in with an approved reporting account.');enableDownloads(false);}
 function renderSummary(s){
  const values=[['Total admitted',s.attended],['From registration master',s.registeredAttended],['Organizer-confirmed admissions',s.organizerConfirmed],['Registrations received',s.registered],['Eligible registrations',s.eligible],['No verified entry',s.noShow],['Blocked registrations',s.blocked],['Recorded issue attempts',s.serverIssues],['Tickets with recorded issues',s.issueTickets],['Duplicate attempts',s.duplicateAttempts],['Pending Help Desk cases',s.pendingHelpDesk]];
  const wrap=$('report-stats');wrap.replaceChildren();
  for(const [label,value] of values){const item=text('article','','report-stat');item.append(text('span',label),text('strong',value??'—'));wrap.append(item);}
  enableDownloads(true);
  $('report-caveat').textContent='Total admitted includes documented organizer confirmations. Missing registration data does not establish payment or eligibility. No verified entry does not prove absence. For corrections, original scan time and record creation time are separate; the exact admission time is not known. Updated '+new Date(s.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST.';
 }
 async function loadMembers(seq,who){
  if(C.profile()?.role!=='admin')return;
  const result=await C.api('reports-members');if(seq!==generation||who!==identity()||C.profile()?.role!=='admin')return;
  $('report-manage').hidden=false;const wrap=$('report-teachers');wrap.replaceChildren();
  for(const member of result.members){
   const line=text('div','','report-member'),info=text('div','');info.append(text('strong',member.name),text('small',member.email||'Verified Google account'));
   if(member.requested)info.append(text('small','Faculty access requested'));
   if(member.scanner||member.helpdesk)info.append(text('small','Disable Checker/Help Desk access first.'));
   if(member.nameConfirmed===false)info.append(text('small','Teacher must save their real name first.'));
   const button=text('button',member.teacher?'Revoke reports':'Approve reports','button secondary'),next=!member.teacher;button.type='button';button.disabled=next&&(member.scanner||member.helpdesk||member.nameConfirmed===false);
   button.onclick=async()=>{if(button.disabled||!permitted()||C.profile().role!=='admin')return;button.disabled=true;
    try{await C.api('reports-grant',{checkerId:member.id,enabled:next});if(seq===generation&&who===identity()){status('Faculty access updated. The teacher can refresh their account.');await loadMembers(seq,who);}}
    catch(err){if(seq===generation)status(err.message);}finally{button.disabled=false;}};
   line.append(info,button);wrap.append(line);
  }
  if(!result.members.length)wrap.append(text('p','Teachers appear after signing in with Google and saving their name.'));
 }
 async function refresh(){
  if(!permitted()){clear();return;}
  const seq=++generation,who=identity();loadedBy=who;status('Loading the latest server totals…');enableDownloads(false);$('report-manage').hidden=true;
  try{const r=await C.api('reports-summary');if(seq!==generation||who!==identity()||!permitted())return;summary=r.stats;renderSummary(summary);status('Live report ready. Select a dataset to download.');if(C.profile().role==='admin')await loadMembers(seq,who);}
  catch(err){if(seq===generation){status(err.message);enableDownloads(false);}}
 }
 async function download(format){
  if(pending||!permitted())return;pending=true;const seq=generation,who=identity();enableDownloads(false);
  try{
   const current=await C.api('me');
   if(seq!==generation||who!==identity()||!permitted()||current.reports!==true)throw Error('Reporting access changed. Sign in again.');
   const date=new Date().toISOString().slice(0,10);
   if(format==='pdf'){
    const latest=await C.api('reports-summary');if(seq!==generation||who!==identity()||!permitted())throw Error('Access changed during export.');summary=latest.stats;renderSummary(summary);enableDownloads(false);
    C.saveReport('Navrang-Attendance-Summary-'+date+'.pdf','application/pdf',E.pdf(summary));status('Updated PDF summary prepared. Choose a save location.');
   }else{
    const kind=select.value;if(!Object.prototype.hasOwnProperty.call(kinds,kind))throw Error('Choose a valid report.');status('Collecting '+kinds[kind]+' from the server…');
    const result=await C.api('reports-export',{kind});if(seq!==generation||who!==identity()||!permitted())throw Error('Access changed during export.');
    const rows=result.rows.map(row=>({...row,'Report generated UTC':result.generatedAt}));
    const bytes=format==='csv'?new TextEncoder().encode(E.csv(rows)):E.xlsx(rows,'Navrang '+kind);
    const mime=format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    C.saveReport('Navrang-'+kind+'-'+date+'.'+format,mime,bytes);status(result.count+' records prepared in '+format.toUpperCase()+'. Choose a save location.');
   }
  }catch(err){if(seq===generation)status(err.message);}
  finally{pending=false;if(seq===generation&&permitted()&&summary)enableDownloads(true);}
 }
 $('report-refresh').onclick=refresh;for(const format of ['csv','xlsx','pdf'])$('report-'+format).onclick=()=>download(format);
 C.on(e=>{if((e.type==='auth'||e.type==='profile')&&loadedBy&&loadedBy!==identity())clear();});
 root.NavrangReports={refresh,clear};
})(globalThis);
