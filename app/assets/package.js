(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'));else root.NavrangPackage=factory(root.NavrangCore);})(globalThis,function(C){
 'use strict';
 function encode(batch,at){if(!batch||!batch.total||!Number.isFinite(Date.parse(at)))throw Error('Invalid package data.');return JSON.stringify({format:'navrang.registrations',version:1,eventId:C.EVENT,createdAt:at,records:Object.values(batch.records)});}
 function parse(text){
  if(typeof text!=='string'||text.length>8*1024*1024)throw Error('Choose a registration package smaller than 8 MB.');
  let p;try{p=JSON.parse(text)}catch{throw Error('This is not a valid JSON registration package.');}
  if(!p||p.format!=='navrang.registrations'||p.version!==1)throw Error('Unsupported registration package format or version.');
  if(p.eventId!==C.EVENT)throw Error('This package belongs to a different event.');
  if(!Number.isFinite(Date.parse(p.createdAt))||!Array.isArray(p.records))throw Error('Invalid registration package.');
  return C.normalizeRows(p.records.map(r=>({TransactionID:r.id,Customer:r.name,LinkID:p.eventId,Amount:r.amount,Quantity:r.quantity,RefundAmount:r.refund,Description:r.description})));
 }
 return {encode,parse};
});
