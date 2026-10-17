"""Exercise the live in-memory schema, rollback and duplicate-request protection."""
from pathlib import Path
import sqlite3,json
schema=(Path(__file__).resolve().parents[1]/'app/assets/local-schema.sql').read_text()
db=sqlite3.connect(':memory:');db.executescript(schema)
db.execute("INSERT INTO tickets VALUES(?,?)",('DEMO0001',json.dumps({'id':'DEMO0001','name':'Synthetic'})))
db.execute("INSERT INTO outbox VALUES(?,?,?,?,?)",('request-1','DEMO0001','checker-A','{"requestId":"request-1"}','2026-10-16'));db.commit()
try:
 with db:db.execute("INSERT INTO outbox VALUES(?,?,?,?,?)",('request-2','DEMO0001','checker-A','{}','2026-10-16'))
 raise AssertionError('Duplicate request was accepted')
except sqlite3.IntegrityError:pass
db.execute("CREATE TEMP TRIGGER simulated_failure BEFORE INSERT ON tickets WHEN NEW.id='DEMOFAIL' BEGIN SELECT RAISE(ABORT,'memory transaction failed'); END")
try:
 with db:
  db.execute('DELETE FROM tickets');db.execute("INSERT INTO tickets VALUES('DEMOFAIL','{}')")
 raise AssertionError('Failure injection did not run')
except sqlite3.IntegrityError:pass
assert db.execute('SELECT id FROM tickets').fetchall()==[('DEMO0001',)]
assert db.execute('SELECT count(*) FROM outbox').fetchone()[0]==1
assert db.execute('PRAGMA database_list').fetchone()[2]==''
db.close();db=sqlite3.connect(':memory:');db.executescript(schema)
assert db.execute('SELECT count(*) FROM tickets').fetchone()[0]==0
assert db.execute('SELECT count(*) FROM outbox').fetchone()[0]==0
db.close()
print('PASS: in-memory SQLite rollback, duplicate protection and no roster/outbox after reopening.')
