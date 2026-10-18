import {test} from 'node:test';
import assert from 'node:assert/strict';
import E from '../../app/assets/report-export.js';

test('PDF summary includes the two distinct sources of attendance and preserves unknown timing',()=>{
 const bytes=E.pdf({registered:1124,eligible:1041,blocked:83,attended:793,registeredAttended:775,organizerConfirmed:18,noShow:266,serverIssues:32,issueTickets:18,duplicateAttempts:84,pendingHelpDesk:0,generatedAt:'2026-10-18T06:13:11Z'});
 const pdf=Buffer.from(bytes).toString('utf8');
 assert.ok(pdf.includes('Total admitted: 793'));
 assert.ok(pdf.includes('From registration master: 775'));
 assert.ok(pdf.includes('Organizer-confirmed admissions: 18'));
 assert.ok(pdf.includes('Admitted - registration data missing'));
 assert.ok(pdf.includes('Exact admission time is unknown for those corrections.'));
 assert.ok(pdf.includes('No verified entry does NOT prove non-attendance.'));
 assert.ok(!pdf.includes('Attendance numbers use server-confirmed admission receipts.'));
});
