import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createLiveKitCloudRelay } from '../voice/livekit-relay.mjs';
import { voiceReadiness } from '../functions/navrang-gate/voice-control.mjs';

const secret = 'synthetic-unit-test-only-secret-0123456789';
const now = 1700000000123;
const options = { url: 'wss://synthetic-test.livekit.cloud', apiKey: 'synthetic-key', apiSecret: secret, clock: () => now };
const membership = { room: 'nv-opaque-room', identity: 'opaque-member' };
function decodeAndVerify(token) {
 const [header, payload, signature] = token.split('.');
 assert.equal(signature, createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'));
 assert.equal(JSON.parse(Buffer.from(header, 'base64url')).alg, 'HS256');
 return JSON.parse(Buffer.from(payload, 'base64url'));
}

test('receive credentials are signed, opaque, room scoped and never grant publishing or administration', async () => {
 let calls = 0;
 const relay = createLiveKitCloudRelay({ ...options, fetchImpl: () => { calls++; throw Error('unexpected network'); } });
 const result = await relay.mintReceiveToken({ ...membership, ttlSeconds: 600, canPublish: true, roomAdmin: true });
 const claims = decodeAndVerify(result.token);
 assert.deepEqual(claims, { iss: options.apiKey, sub: membership.identity, nbf: 1700000000, exp: 1700000600,
  video: { room: membership.room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false } });
 assert.equal(result.canPublish, false);
 assert.equal(calls, 0);
 assert.equal((await relay.mintReceiveToken(membership)).expiresAt, new Date(1700000060000).toISOString());
});

test('no receive token may outlive the Cloud ten-minute revocation window', async () => {
 const relay = createLiveKitCloudRelay(options);
 for (const ttlSeconds of [0, -1, 600.1, 601, Infinity, '60', null]) {
  await assert.rejects(relay.mintReceiveToken({ ...membership, ttlSeconds }), /TTL/);
 }
 for (const invalid of [{ room: 'email@example.test' }, { identity: '../arbitrary' }, { room: '' }]) {
  await assert.rejects(relay.mintReceiveToken({ ...membership, ...invalid }), /opaque/);
 }
});

test('only direct secure Cloud origins are accepted; self-hosted replay is never called safe', () => {
 for (const url of ['https://relay.example.test', 'http://synthetic-test.livekit.cloud', 'https://synthetic-test.livekit.cloud.evil.test',
  'https://user:pass@synthetic-test.livekit.cloud', 'https://synthetic-test.livekit.cloud/api', 'https://synthetic-test.livekit.cloud?key=secret']) {
  assert.throws(() => createLiveKitCloudRelay({ ...options, url }), /Cloud/);
 }
 assert.throws(() => createLiveKitCloudRelay({ ...options, timeoutMs: 2001 }), /Bounded/);
});

test('strict removal sends an explicit same-second-safe cutoff and minimal room-admin JWT', async () => {
 const calls = [];
 const relay = createLiveKitCloudRelay({ ...options, fetchImpl: async (...args) => { calls.push(args); return Response.json({}); } });
 assert.deepEqual(await relay.revoke({ ...membership, strict: true, cutoff: 1700000000 }), { revoked: true, cutoff: 1700000003 });
 const [url, request] = calls[0];
 assert.equal(url, 'https://synthetic-test.livekit.cloud/twirp/livekit.RoomService/RemoveParticipant');
 assert.equal(request.method, 'POST');
 assert.equal(request.redirect, 'error');
 assert.equal(request.cache, 'no-store');
 assert.deepEqual(JSON.parse(request.body), { ...membership, revoke_token_ts: '1700000003' });
 assert.deepEqual(decodeAndVerify(request.headers.Authorization.slice(7)), { iss: options.apiKey, nbf: 1700000000, exp: 1700000060,
  video: { room: membership.room, roomAdmin: true } });
 assert.equal(request.signal instanceof AbortSignal, true);
});

test('non-strict, malformed or out-of-window removal never makes a provider request', async () => {
 let calls = 0;
 const relay = createLiveKitCloudRelay({ ...options, fetchImpl: () => { calls++; throw Error('unexpected'); } });
 for (const input of [{ strict: false }, { strict: true, cutoff: 0 }, { strict: true, cutoff: 1700000031 }, { strict: true, room: '../room' }]) {
  const result = await relay.revoke({ ...membership, ...input });
  assert.equal(result.revoked, false);
  assert.equal(result.code, 'INVALID_REVOCATION');
 }
 assert.equal(calls, 0);
});

test('provider errors, non-JSON success and missing participants are never falsely acknowledged', async () => {
 for (const fetchImpl of [
  async () => { throw Error(`provider leaked ${secret}`); },
  async () => new Response(`provider leaked ${secret}`, { status: 404 }),
  async () => new Response('not JSON', { status: 200 }),
  async () => Response.json({ code: 'not_found', msg: secret }),
  async () => Response.json(null)
 ]) {
  const result = await createLiveKitCloudRelay({ ...options, fetchImpl }).revoke({ ...membership, strict: true });
  assert.deepEqual(result, { revoked: false, code: 'RELAY_UNAVAILABLE' });
  assert.equal(JSON.stringify(result).includes(secret), false);
 }
});

test('hung network and body reads are bounded and abort the request', async () => {
 for (const bodyHangs of [false, true]) {
  let signal;
  const relay = createLiveKitCloudRelay({ ...options, timeoutMs: 20, fetchImpl: async (_, request) => {
   signal = request.signal;
   if (bodyHangs) return { ok: true, json: () => new Promise(() => {}) };
   return new Promise(() => {});
  } });
  assert.deepEqual(await relay.revoke({ ...membership, strict: true }), { revoked: false, code: 'RELAY_UNAVAILABLE' });
  assert.equal(signal.aborted, true);
 }
});

test('configured credentials and forged health booleans cannot enable a publish grant or renewal', async () => {
 let calls = 0;
 const relay = createLiveKitCloudRelay({ ...options, leaseEnforced: true, workerDeathVerified: true, revocationVerified: true,
  fetchImpl: () => { calls++; throw Error('must never publish'); } });
 const state = relay.readiness();
 state.leaseEnforced = true;
 assert.equal(voiceReadiness(relay.readiness(), now).ready, false);
 assert.equal(relay.readiness().workerDeathVerified, false);
 for (const method of ['grant', 'renew']) {
  assert.deepEqual(await relay[method]({ ...membership, expiresAt: new Date(now + 15000).toISOString(), watchdogArmed: true }),
   { granted: false, renewed: false, status: 503, code: 'ACTIVE_MEDIA_FAILSAFE_UNAVAILABLE' });
 }
 assert.equal(calls, 0);
 assert.equal(relay.transportEvidence, 'NOT_RUN');
});

test('controller cancellation aborts transport immediately without awaiting the provider', async () => {
 const stopped = new AbortController();
 stopped.abort(Error(secret));
 let calls = 0;
 const neverStarted = createLiveKitCloudRelay({ ...options, fetchImpl: () => { calls++; return new Promise(() => {}); } });
 assert.deepEqual(await neverStarted.revoke({ ...membership, strict: true }, { signal: stopped.signal }),
  { revoked: false, code: 'RELAY_UNAVAILABLE' });
 assert.equal(calls, 0);

 const active = new AbortController();
 let signal, started;
 const requestStarted = new Promise(resolve => { started = resolve; });
 const pendingRelay = createLiveKitCloudRelay({ ...options, fetchImpl: async (_, request) => {
  signal = request.signal;
  started();
  return new Promise(() => {});
 } });
 const pending = pendingRelay.revoke({ ...membership, strict: true }, { signal: active.signal });
 await requestStarted;
 active.abort(Error(secret));
 assert.deepEqual(await pending, { revoked: false, code: 'RELAY_UNAVAILABLE' });
 assert.equal(signal.aborted, true);
});

test('cutoff covers token refresh during removal and elapsed cutoff cannot be acknowledged', async () => {
 for (const elapsed of [1500, 3000]) {
  let current = now, cutoff;
  const relay = createLiveKitCloudRelay({ ...options, clock: () => current, fetchImpl: async (_, request) => {
   cutoff = Number(JSON.parse(request.body).revoke_token_ts);
   current += elapsed;
   return Response.json({});
  } });
  const result = await relay.revoke({ ...membership, strict: true });
  if (elapsed === 1500) {
   assert(Math.floor(current / 1000) < cutoff, 'a token refreshed before removal is older than cutoff');
   assert.equal(result.revoked, true);
  } else assert.deepEqual(result, { revoked: false, code: 'RELAY_UNAVAILABLE' });
 }
});
