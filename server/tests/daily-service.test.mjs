import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyVoiceService, strictDailyDeletion } from '../voice/daily-service.mjs';
import { createDailyLeaseCandidate } from '../voice/daily-relay.mjs';

// Every acceptance receipt below is a synthetic local fixture. No network,
// provider credential, deployment setting or production gate is involved.
const at = 1700000000123;
const ids = Array.from({ length: 8 }, (_, i) => `${i + 1}`.repeat(8) + '-1111-4111-8111-111111111111');
const [publisher, listener, leaseId, operationId, sessionId, dutyId, commandId] = ids;
const token = 'a'.repeat(64);
function fixture({ listenerMode = false } = {}) {
 let current = at;
 const events = [], operation = { operationId, sessionId, dutyId, state: 'granting', identity: publisher,
  generation: 7, leaseId, expiresAt: new Date(at + 15000).toISOString(), revoke: [] };
 const plan = { provider: 'daily', leaseId, publisherIdentity: publisher, generation: 7,
  roomId: 'nv_' + 'a'.repeat(32), roomUrl: 'https://fixture.daily.co/nv_' + 'a'.repeat(32), expiresAt: new Date(1700000015000).toISOString() };
 const credential = identity => ({ provider: 'daily', leaseId, generation: 7, roomId: plan.roomId, roomUrl: plan.roomUrl,
  identity, token: 'synthetic.native.only', expiresAt: plan.expiresAt });
 const deletion = old => ({ provider: 'daily', roomId: old.roomId, leaseId: old.leaseId, generation: old.generation,
  expiresAt: old.expiresAt, deleted: true, absenceObserved: true, mediaTerminationVerified: true });
 const relay = {
  readiness: () => ({ configured: true, leaseEnforced: true, workerDeathVerified: true, revocationVerified: true,
   revocationMode: 'guarded-admission', workerAt: current }),
  planLease: () => { events.push('plan'); return plan; },
  createLeaseRoom: async value => { events.push('create'); return { prepared: true, lease: value, mediaTerminationVerified: true }; },
  inspectLeaseRoom: async value => { events.push('inspect'); return { prepared: true, lease: value, mediaTerminationVerified: false }; },
  mintCredential: async (_, input) => { events.push(`mint:${input.role}`); return { credential: credential(input.identity) }; },
  deleteLeaseRoom: async old => { events.push('delete'); return deletion(old); }
 };
 const snapshot = () => ({ state: listenerMode ? 'listening' : 'speaking', sessionId, dutyId,
  identity: listenerMode ? listener : publisher, plan, serverTime: current, dutyExpiresAt: new Date(at + 60000).toISOString() });
 let rpc = async (action, payload, actor) => {
  assert.equal(actor, token);
  events.push(action);
  if (['floor-prepare', 'daily-renew-prepare', 'voice-broadcast-start'].includes(action)) return operation;
  if (action === 'daily-plan') return { ...operation, plan: payload.plan };
  if (action === 'daily-commit') return { state: 'active', sessionId, dutyId, leaseId, generation: 7, expiresAt: plan.expiresAt };
  if (action === 'daily-receive') return snapshot();
  if (action === 'daily-ack') return { state: 'acked' };
  if (action === 'voice-join') return { sessionId, identity: listener, canPublish: false };
  return { state: 'idle', dutyId, sessionId, serverTime: current, expiresAt: new Date(at + 60000).toISOString() };
 };
 return { events, operation, plan, relay, snapshot, deletion, credential, setTime: value => { current = value; },
  get rpc() { return rpc; }, set rpc(value) { rpc = value; },
  service(extra = {}) { return createDailyVoiceService({ rpc, relay, clock: () => current, ...extra }); } };
}

test('persisted immutable plan precedes provider creation; committed exact floor precedes publisher credential', async () => {
 const f = fixture(), result = await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token);
 assert.equal(result.state, 'active');
 assert.equal(result.transmit.token, 'synthetic.native.only');
 assert.equal(result.generation, 7);
 assert.equal(result.expiresAt, f.plan.expiresAt);
 assert.deepEqual(f.events, ['floor-prepare', 'plan', 'daily-plan', 'create', 'daily-commit', 'mint:publisher', 'daily-receive']);
});

test('preemption requires exact strict deletion receipt and its durable ACK before new room creation', async () => {
 const f = fixture();
 const previous = { ...f.plan, roomId: 'nv_' + 'b'.repeat(32), generation: 6 };
 f.operation.revoke = [{ commandId, generation: 8, plan: previous }];
 const result = await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token);
 assert.equal(result.state, 'active');
 assert(f.events.indexOf('delete') < f.events.indexOf('daily-ack'));
 assert(f.events.indexOf('daily-ack') < f.events.indexOf('daily-plan'));
 assert(f.events.indexOf('daily-plan') < f.events.indexOf('create'));
 for (const tampered of [{ mediaTerminationVerified: false }, { roomId: f.plan.roomId }, { generation: 7 }, { deleted: false }, { absenceObserved: false }]) {
  const other = fixture(); other.operation.revoke = f.operation.revoke;
  other.relay.deleteLeaseRoom = async () => ({ ...f.deletion(previous), ...tampered });
  assert.equal((await other.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token)).status, 503);
  assert(!other.events.includes('daily-ack'));
  assert(!other.events.includes('create'));
 }
});

test('unverified room creation never commits or returns a publisher token and is durably quarantined', async () => {
 const f = fixture();
 f.relay.createLeaseRoom = async lease => ({ prepared: true, lease, mediaTerminationVerified: false });
 const result = await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token);
 assert.equal(result.status, 503);
 assert(!f.events.includes('daily-commit'));
 assert(!f.events.includes('mint:publisher'));
 assert(f.events.includes('floor-fail'));
 assert(f.events.includes('voice-release'));
});

test('commit mismatches and expired responses cannot leak prepared publisher credentials', async () => {
 for (const change of ['generation', 'lease', 'expiry', 'late']) {
  const f = fixture(), previous = f.rpc;
  f.rpc = async (...args) => {
   const result = await previous(...args);
   if (args[0] === 'daily-commit') {
    if (change === 'generation') result.generation++;
    if (change === 'lease') result.leaseId = ids[7];
    if (change === 'expiry') result.expiresAt = new Date(at + 16000).toISOString();
    if (change === 'late') f.setTime(at + 16000);
   }
   return result;
  };
  assert.equal((await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token)).status, 503);
  assert(!f.events.includes('mint:publisher'));
 }
});

test('publisher authorization is checked again after mint; lost authority releases exact committed lease', async () => {
 const f = fixture(), previous = f.rpc, released = [];
 f.rpc = async (...args) => {
  if (args[0] === 'daily-receive') return { error: 'Revoked', status: 403 };
  if (args[0] === 'voice-release') released.push(args[1]);
  return previous(...args);
 };
 const result = await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token);
 assert.equal(result.status, 503);
 assert.equal('transmit' in result, false);
 assert.deepEqual(released, [{ sessionId, leaseId }]);
});

test('listener discovery returns an authorized native-only credential only after a second fresh matching read', async () => {
 const f = fixture({ listenerMode: true });
 const result = await f.service().handle('voice-join', { sessionId, dutyId }, token);
 assert.equal(result.state, 'listening');
 assert.equal(result.receive.identity, listener);
 assert.equal(result.leaseId, leaseId);
 assert.deepEqual(f.events, ['voice-join', 'daily-receive', 'inspect', 'mint:listener', 'daily-receive']);
 assert.equal('plan' in result, false);
});

test('listener removal, floor rotation or late token mint discards the entire credential response', async () => {
 for (const change of ['revoked', 'rotated', 'identity', 'expired']) {
  const f = fixture({ listenerMode: true }), previous = f.rpc;
  let reads = 0;
  f.rpc = async (...args) => {
   const result = await previous(...args);
   if (args[0] === 'daily-receive' && ++reads === 2) {
    if (change === 'revoked') return { error: 'Revoked', status: 403 };
    if (change === 'rotated') return { ...result, plan: { ...result.plan, generation: 8 } };
    if (change === 'identity') return { ...result, identity: ids[7] };
    if (change === 'expired') f.setTime(at + 16000);
   }
   return result;
  };
  const result = await f.service().handle('voice-join', { sessionId, dutyId }, token);
  assert.equal(result.status, 503);
  assert.equal('receive' in result, false);
 }
});

test('idle and own-speaker discoveries expose no receive credentials or second publisher', async () => {
 for (const state of ['idle', 'speaking']) {
  const f = fixture(), previous = f.rpc;
  f.rpc = async (...args) => args[0] === 'daily-receive' ? { ...f.snapshot(), state } : previous(...args);
  const result = await f.service().handle('voice-join', { sessionId, dutyId }, token);
  assert.equal(result.state, state);
  assert.equal(result.receive, null);
  assert(!f.events.some(value => value.startsWith('mint:')));
 }
});

test('renewal uses rotate-only private preparation and never the old in-place expiry extension', async () => {
 const f = fixture();
 const previous = f.rpc, requests = [];
 f.rpc = async (...args) => { if (args[0] === 'daily-renew-prepare') requests.push(args[1]); return previous(...args); };
 const result = await f.service().handle('voice-renew', { sessionId, leaseId: ids[7] }, token);
 assert.equal(result.state, 'active');
 assert.equal(f.events[0], 'daily-renew-prepare');
 assert.equal(f.events.includes('voice-renew'), false);
 assert.equal(result.leaseId, leaseId);
 await f.service().handle('voice-renew', { sessionId, leaseId: ids[7] }, token);
 assert.deepEqual(requests, Array(2).fill({ sessionId, leaseId: ids[7], requestId: ids[7] }));
});

test('retry of an already committed request restores only the original immutable room, with no POST creation', async () => {
 const f = fixture(); f.operation.state = 'active'; f.operation.plan = f.plan;
 const result = await f.service().handle('voice-floor', { sessionId, requestId: ids[7] }, token);
 assert.equal(result.state, 'active');
 assert.deepEqual(f.events, ['floor-prepare', 'inspect', 'mint:publisher', 'daily-receive']);
});

test('real candidate and fresh nominal worker cannot enter any provider operation through this service', async () => {
 let calls = 0;
 const relay = createDailyLeaseCandidate({ url: 'https://fixture.daily.co', apiKey: 'synthetic-test-key-no-real-account',
  fetchImpl: async () => { calls++; throw Error('Unexpected provider request'); }, clock: () => at });
 const service = createDailyVoiceService({ rpc: async () => { calls++; throw Error('Unexpected database request'); }, relay, clock: () => at });
 assert.equal((await service.handle('voice-floor', { sessionId, requestId: ids[7] }, token)).status, 503);
 assert.equal(calls, 0);
 const f = fixture();
 f.relay.readiness = () => ({ configured: true, workerAt: at, revocationVerified: true, revocationMode: 'guarded-admission' });
 assert.equal((await f.service().handle('duty-join', { installationId: 'fixture' }, token)).status, 503);
 assert.equal(f.events.length, 0);
});

test('cleanup remains available when relay is disabled, while unknown/private actions and absent actor fail before calls', async () => {
 const f = fixture(); f.relay.readiness = () => ({});
 const service = f.service();
 for (const action of ['duty-leave', 'voice-release', 'voice-broadcast-end']) {
  assert.equal((await service.handle(action, { sessionId, dutyId, leaseId }, token)).state, 'idle');
 }
 const count = f.events.length;
 assert.equal((await service.handle('daily-plan', {}, token)).status, 400);
 assert.equal((await service.handle('voice-floor', {}, '')).status, 401);
 assert.equal(f.events.length, count);
});

test('aborted or hung private operations are bounded and their exception details are redacted', async () => {
 const f = fixture(); f.rpc = async () => new Promise(() => {});
 const service = f.service({ timeoutMs: 10, budgetMs: 20 });
 assert.equal((await service.handle('voice-floor', { sessionId, requestId: ids[7] }, token)).status, 503);
 const signal = new AbortController(); signal.abort(Error('synthetic-secret'));
 const result = await service.handle('voice-floor', {}, token, { signal: signal.signal });
 assert.equal(result.status, 503);
 assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});

test('deletion evidence binds the exact immutable room and lease independently of its control command generation', () => {
 const f = fixture();
 assert.equal(strictDailyDeletion(f.deletion(f.plan), f.plan), true);
 assert.equal(strictDailyDeletion({ ...f.deletion(f.plan), generation: 8 }, f.plan), false);
 assert.equal(strictDailyDeletion({ ...f.deletion(f.plan), mediaTerminationVerified: false }, f.plan), false);
 assert.equal(strictDailyDeletion({ provider: 'daily', deleted: true, absenceObserved: true, mediaTerminationVerified: true }, {}), false);
});
