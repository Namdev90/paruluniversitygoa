// Composition for the existing authenticated handler and persistent controller.
// The deployment supplies an already-authorized pool; no new server/listener,
// role switch, grant, credential discovery or provider request runs at import.
import { createDailyVoiceStore, createVoiceControllerStore } from './voice-store.mjs';
import { createDailyLeaseCandidate } from '../voice/daily-relay.mjs';
import { createDailyVoiceService } from '../voice/daily-service.mjs';
import { createVoiceController } from '../voice/controller.mjs';
import { pathToFileURL } from 'node:url';

export function createDailyVoiceRuntime({ pool, relay, url, apiKey, fetchImpl, clock = Date.now, controllerId } = {}) {
 const transport = relay ?? createDailyLeaseCandidate({ url, apiKey, fetchImpl, clock });
 const store = createDailyVoiceStore(pool);
 const service = createDailyVoiceService({ rpc: store.rpc, relay: transport, clock });
 const controller = createVoiceController({ store: createVoiceControllerStore(pool), relay: transport, controllerId });
 return Object.freeze({ service, controller, readiness: () => transport.readiness(), transportEvidence: 'NOT_RUN' });
}

// Opt-in executable cleanup only. Imports never read environment credentials,
// load a database driver, open a connection, or start a reconciliation loop.
// The deployment must already own the database identity and provider account.
export async function runDailyVoiceController({ env = process.env, signal,
 report = record => process.stdout.write(JSON.stringify(record) + '\n'),
 createPool = async options => { const { Pool } = await import('pg'); return new Pool(options); },
 createRelay = createDailyLeaseCandidate, createController = createVoiceController,
 startupTimeoutMs = 1500, shutdownTimeoutMs = 1500 } = {}) {
 if (env.NAVRANG_DAILY_VOICE_CONTROLLER !== 'enabled' || !env.NAVRANG_WORKER_DATABASE_URL ||
     !signal || typeof signal.addEventListener !== 'function' || typeof report !== 'function' ||
     !Number.isInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 2000 ||
     !Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1 || shutdownTimeoutMs > 2000) {
  throw Error('Private Daily controller configuration required.');
 }
 // Validate the owned origin and credential before allocating a pool.
 const relay = createRelay({ url: env.DAILY_URL, apiKey: env.DAILY_API_KEY });
 if (signal.aborted) return;
 async function closePool(pool) {
  let timer;
  try {
   await Promise.race([Promise.resolve().then(() => pool.end()), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Daily controller shutdown unavailable.')), shutdownTimeoutMs);
   })]);
  } finally { clearTimeout(timer); }
 }
 let pool, startupTimer, abandoned = false, abortStartup;
 try {
  const pending = Promise.resolve().then(() => {
   if (signal.aborted) throw Error('Daily controller stopped.');
   return createPool({ connectionString: env.NAVRANG_WORKER_DATABASE_URL, max: 1,
    connectionTimeoutMillis: 1000, idleTimeoutMillis: 30000, statement_timeout: 1000, query_timeout: 1200,
    application_name: 'navrang-daily-voice-controller' });
  }).then(value => {
   // A driver loaded after cancellation must never start a delayed controller.
   if (abandoned || signal.aborted) {
    void closePool(value).catch(() => {});
    throw Error('Daily controller stopped.');
   }
   return value;
  });
  pool = await Promise.race([pending, new Promise((_, reject) => {
   abortStartup = () => reject(Error('Daily controller startup unavailable.'));
   signal.addEventListener('abort', abortStartup, { once: true });
   startupTimer = setTimeout(abortStartup, startupTimeoutMs);
   if (signal.aborted) abortStartup();
  })]);
 } catch {
  abandoned = true;
  throw Error('Daily controller startup unavailable.');
 } finally { clearTimeout(startupTimer); signal.removeEventListener('abort', abortStartup); }
 let previous;
 const emit = record => {
  // Accept only controller status/counts; never serialize an error or provider
  // response, even if an injected adapter supplies additional properties.
  if (!['CLEANUP_ONLY', 'STANDBY', 'PARTIAL', 'DEGRADED', 'BUSY', 'STOPPED', 'DATABASE_UNAVAILABLE'].includes(record?.state) ||
      !Number.isInteger(record.acked) || record.acked < 0 || record.acked > 32) return;
  if (record.state !== previous || record.acked > 0) {
   try { report({ state: record.state, acked: record.acked }); } catch {}
   previous = record.state;
  }
 };
 const databaseError = () => emit({ state: 'DATABASE_UNAVAILABLE', acked: 0 });
 try {
  pool.on('error', databaseError);
  const controller = createController({ store: createVoiceControllerStore(pool), relay });
  if (!signal.aborted) await controller.run({ signal, onCycle: emit });
 } finally {
  try {
   // A hung shutdown must not hold the supervisor indefinitely.
   await closePool(pool);
  } finally { pool.removeListener?.('error', databaseError); }
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 const shutdown = new AbortController();
 const stop = () => shutdown.abort();
 process.once('SIGINT', stop); process.once('SIGTERM', stop);
 try { await runDailyVoiceController({ signal: shutdown.signal }); }
 catch {
  process.stderr.write('Daily voice controller cannot start or continue. Check private configuration and existing database access.\n');
  process.exitCode = 78;
 } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
