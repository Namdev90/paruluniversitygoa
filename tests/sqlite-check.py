"""Exercise the actual bundled SQLite schema with persistence and transaction failures."""
from pathlib import Path
import sqlite3,tempfile,json
schema=(Path(__file__).resolve().parents[1]/'app/assets/local-schema.sql').read_text()
with tempfile.TemporaryDirectory() as td:
 path=Path(td)/'gate.db'
 db=sqlite3.connect(path);db.executescript(schema);db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL')
 db.execute("INSERT INTO tickets VALUES(?,?)",('DEMO0001',json.dumps({'id':'DEMO0001','name':'Synthetic'})))
 db.execute("INSERT INTO legacy_entries VALUES(?,?)",('DEMO0001','{"checker":"Old Checker"}'))
 db.execute("INSERT INTO outbox VALUES(?,?,?,?,?)",('request-1','DEMO0001','checker-A','{"requestId":"request-1"}','2026-10-16'))
 db.commit();db.close()
 db=sqlite3.connect(path)
 assert db.execute('SELECT body FROM outbox').fetchone()[0]=='{"requestId":"request-1"}'
 try:
  with db:db.execute("INSERT INTO outbox VALUES(?,?,?,?,?)",('request-2','DEMO0001','checker-A','{}','2026-10-16'))
  raise AssertionError('Duplicate pending ticket was allowed for the same checker')
 except sqlite3.IntegrityError:pass
 db.execute("CREATE TEMP TRIGGER simulated_failure BEFORE INSERT ON tickets WHEN NEW.id='DEMOFAIL' BEGIN SELECT RAISE(ABORT,'disk write failed'); END")
 try:
  with db:
   db.execute('DELETE FROM tickets')
   db.execute("INSERT INTO tickets VALUES('DEMOFAIL','{}')")
  raise AssertionError('Failure injection was not triggered')
 except sqlite3.IntegrityError:pass
 assert db.execute('SELECT id FROM tickets').fetchall()==[('DEMO0001',)]
 assert db.execute('SELECT count(*) FROM outbox').fetchone()[0]==1
 assert db.execute('SELECT count(*) FROM legacy_entries').fetchone()[0]==1
 with db:db.execute('DELETE FROM tickets');db.execute("INSERT INTO tickets VALUES('DEMO0002','{}')")
 assert db.execute('SELECT count(*) FROM outbox').fetchone()[0]==1
 assert db.execute('SELECT count(*) FROM legacy_entries').fetchone()[0]==1
 db.close()
 print('PASS SQLite schema: reopened durable outbox, duplicate suppression, failed-import rollback and preserved legacy/pending data.')
