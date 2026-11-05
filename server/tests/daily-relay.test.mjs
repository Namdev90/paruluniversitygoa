import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyLeaseCandidate } from '../voice/daily-relay.mjs';
import { voiceReadiness } from '../functions/navrang-gate/voice-control.mjs';

const at = 1700000000123;
const publisher = '11111111-1111-4111-8111-111111111111';
const listener = '22222222-2222-4222-8222-222222222222';
const leaseId = '33333333-3333-4333-8333-333333333333';
const token = 'c3ludGhldGlj.cGF5bG9hZA.c2lnbmF0dXJl';
const key = 'synthetic-test-server-key-not-a-real-secret';
const options = { url: 'https://synthetic-test.daily.co', apiKey: key, clock: () => at };
const lease = { leaseId, publisherIdentity: publisher, generation: 7, expiresAt: new Date(at + 15000).toISOString() };
function fixture(override = {}) {
 const calls = [];
 const fetchImpl = async (url, init) => {
  calls.push({ url, ...init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
  if (url.endsWith('/rooms') && init.method === 'POST') {
   const body = JSON.parse(init.body);
   return Response.json({ name: body.name, url: `${options.url}/${body.name}`, privacy: body.privacy, config: body.properties });
  }
  if (url.endsWith('/meeting-tokens')) return Response.json({ token });
  if (init.method === 'DELETE') return Response.json({ deleted: true, name: url.split('/').at(-1) });
  return new Response('', { status: 404 });
 };
 return { calls, relay: createDailyLeaseCandidate({ ...options, fetchImpl, ...override }), fetchImpl };
}
async function prepared(f = fixture()) {
 const plan = f.relay.planLease(lease);
 assert.equal((await f.relay.createLeaseRoom(plan)).prepared, true);
 return { ...f, plan };
}

test('immutable plans are fresh unique per attempt, rounded down and never silently extended', () => {
 const { relay, calls } = fixture();
 const first = relay.planLease(lease), second = relay.planLease(lease);
 assert(Object.isFrozen(first));
 assert.notEqual(first.roomId, second.roomId);
 assert.match(first.roomId, /^nv_[a-f0-9]{32}$/);
 assert.equal(Date.parse(first.expiresAt), 1700000015000);
 assert(Date.parse(first.expiresAt) < Date.parse(lease.expiresAt));
 assert.equal(calls.length, 0, 'planning must be persistable before network starts');
 for (const input of [ { expiresAt: new Date(at + 15001).toISOString() }, { expiresAt: new Date(at).toISOString() },
  { expiresAt: new Date(at + 1).toISOString() }, { generation: 0 }, { generation: 1.5 }, { publisherIdentity: 'email@example.test' },
  { leaseId: '../arbitrary' }, { expiresAt: null } ]) assert.throws(() => relay.planLease({ ...lease, ...input }));
});

test('private SFU room defaults deny publishing and expire independently without client/controller cooperation', async () => {
 const { calls, plan } = await prepared();
 const call = calls[0];
 assert.equal(call.url, 'https://api.daily.co/v1/rooms');
 assert.equal(call.method, 'POST');
 assert.equal(call.redirect, 'error');
 assert.equal(call.cache, 'no-store');
 assert.equal(call.headers.Authorization, `Bearer ${key}`);
 assert.deepEqual(call.body, { name: plan.roomId, privacy: 'private', properties: { exp: 1700000015,
  eject_at_room_exp: true, enable_knocking: false, sfu_switchover: 0.5, enforce_unique_user_ids: true,
  start_audio_off: true, start_video_off: true, enable_screenshare: false,
  permissions: { canSend: false, canReceive: { base: false }, canAdmin: false, hasPresence: true } } });
});

test('only the bound publisher identity gets audio; listeners have no microphone/admin/camera/screen rights', async () => {
 const { relay, plan, calls } = await prepared();
 for (const role of ['publisher', 'listener']) {
  const identity = role === 'publisher' ? publisher : listener;
  const result = await relay.mintCredential(plan, { identity, role, is_owner: true, exp: 9999999999 });
  assert.deepEqual(result.credential, { provider: 'daily', leaseId, generation: 7, roomId: plan.roomId,
   roomUrl: plan.roomUrl, identity, token, expiresAt: plan.expiresAt });
  const properties = calls.at(-1).body.properties;
  assert.equal(properties.room_name, plan.roomId);
  assert.equal(properties.user_id, identity);
  assert.equal(properties.exp, 1700000015);
  assert.equal(properties.eject_at_token_exp, true);
  assert.equal(properties.is_owner, false);
  assert.equal(properties.start_audio_off, true);
  assert.equal(properties.start_video_off, true);
  assert.equal(properties.start_cloud_recording, false);
  assert.equal(properties.auto_start_transcription, false);
  assert.equal(properties.permissions.canAdmin, false);
  assert.equal(properties.permissions.hasPresence, true);
  assert.deepEqual(properties.permissions.canSend, role === 'publisher' ? ['audio'] : false);
  assert.deepEqual(properties.permissions.canReceive, role === 'publisher' ? { base: false } : { base: {
   audio: true, video: false, screenAudio: false, screenVideo: false, customAudio: { '*': false }, customVideo: { '*': false } } });
 }
 const count = calls.length;
 for (const input of [{ identity: listener, role: 'publisher' }, { identity: publisher, role: 'listener' },
  { identity: listener, role: 'owner' }, { identity: 'person@example.test', role: 'listener' }]) {
  assert.equal((await relay.mintCredential(plan, input)).credential, null);
 }
 assert.equal(calls.length, count);
});

test('room creation is one shot; persisted descriptors can only be cleaned up, never recreated', async () => {
 const { relay, plan, calls } = await prepared();
 assert.equal((await relay.createLeaseRoom(plan)).prepared, false);
 assert.equal((await relay.createLeaseRoom({ ...plan })).prepared, false);
 const afterRestart = fixture();
 assert.equal((await afterRestart.relay.createLeaseRoom(JSON.parse(JSON.stringify(plan)))).prepared, false);
 assert.equal(afterRestart.calls.length, 0);
 assert.equal((await relay.deleteLeaseRoom({ ...plan })).deleted, true);
 assert.equal((await relay.createLeaseRoom(plan)).prepared, false);
 assert.equal((await relay.mintCredential(plan, { identity: publisher, role: 'publisher' })).credential, null);
 assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('DELETE200 matching name plus GET404 is reported only as control-plane observation, never strict revocation', async () => {
 const { relay, plan, calls } = await prepared();
 const recoveredPlan = JSON.parse(JSON.stringify(plan));
 const restarted = fixture();
 assert.deepEqual(await restarted.relay.deleteLeaseRoom(recoveredPlan),
  { deleted: true, absenceObserved: true, mediaTerminationVerified: false });
 assert.deepEqual(restarted.calls.map(call => call.method), ['DELETE', 'GET']);
 assert(restarted.calls.every(call => call.url === `https://api.daily.co/v1/rooms/${plan.roomId}`));
 assert.equal(calls.length, 1);
 assert.equal((await relay.revoke(plan)).revoked, false);
});

test('DELETE404, wrong-name ACK, sent-only ACK, malformed body or continuing presence never clears quarantine', async () => {
 for (const response of [new Response('', { status: 404 }), Response.json({ deleted: true, name: 'other-room' }),
  Response.json({ status: 'sent' }), new Response('not json')]) {
  let requests = 0;
  const { relay } = fixture({ fetchImpl: async () => { requests++; return response; } });
  const result = await relay.deleteLeaseRoom(relay.planLease(lease));
  assert.deepEqual(result, { deleted: false, absenceObserved: false, code: 'DAILY_DELETION_UNCONFIRMED' });
  assert.equal(requests, 1, 'GET404 cannot compensate for unacknowledged DELETE');
 }
 const f = fixture();
 const relay = createDailyLeaseCandidate({ ...options, fetchImpl: async (url, request) =>
  request.method === 'GET' ? Response.json({ name: url.split('/').at(-1) }) : f.fetchImpl(url, request) });
 assert.equal((await relay.deleteLeaseRoom(relay.planLease(lease))).deleted, false);
});

test('untrusted origins, forged cleanup paths and credentials cannot redirect server API keys', async () => {
 for (const url of ['http://synthetic-test.daily.co', 'https://daily.example.test', 'https://synthetic-test.daily.co.evil.test',
  'https://user:password@synthetic-test.daily.co', 'https://synthetic-test.daily.co/path', 'https://synthetic-test.daily.co?token=x']) {
  assert.throws(() => createDailyLeaseCandidate({ ...options, url }), /Daily domain/);
 }
 assert.throws(() => createDailyLeaseCandidate({ ...options, apiKey: `${key}\nheader` }), /credential/);
 assert.throws(() => createDailyLeaseCandidate({ ...options, timeoutMs: 2001 }), /Bounded/);
 const { relay, calls } = fixture();
 const plan = relay.planLease(lease);
 for (const tampered of [{ roomId: '../rooms' }, { roomUrl: 'https://evil.test' }, { provider: 'livekit' }]) {
  assert.equal((await relay.deleteLeaseRoom({ ...plan, ...tampered })).code, 'INVALID_DAILY_ROOM');
 }
 assert.equal(calls.length, 0);
});

test('room configuration mismatch or missing expiry acceptance never produces credentials', async () => {
 for (const mutation of [room => { room.config.eject_at_room_exp = false; }, room => { room.privacy = 'public'; },
  room => { room.config.exp++; }, room => { room.config.permissions.canSend = true; },
  room => { room.url = 'https://unexpected.daily.co/room'; }, room => { delete room.config; }]) {
  const f = fixture();
  const relay = createDailyLeaseCandidate({ ...options, fetchImpl: async (...args) => {
   const response = await f.fetchImpl(...args), room = await response.json(); mutation(room); return Response.json(room);
  } });
  const plan = relay.planLease(lease);
  assert.equal((await relay.createLeaseRoom(plan)).prepared, false);
  assert.equal((await relay.mintCredential(plan, { identity: publisher, role: 'publisher' })).credential, null);
  assert.equal(f.calls.length, 1);
 }
});

test('late create/token responses cannot move the absolute expiry or return expired credentials', async () => {
 for (const lateOperation of ['create', 'token']) {
  let current = at;
  const f = fixture();
  const relay = createDailyLeaseCandidate({ ...options, clock: () => current, fetchImpl: async (...args) => {
   const response = await f.fetchImpl(...args);
   if ((lateOperation === 'create' && args[0].endsWith('/rooms')) || args[0].endsWith('/meeting-tokens')) current += 15000;
   return response;
  } });
  const plan = relay.planLease(lease), result = await relay.createLeaseRoom(plan);
  if (lateOperation === 'create') assert.equal(result.prepared, false);
  else {
   assert.equal(result.prepared, true);
   assert.equal((await relay.mintCredential(plan, { identity: publisher, role: 'publisher' })).credential, null);
  }
  assert.equal(plan.expiresAt, '2023-11-14T22:13:35.000Z');
 }
});

test('cleanup through a persisted descriptor fences a delayed create or token callback in this process', async () => {
 for (const delayedOperation of ['create', 'token']) {
  let resume, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const f = fixture();
  const relay = createDailyLeaseCandidate({ ...options, fetchImpl: async (url, request) => {
   if (request.method === 'POST' && url.endsWith(delayedOperation === 'create' ? '/rooms' : '/meeting-tokens')) {
    started(); await new Promise(resolve => { resume = resolve; });
   }
   return f.fetchImpl(url, request);
  } });
  const plan = relay.planLease(lease);
  let pending;
  if (delayedOperation === 'create') pending = relay.createLeaseRoom(plan);
  else { await relay.createLeaseRoom(plan); pending = relay.mintCredential(plan, { identity: publisher, role: 'publisher' }); }
  await waiting;
  assert.equal((await relay.deleteLeaseRoom({ ...plan })).deleted, true);
  resume();
  const result = await pending;
  assert.equal(delayedOperation === 'create' ? result.prepared : result.credential, delayedOperation === 'create' ? false : null);
 }
});

test('network/body timeouts cancel requests and failed attempts cannot be replayed under the same room name', async () => {
 for (const bodyHangs of [false, true]) {
  let signal, calls = 0;
  const { relay } = fixture({ timeoutMs: 20, fetchImpl: async (_, request) => {
   signal = request.signal; calls++;
   return bodyHangs ? { ok: true, status: 200, json: () => new Promise(() => {}) } : new Promise(() => {});
  } });
  const plan = relay.planLease(lease);
  assert.equal((await relay.createLeaseRoom(plan)).prepared, false);
  assert.equal(signal.aborted, true);
  assert.equal((await relay.createLeaseRoom(plan)).prepared, false);
  assert.equal(calls, 1);
 }
});

test('pre-aborted calls never reach provider, and exception text never leaks credentials', async () => {
 const { relay, calls } = fixture();
 const plan = relay.planLease(lease), controller = new AbortController(); controller.abort(Error(key));
 assert.equal((await relay.createLeaseRoom(plan, { signal: controller.signal })).prepared, false);
 assert.equal(calls.length, 0);
 const failing = fixture({ fetchImpl: async () => { throw Error(`secret ${key}`); } });
 const failure = await failing.relay.createLeaseRoom(failing.relay.planLease(lease));
 assert.deepEqual(failure, { prepared: false, code: 'DAILY_REQUEST_UNAVAILABLE' });
 assert.equal(JSON.stringify(failure).includes(key), false);
});

test('candidate configuration, control-plane success and caller-supplied acceptance booleans cannot enable voice', async () => {
 const { relay, calls } = fixture({ leaseEnforced: true, workerDeathVerified: true, revocationVerified: true });
 const state = relay.readiness(); state.leaseEnforced = true; state.workerDeathVerified = true;
 assert.equal(voiceReadiness(relay.readiness(), at).ready, false);
 for (const operation of ['grant', 'renew', 'revoke']) {
  assert.deepEqual(await relay[operation]({ accepted: true, mediaTerminationVerified: true }), {
   granted: false, renewed: false, revoked: false, status: 503, code: 'DAILY_ACCEPTANCE_NOT_VERIFIED' });
 }
 assert.equal(calls.length, 0);
 assert.equal(relay.transportEvidence, 'NOT_RUN');
});

test('restart inspection only reads exact existing room and never recreates a deleted or uncertain name', async () => {
 const original = await prepared();
 const saved = JSON.parse(JSON.stringify(original.plan));
 const reads = [];
 const restarted = createDailyLeaseCandidate({ ...options, fetchImpl: async (url, request) => {
  reads.push(request.method);
  if (request.method === 'DELETE') return Response.json({ deleted: true, name: saved.roomId });
  if (reads.includes('DELETE')) return new Response('', { status: 404 });
  return Response.json({ name: saved.roomId, url: saved.roomUrl, privacy: 'private', config: original.calls[0].body.properties });
 } });
 const inspected = await restarted.inspectLeaseRoom(saved);
 assert.equal(inspected.prepared, true);
 assert.equal(inspected.mediaTerminationVerified, false);
 assert.deepEqual(inspected.lease, saved);
 assert.equal((await restarted.createLeaseRoom(inspected.lease)).prepared, false);
 await restarted.deleteLeaseRoom({ ...saved });
 const count = reads.length;
 assert.equal((await restarted.inspectLeaseRoom({ ...saved })).prepared, false);
 assert.equal(reads.length, count);
 assert(reads.every(method => method !== 'POST'));
});

test('cached credentials and cached inspection still obey explicit caller cancellation', async () => {
 const { relay, plan, calls } = await prepared();
 const first = await relay.mintCredential(plan, { identity: listener, role: 'listener' });
 assert(first.credential);
 const count = calls.length;
 const cached = await relay.mintCredential(plan, { identity: listener, role: 'listener' });
 assert.equal(cached.credential, first.credential);
 assert.equal(calls.length, count);
 const stop = new AbortController(); stop.abort();
 assert.equal((await relay.mintCredential(plan, { identity: listener, role: 'listener' }, { signal: stop.signal })).credential, null);
 assert.equal((await relay.inspectLeaseRoom(plan, { signal: stop.signal })).prepared, false);
 assert.equal(calls.length, count);
});
