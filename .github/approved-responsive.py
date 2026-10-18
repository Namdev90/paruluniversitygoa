#!/usr/bin/env python3
"""One-time reviewed source integration; no credentials, network or live data writes.
Fail before writing if the baseline differs. The workflow removes this helper
after verifying/committing the ordinary source changes.
"""
from pathlib import Path
import hashlib, subprocess
ROOT=Path(__file__).resolve().parents[1]
changes={'app/assets/report-export.js': {'before': 'a6f2b1127d976b47da1994912cf488a0667a445b62f86eaea51e8079c3c0eed6',
 'after': 'a7f149584265c7014d1a328f3c0f53db60f4ffb7ea583a080e55d54b4e95e58f',
 'edits': [(5141,5142,'T'),(5143,5150,'tal'),(5152,5152,'dmi'),(5155,5156,''),(5157,5160,''),(5176,5176,"ed],['From registration master',summary.registeredAttended],['Organizer-confirmed admissions',summary.organizerConfirm"),(5794,5794,'i'),(5795,5795,'cl'),(5796,5798,'des scann'),(5800,5800,' receipt'),(5802,5805,'and'),(5806,5807,'organiz'),(5809,5810," confirmations.',\n   'Admitted - registration data missing: organiz"),(5823,5823,"cases.',\n   'Exact "),(5833,5833,'time is unknown for those cor'),(5836,5837,'t'),(5838,5840,'on')]},
 'app/assets/reports.js': {'before':'85fc52b9a06d9398314e375e843d5061a112b36ec8088ecf98ea9deb5d87b458','after':'805526f4e0c43a613355240c2ed0c751ea22d25085daccc232b405eddf07bf62','edits':[(5040,5040,'{\n   try{'),(5067,5067,"}\n   catch(err){if(seq===generation&&who===identity()&&C.profile()?.role==='admin'){\n    $('report-manage').hidden=false;\n    $('report-teachers').replaceChildren(text('p','Teacher management unavailable. Attendance downloads remain ready. Use Refresh to retry.','micro-note'));\n   }}\n  }")]},
 'tools/PrepareBrands.java':{'before':'5b684a607728de56dfde40aab4525f34bd53afe0e5e582e72c7e72db7a6307d1','after':'0791482ba2b128e6c354fc9c4f9f3ae9c1f786574631af07fa0be13af474eb8b','edits':[(1014,1014,'\n  System.setProperty("java.awt.headless","true");')]},
 'tools/package-web.py':{'before':'d9048e2fee6bd84870f7037f7b1989b916d1b5d45529e895571e64ab91d0f5ce','after':'546ca06e04fbfeec4f2514f555603bd7c680b7d1f762f6b4d6465bcae4d4b585','edits':[(149,149,',subprocess,tempfile'),(376,376,"report-export.js','reports.js','"),(532,532,"# The browser favicon and downloadable official crop use the same verified\n# original artwork as Android, without packaging native resources or any key.\nwith tempfile.TemporaryDirectory(prefix='navrang-web-brand-') as temporary:\n subprocess.run(['java','-Djava.awt.headless=true',str(root/'tools/PrepareBrands.java'),str(root),temporary],check=True)\n for name in ['navrang-wordmark.png','app-icon.png']:\n  shutil.copy2(Path(temporary)/'app/assets/art'/name,dest/'art'/name)\n")]},
 'server/reconcile-missing-registration-v077.sql':{'before':'eca81cffef9b954099f5afebc952be4d35a5d646a17ebd32370259af653790f2','after':'c1b049b26a9d080c66b9b59b2e0c1173022fdd8b5c6fc50e64db121f7d1d704e','edits':[(1292,1292,";end if;\n -- A later organizer import needs a reviewed match, not an invented missing-data receipt.\n if exists(select 1 from navrang_private.attempts x join navrang_private.tickets t on t.id=x.ticket_id\n  where not x.test_fixture and x.response->>'code'='not_found'\n   and x.at >= '2026-10-16T18:30:00Z'::timestamptz and x.at < '2026-10-17T18:30:00Z'::timestamptz\n   and not exists(select 1 from navrang_private.admissions a where a.event_id='O9KL3' and a.ticket_id=x.ticket_id))\n then raise exception 'Canonical registration now exists for a missing-data candidate. Review the match before reconciliation.'")]},
 'app/assets/index.html':{'before':'d5a9f5a6ac9e9b0d69a513239882a1d4af4b411269993a5836ae4d37c7aedcfa','after':'8a24b9a04ae0fdd83ca404a1319a5c2a2b281be0cc1638e364b421603fb6434d','edits':[(627,627,'-shell.css"><link rel="stylesheet" href="art/responsive')]}}
schema=ROOT/'server/schema.sql'
assert hashlib.sha256(schema.read_bytes()).hexdigest()=='53bc2ea0187a71a65670869cac8df150cc7fa2259c42686f710e2487a78f4089','Schema baseline moved; reconcile before applying.'
staged={}
for name,spec in changes.items():
 p=ROOT/name;old=p.read_text()
 assert hashlib.sha256(old.encode()).hexdigest()==spec['before'],name+' baseline moved; do not overwrite.'
 new=old
 for start,end,value in reversed(spec['edits']):new=new[:start]+value+new[end:]
 assert hashlib.sha256(new.encode()).hexdigest()==spec['after'],name+' failed exact output verification.'
 staged[p]=new
marker='-- BEGIN GENERATED TEACHER REPORTS (teacher-reports-v077.sql)\n'
staged[schema]=schema.read_text()+'\n'+marker+(ROOT/'server/teacher-reports-v077.sql').read_text()+'-- END GENERATED TEACHER REPORTS\n'
for p,content in staged.items():p.write_text(content)
old_readme=subprocess.check_output(['git','show','3fb78ea46451a25033cddcdc4fd625dd89e41492:README.md'],cwd=ROOT,text=True)
old_readme=old_readme.replace('(docs/','(').replace('(app/','(../app/')
(ROOT/'docs/OPERATIONS.md').write_text('# Operations reference\n\nPreserved from the pre-refresh README. Version-specific historical paragraphs remain; consult the root README and Changelog for shipped versus unreleased status.\n\n'+old_readme)
print('Applied seven reviewed source fixes; original signing/update channel files are untouched.')
