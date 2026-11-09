import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDailyVoiceController } from '../workers/daily-voice.mjs';
import { createDailyLeaseCandidate } from '../voice/daily-relay.mjs';

const env = { NAVRANG_DAILY_VOICE_CONTROLLER: 'enabled', NAVRANG_WORKER_DATABASE_URL: 'postgres://synthetic.invalid/test',
 DAILY_URL: 'https://fixture.daily.co', DAILY_API_KEY: 'synthetic-never-real-key' };
function fixture(overrides = {}) {
 const calls = [], records = [], signal = new AbortController().signal;
 const pool = { connect() { throw Error('No real connection expected'); },
  on: (...args) => calls.push(['on', ...args]), removeListener: (...args) => calls.push(['off', ...args]),
  end: async () => calls.push(['end']) };
 return { calls, records, pool, options: { env, signal, report: value => records.push(value),
  createPool: async options => { calls.push(['pool', options]); return pool; },
  createController: options => { calls.push(['controller', options]); return { run: async () => {} }; }, ...overrides } };
}

test('Daily executable is opt-in and safe to run with no configuration or installed pg driver', () => {
 const result = spawnSync(process.execPath, [fileURLToPath(new URL('../workers/daily-voice.mjs', import.meta.url))], {
  env: {}, encoding: 'utf8', timeout: 2000
 });
 assert.equal(result.status, 78); assert.equal(result.stdout, '');
 assert.equal(result.stderr, 'Daily voice controller cannot start or continue. Check private configuration and existing database access.\n');
 assert.equal(result.stderr.includes('ERR_MODULE_NOT_FOUND'), false);
});

test('missing opt-in, credential, owned origin or shutdown signal fails before pool/driver creation', async () => {
 for (const change of [{ NAVRANG_DAILY_VOICE_CONTROLLER: '' }, { NAVRANG_WORKER_DATABASE_URL: '' },
  { DAILY_URL: 'https://attacker.invalid' }, { DAILY_API_KEY: '' }]) {
  const f = fixture({ env: { ...env, ...change } });
  await assert.rejects(runDailyVoiceController(f.options)); assert.equal(f.calls.length, 0);
 }
 const f = fixture({ signal: undefined });
 await assert.rejects(runDailyVoiceController(f.options)); assert.equal(f.calls.length, 0);
 const aborted = fixture({ signal: AbortSignal.abort() });
 await runDailyVoiceController(aborted.options); assert.equal(aborted.calls.length, 0);
});

test('worker binds bounded private pool and real disabled candidate, never fabricates media acceptance', async () => {
 const f = fixture(); await runDailyVoiceController(f.options);
 const options = f.calls.find(row => row[0] === 'pool')[1];
 assert.equal(options.connectionString, env.NAVRANG_WORKER_DATABASE_URL);
 assert.equal(options.max, 1); assert.equal(options.connectionTimeoutMillis, 1000);
 assert.equal(options.statement_timeout, 1000); assert.equal(options.query_timeout, 1200);
 const { store, relay } = f.calls.find(row => row[0] === 'controller')[1];
 assert.equal(typeof store.ackDaily, 'function');
 assert.equal(relay.readiness().leaseEnforced, false);
 assert.equal(relay.readiness().workerDeathVerified, false);
 assert.equal(relay.readiness().revocationVerified, false);
 assert.equal((await relay.grant()).status, 503);
 assert.equal((await relay.renew()).status, 503);
 assert.equal((await relay.revoke()).status, 503);
 assert.equal(f.calls.filter(row => row[0] === 'end').length, 1);
});

test('worker emits only fixed redacted statuses/counts and closes pool after a failure', async () => {
 const f = fixture();
 f.options.createController = () => ({ run: async ({ onCycle }) => {
  const error = f.calls.find(row => row[0] === 'on')[2];
  error(Error('synthetic-database-secret'));
  for (const record of [{ state: 'STANDBY', acked: 0, token: 'synthetic-provider-secret' },
   { state: 'STANDBY', acked: 0 }, { state: 'CLEANUP_ONLY', acked: 1 },
   { state: 'ACTIVE', acked: 0 }, { state: 'DEGRADED', acked: 33 }, { state: 'synthetic-secret', acked: 0 }]) onCycle(record);
  throw Error('synthetic-private-driver-failure');
 } });
 await assert.rejects(runDailyVoiceController(f.options));
 assert.deepEqual(f.records, [{ state: 'DATABASE_UNAVAILABLE', acked: 0 }, { state: 'STANDBY', acked: 0 }, { state: 'CLEANUP_ONLY', acked: 1 }]);
 assert.equal(f.calls.filter(row => row[0] === 'end').length, 1);
 assert.equal(f.calls.filter(row => row[0] === 'off').length, 1);
});

test('hung shutdown is bounded and a reporting failure cannot interrupt cleanup', async () => {
 const f = fixture({ shutdownTimeoutMs: 10, report: () => { throw Error('synthetic-report-error'); } });
 f.pool.end = () => new Promise(() => {});
 f.options.createController = () => ({ run: async ({ onCycle }) => onCycle({ state: 'CLEANUP_ONLY', acked: 0 }) });
 await assert.rejects(runDailyVoiceController(f.options), /shutdown unavailable/);
 assert.equal(f.calls.filter(row => row[0] === 'off').length, 1);
});

test('hung startup and cancellation are bounded; late pool is closed without delayed controller work', async () => {
 const aborter = new AbortController(); let resolvePool;
 const f = fixture({ signal: aborter.signal, startupTimeoutMs: 10,
  createPool: () => new Promise(resolve => { resolvePool = resolve; }) });
 const pending = runDailyVoiceController(f.options);
 await new Promise(resolve => setImmediate(resolve));
 aborter.abort();
 await assert.rejects(pending, /startup unavailable/);
 resolvePool(f.pool);
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(f.calls.some(row => row[0] === 'controller'), false);
 assert.equal(f.calls.filter(row => row[0] === 'end').length, 1);
 const hung = fixture({ startupTimeoutMs: 10, createPool: () => new Promise(() => {}) });
 await assert.rejects(runDailyVoiceController(hung.options), /startup unavailable/);
 assert.equal(hung.calls.length, 0);
});

test('real worker/controller/candidate never ACKs a synthetic DELETE200/GET404 as media termination', async () => {
 const aborter = new AbortController(), actions = [], requests = [], records = [];
 const id = '12345678-1234-4234-9234-123456789abc';
 const plan = { provider: 'daily', leaseId: id, publisherIdentity: id, generation: 3,
  roomId: 'nv_' + 'b'.repeat(32), roomUrl: 'https://fixture.daily.co/nv_' + 'b'.repeat(32), expiresAt: '2026-10-25T12:00:00.000Z' };
 const pool = { on() {}, removeListener() {}, end: async () => actions.push('pool-end'),
  connect: async () => ({ release() {}, query: async ({ values: [action] }) => {
   actions.push(action);
   const result = action === 'controller-claim' ? { claimed: true } : action === 'controller-poll' ?
    { commands: [{ operation: 'revoke', commandId: id, operationId: id, room: id, identity: id, generation: 4, plan }] } : { released: true };
   return { rows: [{ result }] };
  } }) };
 await runDailyVoiceController({ env, signal: aborter.signal, createPool: async () => pool,
  createRelay: options => createDailyLeaseCandidate({ ...options, fetchImpl: async (_, request) => {
   requests.push(request.method);
   return request.method === 'DELETE' ? Response.json({ deleted: true, name: plan.roomId }) : new Response(null, { status: 404 });
  } }), report: record => { records.push(record); aborter.abort(); } });
 assert.deepEqual(requests, ['DELETE', 'GET']);
 assert.deepEqual(records, [{ state: 'DEGRADED', acked: 0 }]);
 assert.deepEqual(actions, ['controller-claim', 'controller-poll', 'controller-release', 'pool-end']);
});
