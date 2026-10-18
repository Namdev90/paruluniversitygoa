'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const E=require('../app/assets/report-export.js');
const root=path.join(__dirname,'..');
test('CSV protects spreadsheet formulas and preserves Unicode names',()=>{
 const data=E.csv([{'Ticket ID':'ABCD1234','Name':'=1+1','Status':'Attended'},{'Ticket ID':'EFGH5678','Name':'किरण','Status':'Not entered'}]);
 assert.ok(data.startsWith('\uFEFF'));
 assert.match(data, /"'=1\+1"/);
 assert.match(data,/किरण/);
});
test('XLSX produces a real ZIP of Excel workbook parts',()=>{
 const bytes=E.xlsx([{'Ticket ID':'ABCD1234','Name':'=2+2','Entered':true,'Count':3}],'Navrang all');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 assert.equal(v.getUint32(0,true),0x04034b50);
 const zip=Buffer.from(bytes);
 const end=zip.lastIndexOf(Buffer.from('PK\x05\x06','binary'));
 assert.ok(end>0);
 assert.equal(v.getUint32(end,true),0x06054b50);
 const names=['[Content_Types].xml','xl/workbook.xml','xl/worksheets/sheet1.xml'];
 for(const name of names)assert.ok(zip.includes(Buffer.from(name)),name+' must be packaged');
 assert.ok(zip.includes(Buffer.from('&lt;'))===false);
 assert.ok(zip.includes(Buffer.from('=2+2')));
});
test('PDF summary is a self-contained readable PDF',()=>{
 const pdf=Buffer.from(E.pdf({registered:1124,eligible:1041,blocked:83,attended:775,noShow:266,serverIssues:10,issueTickets:6,duplicateAttempts:20,pendingHelpDesk:2,generatedAt:'2026-10-18T04:54:00Z'}));
 assert.match(pdf.subarray(0,8).toString(),/%PDF-1.4/);
 assert.ok(pdf.includes(Buffer.from('Navrang 2026 - Attendance summary')));
 assert.ok(pdf.includes(Buffer.from('%%EOF')));
});
test('report screen and binary Android save integration are bundled',()=>{
 const index=fs.readFileSync(path.join(root,'app/assets/index.html'),'utf8');
 const build=fs.readFileSync(path.join(root,'tools/build.py'),'utf8');
 const native=fs.readFileSync(path.join(root,'app/java/in/navrang/gate/MainActivity.java'),'utf8');
 const gate=fs.readFileSync(path.join(root,'app/assets/gate.js'),'utf8');
 for(const script of ['report-export.js','reports.js']){assert.ok(index.includes('src="'+script+'"'));assert.ok(build.includes("'"+script+"'"));}
 assert.match(index,/id="view-reports"/);assert.match(gate,/canReports\(\)/);
 assert.match(native,/saveReport\(String name,String mime,String content\)/);
 assert.match(native,/reportAllowed\(generation\)/);
});
