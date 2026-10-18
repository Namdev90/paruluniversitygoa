import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const reports=fs.readFileSync(new URL('../teacher-reports-v077.sql',import.meta.url),'utf8');
const schema=fs.readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
test('expired faculty accounts cannot be silently reactivated by a reporting grant',()=>{
 const branch=reports.split("if p_action='grant' then")[1].split("if not permitted")[0];
 assert.ok(branch.indexOf('c.access_expires_at<=now()')<branch.indexOf('set active=true'));
 assert.match(branch,/Renew it before granting reports/);
});
test('registered attendance is disjoint from organizer confirmations and includes retained roster evidence',()=>{
 const expression=reports.match(/'registeredAttended',([^\n]+)/)[1];
 assert.match(expression,/is distinct from 'organizer_confirmed'/);
 assert.match(expression,/known\.id=a\.ticket_id/);
 assert.doesNotMatch(expression,/known\.active/);
 assert.match(reports,/from navrang_private\.tickets t full outer join/);
 assert.match(reports,/where coalesce\(t\.active,false\) or a\.ticket_id is not null/);
});
test('recent throughput never counts correction creation as scanner admission time',()=>{
 for(const key of ['lastMinute','lastFiveMinutes']){
  const expression=schema.slice(schema.indexOf("'"+key+"'"));
  assert.match(expression.slice(0,250),/receipt#>>'\{entry,admissionBasis\}'\) is distinct from 'organizer_confirmed'/);
 }
});
