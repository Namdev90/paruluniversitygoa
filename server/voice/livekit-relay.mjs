// Server only. Input room/identity must come from fresh authorized database state.
// Protocol references and the deliberately unavailable media grant are described
// in docs/voice-relay-boundary-0.8.0.md. No provider request runs at import time.
const encoder = new TextEncoder();
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const unavailable = () => ({ granted: false, renewed: false, status: 503, code: 'ACTIVE_MEDIA_FAILSAFE_UNAVAILABLE' });
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

export function createLiveKitCloudRelay({ url, apiKey, apiSecret, fetchImpl = fetch, clock = Date.now, timeoutMs = 1500 } = {}) {
 let endpoint;
 try { endpoint = new URL(url); } catch { throw TypeError('Owned LiveKit Cloud endpoint required'); }
 // Self-hosted removal does not invalidate cached tokens. Never silently accept
 // another deployment mode or forward a server credential through a redirect.
 if (!['https:', 'wss:'].includes(endpoint.protocol) || !/^[a-z0-9-]+\.livekit\.cloud$/.test(endpoint.hostname) ||
     endpoint.username || endpoint.password || endpoint.port || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
  throw TypeError('Owned LiveKit Cloud endpoint required');
 }
 if (typeof apiKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(apiKey) ||
     typeof apiSecret !== 'string' || apiSecret.length < 32 || apiSecret.length > 4096) throw TypeError('Server relay credentials required');
 if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2000 || typeof fetchImpl !== 'function' || typeof clock !== 'function') {
  throw TypeError('Bounded relay transport required');
 }
 endpoint.protocol = 'https:';
 let signingKey;
 const seconds = () => {
  const now = clock();
  if (!Number.isSafeInteger(now) || now < 0) throw Error('Relay clock unavailable');
  return Math.floor(now / 1000);
 };
 async function sign(claims) {
  signingKey ??= await crypto.subtle.importKey('raw', encoder.encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = `${base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))}.${base64url(encoder.encode(JSON.stringify(claims)))}`;
  return `${message}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(message))))}`;
 }
 async function bounded(work, externalSignal) {
  const controller = new AbortController();
  let timer, onAbort;
  try {
   return await Promise.race([
    Promise.resolve().then(() => {
     if (controller.signal.aborted) throw Error('Relay request unavailable');
     return work(controller.signal);
    }),
    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Relay request unavailable')); }, timeoutMs); }),
    new Promise((_, reject) => {
     if (!externalSignal) return;
     onAbort = () => { controller.abort(); reject(Error('Relay request unavailable')); };
     externalSignal.addEventListener('abort', onAbort, { once: true });
     if (externalSignal.aborted) onAbort();
    })
   ]);
  } finally {
   clearTimeout(timer);
   if (onAbort) externalSignal.removeEventListener('abort', onAbort);
  }
 }
 return Object.freeze({
  // Credentials establish configuration only. Neither local tests nor a live
  // controller heartbeat establish relay-side expiry or reconnect rejection.
  readiness() {
   return { configured: true, revocationMode: 'cloud-explicit-cutoff', revocationVerified: false,
    leaseEnforced: false, workerDeathVerified: false, workerAt: null, transportEvidence: 'NOT_RUN' };
  },
  async mintReceiveToken({ room, identity, ttlSeconds = 60 } = {}) {
   if (!opaque(room) || !opaque(identity) || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 600) {
    throw TypeError('Authorized opaque membership and token TTL from 1 to 600 seconds required');
   }
   try {
    const now = seconds();
    const token = await sign({ iss: apiKey, sub: identity, nbf: now, exp: now + ttlSeconds,
     video: { room, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false, canUpdateOwnMetadata: false } });
    return { token, expiresAt: new Date((now + ttlSeconds) * 1000).toISOString(), canPublish: false };
   } catch { throw Error('Relay token unavailable'); }
  },
  async revoke({ room, identity, strict, cutoff } = {}, { signal: externalSignal } = {}) {
   if (!opaque(room) || !opaque(identity) || strict !== true) return { revoked: false, code: 'INVALID_REVOCATION' };
   try {
    return await bounded(async signal => {
     const now = seconds();
     if (cutoff !== undefined && (!Number.isSafeInteger(cutoff) || Math.abs(cutoff - now) > 30)) {
      return { revoked: false, code: 'INVALID_REVOCATION' };
     }
     // Cloud compares token nbf < cutoff. Cover both this second and tokens
     // refreshed while the bounded removal request is in flight, not only
     // credentials held when the request began. Remain inside its +/-60s window;
     // actual clock-skew/reconnect verification is still gated.
     const revokeTokenTs = Math.max(now + Math.ceil(timeoutMs / 1000) + 1, cutoff ?? 0);
     const token = await sign({ iss: apiKey, nbf: now, exp: now + 60, video: { room, roomAdmin: true } });
     if (signal.aborted) throw Error('Relay request unavailable');
     const response = await fetchImpl(new URL('/twirp/livekit.RoomService/RemoveParticipant', endpoint).href, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // Protobuf JSON permits int64 as decimal strings. Explicit cutoff also
      // makes already-absent participants successful revocation requests.
      body: JSON.stringify({ room, identity, revoke_token_ts: String(revokeTokenTs) })
     });
     if (!response.ok) { await response.body?.cancel(); return { revoked: false, code: 'RELAY_UNAVAILABLE' }; }
     const body = await response.json();
     if (!body || typeof body !== 'object' || Array.isArray(body) || body.error || body.code || seconds() >= revokeTokenTs) return { revoked: false, code: 'RELAY_UNAVAILABLE' };
     return { revoked: true, cutoff: revokeTokenTs };
    }, externalSignal);
   } catch { return { revoked: false, code: 'RELAY_UNAVAILABLE' }; }
  },
  // A watchdog armed before UpdateParticipant is insufficient: a delayed grant
  // may land after its removal. Only a relay-owned fenced grant/deadline can
  // make that safe. There is intentionally no boolean or callback bypass here.
  async grant() { return unavailable(); },
  async renew() { return unavailable(); },
  transportEvidence: 'NOT_RUN'
 });
}
