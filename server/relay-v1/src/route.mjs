// SPDX-License-Identifier: MIT
import { AuthError } from './auth.mjs';

export function routeRoom(request) {
  const url = new URL(request.url);
  return url.search ? null : /^\/v1\/rooms\/([A-Za-z0-9_-]{1,64})\/socket$/.exec(url.pathname)?.[1] ?? null;
}
export const websocketRequest = request => request.headers.get('Upgrade')?.toLowerCase() === 'websocket';
export function timeNonce(request) {
  const nonce = request.headers.get('X-Navrang-Time-Nonce');
  return /^[a-f0-9]{32}$/.test(nonce ?? '') ? nonce : null;
}
const unavailable = status => new Response('Unavailable or unauthorized', { status });

/** Same authenticated room route; clock reads never allocate before JWT verification. */
export async function routeRequest(request, env, { authenticate, forward }) {
  if (typeof authenticate !== 'function' || typeof forward !== 'function') throw TypeError('Authenticated room dependencies required');
  const room = routeRoom(request);
  if (!room) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET') return new Response('GET required', { status: 426 });
  if (!websocketRequest(request)) {
    if (request.headers.has('Upgrade')) return new Response('WebSocket required', { status: 426 });
    if (!timeNonce(request)) return new Response('Fresh clock nonce required', { status: 400 });
  }
  try {
    await authenticate(request, env, room);
    return await forward(room, request);
  } catch (failure) {
    return unavailable(failure instanceof AuthError && [401, 403, 503].includes(failure.status) ? failure.status : 503);
  }
}

/** Timestamp from the same logical Durable Object clock that enforces the grant.
 * Caller MUST authenticate first. Nonce binding + no-store prevents accepting a
 * cached sample; neither a floor, a role nor a grant is created or extended.
 */
export function clockResponse(core, request) {
  const nonce = timeNonce(request);
  if (request.method !== 'GET' || request.headers.has('Upgrade') || !nonce) return new Response('Invalid clock request', { status: 400 });
  try {
    const serverTime = core.now();
    if (!Number.isSafeInteger(serverTime) || serverTime < 0) throw Error('Invalid clock');
    return Response.json({ version: 1, nonce, serverTime }, {
      headers: { 'Cache-Control': 'no-store, private', 'Pragma': 'no-cache',
        'X-Navrang-Relay-Capabilities': 'clock-v1, staged-grant-v1, scoped-control-v1' }
    });
  } catch { return unavailable(503); }
}
