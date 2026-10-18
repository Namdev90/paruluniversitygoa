const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
function check(config={},evidence={}){
 const r=spawnSync('python3',[path.join(__dirname,'../tools/check-communications-readiness.py')],{input:JSON.stringify({config,evidence}),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);
}
const configured={push:{configured:true,artifactResolved:true},voice:{configured:true,artifactResolved:true}};
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
test('only actual accepted delivery and revocation evidence enables release',()=>{
 const r=check(configured,{pushDelivery:true,voiceDelivery:true,revokedTokenRejected:true,workerHealthy:true});assert.equal(r.releaseReady,true);assert.deepEqual(r.blockers,[]);
});
test('truthy strings cannot masquerade as successful provider evidence',()=>{
 const r=check(configured,{pushDelivery:'true',voiceDelivery:1,revokedTokenRejected:'passed',workerHealthy:true});assert.equal(r.releaseReady,false);
});
test('readiness output never reflects credential or token fields',()=>{
 const r=check({...configured,secret:'SECRET_FIXTURE',push:{...configured.push,privateKey:'SECRET_FIXTURE'}},{token:'SECRET_FIXTURE'});assert.equal(JSON.stringify(r).includes('SECRET_FIXTURE'),false);
});
