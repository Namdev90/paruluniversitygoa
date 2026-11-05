import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayCore } from '../src/core.mjs';
// In-memory store and peers keep staged admission independent of SQLite/runtime APIs.
const binaries = p => p.messages.filter(value => value instanceof ArrayBuffer);
function frame(g, sequence = 1) {
  const packet = new ArrayBuffer(44), bytes = new Uint8Array(packet), view = new DataView(packet);
  bytes.set([78, 86, 82, 71, 1, 1, 0, 40]); view.setUint32(8, g.epoch); view.setUint32(12, sequence);
  view.setBigUint64(16, BigInt(g.deadline));
  bytes.set(g.grantId.replace(/-/g, '').match(/../g).map(value => parseInt(value, 16)), 24);
  bytes.fill(0xa5, 40); return packet;
}

const OP = '00112233-4455-4677-8899-aabbccddeeff';
const OTHER_OP = 'ffeeddcc-bbaa-4988-8776-554433221100';
function fixture() {
  let now = 1_000_000, next = 0, saved = null, saves = 0;
  const store = { load: () => structuredClone(saved), save: state => { saves++; saved = structuredClone(state); } };
  const peers = new Map();
  const core = new RelayCore(store, peers, () => now, () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`);
  const peer = (role, overrides = {}) => {
    const id = `peer${++next}`;
    const p = { id, room: 'room', subject: role, role, version: 1, jti: `synthetic${id}`, expires: now + 300_000, alive: true, messages: [], ...overrides };
    p.open = () => p.alive; p.close = () => { p.alive = false; }; p.send = data => p.messages.push(data);
    p.persist = () => { p.attachment = structuredClone({ flow: p.flow }); };
    return p;
  };
  const add = (role, overrides) => { const p = peer(role, overrides); core.connect(p); return p; };
  const c = add('controller'), s = add('speaker'), l = add('listener');
  return { core, store, peers, c, s, l, peer, add, now: () => now, advance: ms => { now += ms; }, saves: () => saves };
}
const controls = p => p.messages.filter(v => typeof v === 'string').map(v => JSON.parse(v));
const command = (f, actor, value) => f.core.message(actor, JSON.stringify(value));
const preparation = (f, overrides = {}) => ({ type: 'prepare', subject: f.s.subject, operationId: OP, deadline: f.now() + 15_000, ...overrides });
function prepare(f, overrides = {}) {
  const request = preparation(f, overrides); command(f, f.c, request);
  const receipt = controls(f.c).filter(v => v.type === 'prepared').at(-1);
  assert.ok(receipt, 'controller receives a preparation receipt'); return { request, receipt, staged: structuredClone(f.core.state.prepared) };
}
const activation = receipt => ({ type: 'activate', operationId: receipt.operationId, grantId: receipt.grantId, epoch: receipt.epoch, deadline: receipt.deadline });

test('prepare durably reserves a fixed epoch and lease without activating or disclosing a grant', () => {
  const f = fixture(); const before = f.core.state.epoch;
  const { request, receipt } = prepare(f);
  assert.deepEqual(Object.keys(receipt).sort(), ['type', 'operationId', 'grantId', 'epoch', 'deadline'].sort());
  assert.equal(receipt.operationId, OP); assert.equal(receipt.deadline, request.deadline); assert.equal(receipt.epoch, before + 1);
  assert.match(receipt.grantId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(f.core.state.grant, null); assert.ok(f.core.state.prepared);
  assert.deepEqual(f.store.load().prepared, f.core.state.prepared); assert.equal(f.store.load().epoch, receipt.epoch);
  assert.equal(controls(f.s).some(v => v.type === 'grant' || v.type === 'prepared'), false);
  assert.equal(controls(f.l).some(v => v.type === 'grant' || v.type === 'prepared'), false);
});

test('even a malicious speaker with the staged envelope cannot forward media before activation', () => {
  const f = fixture(), { staged } = prepare(f);
  assert.throws(() => f.core.message(f.s, frame(staged)));
  assert.throws(() => f.core.message(f.l, frame(staged)));
  assert.equal(binaries(f.l).length, 0); assert.equal(f.core.state.grant, null);
  assert.equal(f.core.state.prepared.sequence, 0, 'rejected early media cannot advance the staged sequence');
  const joined = f.add('listener', { subject: 'late_listener' });
  assert.deepEqual(controls(joined).map(v => v.type), ['ready'], 'discovery cannot leak a prepared grant');
});

test('exact activation commits the original immutable v1 grant and then permits media', () => {
  const f = fixture(), { receipt, staged } = prepare(f);
  f.advance(1000); command(f, f.c, activation(receipt));
  const g = f.core.state.grant;
  assert.ok(g); assert.ok(!f.core.state.prepared); assert.equal(g.epoch, staged.epoch); assert.equal(g.grantId, staged.grantId);
  assert.equal(g.deadline, staged.deadline); assert.equal(g.subject, f.s.subject);
  assert.deepEqual(f.store.load().grant, g); assert.ok(!f.store.load().prepared);
  const expected = { type: 'grant', grantId: g.grantId, epoch: g.epoch, subject: f.s.subject, deadline: g.deadline };
  for (const p of [f.c, f.s, f.l]) assert.deepEqual(controls(p).filter(v => v.type === 'grant'), [expected]);
  assert.equal(f.core.message(f.s, frame(g)), 1); assert.equal(binaries(f.l).length, 1);
});

test('same preparation is idempotent across delay without epoch, identity or deadline renewal', () => {
  const f = fixture(), { request, receipt, staged } = prepare(f, { deadline: 1_014_000 });
  f.advance(1000); command(f, f.c, request);
  assert.deepEqual(controls(f.c).filter(v => v.type === 'prepared'), [receipt, receipt]);
  assert.deepEqual(f.core.state.prepared, staged); assert.equal(f.core.state.epoch, receipt.epoch);
  assert.equal(f.core.state.grant, null); assert.deepEqual(f.store.load().prepared, staged);
});

test('conflicting prepare cannot replace an existing reservation or extend its deadline', () => {
  for (const change of [{ operationId: OTHER_OP }, { subject: 'other_speaker' }, { deadline: 1_014_001 }]) {
    const f = fixture(), { request, staged } = prepare(f, { deadline: 1_014_000 });
    assert.throws(() => command(f, f.c, { ...request, ...change }));
    assert.deepEqual(f.core.state.prepared, staged); assert.equal(f.core.state.epoch, staged.epoch);
    assert.equal(f.core.state.grant, null);
  }
});

test('speaker and listener cannot prepare or activate even with an exact leaked receipt', () => {
  for (const role of ['s', 'l']) {
    const f = fixture();
    assert.throws(() => command(f, f[role], preparation(f)));
    assert.ok(!f.core.state.prepared); assert.equal(f.core.state.epoch, 0);
    const { receipt, staged } = prepare(f);
    assert.throws(() => command(f, f[role], activation(receipt)));
    assert.equal(f.core.state.grant, null); assert.deepEqual(f.core.state.prepared, staged);
  }
});

test('malformed preparation identity and deadline fields cannot reserve an epoch', () => {
  const fields = [
    { operationId: undefined }, { operationId: OP.toUpperCase() }, { operationId: 'not-a-uuid' },
    { operationId: null }, { operationId: 1 }, { subject: undefined }, { subject: '../speaker' }, { subject: null },
    { deadline: undefined }, { deadline: '1015000' }, { deadline: 1_000_000 }, { deadline: 999_999 },
    { deadline: 1_015_001 }, { deadline: 1_014_999.5 }, { deadline: -1 }, { deadline: null },
    { deadline: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const change of fields) {
    const f = fixture();
    assert.throws(() => command(f, f.c, preparation(f, change)), JSON.stringify(change));
    assert.ok(!f.core.state.prepared); assert.equal(f.core.state.grant, null); assert.equal(f.core.state.epoch, 0);
  }
});

test('preparation deadline must fit both peers authorization and cannot be silently extended or capped', () => {
  for (const role of ['c', 's']) {
    const f = fixture(); f[role].expires = f.now() + 500;
    assert.throws(() => command(f, f.c, preparation(f, { deadline: f.now() + 501 })));
    assert.ok(!f.core.state.prepared); assert.equal(f.core.state.epoch, 0);
    const { receipt } = prepare(f, { deadline: f.now() + 500 });
    assert.equal(receipt.deadline, f[role].expires, 'exact authorization boundary accepted unchanged');
  }
});

test('activation rejects every mismatched or missing fixed receipt field without activating', () => {
  for (const change of [
    { operationId: OTHER_OP }, { operationId: undefined }, { operationId: OP.toUpperCase() },
    { grantId: '00000000-0000-4000-8000-ffffffffffff' }, { grantId: undefined },
    { epoch: 0 }, { epoch: 2 }, { epoch: '1' }, { epoch: undefined },
    { deadline: 1_015_001 }, { deadline: 1_014_999 }, { deadline: '1015000' }, { deadline: undefined },
  ]) {
    const f = fixture(), { receipt, staged } = prepare(f);
    assert.throws(() => command(f, f.c, { ...activation(receipt), ...change }), JSON.stringify(change));
    assert.equal(f.core.state.grant, null); assert.deepEqual(f.core.state.prepared, staged);
    assert.equal(controls(f.s).some(v => v.type === 'grant'), false);
  }
});

test('repeated exact active activation only acknowledges the controller without rebroadcast or extension', () => {
  const f = fixture(), { receipt } = prepare(f); command(f, f.c, activation(receipt));
  const g = structuredClone(f.core.state.grant);
  const speakerMessages = structuredClone(f.s.messages), listenerMessages = structuredClone(f.l.messages);
  f.advance(1000); command(f, f.c, activation(receipt));
  assert.deepEqual(f.core.state.grant, g); assert.deepEqual(f.s.messages, speakerMessages); assert.deepEqual(f.l.messages, listenerMessages);
  assert.equal(controls(f.c).filter(v => v.type === 'grant').length, 2);
  const expected = { type: 'grant', grantId: g.grantId, epoch: g.epoch, subject: g.subject, deadline: g.deadline };
  assert.deepEqual(controls(f.c).at(-1), expected);
  f.advance(14_000); assert.throws(() => command(f, f.c, activation(receipt)));
  assert.throws(() => f.core.message(f.s, frame(g))); assert.equal(binaries(f.l).length, 0);
});

test('exact fixed deadline is enforced at activation without waiting for cleanup', () => {
  for (const delta of [15_000, 15_001, 60_000]) {
    const f = fixture(), { receipt, staged } = prepare(f); f.advance(delta);
    assert.throws(() => command(f, f.c, activation(receipt)));
    assert.equal(f.core.state.grant, null); assert.throws(() => f.core.message(f.s, frame(staged)));
    assert.equal(binaries(f.l).length, 0); assert.equal(f.core.state.epoch, staged.epoch);
  }
});

test('revocation cancels staged admission and old activation cannot resurrect it', () => {
  const f = fixture(), { receipt, staged } = prepare(f);
  command(f, f.c, { type: 'revoke' });
  assert.ok(!f.core.state.prepared); assert.ok(!f.store.load().prepared); assert.equal(f.core.state.grant, null);
  assert.throws(() => command(f, f.c, activation(receipt))); assert.throws(() => f.core.message(f.s, frame(staged)));
  const next = prepare(f, { operationId: OTHER_OP });
  assert.equal(next.receipt.epoch, receipt.epoch + 1); assert.notEqual(next.receipt.grantId, receipt.grantId);
  assert.throws(() => command(f, f.c, activation(receipt)));
  assert.deepEqual(f.core.state.prepared, next.staged);
});

test('controller or speaker disconnect cancels preparation; fresh same-subject sockets cannot inherit it', () => {
  for (const role of ['c', 's']) {
    const f = fixture(), { receipt, staged } = prepare(f), old = f[role];
    f.core.disconnect(old, 'synthetic cancelled peer');
    assert.ok(!f.core.state.prepared); assert.ok(!f.store.load().prepared); assert.equal(f.core.state.epoch, receipt.epoch);
    const replacement = f.add(old.role, { subject: old.subject });
    const controller = role === 'c' ? replacement : f.c;
    assert.throws(() => command(f, controller, activation(receipt)));
    assert.throws(() => f.core.message(role === 's' ? replacement : f.s, frame(staged)));
    assert.equal(binaries(f.l).length, 0);
  }
});

test('activation rechecks both peer liveness and authorization without relying on a disconnect callback', () => {
  for (const role of ['c', 's']) {
    for (const invalidate of [p => { p.alive = false; }, p => { p.expires = 1_000_000; }, p => { p.version++; }]) {
      const f = fixture(), { receipt, staged } = prepare(f); invalidate(f[role]);
      assert.throws(() => command(f, f.c, activation(receipt)));
      assert.equal(f.core.state.grant, null); assert.throws(() => f.core.message(f.s, frame(staged)));
      assert.equal(binaries(f.l).length, 0);
    }
  }
});

test('cleanup expires the prepared lease durably and never revives its reserved epoch', () => {
  const f = fixture(), { receipt } = prepare(f); f.advance(15_000); f.core.cleanup();
  assert.ok(!f.core.state.prepared); assert.ok(!f.store.load().prepared); assert.equal(f.core.state.epoch, receipt.epoch);
  assert.throws(() => command(f, f.c, activation(receipt)));
  const next = prepare(f, { operationId: OTHER_OP }); assert.equal(next.receipt.epoch, receipt.epoch + 1);
});

test('actor reconstruction retires a durable preparation rather than granting or restoring it', () => {
  const f = fixture(), { receipt, staged } = prepare(f);
  const resumed = new RelayCore(f.store, f.peers, f.now, () => '00000000-0000-4000-8000-eeeeeeeeeeee');
  assert.ok(!resumed.state.prepared); assert.ok(!f.store.load().prepared); assert.equal(resumed.state.grant, null);
  assert.equal(resumed.state.epoch, receipt.epoch);
  assert.throws(() => resumed.message(f.c, JSON.stringify(activation(receipt))));
  assert.throws(() => resumed.message(f.s, frame(staged))); assert.equal(binaries(f.l).length, 0);
  resumed.message(f.c, JSON.stringify(preparation(f, { operationId: OTHER_OP })));
  assert.equal(resumed.state.prepared.epoch, receipt.epoch + 1);
});

test('prepared reservation and old immediate grant cannot overwrite each other', () => {
  const f = fixture(), { staged } = prepare(f);
  assert.throws(() => command(f, f.c, { type: 'grant', subject: f.s.subject }));
  assert.deepEqual(f.core.state.prepared, staged); assert.equal(f.core.state.grant, null);
  const active = fixture(); command(active, active.c, { type: 'grant', subject: active.s.subject });
  const old = structuredClone(active.core.state.grant);
  assert.equal(active.core.message(active.s, frame(old)), 1, 'legacy immediate grant retains v1 behavior');
  assert.throws(() => command(active, active.c, preparation(active)));
  assert.deepEqual(active.core.state.grant, { ...old, sequence: 1, frames: 1 }); assert.ok(!active.core.state.prepared);
});

test('durable epoch exhaustion prevents a staged lease without allocating a receipt', () => {
  const f = fixture(); f.core.state.epoch = 0xffffffff;
  assert.throws(() => command(f, f.c, preparation(f)));
  assert.ok(!f.core.state.prepared); assert.equal(f.core.state.grant, null);
  assert.equal(controls(f.c).some(v => v.type === 'prepared'), false);
});

test('prepare cannot succeed without an active speaker and cannot publish an unpersisted receipt', () => {
  const missing = fixture(); missing.core.disconnect(missing.s, 'synthetic absent speaker');
  assert.throws(() => command(missing, missing.c, preparation(missing)));
  assert.ok(!missing.core.state.prepared); assert.equal(missing.core.state.epoch, 0);
  const failed = fixture(); failed.store.save = () => { throw new Error('synthetic metadata failure'); };
  assert.throws(() => command(failed, failed.c, preparation(failed)), /synthetic metadata failure/);
  assert.equal(controls(failed.c).some(v => v.type === 'prepared'), false, 'receipt must follow durable reservation');
  assert.equal(failed.core.state.grant, null);
  assert.equal(controls(failed.s).some(v => v.type === 'grant'), false);
});

test('uncertain preparation persistence cannot later return an unpersisted idempotent receipt', () => {
  const f = fixture(), request = preparation(f), persist = f.store.save;
  f.store.save = () => { throw new Error('synthetic metadata failure'); };
  assert.throws(() => command(f, f.c, request), /synthetic metadata failure/);
  f.store.save = persist;
  assert.throws(() => command(f, f.c, request), 'same actor must remain fenced after uncertain persistence');
  assert.equal(controls(f.c).some(v => v.type === 'prepared'), false);
  assert.equal(controls(f.s).some(v => v.type === 'grant'), false);
});

test('uncertain activation persistence cannot authorize in-memory media even if caller catches the failure', () => {
  const f = fixture(), { receipt, staged } = prepare(f);
  f.store.save = () => { throw new Error('synthetic metadata failure'); };
  assert.throws(() => command(f, f.c, activation(receipt)), /synthetic metadata failure/);
  assert.throws(() => f.core.message(f.s, frame(staged)), 'storage uncertainty must fence media inside Core');
  assert.equal(binaries(f.l).length, 0);
  assert.equal(controls(f.s).some(v => v.type === 'grant'), false);
});
