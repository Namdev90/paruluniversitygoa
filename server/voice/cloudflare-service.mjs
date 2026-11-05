import { voiceReadiness } from '../functions/navrang-gate/voice-control.mjs';

const PROVIDER = 'navrang-relay-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const actions = new Set(['duty-join', 'duty-heartbeat', 'duty-leave', 'voice-join', 'voice-floor',
 'voice-renew', 'voice-release', 'voice-broadcast-start', 'voice-broadcast-end', 'voice-invite']);
const cleanup = new Set(['duty-leave', 'voice-release', 'voice-broadcast-end']);
const keys = ['provider', 'leaseId', 'publisherIdentity', 'generation', 'roomId', 'origin', 'expiresAt'];
const unavailable = () => ({ error: 'Voice is unavailable. Rejoin when communications are ready.', status: 503 });
export const sameCloudflarePlan = (a, b) => !!a && !!b && keys.every(key => a[key] !== undefined && a[key] === b[key]);
function approvedOrigin(value) {
 try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value && !u.port && !u.username && !u.password &&
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(u.hostname) && u.hostname.includes('.') && !/^[0-9.]+$/.test(u.hostname); } catch { return false; }
}
function validPlan(plan, origin) {
 return plan?.provider === PROVIDER && Object.keys(plan).length === keys.length && keys.every(key => Object.hasOwn(plan, key)) &&
  UUID.test(plan.leaseId) && UUID.test(plan.publisherIdentity) && Number.isSafeInteger(plan.generation) && plan.generation > 0 &&
  plan.roomId === 'nr_' + plan.leaseId.replaceAll('-', '') && plan.origin === origin &&
  Number.isSafeInteger(Date.parse(plan.expiresAt)) && Date.parse(plan.expiresAt) % 1000 === 0;
}
export function strictCloudflareRevocation(result, plan) {
 return validPlan(plan, plan?.origin) && approvedOrigin(plan.origin) && result?.provider === PROVIDER && result.revoked === true &&
  result.forwardingStopped === true && result.mediaTerminationVerified === true &&
  ['roomId', 'leaseId', 'generation', 'expiresAt'].every(key => result[key] === plan[key]);
}
function credentialMatches(credential, plan, identity, role) {
 return credential?.provider === PROVIDER && credential.identity === identity && credential.role === role &&
  typeof credential.token === 'string' && credential.token.length > 0 && credential.token.length <= 4096 &&
  ['roomId', 'origin', 'leaseId', 'generation', 'expiresAt'].every(key => credential[key] === plan[key]);
}
function receiptMatches(receipt, plan, operationId) {
 return receipt?.provider === PROVIDER && receipt.prepared === true && receipt.mediaTerminationVerified === true &&
  receipt.operationId === operationId && UUID.test(receipt.grantId) && Number.isSafeInteger(receipt.epoch) && receipt.epoch > 0 && receipt.epoch <= 0xffffffff &&
  receipt.deadline === Date.parse(plan.expiresAt) && ['roomId', 'leaseId', 'generation', 'expiresAt'].every(key => receipt[key] === plan[key]);
}
function sqlReceipt(receipt) {
 return Object.fromEntries(['provider', 'roomId', 'leaseId', 'generation', 'expiresAt', 'prepared', 'grantId', 'epoch', 'mediaTerminationVerified']
  .map(key => [key, receipt[key]]));
}

/** Private actor-bound bridge. No network client, issuer, signing key or enabled provider is created here.
 * relay owns controller connections; issuer owns configured native-only credential issuance.
 * Both are injected and must pass explicit readiness before any admission descriptor is returned.
 */
export function createCloudflareVoiceService({ rpc, relay, issuer, origin, clock = Date.now, timeoutMs = 1500, budgetMs = 12000 } = {}) {
 if (typeof rpc !== 'function' || typeof clock !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
  !Number.isInteger(budgetMs) || budgetMs < timeoutMs || budgetMs > 12000 || origin !== undefined && !approvedOrigin(origin))
  throw TypeError('Bounded private relay service required');
 const configured = () => approvedOrigin(origin) && relay && ['readiness', 'inspect', 'prepare', 'activate', 'revoke'].every(k => typeof relay[k] === 'function') &&
  issuer && typeof issuer.configured === 'function' && typeof issuer.mintCredential === 'function' && issuer.configured() === true;
 async function handle(action, payload = {}, actorToken, { signal: externalSignal } = {}) {
  if (!actions.has(action)) return { error: 'Unknown voice action.', status: 400 };
  if (typeof actorToken !== 'string' || !/^[a-f0-9]{64}$/.test(actorToken)) return { error: 'Sign in first.', status: 401 };
  const began = performance.now(); let operation, plan, attempted = false;
  async function bounded(work, recovery = false) {
   const remaining = recovery ? timeoutMs : budgetMs - (performance.now() - began);
   if (remaining <= 0 || !recovery && externalSignal?.aborted) throw Error('Voice operation stopped');
   const aborter = new AbortController(); let timer, rejectAbort;
   const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
   const abort = () => { aborter.abort(); rejectAbort(Error('Voice operation stopped')); };
   if (!recovery) externalSignal?.addEventListener('abort', abort, { once: true });
   try {
    timer = setTimeout(abort, Math.min(timeoutMs, remaining));
    return await Promise.race([Promise.resolve().then(() => { if (aborter.signal.aborted) throw Error('Voice operation stopped'); return work(aborter.signal); }), interrupted]);
   } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
  }
  const call = (name, value, recovery = false) => bounded(signal => rpc(name, value, actorToken, { signal }), recovery);
  const live = value => validPlan(value, origin) && Date.parse(value.expiresAt) > clock() && Date.parse(value.expiresAt) <= clock() + 15000;
  const ready = async () => {
   if (!configured()) return false;
   const evidence = await bounded(signal => relay.readiness({ signal }));
   return voiceReadiness(evidence, clock()).ready && Array.isArray(evidence.capabilities) &&
    ['clock-v1', 'staged-grant-v1'].every(value => evidence.capabilities.includes(value));
  };
  const mint = async (value, identity, role) => {
   const result = await bounded(signal => issuer.mintCredential(value, { identity, role }, { signal }));
   if (!credentialMatches(result?.credential, value, identity, role)) throw Error('Native credential binding rejected');
   return result.credential;
  };
  const operationMatches = value => value && UUID.test(value.operationId) && UUID.test(value.sessionId) && UUID.test(value.dutyId) &&
   UUID.test(value.identity) && UUID.test(value.leaseId) && Number.isSafeInteger(value.generation) && value.generation > 0;
  try {
   // Local ending intent reaches the existing authorization/cleanup queue even without an issuer or relay.
   if (cleanup.has(action)) return await call(action, payload);
   if (!await ready()) return unavailable();
   if (['duty-join', 'duty-heartbeat', 'voice-invite'].includes(action)) return await call(action, payload);
   if (action === 'voice-join') {
    const joined = await call('voice-join', payload); if (joined?.error) return joined;
    const before = await call('relay-receive', payload); if (before?.error) return before;
    if (['idle', 'speaking'].includes(before?.state)) return { state: before.state, sessionId: before.sessionId, dutyId: before.dutyId,
     serverTime: before.serverTime, dutyExpiresAt: before.dutyExpiresAt, leaseId: before.plan?.leaseId ?? null,
     generation: before.plan?.generation ?? null, receive: null };
    if (before?.state !== 'listening' || !live(before.plan)) throw Error('No active receiving authority');
    const inspected = await bounded(signal => relay.inspect(before.plan, {}, { signal }));
    if (inspected?.active !== true || !sameCloudflarePlan(inspected.plan, before.plan)) throw Error('Relay floor not active');
    const credential = await mint(before.plan, before.identity, 'listener');
    const after = await call('relay-receive', payload);
    if (after?.error || after?.state !== 'listening' || after.identity !== before.identity || after.dutyId !== before.dutyId ||
     after.sessionId !== before.sessionId || !sameCloudflarePlan(after.plan, before.plan) || !live(after.plan) || !await ready()) throw Error('Receiving authority changed');
    return { state: 'listening', sessionId: after.sessionId, dutyId: after.dutyId, serverTime: after.serverTime,
     dutyExpiresAt: after.dutyExpiresAt, leaseId: after.plan.leaseId, generation: after.plan.generation, receive: credential };
   }
   const phase = payload.phase ?? 'prepare';
   if (!['prepare', 'commit'].includes(phase) || phase === 'commit' && (!UUID.test(payload.operationId) || !Number.isSafeInteger(payload.generation) || payload.generation < 1))
    return { error: 'Invalid relay phase.', status: 400 };
   // Private SQL accepts no public phase fields. Commit uses an exact read-only lookup, never a new acquisition.
   const prepareAction = action === 'voice-renew' ? 'relay-renew-prepare' : action === 'voice-broadcast-start' ? 'voice-broadcast-start' : 'floor-prepare';
   const { phase: ignoredPhase, operationId: ignoredOperation, generation: ignoredGeneration, ...original } = payload;
   const preparePayload = action === 'voice-renew' ? { ...original, requestId: original.leaseId } : original;
   operation = await call(phase === 'commit' ? 'relay-operation' : prepareAction, phase === 'commit' ?
    { operationId: payload.operationId, generation: payload.generation, sessionId: payload.sessionId } : preparePayload);
   if (operation?.error) return operation;
   if (!operationMatches(operation) || !['granting', 'active'].includes(operation.state) ||
    phase === 'commit' && (operation.operationId !== payload.operationId || operation.generation !== payload.generation)) throw Error('Stale floor operation');
   if (operation.plan) {
    plan = operation.plan;
    if (!live(plan) || plan.leaseId !== operation.leaseId || plan.publisherIdentity !== operation.identity || plan.generation !== operation.generation) throw Error('Invalid saved plan');
   } else {
    if (operation.state !== 'granting' || phase === 'commit') throw Error('Previously persisted provisional plan required');
    const expiry = Math.floor(Date.parse(operation.expiresAt) / 1000) * 1000;
    if (!Number.isSafeInteger(expiry)) throw Error('Invalid lease deadline');
    plan = { provider: PROVIDER, leaseId: operation.leaseId, publisherIdentity: operation.identity, generation: operation.generation,
     roomId: 'nr_' + operation.leaseId.replaceAll('-', ''), origin, expiresAt: new Date(expiry).toISOString() };
    const saved = await call('relay-plan', { operationId: operation.operationId, generation: operation.generation, plan });
    if (saved?.error || saved?.state !== 'granting' || saved.operationId !== operation.operationId || saved.generation !== operation.generation ||
     saved.sessionId !== operation.sessionId || saved.dutyId !== operation.dutyId || saved.identity !== operation.identity ||
     saved.leaseId !== operation.leaseId || !sameCloudflarePlan(saved?.plan, plan) || !live(plan)) throw Error('Immutable relay plan not persisted');
   }
   if (phase === 'prepare') {
    // Provisional room admission permits time sampling/socket initialization only; Core has no live grant yet.
    const credential = await mint(plan, plan.publisherIdentity, 'speaker');
    const current = await call(prepareAction, preparePayload);
    if (current?.error || !['granting', 'active'].includes(current.state) || !operationMatches(current) || current.operationId !== operation.operationId || current.generation !== plan.generation ||
     current.dutyId !== operation.dutyId || current.sessionId !== operation.sessionId || current.identity !== plan.publisherIdentity ||
     !sameCloudflarePlan(current.plan, plan) || !live(plan) || !await ready()) throw Error('Provisional admission changed');
    return { state: 'prepared', operationId: operation.operationId, sessionId: operation.sessionId, dutyId: operation.dutyId,
     generation: plan.generation, leaseId: plan.leaseId, expiresAt: plan.expiresAt, serverTime: current.serverTime, transmit: credential };
   }
   if (operation.state === 'granting') {
    if (!Array.isArray(operation.revoke) || operation.revoke.length > 32) throw Error('Invalid removal list');
    for (const old of operation.revoke) {
     if (!UUID.test(old.commandId) || !validPlan(old.plan, origin)) throw Error('Mixed provider removal unavailable');
     const result = await bounded(signal => relay.revoke(old.plan, { signal }));
     if (!strictCloudflareRevocation(result, old.plan)) throw Error('Strict room removal unverified');
     const acked = await call('relay-ack', { operationId: operation.operationId, commandId: old.commandId, generation: old.generation, plan: old.plan, receipt: result });
     if (acked?.state !== 'acked') throw Error('Removal acknowledgement rejected');
    }
   }
   attempted = true;
   let receipt;
   if (operation.state === 'active') {
    const inspected = await bounded(signal => relay.inspect(plan, { operationId: operation.operationId }, { signal }));
    if (!sameCloudflarePlan(inspected?.plan, plan)) throw Error('Relay plan changed');
    receipt = inspected.receipt;
   } else receipt = await bounded(signal => relay.prepare(plan, { operationId: operation.operationId, subject: plan.publisherIdentity, deadline: Date.parse(plan.expiresAt) }, { signal }));
   if (!receiptMatches(receipt, plan, operation.operationId) || !live(plan)) throw Error('Prepared receipt rejected');
   if (operation.state !== 'active') {
    const committed = await call('relay-commit', { operationId: operation.operationId, generation: operation.generation, plan, receipt: sqlReceipt(receipt) });
    if (committed?.error || committed?.state !== 'active' || committed.operationId !== operation.operationId || committed.sessionId !== operation.sessionId ||
     committed.dutyId !== operation.dutyId || committed.identity !== plan.publisherIdentity || !sameCloudflarePlan(committed.plan, plan) ||
     committed.leaseId !== plan.leaseId || committed.generation !== plan.generation ||
     Date.parse(committed.expiresAt) !== Date.parse(plan.expiresAt) || !live(plan)) throw Error('Relay floor commit rejected');
   }
   const beforeActivation = await call('relay-receive', { sessionId: operation.sessionId, dutyId: operation.dutyId });
   if (beforeActivation?.error || beforeActivation?.state !== 'speaking' || beforeActivation.identity !== plan.publisherIdentity ||
    beforeActivation.dutyId !== operation.dutyId || beforeActivation.sessionId !== operation.sessionId ||
    !sameCloudflarePlan(beforeActivation.plan, plan) || !live(plan) || !await ready()) throw Error('Activation authority changed');
   const activated = await bounded(signal => relay.activate(plan, receipt, { signal }));
   if (activated?.active !== true || !receiptMatches(activated, plan, operation.operationId) || activated.grantId !== receipt.grantId ||
    activated.epoch !== receipt.epoch || !live(plan)) throw Error('Exact activation unverified');
   const current = await call('relay-receive', { sessionId: operation.sessionId, dutyId: operation.dutyId });
   if (current?.error || current?.state !== 'speaking' || current.identity !== plan.publisherIdentity || current.dutyId !== operation.dutyId ||
    current.sessionId !== operation.sessionId || !sameCloudflarePlan(current.plan, plan) || !live(plan) || !await ready()) throw Error('Committed authority changed');
   return { state: 'active', operationId: operation.operationId, sessionId: operation.sessionId, dutyId: operation.dutyId,
    generation: plan.generation, leaseId: plan.leaseId, expiresAt: plan.expiresAt, serverTime: current.serverTime,
    grant: { grantId: receipt.grantId, epoch: receipt.epoch, deadline: receipt.deadline } };
  } catch {
   if (operationMatches(operation)) {
    if (plan && attempted) try { await bounded(signal => relay.revoke(plan, { signal }), true); } catch {}
    try { await call('floor-fail', { operationId: operation.operationId, generation: operation.generation, ambiguousGrant: attempted }, true); } catch {}
    if (plan) try { await call('voice-release', { sessionId: operation.sessionId, leaseId: plan.leaseId }, true); } catch {}
   }
   return unavailable();
  }
 }
 return Object.freeze({ supports: action => actions.has(action), handle, transportEvidence: 'NOT_RUN' });
}
