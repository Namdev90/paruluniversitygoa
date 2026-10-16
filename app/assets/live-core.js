(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NavrangLive=api;})(globalThis,function(){
 'use strict';const id=/^[A-Z0-9]{8}$/;
 function entry(e){if(!e||!id.test(e.ticketId)||!Number.isSafeInteger(e.seq)||e.seq<1||typeof e.name!=='string'||typeof e.checker!=='string'||!e.checker||!Number.isFinite(Date.parse(e.at)))throw Error('Invalid server receipt. Keep the request for retry.');return e;}
 function confirm(job,r){
  if(!r||!['admitted','duplicate','blocked','not_found'].includes(r.code))throw Error('Entry is not confirmed.');
  if(r.id!==job.ticketId)throw Error('Server response does not match the saved request.');
  if(r.code==='admitted'||r.code==='duplicate'){entry(r.entry);if(r.entry.ticketId!==job.ticketId)throw Error('Receipt does not match the saved ticket.');if(r.code==='admitted'&&(r.entry.checkerId||'admin')!==job.actor)throw Error('Receipt belongs to another checker.');}
  return r;
 }
 function merge(old,p){
  const s={dataRevision:-1,records:{},entries:{},cursor:0,stats:{},...old};s.records={...s.records};s.entries={...s.entries};
  if(Array.isArray(p.records)&&p.dataRevision>=s.dataRevision){s.records={};for(const r of p.records){if(!r||!id.test(r.id))throw Error('Invalid registration update.');s.records[r.id]=r;}s.dataRevision=p.dataRevision;}
  for(const e of p.entries||[]){entry(e);const previous=s.entries[e.ticketId];if(previous&&(previous.seq!==e.seq||previous.checker!==e.checker||previous.checkerId!==e.checkerId||previous.at!==e.at||previous.deviceId!==e.deviceId))throw Error('Conflicting entry history. Keep the original receipt.');s.entries[e.ticketId]=e;}
  s.cursor=Math.max(s.cursor,p.cursor||0);s.stats=p.stats||s.stats;s.source=p.source||s.source;s.checkers=p.checkers||s.checkers;return s;
 }
 function uuid(){const b=new Uint8Array(16);crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
 function csv(entries){
  const cell=v=>{let s=v==null?'':String(v);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['EventID','TransactionID','Student','CheckedAt','Checker','DeviceID','Scope'],...entries.map(e=>['O9KL3',e.ticketId,e.name,e.at,e.checker,e.deviceId,e.scope||'server'])];
  return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 return {confirm,merge,uuid,csv};
});
