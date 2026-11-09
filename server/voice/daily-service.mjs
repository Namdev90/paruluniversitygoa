// Existing authenticated action handler. No public endpoint, credentials or
// readiness switch is created here. The real candidate relay stays disabled.
import { voiceReadiness } from '../functions/navrang-gate/voice-control.mjs';

const actions = new Set(['duty-join', 'duty-heartbeat', 'duty-leave', 'voice-join', 'voice-floor',
 'voice-renew', 'voice-release', 'voice-broadcast-start', 'voice-broadcast-end', 'voice-invite']);
const cleanup = new Set(['duty-leave', 'voice-release', 'voice-broadcast-end']);
const unavailable = () => ({ error: 'Voice is unavailable. Rejoin when communications are ready.', status: 503 });
const planKeys = ['provider', 'leaseId', 'publisherIdentity', 'generation', 'roomId', 'roomUrl', 'expiresAt'];
export const sameDailyPlan = (one, two) => !!one && !!two && planKeys.every(key => one[key] !== undefined && one[key] === two[key]);
export function strictDailyDeletion(result, plan) {
 return plan?.provider === 'daily' && /^nv_[a-f0-9]{32}$/.test(plan.roomId) && typeof plan.leaseId === 'string' &&
  Number.isSafeInteger(plan.generation) && plan.generation > 0 && Number.isFinite(Date.parse(plan.expiresAt)) &&
  result?.provider === 'daily' && result.deleted === true && result.absenceObserved === true &&
  result.mediaTerminationVerified === true && ['roomId', 'leaseId', 'generation', 'expiresAt'].every(key => result[key] === plan?.[key]);
}
function credentialMatches(credential, plan, identity) {
 return credential?.provider === 'daily' && typeof credential.token === 'string' && credential.token.length > 0 &&
  credential.identity === identity && ['roomId', 'roomUrl', 'leaseId', 'generation', 'expiresAt'].every(key => credential[key] === plan?.[key]);
}
export function createDailyVoiceService({ rpc, relay, clock = Date.now, timeoutMs = 1500, budgetMs = 12000 } = {}) {
 if (typeof rpc !== 'function' || !relay || !['readiness', 'planLease', 'createLeaseRoom', 'inspectLeaseRoom', 'mintCredential', 'deleteLeaseRoom']
  .every(key => typeof relay[key] === 'function') || typeof clock !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
  !Number.isInteger(budgetMs) || budgetMs < timeoutMs || budgetMs > 12000) throw TypeError('Bounded private Daily service required');
 async function handle(action, payload, actorToken, { signal: externalSignal } = {}) {
  if (!actions.has(action)) return { error: 'Unknown voice action.', status: 400 };
  if (typeof actorToken !== 'string' || !/^[a-f0-9]{64}$/.test(actorToken)) return { error: 'Sign in first.', status: 401 };
  const began = performance.now();
  async function bounded(work, recovery = false) {
   const remaining = recovery ? timeoutMs : budgetMs - (performance.now() - began);
   if (remaining <= 0 || (!recovery && externalSignal?.aborted)) throw Error('Voice operation stopped');
   const aborter = new AbortController(); let timer, rejectAbort;
   const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
   const abort = () => { aborter.abort(); rejectAbort(Error('Voice operation stopped')); };
   if (!recovery) externalSignal?.addEventListener('abort', abort, { once: true });
   try {
    timer = setTimeout(abort, Math.min(timeoutMs, remaining));
    return await Promise.race([Promise.resolve().then(() => {
     if (aborter.signal.aborted) throw Error('Voice operation stopped');
     return work(aborter.signal);
    }), interrupted]);
   } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
  }
  const call = (name, p, recovery = false) => bounded(signal => rpc(name, p, actorToken, { signal }), recovery);
  const ready = async () => voiceReadiness(await bounded(() => relay.readiness()), clock()).ready;
  const live = plan => Number.isFinite(Date.parse(plan?.expiresAt)) && Date.parse(plan.expiresAt) > clock() && Date.parse(plan.expiresAt) <= clock() + 15000;
  let operation, plan, attempted = false;
  try {
   // Ending intent always reaches authorized SQL even when the provider is down.
   if (cleanup.has(action)) return await call(action, payload);
   if (!await ready()) return unavailable();
   if (['duty-join', 'duty-heartbeat', 'voice-invite'].includes(action)) return await call(action, payload);
   if (action === 'voice-join') {
    const joined = await call('voice-join', payload);
    if (joined?.error) return joined;
    const before = await call('daily-receive', payload);
    if (before?.error) return before;
    if (['idle', 'speaking'].includes(before?.state)) return { state: before.state, dutyId: before.dutyId,
     sessionId: before.sessionId, serverTime: before.serverTime, dutyExpiresAt: before.dutyExpiresAt,
     generation: before.plan?.generation ?? null, leaseId: before.plan?.leaseId ?? null, receive: null };
    if (before?.state !== 'listening' || !live(before.plan)) return unavailable();
    const inspected = await bounded(signal => relay.inspectLeaseRoom(before.plan, { signal }));
    if (inspected?.prepared !== true || !sameDailyPlan(inspected.lease, before.plan)) return unavailable();
    const minted = await bounded(signal => relay.mintCredential(inspected.lease, { identity: before.identity, role: 'listener' }, { signal }));
    if (!credentialMatches(minted?.credential, before.plan, before.identity)) return unavailable();
    // A room can rotate or a listener can lose duty/role while token minting is
    // in flight. Never return a credential based only on the earlier check.
    const after = await call('daily-receive', payload);
    if (after?.error || after?.state !== 'listening' || after.identity !== before.identity || after.dutyId !== before.dutyId ||
        after.sessionId !== before.sessionId || !sameDailyPlan(after.plan, before.plan) || !live(after.plan) || !await ready()) return unavailable();
    return { state: 'listening', sessionId: after.sessionId, dutyId: after.dutyId, serverTime: after.serverTime,
     dutyExpiresAt: after.dutyExpiresAt, generation: after.plan.generation, leaseId: after.plan.leaseId, receive: minted.credential };
   }
   const prepare = action === 'voice-floor' ? 'floor-prepare' : action === 'voice-renew' ? 'daily-renew-prepare' : 'voice-broadcast-start';
   // Public renewal has only sessionId/leaseId. That server-issued old lease is
   // also a stable private request key, so a network retry cannot rotate twice.
   const preparePayload = action === 'voice-renew' ? { ...payload, requestId: payload.leaseId } : payload;
   operation = await call(prepare, preparePayload);
   if (operation?.error) return operation;
   if (!operation?.operationId || !operation.sessionId || !operation.dutyId || !Number.isSafeInteger(operation.generation)) throw Error('Invalid floor operation');
   if (operation.state === 'active') {
    // Retrying a committed request can recover its original room without ever
    // recreating it or extending its credential deadline.
    if (!live(operation.plan)) throw Error('Expired floor');
    const inspected = await bounded(signal => relay.inspectLeaseRoom(operation.plan, { signal }));
    if (inspected?.prepared !== true || !sameDailyPlan(inspected.lease, operation.plan)) throw Error('Invalid floor');
    plan = inspected.lease;
   } else {
    if (operation.state !== 'granting' || !Array.isArray(operation.revoke) || operation.revoke.length > 32) throw Error('Invalid floor');
    for (const previous of operation.revoke) {
     if (!previous.commandId || !previous.plan || previous.plan.provider !== 'daily') throw Error('Mixed relay removal is unavailable');
     const result = await bounded(signal => relay.deleteLeaseRoom(previous.plan, { signal }));
     if (!strictDailyDeletion(result, previous.plan)) throw Error('Strict room removal unverified');
     const acked = await call('daily-ack', { operationId: operation.operationId, commandId: previous.commandId,
      generation: previous.generation, plan: previous.plan, receipt: result });
     if (acked?.state !== 'acked') throw Error('Room removal receipt rejected');
    }
    if (!await ready()) throw Error('Relay readiness lost');
    plan = relay.planLease({ leaseId: operation.leaseId, publisherIdentity: operation.identity,
     generation: operation.generation, expiresAt: operation.expiresAt });
    const saved = await call('daily-plan', { operationId: operation.operationId, generation: operation.generation, plan });
    if (saved?.error || !sameDailyPlan(saved?.plan, plan) || !live(plan)) throw Error('Durable room plan rejected');
    attempted = true;
    const created = await bounded(signal => relay.createLeaseRoom(plan, { signal }));
    if (created?.prepared !== true || created.mediaTerminationVerified !== true || !sameDailyPlan(created.lease, plan) || !live(plan)) {
     throw Error('Relay-owned expiry unverified');
    }
    const receipt = { provider: 'daily', roomId: plan.roomId, leaseId: plan.leaseId, generation: plan.generation,
     expiresAt: plan.expiresAt, mediaTerminationVerified: true, grantVerified: true };
    const committed = await call('daily-commit', { operationId: operation.operationId, generation: operation.generation, plan, receipt });
    if (committed?.error || committed?.state !== 'active' || committed.leaseId !== plan.leaseId || committed.generation !== plan.generation ||
        Date.parse(committed.expiresAt) !== Date.parse(plan.expiresAt) || !live(plan)) throw Error('Floor commit rejected');
   }
   const minted = await bounded(signal => relay.mintCredential(plan, { identity: plan.publisherIdentity, role: 'publisher' }, { signal }));
   if (!credentialMatches(minted?.credential, plan, plan.publisherIdentity)) throw Error('Publisher credential unavailable');
   const current = await call('daily-receive', { dutyId: operation.dutyId, sessionId: operation.sessionId });
   if (current?.error || current?.state !== 'speaking' || current.identity !== plan.publisherIdentity || !sameDailyPlan(current.plan, plan) ||
       !live(plan) || !await ready()) throw Error('Publisher authority changed');
   return { state: 'active', sessionId: operation.sessionId, dutyId: operation.dutyId, serverTime: current.serverTime,
    generation: plan.generation, leaseId: plan.leaseId, expiresAt: plan.expiresAt, transmit: minted.credential };
  } catch {
   if (operation?.operationId && Number.isSafeInteger(operation.generation)) {
    // Compensation never substitutes for durable reconciliation. Even if the
    // client disconnected, enqueue the failure using its freshly checked actor.
    if (plan && attempted) try { await bounded(signal => relay.deleteLeaseRoom(plan, { signal }), true); } catch {}
    try { await call('floor-fail', { operationId: operation.operationId, generation: operation.generation, ambiguousGrant: attempted }, true); } catch {}
    // A token-mint failure after commit is still a release, not a continued
    // floor with an unobserved owner. SQL verifies exact lease ownership.
    if (plan) try { await call('voice-release', { sessionId: operation.sessionId, leaseId: plan.leaseId }, true); } catch {}
   }
   return unavailable();
  }
 }
 return Object.freeze({ supports: action => actions.has(action), handle, transportEvidence: 'NOT_RUN' });
}
