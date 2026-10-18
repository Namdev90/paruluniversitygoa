(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NavrangReportExport=api;})(globalThis,function(){
 'use strict';
 const utf8=s=>new TextEncoder().encode(s);
 const text=v=>v==null?'':String(v);
 const csvCell=v=>{let s=text(v);if(/^[\s\u0000-\u001f]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 function columns(rows){return [...new Set(rows.flatMap(row=>Object.keys(row)))];}
 function csv(rows){const cols=columns(rows);return '\uFEFF'+[cols.map(csvCell).join(','),...rows.map(r=>cols.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n';}
 function xml(v){return text(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
 function colLetter(i){let v='';for(i++;i;i=Math.floor((i-1)/26))v=String.fromCharCode(65+(i-1)%26)+v;return v;}
 const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;t[n]=c>>>0;}return t;})();
 function crc32(bytes){let c=0xffffffff;for(let n of bytes)c=crcTable[(c^n)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
 function pack(chunks){const length=chunks.reduce((s,b)=>s+b.length,0),out=new Uint8Array(length);let at=0;for(const b of chunks){out.set(b,at);at+=b.length;}return out;}
 function zip(entries){
  const local=[],central=[];let offset=0;
  for(const [name,data] of entries){
   const key=utf8(name),bytes=typeof data==='string'?utf8(data):data,crc=crc32(bytes);
   if(bytes.length>0xffffffff)throw Error('Dataset exceeds XLSX limit.');
   const a=new Uint8Array(30+key.length),dv=new DataView(a.buffer);
   dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(6,0x0800,true);
   dv.setUint32(14,crc,true);dv.setUint32(18,bytes.length,true);dv.setUint32(22,bytes.length,true);
   dv.setUint16(26,key.length,true);a.set(key,30);
   const b=new Uint8Array(46+key.length),cv=new DataView(b.buffer);
   cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
   cv.setUint16(8,0x0800,true);cv.setUint32(16,crc,true);cv.setUint32(20,bytes.length,true);
   cv.setUint32(24,bytes.length,true);cv.setUint16(28,key.length,true);cv.setUint32(42,offset,true);b.set(key,46);
   local.push(a,bytes);central.push(b);offset+=a.length+bytes.length;
  }
  const body=pack(local),dir=pack(central),end=new Uint8Array(22),e=new DataView(end.buffer);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);
  e.setUint16(10,entries.length,true);e.setUint32(12,dir.length,true);e.setUint32(16,body.length,true);
  return pack([body,dir,end]);
 }
 function xlsx(rows,sheetName='Navrang'){
  const headers=columns(rows);if(headers.length>150||rows.length>50000)throw Error('Too many report records.');
  const values=[headers,...rows.map(r=>headers.map(k=>r[k]))];
  const lines=values.map((r,i)=>'<row r="'+(i+1)+'">'+r.map((value,j)=>{
   const cell=colLetter(j)+(i+1);
   return typeof value==='number'&&Number.isFinite(value)?'<c r="'+cell+'"><v>'+value+'</v></c>':
    typeof value==='boolean'?'<c r="'+cell+'" t="b"><v>'+(value?1:0)+'</v></c>':
    '<c r="'+cell+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  }).join('')+'</row>').join('');
  const doc='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const sheet=doc+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+lines+'</sheetData></worksheet>';
  const workbook=doc+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+xml(sheetName.slice(0,31))+'" sheetId="1" r:id="rId1"/></sheets></workbook>';
  return zip([
   ['[Content_Types].xml',doc+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
   ['_rels/.rels',doc+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',workbook],
   ['xl/_rels/workbook.xml.rels',doc+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
   ['xl/worksheets/sheet1.xml',sheet]
  ]);
 }
 function pdf(summary){
  const metrics=[['Registered',summary.registered],['Eligible',summary.eligible],['Blocked',summary.blocked],
   ['Confirmed attendees',summary.attended],['Eligible with no verified entry',summary.noShow],
   ['Server issue attempts',summary.serverIssues],['Tickets with server issues',summary.issueTickets],
   ['Duplicate attempts',summary.duplicateAttempts],['Pending Help Desk cases',summary.pendingHelpDesk]];
  const esc=v=>text(v).replace(/[^\x20-\x7e]/g,'?').replace(/[\\()]/g,m=>'\\'+m);
  const lines=['Navrang 2026 - Attendance summary','Parul University Goa',''];
  for(const [label,value] of metrics)lines.push(label+': '+text(value??'Unverified'));
  lines.push('','Generated UTC: '+text(summary.generatedAt||new Date().toISOString()),'',
   'Attendance numbers use server-confirmed admission receipts.',
   'No verified entry does NOT prove non-attendance.',
   'Offline/unsubmitted attempts cannot be counted as gate issues.',
   'Use the CSV/XLSX dataset export for participant-level details.');
  const stream='BT /F1 13 Tf 45 785 Td 17 TL '+lines.map((line,i)=>(i?'T* ':'')+'('+esc(line)+') Tj').join('\n')+' ET\n';
  const objects=[
   '<< /Type /Catalog /Pages 2 0 R >>',
   '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
   '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
   '<< /Length '+utf8(stream).length+' >>\nstream\n'+stream+'endstream',
   '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const all=['%PDF-1.4\n%\x80\x80\x80\x80\n'],offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(utf8(all.join('')).length);all.push((i+1)+' 0 obj\n'+objects[i]+'\nendobj\n');}
  const xref=utf8(all.join('')).length;
  all.push('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n');
  for(let i=1;i<offsets.length;i++)all.push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
  all.push('trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');
  return utf8(all.join(''));
 }
 return{csv,xlsx,pdf,columns};
});
