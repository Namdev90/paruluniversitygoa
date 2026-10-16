const test = require('node:test');
const assert = require('node:assert/strict');
let C;
try { C = require('../app/assets/core.js'); } catch { C = {}; }
const row = (extra={}) => ({ TransactionID:'ABCDEFG1',Customer:'Test Student',LinkID:'O9KL3',Amount:100,Quantity:1,RefundAmount:0,Description:'Transaction completed successfully',PayOutStatus:'Not Paid',...extra });
const stateWith = (...rows) => C.applyImport(C.newState('device-test'), C.normalizeRows(rows), 'test.xlsx','2026-10-16T15:00:00Z');

test('successful payment with unsettled payout remains eligible',()=>{
 assert.equal(typeof C.normalizeRows,'function');
 const b=C.normalizeRows([row()]); assert.equal(b.eligible,1); assert.equal(b.records.ABCDEFG1.eligible,true);
});
test('cancelled failed and dropped transactions are blocked',()=>{
 for(const Description of ['Transaction Failed','Transaction Dropped','Transaction Cancelled by user']) assert.equal(C.normalizeRows([row({Description})]).eligible,0);
});
test('payout Paid cannot make an unsuccessful transaction eligible',()=>assert.equal(C.normalizeRows([row({Description:'Transaction Failed',PayOutStatus:'Paid'})]).eligible,0));
test('fees above 100 do not block a successful payment',()=>assert.equal(C.normalizeRows([row({Amount:101.8})]).eligible,1));
test('refunds underpayment invalid quantity and missing names are blocked',()=>{
 for(const extra of [{RefundAmount:100},{RefundAmount:-1},{Amount:99},{Amount:null},{Quantity:2},{Quantity:null},{Customer:''},{RefundAmount:null}]) assert.equal(C.normalizeRows([row(extra)]).eligible,0);
});
test('unknown status is blocked rather than guessed successful',()=>assert.equal(C.normalizeRows([row({Description:'Payment maybe successful'})]).eligible,0));
test('boolean and coercible object spreadsheet cells cannot create eligible tickets',()=>{
 for(const extra of [{Quantity:true},{RefundAmount:false},{Amount:true},{Amount:'0x64'},{RefundAmount:{valueOf:()=>0}}]) assert.equal(C.normalizeRows([row(extra)]).eligible,0);
});
test('wrong event, malformed IDs and conflicting IDs reject import',()=>{
 for(const rows of [[row({LinkID:'OTHER'})],[row({TransactionID:'https://example.com'})],[row(),row({Description:'Transaction Failed'})]]) assert.throws(()=>C.normalizeRows(rows));
});
test('identical repeated rows collapse without changing independent tickets',()=>{
 const b=C.normalizeRows([row(),row(),row({TransactionID:'ABCDEFG2',Customer:'Test Student'})]); assert.equal(b.total,2);assert.equal(b.duplicates,1);
});
test('missing schema and empty files reject import',()=>{ assert.throws(()=>C.normalizeRows([]));assert.throws(()=>C.normalizeRows([{TransactionID:'ABCDEFG1'}])); });
test('fresh state and unknown ticket never admit',()=>{ assert.equal(C.inspectTicket(C.newState('x'),'ABCDEFG1').code,'not_found');assert.throws(()=>C.admit(C.newState('x'),'ABCDEFG1','Checker','2026-10-16T15:00:00Z')); });
test('invalid QR does not get opened or fuzzily matched',()=>{
 const s=stateWith(row({TransactionID:'O0O0O0O0'}));assert.equal(C.inspectTicket(s,'00000000').code,'not_found');assert.equal(C.inspectTicket(s,'https://example.com').code,'invalid');assert.equal(C.inspectTicket(s,'O0O0O0O0').code,'ready');
});
test('admission requires checker identity',()=>assert.throws(()=>C.admit(stateWith(row()),'ABCDEFG1','   ','2026-10-16T15:00:00Z')));
test('one admission records attribution and never mutates its input',()=>{
 const s=stateWith(row()); const a=C.admit(s,'ABCDEFG1','Checker One','2026-10-16T15:01:00Z');assert.equal(a.result.code,'admitted');assert.equal(Object.keys(s.admissions).length,0);assert.equal(a.state.admissions.ABCDEFG1.checker,'Checker One');assert.equal(a.state.admissions.ABCDEFG1.deviceId,'device-test');
});
test('repeat admissions stay duplicate with original checker and time',()=>{
 const a=C.admit(stateWith(row()),'ABCDEFG1','First','2026-10-16T15:01:00Z');const b=C.admit(a.state,'ABCDEFG1','Second','2026-10-16T15:02:00Z');assert.equal(b.result.code,'duplicate');assert.equal(b.state.admissions.ABCDEFG1.checker,'First');assert.equal(Object.keys(b.state.admissions).length,1);
});
test('updated Excel replaces eligibility but preserves every admission',()=>{
 const a=C.admit(stateWith(row()),'ABCDEFG1','First','2026-10-16T15:01:00Z');const s=C.applyImport(a.state,C.normalizeRows([row({TransactionID:'ABCDEFG2'})]),'new.xlsx','2026-10-16T15:02:00Z');assert.equal(C.inspectTicket(s,'ABCDEFG1').code,'duplicate');assert.equal(C.inspectTicket(s,'ABCDEFG2').code,'ready');assert.equal(Object.keys(s.records).length,1);assert.equal(s.admissions.ABCDEFG1.checker,'First');
});
test('reimporting the same file cannot reset a used ticket',()=>{
 const a=C.admit(stateWith(row()),'ABCDEFG1','First','2026-10-16T15:01:00Z');const s=C.applyImport(a.state,C.normalizeRows([row()]),'test.xlsx','2026-10-16T15:02:00Z');assert.equal(C.inspectTicket(s,'ABCDEFG1').code,'duplicate');
});
test('changed payment and refund statuses take effect for unadmitted tickets',()=>{
 for(const extra of [{Description:'Transaction Failed'},{RefundAmount:100}]){const s=C.applyImport(stateWith(row()),C.normalizeRows([row(extra)]),'new.xlsx','2026-10-16T15:02:00Z');assert.equal(C.inspectTicket(s,'ABCDEFG1').code,'blocked');assert.throws(()=>C.admit(s,'ABCDEFG1','First','2026-10-16T15:03:00Z'));}
});
test('CSV quotes fields and neutralizes spreadsheet formula injection',()=>{
 const a=C.admit(stateWith(row({Customer:'=2+2,"Student"'})),'ABCDEFG1','@operator','2026-10-16T15:01:00Z');const csv=C.csv(a.state);assert.ok(csv.includes("'=2+2"));assert.ok(csv.includes("'@operator"));assert.ok(csv.includes('""Student""'));assert.ok(csv.includes('device-test'));
});
test('serialized state validation rejects malformed or foreign state',()=>{
 assert.equal(C.validateState(JSON.parse(JSON.stringify(stateWith(row())))).eventId,'O9KL3');assert.throws(()=>C.validateState({}));assert.throws(()=>C.validateState({...C.newState('x'),eventId:'other'}));
});
