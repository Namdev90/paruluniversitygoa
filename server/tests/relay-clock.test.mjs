import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest, routeRoom, clockResponse } from '../relay-v1/src/route.mjs';
import { AuthError } from '../relay-v1/src/auth.mjs';
import { RelayCore } from '../relay-v1/src/core.mjs';

const ORIGIN = 'https://fixture.invalid';
const ROOM = 'room_1-Ab';
const PATH = `/v1/rooms/${ROOM}/socket`;
const NONCE = '00112233445566778899aabbccddeeff';
const FRESH_NONCE = 'ffeeddccbbaa99887766554433221100';
// Deliberately synthetic text; tests never create, sign, or verify a credential.
const PRIVATE_HEADER = 'Bearer synthetic-private-fixture-never-echo';
const ENV = Object.freeze({ synthetic: true });
function request({ path = PATH, method = 'GET', nonce = NONCE, upgrade, headers = {} } = {}) {
  const values = new Headers({ Authorization: PRIVATE_HEADER, ...headers });
  if (nonce !== undefined && nonce !== null) values.set('X-Navrang-Time-Nonce', nonce);
  if (upgrade !== undefined) values.set('Upgrade', upgrade);
  return new Request(ORIGIN + path, { method, headers: values });
}
function noForward() {
  let authenticated = 0, forwarded = 0;
  return {
    hooks: {
      authenticate: async () => { authenticated++; },
      forward: async () => { forwarded++; throw new Error('must not forward invalid request'); },
    },
    counts: () => ({ authenticated, forwarded }),
  };
}
async function assertRedacted(response) {
  const body = await response.text();
  const exposed = body + JSON.stringify([...response.headers]);
  assert.ok(!exposed.includes(PRIVATE_HEADER));
  assert.ok(!exposed.includes('synthetic-private-fixture-never-echo'));
  assert.ok(!exposed.includes('internal-sensitive-failure'));
}
function coreFixture() {
  let current = 1_000_000, writes = 0;
  const store = { load: () => null, save: () => { writes++; } };
  const peers = new Map();
  const core = new RelayCore(store, peers, () => current, () => '00000000-0000-4000-8000-000000000001');
  let id = 0;
  function connect(role) {
    const p = { id: `peer${++id}`, room: ROOM, subject: role, role, version: 1,
      jti: `synthetic${id}`, expires: current + 300_000, alive: true, messages: [], persisted: 0 };
    p.open = () => p.alive;
    p.close = () => { p.alive = false; };
    p.send = value => p.messages.push(value);
    p.persist = () => { p.persisted++; };
    core.connect(p); return p;
  }
  return { core, peers, connect, writes: () => writes, setTime: value => { current = value; }, now: () => current };
}

test('room parser accepts only the exact current room socket path with no query', () => {
  for (const room of ['a', ROOM, '_', '-','a'.repeat(64)])
    assert.equal(routeRoom(request({ path: `/v1/rooms/${room}/socket` })), room);
  for (const path of ['/v1/rooms//socket', `/v1/rooms/${'a'.repeat(65)}/socket`,
    `/v1/rooms/${ROOM}/socket/`, `/v1/rooms/${ROOM}/socket?nonce=${NONCE}`,
    `/v1/rooms/${ROOM}/socket?token=synthetic`, '/v1/rooms/a.b/socket',
    '/v1/rooms/%61/socket', '/v1/rooms/a%2Fb/socket', '/v1/rooms/a/socket/extra', '/health'])
    assert.equal(routeRoom(request({ path })), null, path);
});

test('invalid route is rejected before authentication or any room allocation', async () => {
  for (const path of ['/elsewhere', `${PATH}?token=synthetic`, `${PATH}/`, '/v1/rooms/a.b/socket']) {
    const spy = noForward();
    assert.equal((await routeRequest(request({ path }), ENV, spy.hooks)).status, 404);
    assert.deepEqual(spy.counts(), { authenticated: 0, forwarded: 0 });
  }
});

test('methods and unknown upgrades are rejected before authentication and forwarding', async () => {
  for (const options of [{ method: 'POST' }, { method: 'HEAD' }, { method: 'PUT', upgrade: 'websocket' },
    { upgrade: 'h2c' }, { upgrade: 'websocket, h2c' }, { upgrade: '' }]) {
    const spy = noForward();
    assert.equal((await routeRequest(request(options), ENV, spy.hooks)).status, 426, JSON.stringify(options));
    assert.deepEqual(spy.counts(), { authenticated: 0, forwarded: 0 });
  }
});

test('clock probes reject malformed, absent and duplicated nonce headers before authentication', async () => {
  for (const nonce of [null, '', '0'.repeat(31), '0'.repeat(33), NONCE.toUpperCase(), 'z'.repeat(32),
    `${NONCE}, ${NONCE}`, `${NONCE.slice(0, 16)} ${NONCE.slice(17)}`]) {
    const spy = noForward();
    assert.equal((await routeRequest(request({ nonce }), ENV, spy.hooks)).status, 400, String(nonce));
    assert.deepEqual(spy.counts(), { authenticated: 0, forwarded: 0 });
  }
});

test('authenticated probe forwards the original exact-room request only after authentication completes', async () => {
  const req = request();
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const expected = new Response('synthetic forwarded response', { status: 200 });
  const pending = routeRequest(req, ENV, {
    authenticate: async (actual, env, room) => {
      assert.equal(actual, req); assert.equal(env, ENV); assert.equal(room, ROOM);
      calls.push('authenticate'); await gate; calls.push('authenticated');
    },
    forward: async (room, actual) => {
      assert.deepEqual(calls, ['authenticate', 'authenticated']);
      assert.equal(room, ROOM); assert.equal(actual, req);
      calls.push('forward'); return expected;
    },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ['authenticate']);
  release();
  assert.equal(await pending, expected);
  assert.deepEqual(calls, ['authenticate', 'authenticated', 'forward']);
});

test('WebSocket route remains authenticated and does not require or interpret a probe nonce', async () => {
  for (const nonce of [null, 'not-a-probe-nonce']) {
    const req = request({ upgrade: 'WebSocket', nonce });
    const calls = [];
    const expected = new Response('socket-forward-fixture');
    assert.equal(await routeRequest(req, ENV, {
      authenticate: async (actual, env, room) => {
        assert.equal(actual, req); assert.equal(env, ENV); assert.equal(room, ROOM); calls.push('auth');
      },
      forward: async (room, actual) => {
        assert.deepEqual(calls, ['auth']); assert.equal(room, ROOM); assert.equal(actual, req);
        calls.push('forward'); return expected;
      },
    }), expected);
    assert.deepEqual(calls, ['auth', 'forward']);
  }
});

test('authorization denial and authority failure cannot forward probes or sockets and remain redacted', async () => {
  for (const upgrade of [undefined, 'websocket']) {
    for (const status of [401, 403, 503]) {
      let forwarded = 0;
      const response = await routeRequest(request({ upgrade }), ENV, {
        authenticate: async () => { throw new AuthError(status); },
        forward: async () => { forwarded++; return new Response('forbidden forward'); },
      });
      assert.equal(response.status, status); assert.equal(forwarded, 0);
      await assertRedacted(response);
    }
    let forwarded = 0;
    const response = await routeRequest(request({ upgrade }), ENV, {
      authenticate: async () => { throw new Error(`internal-sensitive-failure ${PRIVATE_HEADER}`); },
      forward: async () => { forwarded++; },
    });
    assert.equal(response.status, 503); assert.equal(forwarded, 0); await assertRedacted(response);
  }
});

test('forwarding errors fail closed with a redacted unavailable response', async () => {
  const response = await routeRequest(request(), ENV, {
    authenticate: async () => {},
    forward: async () => { throw new Error(`internal-sensitive-failure ${PRIVATE_HEADER}`); },
  });
  assert.equal(response.status, 503); await assertRedacted(response);
});

test('clock response echoes only version, exact nonce and authoritative safe-integer time without caching', async () => {
  const f = coreFixture();
  const response = clockResponse(f.core, request());
  assert.ok(response instanceof Response, 'clockResponse is synchronous');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json(?:;|$)/i);
  const cache = response.headers.get('Cache-Control') ?? '';
  assert.match(cache, /(?:^|,)\s*no-store\s*(?:,|$)/i);
  assert.match(cache, /(?:^|,)\s*private\s*(?:,|$)/i);
  assert.deepEqual(await response.json(), { version: 1, nonce: NONCE, serverTime: f.now() });
  const second = clockResponse(f.core, request({ nonce: FRESH_NONCE }));
  await assertRedacted(second);
});

test('a cached or delayed probe response cannot satisfy a different request nonce', async () => {
  const f = coreFixture();
  const first = await clockResponse(f.core, request()).json();
  f.setTime(f.now() + 25);
  const current = await clockResponse(f.core, request({ nonce: FRESH_NONCE })).json();
  assert.equal(first.nonce, NONCE);
  assert.notEqual(first.nonce, FRESH_NONCE, 'consumer must require exact outstanding nonce match');
  assert.equal(current.nonce, FRESH_NONCE);
  assert.equal(current.serverTime, first.serverTime + 25);
  assert.equal(first.serverTime, 1_000_000, 'old response remains old rather than being relabeled');
});

test('clock probes never connect peers, mint grants, consume jtis or persist room metadata', async () => {
  const f = coreFixture();
  const controller = f.connect('controller');
  const speaker = f.connect('speaker');
  const listener = f.connect('listener');
  f.core.message(controller, JSON.stringify({ type: 'grant', subject: speaker.subject }));
  const state = structuredClone(f.core.state);
  const grant = f.core.state.grant;
  const writes = f.writes();
  const observations = [...f.peers.values()].map(p => ({ p, messages: structuredClone(p.messages), persisted: p.persisted, flow: structuredClone(p.flow) }));
  for (const nonce of [NONCE, FRESH_NONCE]) {
    f.setTime(f.now() + 10);
    assert.equal(clockResponse(f.core, request({ nonce })).status, 200);
  }
  assert.equal(f.writes(), writes, 'probe has no storage side effects');
  assert.equal(f.core.state.grant, grant, 'active immutable grant object retained');
  const after = structuredClone(f.core.state); delete state.clock; delete after.clock;
  assert.deepEqual(after, state, 'only in-memory monotonic clock observation may change');
  assert.deepEqual([...f.peers.values()], [controller, speaker, listener]);
  for (const { p, messages, persisted, flow } of observations) {
    assert.deepEqual(p.messages, messages); assert.equal(p.persisted, persisted); assert.deepEqual(p.flow, flow);
    assert.equal(p.alive, true);
  }
});

test('clock response fails closed for rollback, thrown clock errors and invalid safe-integer values', async () => {
  const f = coreFixture();
  assert.equal(clockResponse(f.core, request()).status, 200);
  f.setTime(f.now() - 1);
  const rolledBack = clockResponse(f.core, request());
  assert.equal(rolledBack.status, 503); await assertRedacted(rolledBack);
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1000000', undefined]) {
    const response = clockResponse({ now: () => value }, request());
    assert.equal(response.status, 503, String(value)); await assertRedacted(response);
  }
  const failed = clockResponse({ now: () => { throw new Error(`internal-sensitive-failure ${PRIVATE_HEADER}`); } }, request());
  assert.equal(failed.status, 503); await assertRedacted(failed);
});

test('clock accepts both endpoints of the nonnegative safe-integer timestamp domain', async () => {
  for (const value of [0, Number.MAX_SAFE_INTEGER]) {
    const response = clockResponse({ now: () => value }, request());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { version: 1, nonce: NONCE, serverTime: value });
  }
});

test('malformed direct clock requests cannot sample the core clock', () => {
  for (const nonce of [null, '', 'a'.repeat(31), 'A'.repeat(32), 'g'.repeat(32)]) {
    let sampled = 0;
    const response = clockResponse({ now: () => { sampled++; return 1_000_000; } }, request({ nonce }));
    assert.equal(response.status, 400); assert.equal(sampled, 0);
  }
});

test('only documented authentication failures retain their status', async () => {
  for (const status of [200, 400, 404, 418, 500]) {
    let forwarded = 0;
    const response = await routeRequest(request(), ENV, {
      authenticate: async () => { throw new AuthError(status); },
      forward: async () => { forwarded++; },
    });
    assert.equal(response.status, 503, `unexpected AuthError(${status}) must fail unavailable`);
    assert.equal(forwarded, 0); await assertRedacted(response);
  }
});

test('unauthorized probe never reads the Durable Object namespace', async () => {
  let allocations = 0;
  const env = Object.defineProperty({}, 'ROOMS', { get() { allocations++; throw new Error('must not allocate before authentication'); } });
  const response = await routeRequest(request(), env, {
    authenticate: async (actual, passed, room) => {
      assert.equal(passed, env); assert.equal(room, ROOM); throw new AuthError(401);
    },
    forward: async () => { allocations++; throw new Error('must not forward'); },
  });
  assert.equal(response.status, 401); assert.equal(allocations, 0);
});

test('direct non-probe clock requests cannot observe or change the core clock', () => {
  for (const options of [{ method: 'POST' }, { upgrade: 'websocket' }, { upgrade: 'h2c' }]) {
    let sampled = 0;
    const response = clockResponse({ now: () => { sampled++; return 1_000_000; } }, request(options));
    assert.equal(response.status, 400); assert.equal(sampled, 0);
  }
});
