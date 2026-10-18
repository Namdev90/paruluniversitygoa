/**
 * Synthetic Edge routing/handler acceptance tests. No network or database calls.
 *
 * Run with Node >=22.18 (Node 24.19 verified):
 *   node --test server/tests/report-routing.test.mjs
 *
 * This loads the real index.ts and handler, but mocks fetch and Deno. It verifies
 * routing and response handling, NOT SQL filters, database permissions, actual
 * authentication decisions, or the deployed Edge version.
 */
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');

const originalFetch = globalThis.fetch;
const originalDeno = Object.getOwnPropertyDescriptor(globalThis, 'Deno');
const kinds = ['all', 'attended', 'absent', 'blocked', 'issues', 'resolved', 'unresolved', 'duplicates', 'activity', 'helpdesk', 'pending', 'corrections'];
const calls = [];
const bearer = 'b'.repeat(64);
const expectedHash = createHash('sha256').update(bearer).digest('hex');
let handler;
let mode = 'ok';

before(async () => {
  globalThis.Deno = {
    env: { get: key => ({
      SUPABASE_URL: 'https://synthetic.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
      SUPABASE_ANON_KEY: 'synthetic-anon'
    })[key] },
    serve: callback => { handler = callback; }
  };
  globalThis.fetch = async (url, options) => {
    // Do not delegate any call to the original fetch, even unexpected ones.
    assert.equal(url, 'https://synthetic.invalid/rest/v1/rpc/navrang_reports');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.apikey, 'synthetic-service');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-service');
    const body = JSON.parse(options.body);
    calls.push(body);
    if (mode === 'transport') return new Response('private database detail', { status: 500 });
    if (mode === 'auth') return Response.json({ error: 'Sign in again.', status: 401 });
    if (mode === 'revoked') return Response.json({ error: 'Teacher reports permission required.', status: 403 });
    if (mode === 'large') return Response.json({ error: 'Report too large to download.', status: 413 });
    return Response.json({ kind: body.p.kind, rows: [], count: 0, generatedAt: '2026-10-18T00:00:00Z', eventId: 'O9KL3' });
  };
  await import(pathToFileURL(path.join(repo, 'server/functions/navrang-gate/index.ts')).href);
  assert.equal(typeof handler, 'function');
});
beforeEach(() => { mode = 'ok'; });
after(() => {
  globalThis.fetch = originalFetch;
  if (originalDeno) Object.defineProperty(globalThis, 'Deno', originalDeno);
  else delete globalThis.Deno;
});

function post(action, payload = {}, token = bearer) {
  return handler(new Request('https://synthetic.invalid/gate', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: JSON.stringify({ action, payload })
  }));
}

for (const kind of kinds) {
  test(`real Edge routing: ${kind} export forwards empty rows and hashes bearer`, async () => {
    const response = await post('reports-export', { kind });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.deepEqual(body.rows, []);
    assert.equal(body.count, 0);
    assert.equal(body.kind, kind);
    assert.equal(body.generatedAt, '2026-10-18T00:00:00Z');
    assert.equal(body.eventId, 'O9KL3');
    assert.deepEqual(calls.at(-1), { p_action: 'export', p: { kind }, p_token: expectedHash });
  });
}

for (const action of ['access', 'summary', 'members', 'request', 'grant']) {
  test(`real Edge routing: reports-${action} reaches dedicated report RPC`, async () => {
    const payload = action === 'grant' ? { checkerId: '12345678-1234-1234-9234-123456789abc', enabled: true } : {};
    const response = await post('reports-' + action, payload);
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), { p_action: action, p: payload, p_token: expectedHash });
  });
}

for (const [label, token] of [['missing', ''], ['short', 'bad'], ['uppercase', 'B'.repeat(64)], ['63-character', 'b'.repeat(63)]]) {
  test(`report authentication: ${label} token is rejected before RPC`, async () => {
    const before = calls.length;
    assert.equal((await post('reports-export', { kind: 'all' }, token)).status, 401);
    assert.equal(calls.length, before);
  });
}

for (const [label, payload] of [['unknown dataset', { kind: 'unknown' }], ['null dataset', { kind: null }], ['oversized payload', { kind: 'all', extra: 'x'.repeat(2001) }]]) {
  test(`report validation: ${label} is rejected before RPC`, async () => {
    const before = calls.length;
    assert.equal((await post('reports-export', payload)).status, 400);
    assert.equal(calls.length, before);
  });
}

for (const [label, payload] of [['target ID', { checkerId: '12345678-1234-1234-9234-123456789abc' }], ['permission flag', { enabled: true }], ['admin role', { role: 'admin' }]]) {
  test(`faculty request: forged ${label} is rejected before RPC`, async () => {
    const before = calls.length;
    assert.equal((await post('reports-request', payload)).status, 400);
    assert.equal(calls.length, before);
  });
}

for (const [failure, status] of [['auth', 401], ['revoked', 403], ['large', 413], ['transport', 503]]) {
  test(`report failure: ${failure} becomes HTTP ${status} without private database details`, async () => {
    mode = failure;
    const response = await post('reports-export', { kind: 'all' });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(typeof body.error, 'string');
    assert.ok(!JSON.stringify(body).includes('private database detail'));
    assert.ok(!Object.hasOwn(body, 'rows'));
  });
}
