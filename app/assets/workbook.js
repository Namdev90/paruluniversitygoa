(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./core.js'),require('./vendor/xlsx.full.min.js'));else root.NavrangWorkbook=factory(root.NavrangCore,root.XLSX);})(globalThis,function(Core,XLSX){
 'use strict';
 return {parse(bytes){
  if(!bytes||bytes.byteLength===0||bytes.byteLength>8*1024*1024)throw Error('Choose a non-empty Excel file smaller than 8 MB.');
  const b=new Uint8Array(bytes);if(b[0]!==80||b[1]!==75)throw Error('Choose the original .xlsx Excel export, not a photo, PDF or renamed file.');
  const wb=XLSX.read(b,{type:'array',dense:false,cellHTML:false,cellStyles:false,bookVBA:false,sheetRows:50002});
  const sheet=wb.Sheets.Link_Transactions;if(!sheet)throw Error('Missing Link_Transactions sheet. Choose the original Easebuzz Excel export.');
  if(sheet['!fullref']&&XLSX.utils.decode_range(sheet['!fullref']).e.r>50000)throw Error('This prototype accepts up to 50,000 transaction rows.');
  return Core.normalizeRows(XLSX.utils.sheet_to_json(sheet,{defval:null,raw:true}));
 }};
});
