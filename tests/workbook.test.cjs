const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const path=require('node:path');
let W;try{W=require('../app/assets/workbook.js');}catch{W={};}
const file=process.env.NAVRANG_TEST_XLSX||path.join(__dirname,'../test-data/Link_Transactions_Report-2026-04-16-To-2026-10-16.xlsx');
test('actual supplied export parses 997 transactions with 926 eligible and 71 blocked',{skip:!fs.existsSync(file)},()=>{
 assert.equal(typeof W.parse,'function');
 const b=W.parse(fs.readFileSync(file));assert.equal(b.total,997);assert.equal(b.eligible,926);assert.equal(b.blocked,71);assert.equal(Object.values(b.records).filter(r=>r.eligible).length,926);
});
test('not an XLSX and empty data are rejected',()=>{assert.throws(()=>W.parse(new TextEncoder().encode('not excel')),/original .xlsx/);assert.throws(()=>W.parse(new Uint8Array()),/non-empty/);});
const latest=process.env.NAVRANG_LATEST_XLSX;
test('latest authorized export adds 127 records and keeps prior canonical records unchanged',{skip:!latest||!fs.existsSync(latest)||!fs.existsSync(file)},()=>{const newer=W.parse(fs.readFileSync(latest)),older=W.parse(fs.readFileSync(file));assert.equal(newer.total,1124);assert.equal(newer.eligible,1041);assert.equal(newer.blocked,83);assert.equal(Object.keys(newer.records).filter(id=>!older.records[id]).length,127);for(const id of Object.keys(older.records))for(const key of ['name','amount','quantity','refund','description','eligible'])assert.deepEqual(newer.records[id][key],older.records[id][key])});
