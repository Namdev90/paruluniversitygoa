import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVoiceServiceBoundary } from '../functions/navrang-gate/voice-service.mjs';

const actor = 'a'.repeat(64);
const denied = result => { assert.equal(result.status, 503); assert.equal('transmit' in result, false); assert.equal('receive' in result, false); };

test('explicit unconfigured Edge service denies all acquisition without RPC/provider activity', async () => {
 let calls = 0;
 const service = createVoiceServiceBoundary({ rpc: async () => { calls++; throw Error('Unexpected call'); } });
 for (const action of ['duty-join', 'duty-heartbeat', 'voice-join', 'voice-floor', 'voice-renew', 'voice-broadcast-start', 'voice-invite']) {
  assert.equal(service.supports(action), true);
  denied(await service.handle(action, {}, actor));
 }
 for (const action of ['daily-plan', 'controller-claim', 'floor-commit', 'config', 'notifications-feed']) {
  assert.equal(service.supports(action), false);
  assert.equal((await service.handle(action, {}, actor)).status, 400);
 }
 assert.equal((await service.handle('voice-release', {}, 'raw-bearer')).status, 401);
 assert.equal(calls, 0);
 assert.equal(service.transportEvidence, 'NOT_RUN');
});

test('disabled relay still sends ending intent only to existing authenticated actions', async () => {
 const calls = [], payload = { sessionId: 'synthetic' };
 const service = createVoiceServiceBoundary({ rpc: async (...args) => { calls.push(args); return { state: 'ending' }; } });
 for (const action of ['voice-release', 'voice-broadcast-end', 'duty-leave']) {
  assert.deepEqual(await service.handle(action, payload, actor), { state: 'ending' });
 }
 assert.deepEqual(calls.map(args => args.slice(0, 3)), ['voice-release', 'voice-broadcast-end', 'duty-leave'].map(action => [action, payload, actor]));
 assert(calls.every(args => args[3].signal instanceof AbortSignal));
});

test('hung, cancelled, malformed or rejected cleanup is bounded and redacts backend details', async () => {
 let stop, calls = 0;
 const service = createVoiceServiceBoundary({ timeoutMs: 10, rpc: async (_, __, ___, options) => {
  calls++; stop = options.signal; return new Promise(() => {});
 } });
 denied(await service.handle('voice-release', {}, actor));
 assert.equal(stop.aborted, true);
 const aborted = AbortSignal.abort(Error('synthetic-secret'));
 denied(await service.handle('duty-leave', {}, actor, { signal: aborted }));
 assert.equal(calls, 1);
 const controller = new AbortController();
 const pending = service.handle('duty-leave', {}, actor, { signal: controller.signal });
 await new Promise(resolve => setImmediate(resolve));
 controller.abort(Error('synthetic-secret'));
 denied(await pending);
 assert.equal(stop.aborted, true);
 for (const rpc of [async () => { throw Error('synthetic-secret'); }, async () => null, async () => []]) {
  const result = await createVoiceServiceBoundary({ rpc }).handle('duty-leave', {}, actor);
  denied(result); assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
 }
});

test('composed accepted-service dependency cannot receive private actions or bypass cancellation', async () => {
 const calls = [], aborter = new AbortController();
 const boundary = createVoiceServiceBoundary({ rpc: async () => { throw Error('Unexpected fallback'); }, service: {
  supports: () => true,
  handle: async (...args) => { calls.push(args); aborter.abort(); return { state: 'active', transmit: 'must-be-discarded' }; }
 } });
 assert.equal((await boundary.handle('daily-plan', {}, actor)).status, 400);
 denied(await boundary.handle('voice-floor', {}, actor, { signal: aborter.signal }));
 assert.equal(calls.length, 1);
 assert.equal(calls[0][3].signal.aborted, true);
 assert.throws(() => createVoiceServiceBoundary({ rpc() {}, timeoutMs: 2001 }));
});

test('actual Edge entrypoint injects disabled boundary, preserves validation/hash and cleanup RPC path', async () => {
 const originalDeno = globalThis.Deno, originalFetch = globalThis.fetch;
 let handler; const calls = [];
 globalThis.Deno = {
  env: { get: name => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon' })[name] },
  serve: value => { handler = value; }
 };
 globalThis.fetch = async (url, options) => {
  calls.push({ url, options }); return Response.json({ state: 'ending' });
 };
 try {
  await import('../functions/navrang-gate/index.ts');
  const id = '12345678-1234-4234-9234-123456789abc';
  const request = (action, payload, bearer = actor) => new Request('https://fixture.invalid/api', {
   method: 'POST', headers: { authorization: `Bearer ${bearer}` }, body: JSON.stringify({ action, payload })
  });
  assert.equal((await handler(request('duty-join', { installationId: 'synthetic' }, ''))).status, 401);
  assert.equal((await handler(request('duty-join', { installationId: 123 }))).status, 400);
  assert.equal((await handler(request('daily-plan', {}))).status, 400);
  assert.equal((await handler(request('duty-join', { installationId: 'synthetic' }))).status, 503);
  assert.equal(calls.length, 0);
  const response = await handler(request('voice-release', { sessionId: id, leaseId: id }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://fixture.invalid/rest/v1/rpc/navrang_communications');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.p_action, 'voice-release');
  assert.equal(body.p_token, createHash('sha256').update(actor).digest('hex'));
  assert(calls[0].options.signal instanceof AbortSignal);
  assert.equal(body.p_token === actor, false);
  const config = await handler(new Request('https://fixture.invalid/api'));
  assert.equal(config.status, 200);
  assert.equal((await config.json()).googleEnabled, false);
  assert.equal(calls[1].url, 'https://fixture.invalid/rest/v1/rpc/navrang_gate');
  assert.equal(JSON.parse(calls[1].options.body).p_action, 'config');
  assert.equal(calls[2].url, 'https://fixture.invalid/auth/v1/settings');
 } finally {
  globalThis.fetch = originalFetch;
  if (originalDeno === undefined) delete globalThis.Deno; else globalThis.Deno = originalDeno;
 }
});
