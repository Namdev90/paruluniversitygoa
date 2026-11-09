import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCloudflareVoiceStore,createCloudflareVoiceControllerStore} from '../workers/voice-store.mjs';
import {createCloudflareNotificationStore} from '../workers/notification-store.mjs';
import {createReleaseActorVerifier} from '../cloudflare-platform/release-actor.mjs';

const id='12345678-1234-4234-9234-123456789abc';
const token='a'.repeat(64);
function capture(result={ok:true}) {
 const calls=[],releases=[];
 return {calls,releases,pool:{connect:async()=>({query:async q=>{calls.push(q);return {rows:[{result}]};},release:x=>releases.push(x)})}};
}
test('Cloudflare controller has exactly six narrow capabilities and cannot pass an app token',async()=>{
 const c=capture(),store=createCloudflareVoiceControllerStore(c.pool);
 assert.deepEqual(Object.keys(store).sort(),['ack','ackRelay','claim','heartbeat','poll','release']);
 assert(Object.isFrozen(store));
 await store.claim(id);await store.poll(id);await store.ack(id,id,7);
 const command={operationId:id,commandId:id,generation:8},plan={generation:7},receipt={revoked:true,generation:7};
 await store.ackRelay(id,command,plan,receipt);await store.heartbeat(id);await store.release(id);
 assert(c.calls.every(q=>q.text==='select navrang_voice_worker_api.controller($1::text,$2::jsonb) as result'&&q.values.length===2&&q.query_timeout===1200));
 assert.deepEqual(c.calls.map(q=>q.values[0]),['controller-claim','controller-poll','controller-ack','controller-relay-ack','controller-heartbeat','controller-release']);
 assert.deepEqual(JSON.parse(c.calls[3].values[1]),{controllerId:id,...command,plan,receipt});
 assert.equal(c.releases.length,6);
});
test('all sixteen Cloudflare actor phases use one fixed restricted statement',async()=>{
 const c=capture(),store=createCloudflareVoiceStore(c.pool);
 const actions=['duty-join','duty-heartbeat','duty-leave','voice-join','voice-invite','voice-broadcast-start','voice-broadcast-end','voice-release','floor-prepare','floor-fail','relay-operation','relay-plan','relay-receive','relay-renew-prepare','relay-ack','relay-commit'];
 for(const action of actions)await store.rpc(action,{value:"'; SET ROLE service_role; --"},token);
 assert(c.calls.every(q=>q.text==='select navrang_voice_worker_api.actor($1::text,$2::jsonb,$3::text) as result'&&q.values[2]===token));
 assert.deepEqual(c.calls.map(q=>q.values[0]),actions);
 assert.deepEqual(JSON.parse(c.calls[0].values[1]),{value:"'; SET ROLE service_role; --"});
 for(const action of ['daily-plan','controller-claim','controller-daily-ack','unknown'])assert.throws(()=>store.rpc(action,{},token));
 assert.equal(c.calls.length,16);
});
test('missing voice boundary fails closed without retrying a private function or changing roles',async()=>{
 for(const actor of [true,false]) {
  const calls=[],releases=[];
  const pool={connect:async()=>({query:async q=>{calls.push(q);throw Object.assign(Error('restricted schema missing'),{code:'3F000'});},release:x=>releases.push(x)})};
  const store=actor?createCloudflareVoiceStore(pool):createCloudflareVoiceControllerStore(pool);
  await assert.rejects(actor?store.rpc('relay-plan',{},token):store.claim(id),/^Error: Voice controller store is unavailable\.$/);
  assert.equal(calls.length,1);assert(calls[0].text.startsWith('select navrang_voice_worker_api.'));
  assert.deepEqual(releases,[true]);
 }
});
test('Cloudflare delivery exposes only fixed claim/check/finish wrappers with parameterized values',async()=>{
 const c=capture(),store=createCloudflareNotificationStore(c.pool);
 assert.deepEqual(Object.keys(store).sort(),['check','claim','finish']);assert(Object.isFrozen(store));
 await store.claim(20);await store.check(3,id);await store.finish(3,id,"accepted'); SET ROLE service_role; --");
 assert.deepEqual(c.calls.map(q=>q.text),[
  'select navrang_notification_bridge.claim($1::integer) as result',
  'select navrang_notification_bridge.check_delivery($1::bigint,$2::uuid) as result',
  'select navrang_notification_bridge.finish($1::bigint,$2::uuid,$3::text) as result',
 ]);
 assert.deepEqual(c.calls[2].values,[3,id,"accepted'); SET ROLE service_role; --"]);
 assert(c.calls.every(q=>q.query_timeout===8000));assert.equal(c.releases.length,3);
});
test('missing delivery boundary fails without retrying broad legacy access',async()=>{
 const calls=[];const store=createCloudflareNotificationStore({connect:async()=>({query:async q=>{calls.push(q);throw Object.assign(Error('permission denied'),{code:'42501'});},release(){}})});
 await assert.rejects(store.claim(20));assert.equal(calls.length,1);
 assert.equal(calls[0].text,'select navrang_notification_bridge.claim($1::integer) as result');
});
test('release authority accepts only a literal boolean from the narrow admin predicate',async()=>{
 for(const result of [true,false,null,undefined,1,'true',{admin:true,active:true},[true]]) {
  const c=capture(result);const verify=createReleaseActorVerifier({pool:c.pool,subtle:webcrypto.subtle,quota:{consume:()=>true}});
  assert.equal(await verify('Bearer '+token,{}),result===true);
  assert.equal(c.calls.length,1);
  assert.equal(c.calls[0].text,'select navrang_notification_bridge.is_active_admin($1::text) as result');
  assert.deepEqual(c.calls[0].values,[createHash('sha256').update(token).digest('hex')]);
 }
});
test('reviewed SQL artifacts retain their exact approval-bound digests',async()=>{
 const expected={
  'voice-worker-boundary-v1.sql':'8f2e52420c65456e3cd1b50233f560434427074dc63273306da8f28ea2a02102',
  'notification-bridge-v080.sql':'816034a20886322ef8d55db333bd121d217d9dcb1f5fb6c34d18b0a4db0a5c30',
 };
 for(const [name,sha] of Object.entries(expected)) {
  const bytes=await readFile(new URL('../'+name,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sha,name+' requires renewed review if changed');
 }
});
