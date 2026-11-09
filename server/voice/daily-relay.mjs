// Server-only candidate transport. This is deliberately not connected to the
// public voice actions. Provider observations are not active-media acceptance.
// See docs/voice-daily-candidate-0.8.0.md for the durable orchestration boundary.
import { randomUUID } from 'node:crypto';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roomName = /^nv_[0-9a-f]{32}$/;
const api = 'https://api.daily.co/v1';
const unavailable = () => ({ granted: false, renewed: false, revoked: false, status: 503, code: 'DAILY_ACCEPTANCE_NOT_VERIFIED' });
const denied = () => ({ prepared: false, code: 'DAILY_REQUEST_UNAVAILABLE' });
const audioOnly = () => ({ base: { audio: true, video: false, screenAudio: false, screenVideo: false,
 customAudio: { '*': false }, customVideo: { '*': false } } });
const permissions = publisher => ({ canSend: publisher ? ['audio'] : false,
 canReceive: publisher ? { base: false } : audioOnly(), canAdmin: false, hasPresence: true });

export function createDailyLeaseCandidate({ url, apiKey, fetchImpl = fetch, clock = Date.now, timeoutMs = 1500 } = {}) {
 let origin;
 try { origin = new URL(url); } catch { throw TypeError('Owned Daily domain required'); }
 if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.daily\.co$/.test(origin.hostname) || origin.username ||
     origin.password || origin.port || origin.pathname !== '/' || origin.search || origin.hash) throw TypeError('Owned Daily domain required');
 if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(apiKey)) throw TypeError('Server Daily credential required');
 if (typeof fetchImpl !== 'function' || typeof clock !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000) {
  throw TypeError('Bounded Daily transport required');
 }
 const plans = new WeakMap();
 const byRoom = new Map();
 const closedUntil = new Map();
 const credentials = new WeakMap();
 const now = () => {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Daily clock unavailable');
  return value;
 };
 function valid(plan) {
  return plan?.provider === 'daily' && uuid.test(plan.leaseId) && uuid.test(plan.publisherIdentity) &&
   Number.isSafeInteger(plan.generation) && plan.generation > 0 && roomName.test(plan.roomId) &&
   plan.roomUrl === `${origin.origin}/${plan.roomId}` && typeof plan.expiresAt === 'string' &&
   Number.isSafeInteger(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) % 1000 === 0;
 }
 function live(plan) {
  const remaining = Date.parse(plan.expiresAt) - now();
  return valid(plan) && remaining > 0 && remaining <= 15000;
 }
 function roomProperties(plan) {
  return { exp: Date.parse(plan.expiresAt) / 1000, eject_at_room_exp: true, enable_knocking: false, sfu_switchover: 0.5,
   enforce_unique_user_ids: true, start_audio_off: true, start_video_off: true, enable_screenshare: false,
   permissions: { canSend: false, canReceive: { base: false }, canAdmin: false, hasPresence: true } };
 }
 function matchesRoom(room, plan) {
  const config = room?.config, expected = roomProperties(plan);
  return room?.name === plan.roomId && room?.url === plan.roomUrl && room?.privacy === 'private' && config &&
   Object.entries(expected).every(([key, value]) => key === 'permissions' || config[key] === value) &&
   config.permissions?.canSend === false && config.permissions?.canAdmin === false &&
   config.permissions?.canReceive?.base === false && config.permissions?.hasPresence === true;
 }
 function samePlan(one, two) {
  return ['provider', 'leaseId', 'publisherIdentity', 'generation', 'roomId', 'roomUrl', 'expiresAt'].every(key => one?.[key] === two?.[key]);
 }
 async function bounded(work, externalSignal) {
  const aborter = new AbortController();
  let timer, onAbort;
  try {
   return await Promise.race([
    Promise.resolve().then(() => {
     if (aborter.signal.aborted) throw Error('Daily request unavailable');
     return work(aborter.signal);
    }),
    new Promise((_, reject) => { timer = setTimeout(() => { aborter.abort(); reject(Error('Daily request unavailable')); }, timeoutMs); }),
    new Promise((_, reject) => {
     if (!externalSignal) return;
     onAbort = () => { aborter.abort(); reject(Error('Daily request unavailable')); };
     externalSignal.addEventListener('abort', onAbort, { once: true });
     if (externalSignal.aborted) onAbort();
    })
   ]);
  } finally {
   clearTimeout(timer);
   if (onAbort) externalSignal.removeEventListener('abort', onAbort);
  }
 }
 async function request(path, method, body, signal) {
  if (signal.aborted) throw Error('Daily request unavailable');
  const response = await fetchImpl(`${api}${path}`, { method, redirect: 'error', cache: 'no-store', signal,
   headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) {
   // Never surface provider bodies, which may echo credentials or identity data.
   await response.body?.cancel();
   return { status: response.status, body: null };
  }
  return { status: response.status, body: await response.json() };
 }
 return Object.freeze({
  readiness() {
   return { configured: true, revocationMode: 'unverified-immutable-room', revocationVerified: false,
    leaseEnforced: false, workerDeathVerified: false, workerAt: null, transportEvidence: 'NOT_RUN' };
  },
  // Persist this unique plan against the exact database operation BEFORE making
  // any provider request. A new attempt gets a new name. No restore-create API:
  // after a process restart, reconcile/delete the saved plan and start anew.
  planLease({ leaseId, publisherIdentity, generation, expiresAt } = {}) {
   const at = now(), until = Date.parse(expiresAt);
   if (!uuid.test(leaseId) || !uuid.test(publisherIdentity) || !Number.isSafeInteger(generation) || generation < 1 ||
       typeof expiresAt !== 'string' || !Number.isFinite(until) || until <= at || until > at + 15000) {
    throw TypeError('Fresh authorized Daily lease of at most fifteen seconds required');
   }
   // Daily uses integral Unix seconds. Never round up beyond the SQL lease.
   const exp = Math.floor(until / 1000) * 1000;
   if (exp <= at || exp / 1000 > 2147483647) throw TypeError('Unexpired Daily deadline required');
   const roomId = `nv_${randomUUID().replaceAll('-', '')}`;
   // Keep at most still-live plans indexed for serialized crash-cleanup races.
   // Original objects retain their one-shot state in the WeakMap after pruning.
   for (const [name, previous] of byRoom) if (Date.parse(previous.expiresAt) <= at) {
    plans.set(previous, 'closed'); credentials.delete(previous); byRoom.delete(name);
   }
   for (const [name, until] of closedUntil) if (until <= at) closedUntil.delete(name);
   const plan = Object.freeze({ provider: 'daily', leaseId, publisherIdentity, generation, roomId,
    roomUrl: `${origin.origin}/${roomId}`, expiresAt: new Date(exp).toISOString() });
   plans.set(plan, 'planned');
   byRoom.set(roomId, plan);
   return plan;
  },
  async createLeaseRoom(plan, { signal: externalSignal } = {}) {
   if (plans.get(plan) !== 'planned' || !live(plan)) return denied();
   // Mark attempted before awaiting. Neither a timeout nor a second caller may
   // recreate this room later, including after deletion. No automatic retries.
   plans.set(plan, 'attempted');
   try {
    return await bounded(async signal => {
     const properties = roomProperties(plan);
     const result = await request('/rooms', 'POST', { name: plan.roomId, privacy: 'private', properties }, signal);
     if (result.status !== 200 || !matchesRoom(result.body, plan) ||
         !live(plan) || signal.aborted || plans.get(plan) !== 'attempted') throw Error('Daily preparation unavailable');
     plans.set(plan, 'prepared');
     return { prepared: true, lease: plan, mediaTerminationVerified: false };
    }, externalSignal);
   } catch { return denied(); }
  },
  // Restore only an existing room after restart; this method NEVER creates or
  // updates a resource. The caller first reads its exact authorized SQL plan.
  async inspectLeaseRoom(saved, { signal: externalSignal } = {}) {
   if (externalSignal?.aborted || !valid(saved) || !live(saved) || closedUntil.has(saved.roomId)) return denied();
   const existing = byRoom.get(saved.roomId);
   if (existing) return samePlan(existing, saved) && plans.get(existing) === 'prepared'
    ? { prepared: true, lease: existing, mediaTerminationVerified: false } : denied();
   const plan = Object.freeze({ ...saved });
   plans.set(plan, 'inspecting'); byRoom.set(plan.roomId, plan);
   try {
    return await bounded(async signal => {
     const result = await request(`/rooms/${plan.roomId}`, 'GET', undefined, signal);
     if (result.status !== 200 || !matchesRoom(result.body, plan) || !live(plan) || signal.aborted ||
         plans.get(plan) !== 'inspecting' || closedUntil.has(plan.roomId)) throw Error('Daily inspection unavailable');
     plans.set(plan, 'prepared');
     return { prepared: true, lease: plan, mediaTerminationVerified: false };
    }, externalSignal);
   } catch {
    plans.set(plan, 'closed');
    if (byRoom.get(plan.roomId) === plan) byRoom.delete(plan.roomId);
    return denied();
   }
  },
  // Internal credential only. Authorize each audience member freshly, and keep
  // publisher credentials private until exact operation/generation commit.
  async mintCredential(plan, { identity, role } = {}, { signal: externalSignal } = {}) {
   if (externalSignal?.aborted || plans.get(plan) !== 'prepared' || !live(plan) || !uuid.test(identity) || !['publisher', 'listener'].includes(role) ||
       (role === 'publisher' ? identity !== plan.publisherIdentity : identity === plan.publisherIdentity)) {
    return { credential: null, code: 'DAILY_CREDENTIAL_UNAVAILABLE' };
   }
   const cacheKey = `${role}:${identity}`;
   const cached = credentials.get(plan)?.get(cacheKey);
   if (cached) return { credential: cached, role };
   try {
    return await bounded(async signal => {
     const properties = { room_name: plan.roomId, user_id: identity, is_owner: false, exp: Date.parse(plan.expiresAt) / 1000,
      eject_at_token_exp: true, start_audio_off: true, start_video_off: true, start_cloud_recording: false,
      auto_start_transcription: false, permissions: permissions(role === 'publisher') };
     const result = await request('/meeting-tokens', 'POST', { properties }, signal);
     const token = result.body?.token;
     if (result.status !== 200 || typeof token !== 'string' || token.length > 16384 ||
         !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ||
         !live(plan) || signal.aborted || plans.get(plan) !== 'prepared') throw Error('Daily credential unavailable');
     const credential = Object.freeze({ provider: 'daily', leaseId: plan.leaseId, generation: plan.generation,
      roomId: plan.roomId, roomUrl: plan.roomUrl,
      identity, token, expiresAt: plan.expiresAt });
     if (!credentials.has(plan)) credentials.set(plan, new Map());
     credentials.get(plan).set(cacheKey, credential);
     return { credential, role };
    }, externalSignal);
   } catch { return { credential: null, code: 'DAILY_CREDENTIAL_UNAVAILABLE' }; }
  },
  // Accept a saved trusted database plan for crash cleanup, even after expiry.
  // A DELETE acknowledgement and absent resource are control-plane evidence;
  // they do not establish synchronous SFU termination or strict preemption.
  async deleteLeaseRoom(plan, { signal: externalSignal } = {}) {
   if (!valid(plan)) return { deleted: false, absenceObserved: false, code: 'INVALID_DAILY_ROOM' };
   const canonical = byRoom.get(plan.roomId);
   if (canonical) { plans.set(canonical, 'closed'); credentials.delete(canonical); byRoom.delete(plan.roomId); }
   closedUntil.set(plan.roomId, Date.parse(plan.expiresAt));
   try {
    return await bounded(async signal => {
     const path = `/rooms/${plan.roomId}`;
     const removed = await request(path, 'DELETE', undefined, signal);
     if (removed.status !== 200 || removed.body?.deleted !== true || removed.body?.name !== plan.roomId) {
      throw Error('Daily deletion unacknowledged');
     }
     const absent = await request(path, 'GET', undefined, signal);
     if (absent.status !== 404 || signal.aborted) throw Error('Daily deletion not observed');
     return { deleted: true, absenceObserved: true, mediaTerminationVerified: false };
    }, externalSignal);
   } catch { return { deleted: false, absenceObserved: false, code: 'DAILY_DELETION_UNCONFIRMED' }; }
  },
  // Deliberately not a drop-in grant/revoke adapter. The current controller ACK
  // contract requires proof stronger than this candidate can currently supply.
  async grant() { return unavailable(); },
  async renew() { return unavailable(); },
  async revoke() { return unavailable(); },
  transportEvidence: 'NOT_RUN'
 });
}
