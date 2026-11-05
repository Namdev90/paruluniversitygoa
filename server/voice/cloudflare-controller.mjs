import { randomBytes } from 'node:crypto';
import { voiceReadiness } from '../functions/navrang-gate/voice-control.mjs';

const PROVIDER = 'navrang-relay-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CAPABILITIES = ['clock-v1', 'staged-grant-v1', 'scoped-control-v1'];
const PLAN = ['provider', 'leaseId', 'publisherIdentity', 'generation', 'roomId', 'origin', 'expiresAt'];
const BINDING = ['operationId', 'grantId', 'epoch', 'deadline'];
const same = (a, b, keys) => !!a && !!b && keys.every(key => a[key] === b[key]);
function approvedOrigin(value) {
 try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.port && !u.username && !u.password &&
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(u.hostname) && u.hostname.includes('.') && !/^[0-9.]+$/.test(u.hostname); } catch { return false; }
}
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
async function clockBody(response) {
 if(response?.status!==200||typeof response.body?.getReader!=='function')throw Error('Invalid clock response');
 const reader=response.body.getReader();let size=0;const chunks=[];
 try {
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
   if(size>1024){await reader.cancel();throw Error('Clock response bounds');}chunks.push(value);}
 } finally {reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

/** Server-only persistent controller. Connector owns authenticated HTTPS/WSS I/O;
 * issuer owns an already configured private signer. No connection/token is exposed
 * to app callers. Qualification is separate accepted evidence, never inferred from
 * a successful send, socket close, clock response, or a missing HTTP resource.
 */
export function createCloudflareController({ connector, issuer, origin, controllerIdentity, enabled = false,
 qualification = {}, clock = Date.now, timeoutMs = 1000, maxRooms = 32, maxClockSkewMs = 1000,
 nonce = () => randomBytes(16).toString('hex') } = {}) {
 if (typeof enabled !== 'boolean' || typeof clock !== 'function' || typeof nonce !== 'function' ||
  !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 || !Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 128 ||
  !Number.isSafeInteger(maxClockSkewMs) || maxClockSkewMs < 0 || maxClockSkewMs > 1000 || origin !== undefined && !approvedOrigin(origin)) throw TypeError('Invalid bounded controller configuration');
 const rooms = new Map(); let closed = false, lastTime = -1;
 const now = () => { const value = clock(); if (!Number.isSafeInteger(value) || value < lastTime) throw Error('Controller clock invalid'); lastTime = value; return value; };
 const configured = () => !closed && enabled && approvedOrigin(origin) && UUID.test(controllerIdentity) && connector &&
  ['connect', 'clock'].every(key => typeof connector[key] === 'function') && issuer && typeof issuer.configured === 'function' &&
  issuer.configured() === true && typeof issuer.mintControllerCredential === 'function';
 function fail(session) {
  if (!session || session.dead) return;
  session.dead = true;
  const pending = session.pending; session.pending = null; pending?.reject(Error('Controller session unavailable'));
  session.readyReject?.(Error('Controller session unavailable'));
  try { session.socket?.close(1000, 'Controller unavailable'); } catch {}
  // Keep a bounded dead record: uncertain operations cannot reconnect and inherit a grant.
 }
 async function bounded(work, { signal, session } = {}) {
  if (signal?.aborted) { fail(session); throw Error('Controller operation aborted'); }
  const aborter = new AbortController(); let timer, rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => { aborter.abort(); fail(session); rejectAbort(Error('Controller operation stopped')); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
   timer = setTimeout(abort, timeoutMs);
   return await Promise.race([Promise.resolve().then(() => { if (aborter.signal.aborted) throw Error('Controller operation stopped'); return work(aborter.signal); }), interrupted]);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
 }
 async function readiness({ signal } = {}) {
  if (!configured()) return { configured: false, capabilities: [] };
  const evidence = await bounded(() => typeof qualification === 'function' ? qualification() : qualification, { signal });
  return { ...evidence, configured: evidence?.configured === true, capabilities: Array.isArray(evidence?.capabilities) ? [...evidence.capabilities] : [] };
 }
 async function cutoffQualified(signal) {
  if(closed||!enabled)throw Error('Controller unavailable');
  const evidence=await bounded(()=>typeof qualification==='function'?qualification():qualification,{signal});
  // A stale worker heartbeat blocks new admission, not exact cleanup. The
  // independent cutoff qualification itself must still be explicitly valid.
  if(evidence?.leaseEnforced!==true||evidence.workerDeathVerified!==true||evidence.revocationVerified!==true||
   !['cloud-explicit-cutoff','guarded-admission'].includes(evidence.revocationMode)||
   !Array.isArray(evidence.capabilities)||!CAPABILITIES.every(x=>evidence.capabilities.includes(x)))throw Error('Cutoff qualification unavailable');
 }
 async function accepted(signal) {
  const evidence = await readiness({ signal });
  if (!voiceReadiness(evidence, now()).ready || !CAPABILITIES.every(value => evidence.capabilities.includes(value))) throw Error('Relay qualification unavailable');
 }
 function plan(value, live = true) {
  if (!exact(value, PLAN) || value.provider !== PROVIDER || value.origin !== origin || !UUID.test(value.leaseId) || !UUID.test(value.publisherIdentity) ||
   !Number.isSafeInteger(value.generation) || value.generation < 1 || value.roomId !== 'nr_' + value.leaseId.replaceAll('-', '')) throw Error('Invalid controller plan');
  const deadline = Date.parse(value.expiresAt), at = now();
  if (!Number.isSafeInteger(deadline) || deadline % 1000 !== 0 || live && (deadline <= at || deadline > at + 15000)) throw Error('Invalid controller deadline');
  return Object.freeze({ ...value });
 }
 function message(session, event) {
  if (session.dead) return;
  try {
   const data = typeof event === 'string' ? event : event?.data;
   if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 1024) throw Error('Invalid control response');
   const value = JSON.parse(data);
   if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid control response');
   if (value.type === 'ready') {
    if (session.ready || !exact(value, ['type', 'role', 'subject']) || value.role !== 'controller' || value.subject !== controllerIdentity) throw Error('Controller identity mismatch');
    session.ready = true; session.readyResolve(); return;
   }
   // Legacy broadcasts are never treated as scoped cutoff evidence.
   if (value.type === 'revoked') return;
   if (!session.ready || !session.pending) throw Error('Unsolicited control response');
   if (!session.pending.match(value)) throw Error('Control receipt mismatch');
   const pending = session.pending; session.pending = null; pending.resolve(value);
  } catch { fail(session); }
 }
 async function connection(value, signal) {
  const existing = rooms.get(value.roomId);
  if (existing) {
   if (existing.dead || !same(existing.plan, value, PLAN)) throw Error('Controller binding unavailable');
   await existing.opening; return existing;
  }
  // Only expired, immutable leases may release cache capacity. Closing a socket
  // is cleanup, not a returned cutoff receipt, and never authorizes a retry.
  const at = now();
  for(const [room, old] of rooms) if(old.retainUntil<=at){fail(old);rooms.delete(room);}
  if (rooms.size >= maxRooms) throw Error('Controller room capacity');
  const session = { plan: value, retainUntil: at+300000, dead: false, ready: false, socket: null, exchanging: false, pending: null, receipt: null };
  rooms.set(value.roomId, session);
  session.opening = bounded(async operationSignal => {
   const credential = await issuer.mintControllerCredential(value, { identity: controllerIdentity, role: 'controller' }, { signal: operationSignal });
   const c = credential?.credential;
   if (operationSignal.aborted || session.dead || !same(c, value, ['provider', 'roomId', 'origin', 'leaseId', 'generation', 'expiresAt']) ||
    c.identity !== controllerIdentity || c.role !== 'controller' || typeof c.token !== 'string' || !c.token || c.token.length > 4096 || !/^[A-Za-z0-9._-]+$/.test(c.token)) throw Error('Controller credential rejected');
   if(c.authorizationExpiresAt!==undefined){
    const expiry=Date.parse(c.authorizationExpiresAt);
    if(!Number.isSafeInteger(expiry)||expiry<=now()||expiry>now()+300000)throw Error('Controller authorization bound rejected');
    session.retainUntil=expiry;
   }
   const path = '/v1/rooms/' + value.roomId + '/socket', challenge = nonce();
   if (!/^[a-f0-9]{32}$/.test(challenge)) throw Error('Invalid clock nonce');
   const headers = { Authorization: 'Bearer ' + c.token, 'X-Navrang-Time-Nonce': challenge };
   const sent = now();
   const response = await connector.clock({ url: origin + path, headers: { ...headers }, signal: operationSignal });
   const body = await clockBody(response);
   const received = now(), capabilities = response?.headers?.get('X-Navrang-Relay-Capabilities')?.split(',').map(x => x.trim()) ?? [];
   if (operationSignal.aborted || session.dead || !exact(body, ['version', 'nonce', 'serverTime']) || body.version !== 1 || body.nonce !== challenge ||
    !Number.isSafeInteger(body.serverTime) || body.serverTime < sent - maxClockSkewMs || body.serverTime > received + maxClockSkewMs ||
    !/\bno-store\b/i.test(response.headers.get('Cache-Control') ?? '') || !CAPABILITIES.every(k => capabilities.includes(k))) throw Error('Authenticated clock capability rejected');
   const ready = new Promise((resolve, reject) => { session.readyResolve = resolve; session.readyReject = reject; });
   // A failed synchronous ready callback may precede connect() resolution.
   ready.catch(() => {});
   // Install callbacks before opening: the ready message may arrive synchronously.
   const socket = await connector.connect({ url: origin.replace(/^https:/, 'wss:') + path,
    headers: { Authorization: headers.Authorization }, signal: operationSignal,
    onMessage: event => message(session, event), onClose: () => fail(session), onError: () => fail(session) });
   if (operationSignal.aborted || session.dead) { try { socket?.close(1000, 'Controller unavailable'); } catch {} throw Error('Controller connection cancelled'); }
   if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') throw Error('Invalid controller socket');
   session.socket = socket; await ready;
   // Erase the reject hook after the ready promise has a consumer and settled.
   session.readyReject = null;
   return session;
  }, { signal, session }).catch(error => { fail(session); throw error; });
  return session.opening;
 }
 async function exchange(session, request, match, signal) {
  if (session.dead || !session.ready || session.exchanging || session.pending) throw Error('Controller unavailable or busy');
  // Reserve synchronously: bounded() dispatches in a microtask, so checking only
  // pending lets same-turn callers both send and overwrite the receipt consumer.
  session.exchanging = true;
  try {
   return await bounded(() => new Promise((resolve, reject) => {
    session.pending = { resolve, reject, match };
    try { session.socket.send(JSON.stringify(request)); } catch { fail(session); }
   }), { signal, session });
  } finally { session.exchanging = false; }
 }
 const receipt = (value, wire) => Object.freeze({ provider: PROVIDER, prepared: true, mediaTerminationVerified: true,
  operationId: wire.operationId, grantId: wire.grantId, epoch: wire.epoch, deadline: wire.deadline,
  roomId: value.roomId, leaseId: value.leaseId, generation: value.generation, expiresAt: value.expiresAt });
 const bound = (wire, saved) => same(wire, saved, BINDING) && wire.subject === saved.subject;
 const scoped = (type, saved) => ({ type, ...Object.fromEntries(BINDING.map(k => [k, saved[k]])) });
 function saved(value) {
  const session = rooms.get(value.roomId);
  if (!session || session.dead || !same(session.plan, value, PLAN) || !session.receipt) throw Error('Controller preparation unavailable');
  return session;
 }
 async function recover(value, operationId, signal) {
  const session=await connection(value,signal);
  if(session.receipt){if(operationId!==undefined&&session.receipt.operationId!==operationId)throw Error('Recovery operation mismatch');return session;}
  const request={type:'inspect-room',subject:value.publisherIdentity,deadline:Date.parse(value.expiresAt),...(operationId===undefined?{}:{operationId})};
  const wire=await exchange(session,request,x=>x.type==='room-inspected'&&x.room===value.roomId&&x.controllerSubject===controllerIdentity&&
   x.subject===value.publisherIdentity&&x.deadline===request.deadline&&UUID.test(x.operationId)&&UUID.test(x.grantId)&&
   Number.isSafeInteger(x.epoch)&&x.epoch>0&&x.epoch<=0xffffffff&&(operationId===undefined||x.operationId===operationId)&&
   ['prepared','active','revoked'].includes(x.status)&&exact(x,['type',...BINDING,'subject','room','controllerSubject','status',...(x.status==='revoked'?['forwardingStopped']:[])])&&
   (x.status!=='revoked'||x.forwardingStopped===true),signal);
  session.receipt=Object.freeze({type:'prepared',...Object.fromEntries(BINDING.map(k=>[k,wire[k]])),subject:wire.subject});
  return session;
 }
 async function prepare(value, request, { signal } = {}) {
  await accepted(signal); value = plan(value);
  if (!exact(request, ['operationId', 'subject', 'deadline']) || !UUID.test(request.operationId) || request.subject !== value.publisherIdentity || request.deadline !== Date.parse(value.expiresAt)) throw Error('Invalid preparation binding');
  const session = await connection(value, signal);
  if (session.receipt && !same(session.receipt, request, ['operationId', 'subject', 'deadline'])) throw Error('Conflicting controller operation');
  const wire = await exchange(session, { type: 'prepare', ...request }, x => exact(x, ['type', ...BINDING]) && x.type === 'prepared' &&
   x.operationId === request.operationId && x.deadline === request.deadline && UUID.test(x.grantId) && Number.isSafeInteger(x.epoch) && x.epoch > 0 && x.epoch <= 0xffffffff &&
   (!session.receipt || same(x, session.receipt, BINDING)), signal);
  if (now() >= request.deadline) { fail(session); throw Error('Preparation expired'); }
  session.receipt = Object.freeze({ ...wire, subject: request.subject });
  return receipt(value, wire);
 }
 async function activate(value, prepared, { signal } = {}) {
  await accepted(signal); value = plan(value); const session = saved(value), fixed = session.receipt;
  if (!same(prepared, receipt(value, fixed), [...BINDING, 'provider', 'roomId', 'leaseId', 'generation', 'expiresAt']) || prepared.prepared !== true || prepared.mediaTerminationVerified !== true) throw Error('Activation binding mismatch');
  // Grant v1 omits operationId; it is accepted only against this connection's fixed preparation.
  await exchange(session, scoped('activate', fixed), x => exact(x, ['type', 'grantId', 'epoch', 'subject', 'deadline']) && x.type === 'grant' &&
   same(x, fixed, ['grantId', 'epoch', 'deadline', 'subject']), signal);
  if (now() >= fixed.deadline) { fail(session); throw Error('Activation expired'); }
  return { ...receipt(value, fixed), active: true };
 }
 async function inspect(value, request = {}, { signal } = {}) {
  await cutoffQualified(signal); value = plan(value, false);
  if(!exact(request,[])&&(!exact(request,['operationId'])||!UUID.test(request.operationId)))throw Error('Inspection binding mismatch');
  const session = await recover(value,request.operationId,signal), fixed = session.receipt;
  if (!exact(request, []) && (!exact(request, ['operationId']) || request.operationId !== fixed.operationId)) throw Error('Inspection binding mismatch');
  const wire = await exchange(session, scoped('inspect', fixed), x => x.type === 'inspected' && bound(x, fixed) &&
   ['prepared', 'active', 'revoked'].includes(x.status) && exact(x, ['type', ...BINDING, 'subject', 'status', ...(x.status === 'revoked' ? ['forwardingStopped'] : [])]) &&
   (x.status !== 'revoked' || x.forwardingStopped === true), signal);
  if (wire.status !== 'revoked' && now() >= fixed.deadline) { fail(session); throw Error('Inspection expired'); }
  return { plan: { ...value }, active: wire.status === 'active', receipt: { ...receipt(value, fixed), active: wire.status === 'active' } };
 }
 async function revoke(value, { signal } = {}) {
  await cutoffQualified(signal); value = plan(value, false); const session = await recover(value,undefined,signal), fixed = session.receipt;
  await exchange(session, scoped('revoke-prepared', fixed), x => exact(x, ['type', ...BINDING, 'subject', 'status', 'forwardingStopped']) &&
   x.type === 'revoked-prepared' && bound(x, fixed) && x.status === 'revoked' && x.forwardingStopped === true, signal);
  return { provider: PROVIDER, roomId: value.roomId, leaseId: value.leaseId, generation: value.generation, expiresAt: value.expiresAt,
   revoked: true, forwardingStopped: true, mediaTerminationVerified: true };
 }
 function close() { closed = true; for (const session of rooms.values()) fail(session); }
 return Object.freeze({ readiness, prepare, activate, inspect, revoke, close, transportEvidence: 'NOT_RUN' });
}
