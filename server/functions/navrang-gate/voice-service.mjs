// Explicit Edge boundary for existing authenticated actions. No provider or
// private SQL transport is discovered here. A configured candidate is not an
// accepted service; the deployed composition deliberately supplies no service.
const actions = new Set(['duty-join', 'duty-heartbeat', 'duty-leave', 'voice-join', 'voice-floor',
 'voice-renew', 'voice-release', 'voice-broadcast-start', 'voice-broadcast-end', 'voice-invite']);
const cleanup = new Set(['duty-leave', 'voice-release', 'voice-broadcast-end']);
const unavailable = () => ({ error: 'Voice is unavailable. Rejoin when communications are ready.', status: 503 });

export function createVoiceServiceBoundary({ rpc, service, timeoutMs = 1500 } = {}) {
 if (typeof rpc !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 ||
     (service !== undefined && (typeof service?.handle !== 'function' || typeof service?.supports !== 'function'))) {
  throw TypeError('Bounded authenticated voice boundary required');
 }
 return Object.freeze({
  supports: action => actions.has(action),
  async handle(action, payload, actorToken, { signal } = {}) {
   if (!actions.has(action)) return { error: 'Unknown voice action.', status: 400 };
   if (typeof actorToken !== 'string' || !/^[a-f0-9]{64}$/.test(actorToken)) return { error: 'Sign in first.', status: 401 };
   if (signal?.aborted) return unavailable();
   let timer, abort;
   const stop = new AbortController();
   try {
    const interrupted = new Promise((_, reject) => {
     abort = () => { stop.abort(); reject(Error('Voice operation unavailable')); };
     signal?.addEventListener('abort', abort, { once: true });
     timer = setTimeout(abort, timeoutMs);
    });
    const result = await Promise.race([Promise.resolve().then(() => {
     if (stop.signal.aborted || signal?.aborted) throw Error('Voice operation unavailable');
     if (service?.supports(action)) return service.handle(action, payload, actorToken, { signal: stop.signal });
     // Ending intent must reach the existing authorized SQL path even when
     // no relay can safely create a room or return a credential.
     if (cleanup.has(action)) return rpc(action, payload, actorToken, { signal: stop.signal });
     return unavailable();
    }), interrupted]);
    if (stop.signal.aborted || signal?.aborted || !result || typeof result !== 'object' || Array.isArray(result)) return unavailable();
    return result;
   } catch { return unavailable(); }
   finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  },
  transportEvidence: 'NOT_RUN'
 });
}
