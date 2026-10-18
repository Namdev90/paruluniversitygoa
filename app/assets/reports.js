(function(root){
 'use strict';
 const C=root.GateClient,E=root.NavrangReportExport,$=id=>document.getElementById(id);
 const kinds={all:'Complete registration and attendance master',attended:'All confirmed attendees',absent:'Eligible registrations with no verified entry',blocked:'Ineligible / blocked registrations',issues:'Server-recorded entry issues',resolved:'Issues resolved by admission',unresolved:'Issues without verified entry',duplicates:'Duplicate scan attempts',activity:'Gate activity and timing evidence',helpdesk:'Help Desk cases',pending:'Pending Help Desk cases',corrections:'Admitted — registration data missing'};
 const registrationColumns=['Ticket ID','Name','Name status','In registration master','Registration retained','Eligible','Eligibility issue','Payment result','Amount INR','Attendance','Admission basis','Note','Verified entry UTC','Original scan UTC','Record created UTC','Organizer confirmation UTC','Checker / record source','Server issue attempts','Duplicate attempts'];
 const issueColumns=['Ticket ID','Name','Issue codes','Issue attempts','First issue UTC','Outcome','Admission basis','Note','Verified entry UTC','Record created UTC'];
 const helpdeskColumns=['Ticket ID','Name','Status','Created UTC','Reviewed UTC','Recorded by'];
 // Explicit schemas keep empty files useful and keep unrequested response fields out of exports.
 const datasetColumns={all:registrationColumns,attended:registrationColumns,absent:registrationColumns,blocked:registrationColumns,corrections:registrationColumns,
  issues:issueColumns,resolved:issueColumns,unresolved:issueColumns,
  duplicates:['Ticket ID','Name','Duplicate attempts','First duplicate UTC','Last duplicate UTC'],
  activity:['Hour IST','Record source','Time basis','Admissions'],helpdesk:helpdeskColumns,pending:helpdeskColumns};
 let generation=0,summary=null,loadedBy='',pending=null;
 const permitted=()=>{const p=C.profile();return !!p&&(p.role==='admin'||p.active===true&&p.reports===true);};
 const identity=()=>{const p=C.profile();return [p?.role||'',p?.checkerId||'',p?.reports===true,p?.active===true].join(':');};
 const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=String(value);if(cls)n.className=cls;return n;};
 const controls=['report-csv','report-xlsx','report-pdf'];
 const enableDownloads=value=>{for(const id of controls)$(id).disabled=!value||!!pending;};
 const select=$('report-kind');select.replaceChildren();for(const [key,label] of Object.entries(kinds)){const option=text('option',label);option.value=key;select.append(option);}
 const heading=document.querySelector('#view-reports .section-title h2');if(heading)heading.textContent='Faculty reports';
 function status(message,options){$('report-status').textContent=message;root.NavrangReportLayout?.setStatus(message,options);}
 function clear(){generation++;summary=null;loadedBy='';pending=null;$('report-stats').replaceChildren();$('report-caveat').textContent='';$('report-teachers').replaceChildren();$('report-manage').hidden=true;status('Sign in with an approved reporting account.');enableDownloads(false);}
 function checkedSummary(result){
  const s=result?.stats;
  if(!s||typeof s!=='object'||!Number.isFinite(Date.parse(s.generatedAt))||
   ['registered','eligible','blocked','attended','registeredAttended','organizerConfirmed','noShow','serverIssues','issueTickets','duplicateAttempts','pendingHelpDesk'].some(key=>!Number.isSafeInteger(s[key])||s[key]<0))throw Error('The server returned an incomplete report. Refresh and try again.');
  return s;
 }
 function renderSummary(s){
  const values=[['Total admitted',s.attended],['From registration master',s.registeredAttended],['Organizer-confirmed admissions',s.organizerConfirmed],['Registrations received',s.registered],['Eligible registrations',s.eligible],['No verified entry',s.noShow],['Blocked registrations',s.blocked],['Recorded issue attempts',s.serverIssues],['Tickets with recorded issues',s.issueTickets],['Duplicate attempts',s.duplicateAttempts],['Pending Help Desk cases',s.pendingHelpDesk]];
  const wrap=$('report-stats');wrap.replaceChildren();
  if(root.NavrangReportLayout)root.NavrangReportLayout.setMetrics(values);else for(const [label,value] of values){const item=text('article','','report-stat');item.append(text('span',label),text('strong',value??'—'));wrap.append(item);}
  enableDownloads(true);
  $('report-caveat').textContent='Total admitted includes documented organizer confirmations. Missing registration data does not establish payment or eligibility. No verified entry does not prove absence. For corrections, original scan time and record creation time are separate; the exact admission time is not known. Updated '+new Date(s.generatedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST.';
 }
 async function loadMembers(seq,who){
  if(C.profile()?.role!=='admin')return;
  const result=await C.api('reports-members');if(seq!==generation||who!==identity()||C.profile()?.role!=='admin')return;
  if(root.NavrangReportLayout)root.NavrangReportLayout.refreshAccess();else $('report-manage').hidden=false;const wrap=$('report-teachers');wrap.replaceChildren();
  for(const member of result.members){
   const line=text('div','','report-member'),info=text('div','');info.append(text('strong',member.name),text('small',member.email||'Verified Google account'));
   if(member.requested)info.append(text('small','Faculty access requested'));
   if(member.scanner||member.helpdesk)info.append(text('small','Disable Checker/Help Desk access first.'));
   if(member.nameConfirmed===false)info.append(text('small','Teacher must save their real name first.'));
   const button=text('button',member.teacher?'Revoke reports':'Approve reports','button secondary'),next=!member.teacher;button.type='button';button.disabled=next&&(member.scanner||member.helpdesk||member.nameConfirmed===false);
   button.onclick=async()=>{if(button.disabled||!permitted()||C.profile().role!=='admin')return;button.disabled=true;
    try{await C.api('reports-grant',{checkerId:member.id,enabled:next});if(seq===generation&&who===identity()){status('Faculty access updated. The teacher can refresh their account.');await loadMembers(seq,who);}}
    catch(err){if(seq===generation)status(err.message,{error:true});}finally{button.disabled=false;}};
   line.append(info,button);wrap.append(line);
  }
  if(!result.members.length)wrap.append(text('p','Teachers appear after signing in with Google and saving their name.'));
 }
 async function refresh(){
  if(!permitted()){clear();return;}
  const seq=++generation,who=identity();loadedBy=who;summary=null;$('report-stats').replaceChildren();$('report-caveat').textContent='';status('Loading the latest server totals…');enableDownloads(false);$('report-manage').hidden=true;
  try{const r=await C.api('reports-summary');if(seq!==generation||who!==identity()||!permitted())return;summary=checkedSummary(r);renderSummary(summary);status('Live report ready. Select a dataset to download.');if(C.profile().role==='admin'){
   try{await loadMembers(seq,who);}
   catch(err){if(seq===generation&&who===identity()&&C.profile()?.role==='admin'){
    if(root.NavrangReportLayout)root.NavrangReportLayout.refreshAccess();else $('report-manage').hidden=false;
    $('report-teachers').replaceChildren(text('p','Teacher management unavailable. Attendance downloads remain ready. Use Refresh to retry.','micro-note'));
   }}
  }}
  catch(err){if(seq===generation){if(err.status===401||err.status===403)clear();status(err.message,{error:true});enableDownloads(false);}}
 }
 async function download(format){
  if(pending||!permitted()||!summary)return;const operation={},seq=generation,who=identity(),kind=select.value,requestId=root.NavrangLive?.uuid?.()||root.crypto.randomUUID();let preparedId='',terminal=false;pending=operation;enableDownloads(false);
  try{
   if(!['csv','xlsx','pdf'].includes(format)||!Object.prototype.hasOwnProperty.call(kinds,kind))throw Error('Choose a valid report.');
   const current=await C.api('me');
   if(seq!==generation)return;
   if(who!==identity()||!permitted()||current.reports!==true){clear();status('Reporting access changed. Sign in again.');return;}
   const date=new Date().toISOString().slice(0,10);
   const requireOperation=result=>{if(typeof result.operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.operationId))throw Error('The server did not return a report operation. Ask the administrator to update the reporting service.');preparedId=result.operationId;};
   const savePrepared=async(name,mime,bytes,description)=>{
    await C.api('reports-save-outcome',{operationId:preparedId,outcome:'initiated'});
    if(seq!==generation||who!==identity()||!permitted())return;
    status(description+' '+(C.native?'Choose a save location.':'Starting browser download.'));
    const result=await C.saveReport(name,mime,bytes,{operationId:preparedId,dataset:format==='pdf'?'summary':kind,format});
    if(seq!==generation||who!==identity()||!permitted())return;
    const outcome=C.native?result?.outcome:'initiated';if(!['saved','cancelled','failed','initiated'].includes(outcome))throw Error('The app did not confirm this report save.');terminal=true;
    let receiptPending=false;if(outcome!=='initiated')try{await C.api('reports-save-outcome',{operationId:preparedId,outcome});}catch{receiptPending=true;}
    if(seq!==generation||who!==identity()||!permitted())return;
    status(outcome==='saved'?'Report saved on this device.'+(receiptPending?' The server has not acknowledged the device receipt.':''):outcome==='cancelled'?'Report save cancelled.':outcome==='failed'?'Could not save report. Choose another location.':description+' Browser download initiated. Check your downloads.',{error:outcome==='failed'});
   };
   if(format==='pdf'){
    const latest=await C.api('reports-summary-prepare',{requestId});if(seq!==generation||who!==identity()||!permitted())throw Error('Access changed during export.');summary=checkedSummary(latest);requireOperation(latest);renderSummary(summary);enableDownloads(false);
    await savePrepared('Navrang-Attendance-Summary-'+date+'.pdf','application/pdf',E.pdf(summary),'Updated PDF summary prepared.');
   }else{
    status('Collecting '+kinds[kind]+' from the server…');
    const result=await C.api('reports-export',{kind,format,requestId});if(seq!==generation||who!==identity()||!permitted())throw Error('Access changed during export.');
    if(result.kind!==kind||!Array.isArray(result.rows)||result.rows.length>10000||result.count!==result.rows.length||!Number.isFinite(Date.parse(result.generatedAt))||result.rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('The server returned an incomplete dataset. Refresh and try again.');
    requireOperation(result);
    const rows=result.rows.map(row=>({...row,'Report generated UTC':result.generatedAt})),headers=[...datasetColumns[kind],'Report generated UTC'];
    const bytes=format==='csv'?new TextEncoder().encode(E.csv(rows,headers)):E.xlsx(rows,'Navrang '+kind,headers);
    const mime=format==='csv'?'text/csv':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    await savePrepared('Navrang-'+kind+'-'+date+'.'+format,mime,bytes,(result.count?result.count+' records prepared':'No records match this dataset. Column headers prepared')+' in '+format.toUpperCase()+'.');
   }
  }catch(err){if(seq===generation){if(preparedId&&!terminal&&who===identity()&&permitted())try{await C.api('reports-save-outcome',{operationId:preparedId,outcome:'failed'});}catch{}if(err.status===401||err.status===403)clear();status(err.message,{error:true});}}
  finally{if(pending===operation){pending=null;if(permitted()&&summary)enableDownloads(true);}}
 }
 $('report-refresh').onclick=refresh;for(const format of ['csv','xlsx','pdf'])$('report-'+format).onclick=()=>download(format);
 C.on(e=>{if((e.type==='auth'||e.type==='profile')&&loadedBy&&loadedBy!==identity())clear();});
 root.NavrangReports={refresh,clear};
})(globalThis);
