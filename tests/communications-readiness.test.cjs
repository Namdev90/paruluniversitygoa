const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
function check(config={},evidence={}){
 const r=spawnSync('python3',[path.join(__dirname,'../tools/check-communications-readiness.py')],{input:JSON.stringify({config,evidence}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const configured={push:{configured:true,artifactResolved:true},voice:{configured:true,artifactResolved:true,revocationMode:'cloud-explicit-cutoff',tokenTtlSeconds:60}};
const verified={pushDelivery:true,voiceDelivery:true,revokedTokenRejected:true,workerHealthy:true,leaseEnforced:true,workerDeathVerified:true,lateGrantRejected:true};
test('missing transports cannot be labelled release ready',()=>{
 const r=check();assert.equal(r.releaseReady,false);assert.equal(r.implementationReady,false);assert.ok(r.blockers.includes('PUSH_NOT_CONFIGURED'));assert.ok(r.blockers.includes('VOICE_NOT_CONFIGURED'));
});
test('configured transports allow implementation without claiming delivery',()=>{
 const r=check(configured);assert.equal(r.implementationReady,true);assert.equal(r.releaseReady,false);assert.ok(r.blockers.includes('PUSH_DELIVERY_NOT_VERIFIED'));
});
test('a relay with reusable revoked credentials fails release acceptance',()=>{
 const r=check(configured,{pushDelivery:true,voiceDelivery:true,revokedTokenRejected:false,workerHealthy:true});assert.equal(r.releaseReady,false);assert.ok(r.blockers.includes('VOICE_REVOCATION_NOT_VERIFIED'));
});
test('verified transports with unhealthy expiry worker still fail acceptance',()=>{
 const r=check(configured,{pushDelivery:true,voiceDelivery:true,revokedTokenRejected:true,workerHealthy:false});assert.equal(r.releaseReady,false);assert.ok(r.blockers.includes('VOICE_WORKER_NOT_HEALTHY'));
});
test('only delivery, revocation and independent media expiry evidence enables release',()=>{
 const r=check(configured,verified);assert.equal(r.releaseReady,true);assert.deepEqual(r.blockers,[]);
});
test('nominally healthy worker cannot substitute for controller-death and late-grant proof',()=>{
 const r=check(configured,{pushDelivery:true,voiceDelivery:true,revokedTokenRejected:true,workerHealthy:true});
 assert.equal(r.releaseReady,false);
 for(const code of ['VOICE_MEDIA_LEASE_NOT_VERIFIED','VOICE_CONTROLLER_DEATH_NOT_VERIFIED','VOICE_LATE_GRANT_NOT_VERIFIED'])assert(r.blockers.includes(code));
 for(const key of ['leaseEnforced','workerDeathVerified','lateGrantRejected']){
  assert.equal(check(configured,{...verified,[key]:false}).releaseReady,false);
  assert.equal(check(configured,{...verified,[key]:'true'}).releaseReady,false);
 }
});
test('cached self-hosted token replay and excessive Cloud TTL cannot pass readiness',()=>{
 assert(check({...configured,voice:{...configured.voice,revocationMode:'self-host-ttl'}},verified).blockers.includes('VOICE_REVOCATION_MODE_UNSAFE'));
 for(const tokenTtlSeconds of [undefined,0,601,'600',true])assert(check({...configured,voice:{...configured.voice,tokenTtlSeconds}},verified).blockers.includes('VOICE_TOKEN_TTL_UNSAFE'));
 assert.equal(check({...configured,voice:{...configured.voice,tokenTtlSeconds:600}},verified).releaseReady,true);
});
test('truthy strings cannot masquerade as successful provider evidence',()=>{
 const r=check(configured,{pushDelivery:'true',voiceDelivery:1,revokedTokenRejected:'passed',workerHealthy:true});assert.equal(r.releaseReady,false);
});
test('readiness output never reflects credential or token fields',()=>{
 const r=check({...configured,secret:'SECRET_FIXTURE',push:{...configured.push,privateKey:'SECRET_FIXTURE'}},{token:'SECRET_FIXTURE'});assert.equal(JSON.stringify(r).includes('SECRET_FIXTURE'),false);
});
