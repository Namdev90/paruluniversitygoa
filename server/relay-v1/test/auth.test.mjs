// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate,validateClaims } from '../src/auth.mjs';
const now=1000000;
const claims={iss:'local-test-issuer',aud:'navrang-relay-v1',sub:'subject',room:'room',role:'speaker',authVersion:1,jti:'synthetic-claim-id',iat:1000,exp:1100};
test('missing verification configuration rejects with503 before allocation',async()=>{
  await assert.rejects(authenticate(new Request('https://local.invalid'),{},'room',now),e=>e.status===503);
});
test('missing Authorization fails closed, no credentials or tokens generated',async()=>{
  await assert.rejects(authenticate(new Request('https://local.invalid'),{AUTH_ISSUER:'issuer',AUTH_PUBLIC_KEY_JWK:'{}'},'room',now),e=>e.status===401);
});
test('verified-claim boundary validation binds room, issuer, subject, role and expiration',()=>{
  assert.equal(validateClaims(claims,claims.iss,'room',now).subject,'subject');
  for(const override of [{room:'other'},{iss:'other'},{aud:'other'},{sub:''},{role:'admin'},{authVersion:0},{exp:1000},{iat:1001},{exp:1301},{jti:'bad.dot'},{exp:1e30}])assert.throws(()=>validateClaims({...claims,...override},claims.iss,'room',now));
});
