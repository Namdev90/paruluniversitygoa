import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('fresh-install schema includes the exact separately deployable report migration',()=>{
 const schema=read('schema.sql'),reports=read('teacher-reports-v077.sql');
 const marker='-- BEGIN GENERATED TEACHER REPORTS (teacher-reports-v077.sql)\n';
 assert.ok(schema.includes(marker),'fresh install needs the reporting RPC as well as the gate RPC');
 assert.equal(schema.split(marker)[1].split('-- END GENERATED TEACHER REPORTS')[0].trim(),reports.trim());
});
test('historical correction refuses newly matched registrations before creating any receipt',()=>{
 const sql=read('reconcile-missing-registration-v077.sql');
 assert.match(sql,/Canonical registration now exists for a missing-data candidate/);
 assert.ok(sql.indexOf('Canonical registration now exists for a missing-data candidate')<sql.indexOf('for scan_row in'));
});
