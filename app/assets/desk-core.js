(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NavrangDeskCore=api;})(globalThis,function(){
 'use strict';
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 function normalizeLegacy(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Registration details are required.');
  const data={},limits={name:128,studentId:64,college:160,course:120,year:40,phone:24,email:254,ticketId:8,paymentReference:128,notes:1000};
  for(const [key,max]of Object.entries(limits)){const value=raw[key]??'';if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw Error('Invalid '+key+'.');data[key]=value.trim();}
  for(const key of ['name','studentId','college','course','year','phone'])if(!data[key])throw Error('Complete the student name, ID, college, course, year and phone.');
  if(!/^[+()\d .-]+$/.test(data.phone)||data.phone.replace(/\D/g,'').length<7||data.phone.replace(/\D/g,'').length>15)throw Error('Enter a valid phone number.');
  data.email=data.email.toLowerCase();if(data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw Error('Enter a valid email or leave it blank.');
  data.ticketId=data.ticketId.toUpperCase();if(data.ticketId&&!/^[A-Z0-9]{8}$/.test(data.ticketId))throw Error('Ticket ID must be exactly eight letters or digits, or blank for a new ticket.');
  data.issue=raw.issue;data.paymentStatus=raw.paymentStatus;data.paymentMethod=raw.paymentMethod;
  if(!['new_registration','payment_issue','ticket_issue'].includes(data.issue))throw Error('Choose the help desk reason.');
  if(!['paid','unpaid','pending'].includes(data.paymentStatus))throw Error('Choose the reported payment status.');
  if(!['upi','cash','online','other','unknown'].includes(data.paymentMethod))throw Error('Choose the payment method.');
  if(raw.amount===''||raw.amount==null)data.amount=null;else{if(typeof raw.amount!=='number'||!Number.isFinite(raw.amount)||raw.amount<0||raw.amount>100000||Math.abs(raw.amount*100-Math.round(raw.amount*100))>.000001)throw Error('Enter a valid amount in rupees.');data.amount=raw.amount;}
  return data;
 }
 function normalize(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Registration details are required.');
  // Older installed clients can finish pending forms while the new four-field UI rolls out.
  if(!Object.prototype.hasOwnProperty.call(raw,'quantity')&&Object.prototype.hasOwnProperty.call(raw,'studentId'))return normalizeLegacy(raw);
  const data={};for(const [key,max]of Object.entries({name:128,email:254,phone:24})){
   if(typeof raw[key]!=='string'||!raw[key].trim()||raw[key].length>max||/[\u0000-\u001f\u007f]/.test(raw[key]))throw Error('Enter a valid '+key+'.');data[key]=raw[key].trim();
  }
  data.email=data.email.toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))throw Error('Enter a valid email address.');
  if(!/^[+()\d .-]+$/.test(data.phone)||data.phone.replace(/\D/g,'').length<7||data.phone.replace(/\D/g,'').length>15)throw Error('Enter a valid mobile number.');
  if(!Number.isSafeInteger(raw.quantity)||raw.quantity<1||raw.quantity>20)throw Error('Quantity must be a whole number from 1 to 20.');
  data.quantity=raw.quantity;return data;
 }
 function csv(records){
  const cell=value=>{let s=value==null?'':String(value);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
  const columns=[['Student','name'],['Email','email'],['Mobile number','phone'],['Quantity','quantity'],['Ticket ID','ticket_id'],['Review status','status'],['Recorded by','created_by_name'],['Created at (UTC)','created_at'],['Reviewed by','reviewed_by_name'],['Reviewed at (UTC)','reviewed_at'],['Record ID','id']];
  return '\uFEFF'+[columns.map(x=>x[0]),...records.map(r=>columns.map(([,key])=>r[key]??r.details?.[key]??''))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
 }
 return{normalize,csv,uuid};
});
