// SPDX-License-Identifier: MIT
import { identifier } from './protocol.mjs';
export class AuthError extends Error { constructor(status) { super('authorization rejected'); this.status = status; } }
function decode(s) {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new AuthError(401);
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export function validateClaims(c, issuer, room, now) {
  if (!c || c.iss !== issuer || c.aud !== 'navrang-relay-v1' || c.room !== room || !identifier(c.sub) || !identifier(c.room) || !identifier(c.jti, 128) || !['controller','speaker','listener'].includes(c.role) || !Number.isSafeInteger(c.authVersion) || c.authVersion < 1 || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.iat * 1000 > now || c.exp * 1000 <= now || c.exp <= c.iat || c.exp - c.iat > 300 || !Number.isSafeInteger(c.exp * 1000)) throw new AuthError(401);
  return { subject: c.sub, room, role: c.role, version: c.authVersion, jti: c.jti, expires: c.exp * 1000 };
}
export async function authenticate(request, env, room, now = Date.now()) {
  if (!env.AUTH_ISSUER || !env.AUTH_PUBLIC_KEY_JWK) throw new AuthError(503);
  try {
    const header = request.headers.get('Authorization');
    if (!header || header.length > 4096 || !header.startsWith('Bearer ')) throw new AuthError(401);
    const parts = header.slice(7).split('.');
    if (parts.length !== 3) throw new AuthError(401);
    const h = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(parts[0])));
    if (h.alg !== 'EdDSA' || h.typ !== 'JWT' || h.crit !== undefined || h.jku !== undefined || h.jwk !== undefined) throw new AuthError(401);
    const jwk = JSON.parse(env.AUTH_PUBLIC_KEY_JWK);
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || jwk.d !== undefined || typeof jwk.x !== 'string') throw new AuthError(503);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['verify']);
    if (!await crypto.subtle.verify('Ed25519', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new AuthError(401);
    const c = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(parts[1])));
    return validateClaims(c, env.AUTH_ISSUER, room, now);
  } catch (e) { throw e instanceof AuthError ? e : new AuthError(401); }
}
