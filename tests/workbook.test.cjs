const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const path=require('node:path');
let W;try{W=require('../app/assets/workbook.js');}catch{W={};}
const file=process.env.NAVRANG_TEST_XLSX||path.join(__dirname,'../test-data/Link_Transactions_Report-2026-04-16-To-2026-10-16.xlsx');
test('actual supplied export parses 997 transactions with 926 eligible and 71 blocked',{skip:!fs.existsSync(file)},()=>{
 assert.equal(typeof W.parse,'function');
 const b=W.parse(fs.readFileSync(file));assert.equal(b.total,997);assert.equal(b.eligible,926);assert.equal(b.blocked,71);assert.equal(Object.values(b.records).filter(r=>r.eligible).length,926);
});
test('not an XLSX and empty data are rejected',()=>{assert.throws(()=>W.parse(new TextEncoder().encode('not excel')),/original .xlsx/);assert.throws(()=>W.parse(new Uint8Array()),/non-empty/);});
