(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NavrangCore=api;})(globalThis,function(){
 'use strict';
 const EVENT='O9KL3', VERSION=1, ID=/^[A-Z0-9]{8}$/;
 const required=['TransactionID','Customer','LinkID','Amount','Quantity','RefundAmount','Description'];
 const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
 const str=v=>v==null?'':String(v).trim();
 const number=v=>typeof v==='number'?(Number.isFinite(v)?v:NaN):typeof v==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v.trim())?Number(v.trim()):NaN;
 const validTime=v=>typeof v==='string'&&Number.isFinite(Date.parse(v));
 function newState(deviceId){return {version:VERSION,eventId:EVENT,deviceId,operatorName:'',records:{},admissions:{},imports:[]};}
 function normalizeRows(rows){
  if(!Array.isArray(rows)||rows.length===0)throw Error('This file has no transaction rows. Your previous data is unchanged.');
  if(rows.length>50000)throw Error('This prototype accepts up to 50,000 transaction rows.');
  for(const name of required)if(!own(rows[0],name))throw Error('Missing column: '+name);
  const records={};let duplicates=0;
  for(let i=0;i<rows.length;i++){
   const r=rows[i], id=str(r.TransactionID);
   if(!ID.test(id))throw Error('Invalid TransactionID at row '+(i+2)+'. Expected eight uppercase letters or numbers.');
   if(str(r.LinkID)!==EVENT)throw Error('Wrong event at row '+(i+2)+'. This app accepts Navratri event O9KL3 only.');
   const description=str(r.Description),name=str(r.Customer),amount=number(r.Amount),quantity=number(r.Quantity),refund=number(r.RefundAmount);
   let reason='';
   if(description!=='Transaction completed successfully')reason=description||'Missing payment result';
   else if(!name)reason='Missing attendee name';
   else if(!Number.isFinite(amount)||amount<100)reason='Amount needs review';
   else if(!Number.isFinite(quantity)||quantity!==1)reason='Ticket quantity needs review';
   else if(!Number.isFinite(refund)||refund!==0)reason='Refund needs review';
   const record={id,name,amount:Number.isFinite(amount)?amount:null,quantity:Number.isFinite(quantity)?quantity:null,refund:Number.isFinite(refund)?refund:null,description,eligible:reason==='',reason};
   if(own(records,id)){
    if(JSON.stringify(records[id])!==JSON.stringify(record))throw Error('Conflicting duplicate TransactionID '+id+'. Import cancelled.');
    duplicates++;continue;
   }
   records[id]=record;
  }
  const total=Object.keys(records).length, eligible=Object.values(records).filter(r=>r.eligible).length;
  return {records,total,eligible,blocked:total-eligible,duplicates};
 }
 function validateState(s){
  if(!s||s.version!==VERSION||s.eventId!==EVENT||typeof s.deviceId!=='string'||!s.deviceId||s.deviceId.length>128)throw Error('Saved data is invalid. Do not clear app data. Export or recover your backup.');
  if(typeof s.operatorName!=='string'||s.operatorName.length>80||!s.records||!s.admissions||Array.isArray(s.records)||Array.isArray(s.admissions)||!Array.isArray(s.imports))throw Error('Saved data has an invalid structure.');
  if(Object.keys(s.records).length>50000||Object.keys(s.admissions).length>50000)throw Error('Saved data exceeds this prototype limit.');
  for(const [id,r] of Object.entries(s.records))if(!ID.test(id)||!r||r.id!==id||typeof r.name!=='string'||typeof r.eligible!=='boolean'||typeof r.reason!=='string')throw Error('Saved ticket data is invalid.');
  for(const [id,a] of Object.entries(s.admissions))if(!ID.test(id)||!a||a.ticketId!==id||typeof a.name!=='string'||typeof a.checker!=='string'||!a.checker.trim()||typeof a.deviceId!=='string'||!validTime(a.at))throw Error('Saved entry history is invalid.');
  return s;
 }
 function applyImport(state,batch,source,at){
  validateState(state);if(!batch||!batch.total||!validTime(at))throw Error('Invalid import.');
  return {...state,records:batch.records,imports:[...state.imports,{source:str(source).slice(0,200),at,total:batch.total,eligible:batch.eligible,blocked:batch.blocked,duplicates:batch.duplicates}]};
 }
 function inspectTicket(state,input){
  const id=str(input);
  if(!ID.test(id))return {code:'invalid',id,message:'Scan the ticket QR or enter its exact eight-character Transaction ID.'};
  if(own(state.admissions,id))return {code:'duplicate',id,entry:state.admissions[id],record:own(state.records,id)?state.records[id]:null};
  if(!own(state.records,id))return {code:'not_found',id,message:'Not in the current Excel file. Ask the help desk for the latest export.'};
  const record=state.records[id];return {code:record.eligible?'ready':'blocked',id,record,message:record.reason};
 }
 function admit(state,input,checker,at){
  validateState(state);checker=str(checker);if(!checker||checker.length>80)throw Error('Save your checker name first (up to 80 characters).');
  if(!validTime(at))throw Error('Check the phone date and time.');
  const current=inspectTicket(state,input);
  if(current.code==='duplicate')return {state,result:current};
  if(current.code!=='ready')throw Error(current.message||'This ticket cannot be admitted.');
  const a={ticketId:current.id,name:current.record.name,checker,deviceId:state.deviceId,at,source:state.imports.length?state.imports[state.imports.length-1].source:''};
  const next={...state,admissions:{...state.admissions,[current.id]:a}};
  return {state:next,result:{code:'admitted',id:current.id,record:current.record,entry:a}};
 }
 function csv(state){
  const cell=v=>{let s=v==null?'':String(v);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const data=[['EventID','TransactionID','Customer','AdmittedAt','Checker','DeviceID','SourceFile']];
  for(const a of Object.values(state.admissions).sort((a,b)=>a.at.localeCompare(b.at)))data.push([EVENT,a.ticketId,a.name,a.at,a.checker,a.deviceId,a.source]);
  return '\uFEFF'+data.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 return {EVENT,VERSION,newState,normalizeRows,validateState,applyImport,inspectTicket,admit,csv};
});
