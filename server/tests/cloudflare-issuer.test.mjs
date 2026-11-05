import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudflareIssuer} from '../voice/cloudflare-issuer.mjs';
const now=1800000000000;
const plan={provider:'navrang-relay-v1',origin:'https://relay.fixture.invalid',roomId:'nr_'+'a'.repeat(32),leaseId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',publisherIdentity:'speaker',generation:1,expiresAt:new Date(now+10000).toISOString()};
const options={key:{type:'private',extractable:false,algorithm:{name:'Ed25519'},usages:['sign']},issuer:'fixture-issuer',kid:'fixture-key',origin:plan.origin,clock:()=>now,randomId:()=> 'fixture-one-use',enabled:true,subtle:{sign:async()=>new Uint8Array(64)}};
test('issuer defaults unavailable and never discovers a key',async()=>{
 const issuer=createCloudflareIssuer();assert.equal(issuer.configured(),false);
 await assert.rejects(issuer.mintCredential(plan,{identity:'speaker',role:'speaker'}));
});
test('synthetic signing input has exact relay actor, role and immutable expiry',async()=>{
 const issuer=createCloudflareIssuer(options);const {credential}=await issuer.mintCredential(plan,{identity:'speaker',role:'speaker'});
 const claim=JSON.parse(Buffer.from(credential.token.split('.')[1],'base64url'));
 assert.deepEqual(claim,{iss:'fixture-issuer',aud:'navrang-relay-v1',room:plan.roomId,sub:'speaker',role:'speaker',authVersion:1,jti:'fixture-one-use',iat:now/1000,exp:(now+10000)/1000});
 assert.equal(credential.expiresAt,plan.expiresAt);assert.equal(credential.origin,plan.origin);
});
test('issuer rejects different room binding, expiry, subject and role',async()=>{
 const issuer=createCloudflareIssuer(options);
 for(const mutation of [{origin:'https://other.fixture.invalid'},{expiresAt:new Date(now+16000).toISOString()},{roomId:'arbitrary'}])await assert.rejects(issuer.mintCredential({...plan,...mutation},{identity:'speaker',role:'speaker'}));
 await assert.rejects(issuer.mintCredential(plan,{identity:'other',role:'speaker'}));
 await assert.rejects(issuer.mintCredential(plan,{identity:'speaker',role:'admin'}));
});
test('issuer refuses extractable private keys and aborted operations',async()=>{
 assert.equal(createCloudflareIssuer({...options,key:{...options.key,extractable:true}}).configured(),false);
 const signal=AbortSignal.abort();await assert.rejects(createCloudflareIssuer(options).mintCredential(plan,{identity:'speaker',role:'speaker'},{signal}));
});
test('private controller authorization outlives media lease without changing its descriptor deadline',async()=>{
 const issuer=createCloudflareIssuer(options);
 const {credential}=await issuer.mintControllerCredential(plan,{identity:'server-controller'});
 const claim=JSON.parse(Buffer.from(credential.token.split('.')[1],'base64url'));
 assert.equal(claim.role,'controller');assert.equal(claim.iat,now/1000);assert.equal(claim.exp,now/1000+60);
 assert.equal(credential.expiresAt,plan.expiresAt);assert.equal(claim.exp*1000-Date.parse(plan.expiresAt),50000);
 const {credential:listener}=await issuer.mintCredential(plan,{identity:'listener',role:'listener'});
 assert.equal(JSON.parse(Buffer.from(listener.token.split('.')[1],'base64url')).exp,Date.parse(plan.expiresAt)/1000);
});
test('controller TTL is explicitly bounded by relay authorization limits and handles fractional wall time',async()=>{
 for(const controllerAuthTtlSeconds of [15,301,0,-1,60.5,NaN])assert.throws(()=>createCloudflareIssuer({...options,controllerAuthTtlSeconds}));
 for(const controllerAuthTtlSeconds of [16,300]) {
  const issuer=createCloudflareIssuer({...options,clock:()=>now+999,controllerAuthTtlSeconds});
  const {credential}=await issuer.mintControllerCredential(plan,{identity:'server-controller'});
  const claim=JSON.parse(Buffer.from(credential.token.split('.')[1],'base64url'));
  assert.equal(claim.exp-claim.iat,controllerAuthTtlSeconds);assert.ok(claim.exp*1000>Date.parse(plan.expiresAt));
 }
});
test('only private controller may authorize scoped cleanup of an expired media plan',async()=>{
 const issuer=createCloudflareIssuer({...options,clock:()=>now+10000});
 const {credential}=await issuer.mintControllerCredential(plan,{identity:'server-controller'});
 const claim=JSON.parse(Buffer.from(credential.token.split('.')[1],'base64url'));
 assert.equal(credential.expiresAt,plan.expiresAt);assert.equal(Date.parse(credential.authorizationExpiresAt),claim.exp*1000);
 assert.equal(claim.iat,(now+10000)/1000);assert.equal(claim.exp-claim.iat,60);
 for(const role of ['speaker','listener'])await assert.rejects(issuer.mintCredential(plan,{identity:role,role}));
});
