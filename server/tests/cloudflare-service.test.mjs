import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareVoiceService, strictCloudflareRevocation } from '../voice/cloudflare-service.mjs';

// All RPC replies, receipts and token text are synthetic. No signer or network exists.
const ids = Array.from({ length: 10 }, (_, i) => `${i + 1}`.padStart(8, '0') + '-1111-4111-8111-111111111111');
const [identity, listener, leaseId, operationId, sessionId, dutyId, requestId, commandId, grantId, oldLease] = ids;
const origin = 'https://relay.fixture.invalid', token = 'a'.repeat(64), at = 1_700_000_000_123;
const payload = { sessionId, requestId };
function fixture({ listening = false } = {}) {
 let now = at;
 const events = [], calls = [];
 const operation = { operationId, sessionId, dutyId, identity, leaseId, generation: 7, state: 'granting',
  expiresAt: new Date(at + 15000).toISOString(), revoke: [], serverTime: now };
 const plan = { provider: 'navrang-relay-v1', publisherIdentity: identity, leaseId, generation: 7,
  roomId: 'nr_' + leaseId.replaceAll('-', ''), origin, expiresAt: new Date(Math.floor((at + 15000) / 1000) * 1000).toISOString() };
 const receipt = { provider: plan.provider, roomId: plan.roomId, leaseId, generation: 7, expiresAt: plan.expiresAt,
  operationId, prepared: true, grantId, epoch: 3, deadline: Date.parse(plan.expiresAt), mediaTerminationVerified: true };
 const credential = (who, role) => ({ provider: plan.provider, roomId: plan.roomId, origin, leaseId, generation: 7,
  expiresAt: plan.expiresAt, identity: who, role, token: 'synthetic.native.only' });
 const revocation = p => ({ provider: p.provider, roomId: p.roomId, leaseId: p.leaseId, generation: p.generation,
  expiresAt: p.expiresAt, revoked: true, forwardingStopped: true, mediaTerminationVerified: true });
 const snapshot = () => ({ state: listening ? 'listening' : 'speaking', dutyId, sessionId, identity: listening ? listener : identity,
  plan: operation.plan ?? plan, serverTime: now, dutyExpiresAt: new Date(at + 60000).toISOString() });
 const relay = {
  readiness: async () => ({ configured: true, leaseEnforced: true, workerDeathVerified: true, revocationVerified: true,
   revocationMode: 'guarded-admission', workerAt: now, capabilities: ['clock-v1', 'staged-grant-v1'] }),
  prepare: async (p, input) => { events.push('relay.prepare'); assert.equal(input.operationId, operationId); assert.equal(input.subject, identity); assert.equal(input.deadline, receipt.deadline); return { ...receipt }; },
  activate: async (p, r) => { events.push('relay.activate'); assert.deepEqual(r, receipt); return { ...r, active: true }; },
  inspect: async p => { events.push('relay.inspect'); return { plan: p, active: true, receipt: { ...receipt } }; },
  revoke: async p => { events.push('relay.revoke'); return revocation(p); },
 };
 const issuer = { configured: () => true, mintCredential: async (p, input) => { events.push(`issuer:${input.role}`); return { credential: credential(input.identity, input.role) }; } };
 let rpc = async (action, input, actor) => {
  assert.equal(actor, token); events.push(action); calls.push({ action, input: structuredClone(input) });
  if (['floor-prepare', 'relay-renew-prepare', 'voice-broadcast-start', 'relay-operation'].includes(action)) return structuredClone(operation);
  if (action === 'relay-plan') { operation.plan = structuredClone(input.plan); operation.expiresAt = input.plan.expiresAt; return { ...operation }; }
  if (action === 'relay-commit') { operation.state = 'active'; return { ...operation }; }
  if (action === 'relay-receive') return snapshot();
  if (action === 'voice-join') return { sessionId, dutyId, identity: listener };
  if (action === 'relay-ack') return { state: 'acked' };
  return { state: 'idle' };
 };
 return { operation, plan, receipt, relay, issuer, events, calls, credential, revocation, snapshot,
  setTime: value => { now = value; }, get rpc() { return rpc; }, set rpc(value) { rpc = value; },
  service: (extra = {}) => createCloudflareVoiceService({ rpc, relay, issuer, origin, clock: () => now, ...extra }) };
}
const commitPayload = { ...payload, phase: 'commit', operationId, generation: 7 };
async function admit(f) { const result = await f.service().handle('voice-floor', payload, token); assert.equal(result.state, 'prepared'); return result; }

test('immutable actor-authorized SQL plan precedes provisional native speaker credential; no relay grant exists', async () => {
 const f = fixture(), result = await admit(f);
 assert.deepEqual(f.events, ['floor-prepare', 'relay-plan', 'issuer:speaker', 'floor-prepare']);
 assert.equal(result.transmit.role, 'speaker'); assert.equal(result.transmit.identity, identity);
 assert.equal(result.operationId, operationId); assert.equal(result.generation, 7); assert.equal(result.grant, undefined);
 assert.equal(f.operation.state, 'granting'); assert.deepEqual(f.operation.plan, f.plan);
 assert.equal(f.events.includes('relay.prepare'), false); assert.equal(f.events.includes('relay.activate'), false);
});

test('exact staged receipt precedes SQL commit; SQL is rechecked before and after activation', async () => {
 const f = fixture(); await admit(f); f.events.length = 0;
 const result = await f.service().handle('voice-floor', commitPayload, token);
 assert.equal(result.state, 'active'); assert.equal(result.transmit, undefined, 'already admitted native handle owns its consumed credential');
 assert.deepEqual(result.grant, { grantId, epoch: 3, deadline: f.receipt.deadline });
 assert.deepEqual(f.events, ['relay-operation', 'relay.prepare', 'relay-commit', 'relay-receive', 'relay.activate', 'relay-receive']);
 const committed = f.calls.find(c => c.action === 'relay-commit').input;
 assert.equal(committed.receipt.prepared, true); assert.equal(committed.receipt.grantId, grantId);
 assert.equal(committed.receipt.operationId, undefined); assert.equal(committed.receipt.deadline, undefined, 'SQL strict receipt schema stays separate from wire receipt');
 assert.deepEqual(committed.plan, f.plan);
 assert.equal(f.calls.some(c => Object.hasOwn(c.input, 'phase')), false, 'public phase fields never reach private SQL');
});

test('provisional admission retries preserve the saved plan, room and fixed deadline', async () => {
 const f = fixture(); const first = await admit(f); f.events.length = 0;
 const next = await admit(f);
 assert.equal(next.leaseId, first.leaseId); assert.equal(next.expiresAt, first.expiresAt); assert.deepEqual(next.transmit, first.transmit);
 assert.deepEqual(f.events, ['floor-prepare', 'issuer:speaker', 'floor-prepare']);
});

test('committed retry inspects original relay receipt and activates idempotently without a fresh JWT or plan', async () => {
 const f = fixture(); await admit(f); f.operation.state = 'active'; f.events.length = 0;
 const result = await f.service().handle('voice-floor', commitPayload, token);
 assert.equal(result.state, 'active'); assert.equal(result.expiresAt, f.plan.expiresAt);
 assert.deepEqual(f.events, ['relay-operation', 'relay.inspect', 'relay-receive', 'relay.activate', 'relay-receive']);
});

test('renewal uses the old lease as a stable retry key and a new per-lease room', async () => {
 const f = fixture();
 const result = await f.service().handle('voice-renew', { sessionId, leaseId: oldLease }, token);
 assert.equal(result.state, 'prepared'); assert.notEqual(result.leaseId, oldLease);
 assert.equal(result.transmit.roomId, 'nr_' + leaseId.replaceAll('-', ''));
 assert.deepEqual(f.calls[0], { action: 'relay-renew-prepare', input: { sessionId, leaseId: oldLease, requestId: oldLease } });
 assert.equal(f.calls.some(c => c.action === 'voice-renew'), false);
});

test('old room requires exact strict revocation and actor-authorized acknowledgement before preparation', async () => {
 const f = fixture(); await admit(f);
 const old = { ...f.plan, leaseId: oldLease, roomId: 'nr_' + oldLease.replaceAll('-', ''), generation: 6 };
 f.operation.revoke = [{ commandId, generation: 8, plan: old }]; f.events.length = 0;
 assert.equal((await f.service().handle('voice-floor', commitPayload, token)).state, 'active');
 assert.deepEqual(f.events.slice(0, 4), ['relay-operation', 'relay.revoke', 'relay-ack', 'relay.prepare']);
 assert.equal(f.calls.find(c => c.action === 'relay-ack').input.generation, 8);
 assert.equal(f.calls.find(c => c.action === 'relay-ack').input.receipt.generation, 6);
});

test('unverified removals cannot be acknowledged or grant a successor', async () => {
 for (const change of [{ forwardingStopped: false }, { mediaTerminationVerified: false }, { leaseId }, { generation: 8 }]) {
  const f = fixture(); await admit(f);
  const old = { ...f.plan, leaseId: oldLease, roomId: 'nr_' + oldLease.replaceAll('-', ''), generation: 6 };
  f.operation.revoke = [{ commandId, generation: 8, plan: old }];
  f.relay.revoke = async () => ({ ...f.revocation(old), ...change });
  assert.equal((await f.service().handle('voice-floor', commitPayload, token)).status, 503);
  assert.equal(f.events.includes('relay-ack'), false); assert.equal(f.events.includes('relay.prepare'), false);
 }
});

test('native listener credential follows authorized active discovery and a second identical SQL read', async () => {
 const f = fixture({ listening: true });
 const result = await f.service().handle('voice-join', { sessionId, dutyId }, token);
 assert.equal(result.state, 'listening'); assert.equal(result.receive.identity, listener); assert.equal(result.receive.role, 'listener');
 assert.deepEqual(f.events, ['voice-join', 'relay-receive', 'relay.inspect', 'issuer:listener', 'relay-receive']);
});

test('pending relay activation or changed listener identity never returns a receive credential', async () => {
 const notActive = fixture({ listening: true }); notActive.relay.inspect = async p => ({ plan: p, active: false });
 assert.equal((await notActive.service().handle('voice-join', { sessionId, dutyId }, token)).status, 503);
 assert.equal(notActive.events.includes('issuer:listener'), false);
 const changed = fixture({ listening: true }); let reads = 0; const original = changed.rpc;
 changed.rpc = async (...args) => { const result = await original(...args); return args[0] === 'relay-receive' && ++reads === 2 ? { ...result, identity } : result; };
 const result = await changed.service().handle('voice-join', { sessionId, dutyId }, token);
 assert.equal(result.status, 503); assert.equal(result.receive, undefined);
});

test('SQL membership denial precedes issuer work and idle discovery exposes no secret', async () => {
 for (const state of ['idle', 'speaking']) {
  const f = fixture({ listening: true }), original = f.rpc;
  f.rpc = async (...args) => args[0] === 'relay-receive' ? { ...f.snapshot(), state } : original(...args);
  const result = await f.service().handle('voice-join', { sessionId, dutyId }, token);
  assert.equal(result.receive, null); assert.equal(f.events.some(e => e.startsWith('issuer:')), false);
 }
 const denied = fixture(), original = denied.rpc;
 denied.rpc = async (...args) => args[0] === 'voice-join' ? { error: 'Denied', status: 403 } : original(...args);
 assert.equal((await denied.service().handle('voice-join', { sessionId, dutyId }, token)).status, 403);
 assert.equal(denied.events.length, 0);
});

test('receipt mismatch, interrupted activation and stale post-commit authority release the exact stranded floor', async () => {
 for (const fail of ['receipt', 'activate', 'authority']) {
  const f = fixture(); await admit(f);
  if (fail === 'receipt') f.relay.prepare = async () => ({ ...f.receipt, deadline: f.receipt.deadline + 1 });
  if (fail === 'activate') f.relay.activate = async () => { throw Error('synthetic-private-provider-error'); };
  if (fail === 'authority') { const original = f.rpc; f.rpc = async (...args) => args[0] === 'relay-receive' ? { ...f.snapshot(), identity: listener } : original(...args); }
  const result = await f.service().handle('voice-floor', commitPayload, token);
  assert.equal(result.status, 503); assert.equal(result.grant, undefined); assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  assert.equal(f.events.includes('relay.revoke'), true); assert.equal(f.events.includes('floor-fail'), true); assert.equal(f.events.includes('voice-release'), true);
  assert.deepEqual(f.calls.find(c => c.action === 'voice-release').input, { sessionId, leaseId });
  if (fail !== 'activate') assert.equal(f.events.includes('relay.activate'), false);
 }
});

test('expired plans, stale operation IDs and malformed commit phases never activate', async () => {
 const expired = fixture(); await admit(expired); expired.setTime(Date.parse(expired.plan.expiresAt));
 assert.equal((await expired.service().handle('voice-floor', commitPayload, token)).status, 503);
 assert.equal(expired.events.includes('relay.prepare'), false);
 const stale = fixture(); await admit(stale);
 assert.equal((await stale.service().handle('voice-floor', { ...commitPayload, operationId: grantId }, token)).status, 503);
 assert.equal(stale.events.includes('relay.prepare'), false);
 const invalid = fixture();
 for (const value of [{ ...payload, phase: 'commit' }, { ...commitPayload, generation: '7' }, { ...payload, phase: 'activate' }])
  assert.equal((await invalid.service().handle('voice-floor', value, token)).status, 400);
 assert.equal(invalid.events.length, 0);
});

test('absent configured issuer or staged capability fails closed while cleanup remains available', async () => {
 for (const extra of [{ issuer: undefined }, { issuer: { configured: () => false, mintCredential: async () => { throw Error(); } } }]) {
  const f = fixture(), service = f.service(extra);
  assert.equal((await service.handle('voice-floor', payload, token)).status, 503); assert.equal(f.events.length, 0);
  assert.equal((await service.handle('voice-release', { sessionId, leaseId }, token)).state, 'idle');
 }
 const f = fixture(), ready = f.relay.readiness;
 f.relay.readiness = async () => ({ ...await ready(), capabilities: ['clock-v1'] });
 assert.equal((await f.service().handle('voice-floor', payload, token)).status, 503); assert.equal(f.events.length, 0);
});

test('hung operations are bounded, external cancellation cannot authorize a grant, and errors stay redacted', async () => {
 const f = fixture(); f.rpc = async () => new Promise(() => {});
 assert.equal((await f.service({ timeoutMs: 10, budgetMs: 20 }).handle('voice-floor', payload, token)).status, 503);
 const g = fixture(), cancelled = new AbortController(); cancelled.abort();
 assert.equal((await g.service().handle('voice-floor', payload, token, { signal: cancelled.signal })).status, 503);
 assert.equal(g.events.length, 0);
});

test('strict removal distinguishes immutable plan generation from cleanup command generation', () => {
 const f = fixture(); assert.equal(strictCloudflareRevocation(f.revocation(f.plan), f.plan), true);
 assert.equal(strictCloudflareRevocation({ ...f.revocation(f.plan), generation: 8 }, f.plan), false);
 assert.equal(strictCloudflareRevocation({ ...f.revocation(f.plan), forwardingStopped: false }, f.plan), false);
 assert.equal(strictCloudflareRevocation(f.revocation(f.plan), { ...f.plan, provider: 'daily' }), false);
});

test('commit is an exact read-only operation lookup and never allocates a floor for a stale phase', async () => {
 const f = fixture(); await admit(f); f.events.length = 0;
 const original = f.rpc;
 f.rpc = async (...args) => args[0] === 'relay-operation' ? { error: 'Floor operation is stale.', status: 409 } : original(...args);
 assert.equal((await f.service().handle('voice-floor', commitPayload, token)).status, 409);
 assert.equal(f.events.length, 0, 'stale lookup cannot reach floor acquisition, minting, or cleanup of a successor');
 const g = fixture(); await admit(g); g.events.length = 0;
 assert.equal((await g.service().handle('voice-floor', commitPayload, token)).state, 'active');
 assert.deepEqual(g.calls.find(c => c.action === 'relay-operation').input, { operationId, generation: 7, sessionId });
 assert.equal(g.events.includes('floor-prepare'), false);
});

test('revoked provisional authority and forged issuer bindings cannot expose native speaker admission', async () => {
 const revoked = fixture(), original = revoked.rpc; let reads = 0;
 revoked.rpc = async (...args) => {
  const result = await original(...args);
  return args[0] === 'floor-prepare' && ++reads === 2 ? { ...result, state: 'revoking' } : result;
 };
 assert.equal((await revoked.service().handle('voice-floor', payload, token)).status, 503);
 for (const change of [{ role: 'controller' }, { identity: listener }, { origin: 'https://foreign.fixture.invalid' }, { expiresAt: new Date(at + 60000).toISOString() }]) {
  const f = fixture(); f.issuer.mintCredential = async () => ({ credential: { ...f.credential(identity, 'speaker'), ...change } });
  const result = await f.service().handle('voice-floor', payload, token);
  assert.equal(result.status, 503); assert.equal(result.transmit, undefined); assert.equal(f.events.includes('relay.activate'), false);
 }
});

test('activation acknowledgement must match the SQL-committed grant and epoch exactly', async () => {
 for (const change of [{ epoch: 4 }, { grantId: operationId }, { active: false }, { deadline: Date.parse('2099-01-01') }]) {
  const f = fixture(); await admit(f); f.relay.activate = async () => ({ ...f.receipt, active: true, ...change });
  const result = await f.service().handle('voice-floor', commitPayload, token);
  assert.equal(result.status, 503); assert.equal(result.grant, undefined);
  assert.equal(f.events.includes('relay.revoke'), true); assert.equal(f.events.includes('voice-release'), true);
 }
});

test('commit requires the previously persisted provisional plan and cannot allocate or mint one', async () => {
 const f = fixture();
 const result = await f.service().handle('voice-floor', commitPayload, token);
 assert.equal(result.status, 503);
 assert.equal(f.events.includes('relay-plan'), false); assert.equal(f.events.some(e => e.startsWith('issuer:')), false);
 assert.equal(f.events.includes('relay.prepare'), false); assert.equal(f.events.includes('relay.activate'), false);
});

test('mismatched SQL commit binding cannot activate even when lease and deadline appear valid', async () => {
 for (const change of [{ operationId: requestId }, { dutyId: requestId }, { identity: listener }, { plan: null }]) {
  const f = fixture(); await admit(f); const original = f.rpc;
  f.rpc = async (...args) => { const result = await original(...args); return args[0] === 'relay-commit' ? { ...result, ...change } : result; };
  const result = await f.service().handle('voice-floor', commitPayload, token);
  assert.equal(result.status, 503); assert.equal(f.events.includes('relay.activate'), false);
  assert.equal(f.events.includes('relay.revoke'), true); assert.equal(f.events.includes('voice-release'), true);
 }
});
