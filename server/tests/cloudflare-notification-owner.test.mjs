import test from 'node:test';
import assert from 'node:assert/strict';
import {NotificationOwner} from '../cloudflare-platform/notification-owner.mjs';
function fixture(){
 const rows=new Map(),sql={exec(query,...args){
  if(query.startsWith('CREATE'))return {toArray:()=>[]};
  if(query.startsWith('SELECT'))return {toArray:()=>rows.has(args[0])?[rows.get(args[0])]:[]};
  if(query.startsWith('INSERT')){rows.set(args[0],{day:args[1],operations:args[2]});return {toArray:()=>[]};}
  throw Error('unexpected SQL');
 }};
 return {ctx:{storage:{sql}},rows};
}
test('disabled owner performs no import, pool or dispatch work',async()=>{
 let calls=0;const {ctx}=fixture();const owner=new NotificationOwner(ctx,{}, {poolFactory:()=>{calls++},subtle:{importKey:()=>{calls++}}});
 assert.deepEqual(await owner.scheduled(),{state:'NOT_RUN'});assert.equal(calls,0);
});
test('quota survives owner reconstruction and fails closed on rollback/exhaustion',()=>{
 let now=86400000;const {ctx,rows}=fixture();let owner=new NotificationOwner(ctx,{}, {clock:()=>now});
 assert.equal(owner.consume({kind:'database'}),true);owner=new NotificationOwner(ctx,{}, {clock:()=>now});
 assert.equal(owner.consume({kind:'database'}),true);assert.equal(rows.get('database').operations,2);
 rows.set('database',{day:1,operations:10000});assert.equal(owner.consume({kind:'database'}),false);
 now=0;assert.equal(owner.consume({kind:'fcm'}),true);assert.equal(owner.consume({kind:'database'}),false);
 now=2*86400000;assert.equal(owner.consume({kind:'database'}),true);assert.equal(owner.consume({kind:'arbitrary'}),false);
});
test('all qualification and binding gates must be present',async()=>{
 let calls=0;const {ctx}=fixture();const base={NOTIFICATION_ENABLED:'true',NOTIFICATION_QUALIFIED:'true',AUTH_DB_CACHE_DISABLED:'true',NOTIFICATION_DB:{connectionString:'fixture'},FCM_SERVICE_ACCOUNT_KEY:'{}',FCM_PROJECT_ID:'fixture-project',FCM_SERVICE_ACCOUNT_EMAIL:'fixture',FCM_KEY_ID:'fixture'};
 for(const name of Object.keys(base)){
  const env={...base};delete env[name];const owner=new NotificationOwner(ctx,env,{poolFactory:()=>{calls++},subtle:{importKey:()=>{calls++}}});
  assert.deepEqual(await owner.scheduled(),{state:'NOT_RUN'},name);
 }assert.equal(calls,0);
});
test('enabled owner composes bounded dispatcher, shares quota and releases its pool',async()=>{
 const {ctx}=fixture();let closed=0,ended=0,options;
 const env={NOTIFICATION_ENABLED:'true',NOTIFICATION_QUALIFIED:'true',AUTH_DB_CACHE_DISABLED:'true',NOTIFICATION_DB:{connectionString:'fixture'},FCM_SERVICE_ACCOUNT_KEY:'{}',FCM_PROJECT_ID:'fixture-project',FCM_SERVICE_ACCOUNT_EMAIL:'fixture',FCM_KEY_ID:'fixture'};
 const owner=new NotificationOwner(ctx,env,{clock:()=>1000,subtle:{importKey:async()=>({})},poolFactory:()=>({end:async()=>ended++}),dispatcherFactory:value=>{options=value;return{scheduled:async()=>{assert.equal(value.quota.consume({kind:'fcm'}),true);return {state:'COMPLETE'};},close:()=>closed++};}});
 assert.deepEqual(await owner.scheduled(),{state:'COMPLETE'});assert.equal(options.enabled,true);assert.equal(closed,1);assert.equal(ended,1);
});
test('actual scheduled composition claims, rechecks and sends once with durable quotas',async()=>{
 const {ctx,rows}=fixture();const seen=[];let closed=0;
 const env={NOTIFICATION_ENABLED:'true',NOTIFICATION_QUALIFIED:'true',AUTH_DB_CACHE_DISABLED:'true',NOTIFICATION_DB:{connectionString:'fixture'},FCM_SERVICE_ACCOUNT_KEY:'{}',FCM_PROJECT_ID:'fixture-project',FCM_SERVICE_ACCOUNT_EMAIL:'fixture@fixture-project.iam.gserviceaccount.com',FCM_KEY_ID:'fixture'};
 const subtle={importKey:async()=>({type:'private',extractable:false,algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'},modulusLength:2048},usages:['sign']}),sign:async()=>new Uint8Array(256)};
 const poolFactory=()=>({connect:async()=>({query:async q=>{seen.push(q.text);if(q.text.includes('navrang_notification_bridge.claim('))return{rows:[{result:[{id:7,leaseId:'lease'}]}]};if(q.text.includes('navrang_notification_bridge.check_delivery('))return{rows:[{result:{allowed:true,providerTarget:{type:'legacyToken',value:'fixture-device'},eventId:'event',bindingId:'binding',revision:2}}]};return{rows:[{result:{completed:true}}]};},release(){}}),end:async()=>closed++});
 const fetchImpl=async(url,options)=>{seen.push(url);if(url==='https://oauth2.googleapis.com/token')return Response.json({token_type:'Bearer',access_token:'a'.repeat(32),expires_in:3600});assert.equal(url,'https://fcm.googleapis.com/v1/projects/fixture-project/messages:send');assert.equal(JSON.parse(options.body).message.token,'fixture-device');return Response.json({name:'projects/fixture/messages/1'});};
 const owner=new NotificationOwner(ctx,env,{clock:()=>1000000,subtle,poolFactory,fetchImpl});const result=await owner.scheduled();
 assert.equal(result.accepted,1);assert.equal(result.state,'COMPLETE');assert.equal(rows.get('database').operations,3);assert.equal(rows.get('oauth').operations,1);assert.equal(rows.get('fcm').operations,1);assert.equal(closed,1);assert.equal(seen.filter(x=>String(x).includes('messages:send')).length,1);
});
test('release cancellation during certificate digest returns promptly and prevents pool construction',async()=>{
 const {ctx}=fixture();let digestStarted,resolveDigest,pools=0;const started=new Promise(resolve=>{digestStarted=resolve});
 const env={RELEASE_HINT_ENABLED:'true',RELEASE_HINT_QUALIFIED:'true',RELEASE_SIGNER_VERIFIED:'true',AUTH_DB_CACHE_DISABLED:'true',NOTIFICATION_DB:{connectionString:'fixture'},FCM_SERVICE_ACCOUNT_KEY:'{}',FCM_PROJECT_ID:'fixture-project',FCM_SERVICE_ACCOUNT_EMAIL:'fixture',FCM_KEY_ID:'fixture',RELEASE_SIGNER_CERTIFICATE_DER:Buffer.alloc(64).toString('base64')};
 const subtle={digest:()=>{digestStarted();return new Promise(resolve=>{resolveDigest=resolve;});},importKey:async()=>({})};
 const owner=new NotificationOwner(ctx,env,{subtle,poolFactory:()=>{pools++;}}),stop=new AbortController();
 const pending=owner.releaseHint({versionCode:19,sha256:'a'.repeat(64)},'Bearer '+'a'.repeat(64),{signal:stop.signal});await started;stop.abort();
 assert.deepEqual(await pending,{state:'UNAVAILABLE'});resolveDigest(new Uint8Array(32));await new Promise(resolve=>setImmediate(resolve));assert.equal(pools,0);
});
