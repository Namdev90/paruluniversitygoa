// Use an existing, operator-provisioned database identity. This adapter neither
// creates roles nor changes privileges, and never exposes the private schema.
function createNotificationStoreWithStatements(pool, statements) {
  if (typeof pool?.connect !== 'function') throw TypeError('PostgreSQL pool required');
  async function query(text, values, {signal} = {}) {
    signal?.throwIfAborted();
    const client = await pool.connect();
    let destroyed = false;
    const abort = () => { if (!destroyed) { destroyed = true; client.release(true); } };
    try {
      signal?.addEventListener('abort', abort, {once:true});
      signal?.throwIfAborted();
      const result = await client.query({text, values, query_timeout:8000});
      signal?.throwIfAborted();
      return result.rows[0]?.result;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (!destroyed) client.release();
    }
  }
  return Object.freeze({
    claim:(limit, options) => query(statements.claim,[limit],options),
    check:(id, lease, options) => query(statements.check,[id,lease],options),
    finish:(id, lease, outcome, options) => query(statements.finish,[id,lease,outcome],options),
  });
}

// Fixed SQL only. Callers cannot select schema/function names or request a
// private-schema fallback when the narrow boundary is missing.
export function createNotificationStore(pool) {
 return createNotificationStoreWithStatements(pool, {
  claim:'select navrang_private.claim_notification_deliveries($1::integer) as result',
  check:'select navrang_private.check_notification_delivery($1::bigint,$2::uuid) as result',
  finish:'select navrang_private.finish_notification_delivery($1::bigint,$2::uuid,$3::text) as result',
 });
}
export function createCloudflareNotificationStore(pool) {
 return createNotificationStoreWithStatements(pool, {
  claim:'select navrang_notification_bridge.claim($1::integer) as result',
  check:'select navrang_notification_bridge.check_delivery($1::bigint,$2::uuid) as result',
  finish:'select navrang_notification_bridge.finish($1::bigint,$2::uuid,$3::text) as result',
 });
}

// Explicit Google Compute workload identity only; never fall back to a private
// key file or reuse an app session. Metadata hostname/path cannot be supplied by users.
export function createMetadataTokenProvider({fetchImpl=fetch,clock=Date.now} = {}) {
  let cached, expires = 0;
  return async ({signal} = {}) => {
    signal?.throwIfAborted();
    if (cached && clock() < expires-60000) return cached;
    const response = await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {
      headers:{'Metadata-Flavor':'Google'}, redirect:'error',
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
    });
    if (!response.ok || response.headers.get('Metadata-Flavor') !== 'Google') throw Error('Workload identity unavailable');
    const value = await response.json();
    if (value.token_type !== 'Bearer' || typeof value.access_token !== 'string' || !value.access_token ||
        !Number.isFinite(value.expires_in) || value.expires_in < 60 || value.expires_in > 86400) throw Error('Invalid workload identity response');
    cached=value.access_token; expires=clock()+value.expires_in*1000; return cached;
  };
}

export async function runNotificationLoop({worker,signal,intervalMs=15000,onResult=()=>{},wait}={}) {
  if (!worker?.dispatchBatch || !signal || !Number.isSafeInteger(intervalMs) || intervalMs<15000) throw TypeError('Bounded worker and shutdown signal required');
  const pause = wait || (ms => new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve()};
    const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
    if(signal.aborted)finish();
  }));
  while (!signal.aborted) {
    // Sequential batches; durable SQL leases also prevent competing workers
    // from claiming the same job. Provider acceptance does not mean receipt.
    let result;
    try { result=await worker.dispatchBatch({limit:20}); }
    catch { result={state:'UNAVAILABLE'}; }
    onResult(result);
    if (!signal.aborted) await pause(intervalMs);
  }
}
