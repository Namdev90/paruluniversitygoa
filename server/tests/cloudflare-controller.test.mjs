import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareController } from '../voice/cloudflare-controller.mjs';
import { RelayCore } from '../relay-v1/src/core.mjs';
import { validateClaims } from '../relay-v1/src/auth.mjs';
import { createCloudflareIssuer } from '../voice/cloudflare-issuer.mjs';

const OP = '11111111-1111-4111-8111-111111111111';
const LEASE = '22222222-2222-4222-8222-222222222222';
const PUBLISHER = '33333333-3333-4333-8333-333333333333';
const CONTROLLER = '44444444-4444-4444-8444-444444444444';
const GRANT = '55555555-5555-4555-8555-555555555555';
const caps = ['clock-v1', 'staged-grant-v1', 'scoped-control-v1'];
function fixture(options = {}) {
 let time = 1_000_000, persisted = null, core, controllerPeer, opened = 0, closes = 0, minted = 0;
 let transform = x => x, clockTransform = x => x, stalled = false, failSave = false, heldResponses = null;
 let probeStatus = 200, probeHeaders = { 'Cache-Control': 'no-store, private', 'X-Navrang-Relay-Capabilities': caps.join(', ') };
 const peers = new Map(), sent = [], probes = [], connections = [];
 const store = { load: () => structuredClone(persisted), save: value => { if (failSave) throw Error('synthetic persistence failure'); persisted = structuredClone(value); } };
 core = new RelayCore(store, peers, () => time, () => GRANT);
 const makePeer = (id, subject, role, send) => {
  let alive = true;
  return { id, subject, role, room: 'nr_' + LEASE.replaceAll('-', ''), version: 1, jti: 'synthetic_' + id, expires: time + 300000,
   open: () => alive, close: () => { alive = false; }, persist: () => {}, send };
 };
 const speaker = makePeer('speaker', PUBLISHER, 'speaker', () => {}); core.connect(speaker);
 const plan = { provider: 'navrang-relay-v1', leaseId: LEASE, publisherIdentity: PUBLISHER, generation: 1,
  roomId: 'nr_' + LEASE.replaceAll('-', ''), origin: 'https://relay.example.test', expiresAt: new Date(time + 15000).toISOString() };
 const issuer = { configured: () => true, mintControllerCredential: async (p, request) => { minted++;
  return { credential: { ...p, identity: request.identity, role: request.role, token: 'synthetic-controller-token' } }; } };
 const connector = {
  clock: async request => { probes.push(request); const value = clockTransform({ version: 1, nonce: request.headers['X-Navrang-Time-Nonce'], serverTime: time });
   return new Response(JSON.stringify(value), { status: probeStatus, headers: probeHeaders }); },
  connect: async request => { opened++; connections.push(request);
   controllerPeer = makePeer('controller-' + opened, CONTROLLER, 'controller', data => {
    if (stalled) return;
    const value = transform(JSON.parse(data));
    const response=typeof value === 'string' ? value : JSON.stringify(value);
    if(heldResponses)heldResponses.push(()=>request.onMessage(response));else request.onMessage(response);
   });
   const token=request.headers.Authorization.slice(7);
   if(token.split('.').length===3){
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
    Object.assign(controllerPeer,validateClaims(claims,'fixture-issuer',new URL(request.url).pathname.split('/')[3],time));
   }
   core.connect(controllerPeer);
   return { send: data => { sent.push(JSON.parse(data)); core.message(controllerPeer, data); },
    close: () => { closes++; core.disconnect(controllerPeer, 'synthetic closed'); request.onClose(); } };
  },
 };
 const qualification = () => ({ configured: true, leaseEnforced: true, workerDeathVerified: true, revocationVerified: true,
  revocationMode: 'guarded-admission', workerAt: time, capabilities: caps });
 const settings={ connector, issuer, origin: plan.origin, controllerIdentity: CONTROLLER, enabled: true,
  qualification, clock: () => time, nonce: () => 'a'.repeat(32), timeoutMs: 30, ...options };
 const adapter=createCloudflareController(settings);
 return { adapter, restart: overrides=>createCloudflareController({...settings,...overrides}), plan, core: () => core, speaker, peers, sent, probes, connections, store,
  prepare: () => adapter.prepare(plan, { operationId: OP, subject: PUBLISHER, deadline: Date.parse(plan.expiresAt) }),
  setTransform: fn => { transform = fn; }, setClockTransform: fn => { clockTransform = fn; },
  setProbe: (status, headers) => { probeStatus = status; probeHeaders = headers; }, stall: () => { stalled = true; },
  holdResponses:()=>{heldResponses=[];},flushResponses:()=>{const pending=heldResponses;heldResponses=null;for(const deliver of pending??[])deliver();},
  advance: ms => { time += ms; }, time: () => time, failSave: () => { failSave = true; },
  reconstruct: () => { core = new RelayCore(store, peers, () => time, () => GRANT); },
  counts: () => ({ opened, closes, minted }), controller: () => controllerPeer };
}
const scope = (type, receipt) => ({ type, ...Object.fromEntries(['operationId', 'grantId', 'epoch', 'deadline'].map(k => [k, receipt[k]])) });

test('disabled default and unqualified readiness never mint or connect', async () => {
 const f = fixture({ enabled: false }); assert.equal((await f.adapter.readiness()).configured, false);
 await assert.rejects(f.prepare()); assert.deepEqual(f.counts(), { opened: 0, closes: 0, minted: 0 });
 const q = fixture({ qualification: {} }); await assert.rejects(q.prepare()); assert.equal(q.counts().opened, 0);
});
test('authenticated clock nonce and capabilities precede one persistent controller across HTTP phases', async () => {
 const f = fixture(), receipt = await f.prepare();
 assert.equal(receipt.mediaTerminationVerified, true); assert.equal(f.core().state.grant, null);
 assert.equal(f.probes[0].url, f.plan.origin + '/v1/rooms/' + f.plan.roomId + '/socket');
 assert.equal(f.connections[0].url, f.probes[0].url.replace('https:', 'wss:'));
 assert.equal(f.probes[0].headers.Authorization, 'Bearer synthetic-controller-token');
 assert.equal(f.connections[0].headers.Authorization, f.probes[0].headers.Authorization);
 assert.equal((await f.adapter.inspect(f.plan, { operationId: OP })).active, false);
 assert.equal((await f.adapter.activate(f.plan, receipt)).active, true);
 assert.equal((await f.adapter.inspect(f.plan)).active, true);
 assert.equal(f.counts().opened, 1); assert.equal(f.counts().minted, 1);
 const revoked = await f.adapter.revoke(f.plan);
 assert.equal(revoked.forwardingStopped, true); assert.equal(revoked.revoked, true);
 assert.equal(f.core().state.grant, null); assert.equal((await f.adapter.inspect(f.plan)).active, false);
 assert.equal((await f.adapter.revoke(f.plan)).revoked, true, 'exact tombstone retry remains bound');
 assert.equal(f.counts().opened, 1); f.adapter.close();
});
test('same preparation is idempotent and fixes grant epoch and deadline', async () => {
 const f = fixture(), first = await f.prepare(); f.advance(1000); const second = await f.prepare();
 assert.deepEqual(second, first); assert.equal(f.core().state.epoch, 1);
 await assert.rejects(f.adapter.prepare(f.plan, { operationId: LEASE, subject: PUBLISHER, deadline: first.deadline }));
 assert.equal(f.counts().opened, 1); f.adapter.close();
});
test('mismatched plan or receipt cannot cross identity generation deadline or operation', async () => {
 const f = fixture(), receipt = await f.prepare();
 for (const change of [{ generation: 2 }, { expiresAt: new Date(receipt.deadline - 1000).toISOString() }, { publisherIdentity: CONTROLLER }, { origin: 'https://other.example.test' }])
  await assert.rejects(f.adapter.activate({ ...f.plan, ...change }, receipt));
 for (const change of [{ operationId: LEASE }, { grantId: LEASE }, { epoch: 2 }, { deadline: receipt.deadline - 1 }, { generation: 2 }])
  await assert.rejects(f.adapter.activate(f.plan, { ...receipt, ...change }));
 assert.equal(f.core().state.grant, null); f.adapter.close();
});
test('forged or legacy receipts never prove a scoped cutoff', async () => {
 for (const mutation of [x => ({ ...x, operationId: LEASE }), x => ({ ...x, deadline: x.deadline + 1 }), x => ({ ...x, forwardingStopped: false }),
  x => ({ type: 'revoked', epoch: x.epoch, reason: 'legacy unbound' })]) {
  const f = fixture(); await f.prepare(); f.setTransform(x => x.type === 'revoked-prepared' ? mutation(x) : x);
  await assert.rejects(f.adapter.revoke(f.plan)); assert.ok(f.counts().closes > 0);
 }
});
test('malformed preparation and wrong controller ready identity fail closed', async () => {
 for (const mutation of [x => ({ ...x, extra: true }), x => ({ ...x, epoch: 0 }), x => ({ ...x, operationId: LEASE })]) {
  const f = fixture(); f.setTransform(x => x.type === 'prepared' ? mutation(x) : x); await assert.rejects(f.prepare());
 }
 const f = fixture(); f.setTransform(x => x.type === 'ready' ? { ...x, subject: PUBLISHER } : x); await assert.rejects(f.prepare());
});
test('wrong clock nonce version or time blocks WSS before connection', async () => {
 for (const mutation of [x => ({ ...x, nonce: 'b'.repeat(32) }), x => ({ ...x, version: 2 }), x => ({ ...x, serverTime: x.serverTime + 1001 }), x => ({ ...x, extra: 1 })]) {
  const f = fixture(); f.setClockTransform(mutation); await assert.rejects(f.prepare()); assert.equal(f.counts().opened, 0);
 }
});
test('timeout and abort close uncertain session with no reconnect or late activation', async () => {
 const f = fixture(), receipt = await f.prepare(); f.stall(); await assert.rejects(f.adapter.activate(f.plan, receipt));
 assert.ok(f.counts().closes > 0); await assert.rejects(f.prepare()); assert.equal(f.counts().opened, 1);
 const g = fixture(), saved = await g.prepare(), aborter = new AbortController(); aborter.abort();
 await assert.rejects(g.adapter.activate(g.plan, saved, { signal: aborter.signal })); assert.equal(g.core().state.grant, null);
});
test('expired active inspection retires durably without treating stale grant as active', async () => {
 const f = fixture(), receipt = await f.prepare(); await f.adapter.activate(f.plan, receipt); f.advance(15000);
 assert.equal((await f.adapter.inspect(f.plan)).active, false); assert.equal(f.core().state.grant, null);
 assert.equal(f.store.load().controlRetired.operationId, OP); f.adapter.close();
});
test('reconstruction preserves exact retirement on same authenticated controller', async () => {
 const f = fixture(), receipt = await f.prepare(); await f.adapter.activate(f.plan, receipt); f.reconstruct();
 assert.equal((await f.adapter.inspect(f.plan)).active, false); assert.equal((await f.adapter.revoke(f.plan)).forwardingStopped, true);
 assert.equal(f.store.load().controlRetired.grantId, receipt.grantId); f.adapter.close();
});
test('storage uncertainty cannot return a cutoff receipt or permit media', async () => {
 const f = fixture(), receipt = await f.prepare(); await f.adapter.activate(f.plan, receipt); f.failSave();
 await assert.rejects(f.adapter.revoke(f.plan)); assert.equal(f.core().storageUncertain, true);
 await assert.rejects(f.adapter.inspect(f.plan));
});
test('scoped core commands reject missing extra mismatched bindings and noncontrollers', async () => {
 const f = fixture(), receipt = await f.prepare(); const good = scope('revoke-prepared', receipt);
 for (const change of [{ operationId: LEASE }, { grantId: LEASE }, { epoch: 2 }, { deadline: good.deadline - 1 }, { extra: true }])
  assert.throws(() => f.core().message(f.controller(), JSON.stringify({ ...good, ...change })));
 const missing = { ...good }; delete missing.operationId; assert.throws(() => f.core().message(f.controller(), JSON.stringify(missing)));
 assert.throws(() => f.core().message(f.speaker, JSON.stringify(good))); assert.ok(f.core().state.prepared);
 f.adapter.close();
});
test('fresh same-subject controller can inspect exact retirement while wrong subject cannot', async () => {
 const f = fixture(), receipt = await f.prepare(); f.adapter.close();
 const p = { ...f.controller(), id: 'replacement', jti: 'fresh_synthetic', flow: undefined, open: () => true, send: () => {}, close: () => {}, persist: () => {} };
 f.core().connect(p); assert.doesNotThrow(() => f.core().message(p, JSON.stringify(scope('inspect', receipt))));
 f.core().disconnect(p);const other={...p,id:'different',jti:'different_synthetic',subject:LEASE};
 f.core().connect(other);assert.throws(()=>f.core().message(other,JSON.stringify(scope('inspect',receipt))));
});
test('legacy revoke remains unchanged and does not manufacture scoped evidence', async () => {
 const f = fixture(); await f.prepare(); f.core().message(f.controller(), JSON.stringify({ type: 'revoke' }));
 assert.equal(f.core().state.grant, null); assert.equal(f.core().state.prepared, null);
 await assert.rejects(f.adapter.revoke(f.plan));
});

test('HTTP absence cacheable clocks or missing scoped capability cannot qualify a controller', async () => {
 for (const [status, headers] of [[404, {}], [200, { 'Cache-Control': 'public', 'X-Navrang-Relay-Capabilities': caps.join(', ') }],
  [200, { 'Cache-Control': 'no-store', 'X-Navrang-Relay-Capabilities': 'clock-v1, staged-grant-v1' }]]) {
  const f = fixture(); f.setProbe(status, headers); await assert.rejects(f.prepare()); assert.equal(f.counts().opened, 0);
 }
});
test('controller ready timeout remains bounded and rejects reuse', async () => {
 const f = fixture(); f.stall(); await assert.rejects(f.prepare()); assert.ok(f.counts().closes > 0);
 await assert.rejects(f.prepare()); assert.equal(f.counts().opened, 1);
});
test('persistent controller cannot accept concurrent uncorrelated operations', async () => {
 const f = fixture(), receipt = await f.prepare(); f.stall();
 const pending = f.adapter.activate(f.plan, receipt); await new Promise(resolve => setImmediate(resolve));
 await assert.rejects(f.adapter.inspect(f.plan)); await assert.rejects(pending); assert.equal(f.counts().opened, 1);
});
test('same-turn controller exchanges reserve their slot before asynchronous dispatch',async()=>{
 const f=fixture({timeoutMs:500});await f.prepare();f.holdResponses();
 const pending=Promise.allSettled([f.adapter.inspect(f.plan),f.adapter.inspect(f.plan)]);
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.sent.filter(x=>x.type==='inspect').length,1,'only one uncorrelated request may be sent');
 }finally{f.flushResponses();}
 const results=await pending;
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal(f.counts().closes,0,'rejecting contention must preserve the first request');
 assert.equal((await f.adapter.inspect(f.plan)).active,false,'the slot is released when the exchange settles');f.adapter.close();
});
test('clock rollback and closed controller never reopen or renew authority', async () => {
 const f = fixture(); await f.prepare(); f.advance(-1); await assert.rejects(f.adapter.inspect(f.plan));
 f.adapter.close(); assert.equal((await f.adapter.readiness()).configured, false); await assert.rejects(f.prepare());
});
test('scoped tombstone survives expiry cleanup and preserves exact immutable identity', async () => {
 const f = fixture(), receipt = await f.prepare(); f.advance(15000); f.core().cleanup();
 const state = f.store.load(); assert.equal(state.controlRetired.operationId, OP); assert.equal(state.controlRetired.deadline, receipt.deadline);
 assert.equal((await f.adapter.revoke(f.plan)).forwardingStopped, true); f.adapter.close();
});
test('configured room capacity is bounded without evicting uncertain bindings', async () => {
 const f = fixture({ maxRooms: 1 }); await f.prepare();
 const lease = '66666666-6666-4666-8666-666666666666';
 const other = { ...f.plan, leaseId: lease, roomId: 'nr_' + lease.replaceAll('-', '') };
 await assert.rejects(f.adapter.prepare(other, { operationId: OP, subject: PUBLISHER, deadline: Date.parse(other.expiresAt) }));
 assert.equal(f.counts().opened, 1); f.adapter.close();
});
test('stale or incomplete qualification never becomes media-termination evidence', async () => {
 for (const changed of [{ workerAt: 996999 }, { workerDeathVerified: false }, { leaseEnforced: false }, { revocationVerified: false }, { capabilities: ['clock-v1'] }]) {
  const f = fixture({ qualification: { configured: true, leaseEnforced: true, workerDeathVerified: true, revocationVerified: true,
   revocationMode: 'guarded-admission', workerAt: 1000000, capabilities: caps, ...changed } });
  await assert.rejects(f.prepare()); assert.equal(f.counts().minted, 0);
 }
});
test('oversized authenticated clock body is rejected before WSS and receipts never expose controller token', async () => {
 const f = fixture(); f.setClockTransform(x => ({ ...x, excessive: 'x'.repeat(4096) }));
 await assert.rejects(f.prepare()); assert.equal(f.counts().opened, 0);
 const g = fixture(), receipt = await g.prepare(); assert.equal(JSON.stringify(receipt).includes('synthetic-controller-token'), false); g.adapter.close();
});
test('media expiry retains unacknowledged cleanup binding instead of evicting it', async () => {
 const f=fixture({maxRooms:1});await f.prepare();f.advance(15000);
 const lease='77777777-7777-4777-8777-777777777777';
 const next={...f.plan,leaseId:lease,roomId:'nr_'+lease.replaceAll('-',''),expiresAt:new Date(f.time()+15000).toISOString()};
 await assert.rejects(f.adapter.prepare(next,{operationId:LEASE,subject:PUBLISHER,deadline:Date.parse(next.expiresAt)}));
 assert.equal((await f.adapter.revoke(f.plan)).forwardingStopped,true);f.adapter.close();
});
test('actual private issuer TTL permits exact cleanup after media expiry and remains authorization bounded', async () => {
 const issuer=createCloudflareIssuer({key:{type:'private',extractable:false,algorithm:{name:'Ed25519'},usages:['sign']},
  issuer:'fixture-issuer',kid:'fixture-key',origin:'https://relay.example.test',clock:()=>1000000,
  randomId:()=> 'synthetic-controller-jti',enabled:true,subtle:{sign:async()=>new Uint8Array(64)}});
 const f=fixture({issuer}), receipt=await f.prepare();await f.adapter.activate(f.plan,receipt);
 assert.equal(f.controller().expires,1060000);assert.equal(receipt.deadline,1015000);
 f.advance(15000);assert.equal((await f.adapter.inspect(f.plan)).active,false);
 assert.equal((await f.adapter.revoke(f.plan)).forwardingStopped,true);
 f.advance(45000);await assert.rejects(f.adapter.revoke(f.plan),'controller authorization expiry cannot be inferred as cutoff proof');
});

test('process cache loss and actor reconstruction recover exact retirement without granting authority',async()=>{
 const f=fixture(),receipt=await f.prepare();await f.adapter.activate(f.plan,receipt);f.adapter.close();f.reconstruct();f.advance(15000);
 const restarted=f.restart();const inspected=await restarted.inspect(f.plan,{operationId:OP});
 assert.equal(inspected.active,false);assert.equal(inspected.receipt.grantId,receipt.grantId);assert.equal(f.core().state.grant,null);
 assert.equal((await restarted.revoke(f.plan)).forwardingStopped,true);assert.equal(f.counts().opened,2);restarted.close();
});
test('restart recovery rejects wrong operation deadline publisher and unknown room with no absence ACK',async()=>{
 for(const change of [{publisherIdentity:LEASE},{expiresAt:new Date(1014000).toISOString()},
  {leaseId:OP,roomId:'nr_'+OP.replaceAll('-','')}]){
  const f=fixture();await f.prepare();f.adapter.close();const restarted=f.restart();
  await assert.rejects(restarted.revoke({...f.plan,...change}));restarted.close();
 }
 const f=fixture();await f.prepare();f.adapter.close();const restarted=f.restart();
 await assert.rejects(restarted.inspect(f.plan,{operationId:LEASE}));restarted.close();
});
test('stale admission heartbeat permits exact cleanup but withdrawn cutoff qualification does not ACK',async()=>{
 let proof={configured:true,leaseEnforced:true,workerDeathVerified:true,revocationVerified:true,revocationMode:'guarded-admission',workerAt:1000000,capabilities:caps};
 const f=fixture({qualification:()=>proof});await f.prepare();proof={...proof,workerAt:900000,configured:false};
 assert.equal((await f.adapter.revoke(f.plan)).forwardingStopped,true);
 proof={...proof,revocationVerified:false};await assert.rejects(f.adapter.revoke(f.plan));f.adapter.close();
});
test('room discovery rejects another controller subject, different authenticated room and ambiguous records',async()=>{
 const f=fixture(),receipt=await f.prepare();f.adapter.close();f.reconstruct();
 const request={type:'inspect-room',subject:PUBLISHER,deadline:receipt.deadline};
 const other={...f.controller(),id:'different-owner',subject:LEASE,jti:'different-owner-jti',flow:undefined,open:()=>true,close:()=>{},send:()=>{},persist:()=>{}};
 f.core().connect(other);assert.throws(()=>f.core().message(other,JSON.stringify(request)));f.core().disconnect(other);
 const messages=[],owner={...other,id:'same-owner',subject:CONTROLLER,jti:'same-owner-jti',room:'other_room',send:x=>messages.push(JSON.parse(x))};
 f.core().connect(owner);assert.throws(()=>f.core().message(owner,JSON.stringify(request)));
 owner.room=f.plan.roomId;f.core().message(owner,JSON.stringify(request));assert.equal(messages.at(-1).type,'room-inspected');
 assert.equal(f.core().state.grant,null,'discovery never grants or activates media');
 f.core().state.prepared={...f.core().state.controlRetired,grantId:LEASE,epoch:receipt.epoch+1};
 assert.throws(()=>f.core().message(owner,JSON.stringify(request)),'multiple distinct matching records are not guessed');
});
