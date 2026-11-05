/** Durable one-shot public release claims. Uncertain sends are never retried automatically. */
export class ReleaseLedger {
 constructor(sql){
  if(!sql||typeof sql.exec!=='function')throw TypeError('SQLite ledger required');this.sql=sql;
  sql.exec('CREATE TABLE IF NOT EXISTS release_claims (version INTEGER PRIMARY KEY, digest TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN (\'claimed\',\'accepted\',\'unknown\')))');
 }
 async reserve(release,{signal}={}){
  signal?.throwIfAborted();if(!release||!Number.isSafeInteger(release.versionCode)||release.versionCode<1||release.versionCode>2147483647||!/^[a-f0-9]{64}$/.test(release.sha256??''))return 'unavailable';
  // One SQLite statement is the atomic ownership boundary; no exception is interpreted as absence.
  const inserted=this.sql.exec('INSERT INTO release_claims(version,digest,state) VALUES(?,?,\'claimed\') ON CONFLICT(version) DO NOTHING RETURNING version',release.versionCode,release.sha256).toArray();
  signal?.throwIfAborted();if(inserted.length===1)return 'claimed';
  const prior=this.sql.exec('SELECT digest,state FROM release_claims WHERE version=?',release.versionCode).toArray();signal?.throwIfAborted();
  return prior.length===1&&prior[0].digest===release.sha256?'duplicate':'unavailable';
 }
 async finish(release,outcome,{signal}={}){
  signal?.throwIfAborted();if(!['accepted','unknown'].includes(outcome))throw Error('Invalid receipt');
  const changed=this.sql.exec('UPDATE release_claims SET state=? WHERE version=? AND digest=? AND state=\'claimed\' RETURNING version',outcome,release.versionCode,release.sha256).toArray();
  signal?.throwIfAborted();if(changed.length!==1)throw Error('Release receipt unavailable');
 }
}
