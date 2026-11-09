import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceControllerStore,createCloudflareVoiceStore} from '../workers/voice-store.mjs';
import {isCommunicationAction} from '../functions/navrang-gate/communications-contract.mjs';

const id='12345678-1234-4234-9234-123456789abc';
const statement="select navrang_private.voice_rpc($1::text,$2::jsonb,''::text) as result";
test('controller store uses only the existing private function with parameterized values and empty app bearer',async()=>{
 const queries=[],released=[];
 const store=createVoiceControllerStore({connect:async()=>({query:async q=>{queries.push(q);return {rows:[{result:{ok:true}}]};},release:x=>released.push(x)})});
 await store.claim(id);await store.poll(id);await store.ack(id,id,4);await store.heartbeat(id);await store.release(id);
 assert.equal(queries.length,5);assert.equal(released.length,5);
 assert(queries.every(q=>q.text===statement&&q.query_timeout===1200));
 assert.deepEqual(queries.map(q=>q.values[0]),['controller-claim','controller-poll','controller-ack','controller-heartbeat','controller-release']);
 assert.deepEqual(JSON.parse(queries[2].values[1]),{controllerId:id,commandId:id,generation:4});
 assert(queries.every(q=>!isCommunicationAction(q.values[0])));
});
test('payload values cannot inject SQL, choose a function, switch roles or alter grants',async()=>{
 let query;
 const store=createVoiceControllerStore({connect:async()=>({query:async q=>{query=q;return {rows:[{result:{status:400}}]};},release(){}})});
 await store.claim("'; select unsafe(); --");assert.equal(query.text,statement);
 assert.deepEqual(JSON.parse(query.values[1]),{controllerId:"'; select unsafe(); --"});
});
test('aborting database work destroys its connection once and redacts the failure',async()=>{
 const shutdown=new AbortController(),released=[];
 const store=createVoiceControllerStore({connect:async()=>({query:async()=>{shutdown.abort();throw Error('private-secret');},release:x=>released.push(x)})});
 await assert.rejects(store.claim(id,{signal:shutdown.signal}),error=>error.message==='Voice controller store is unavailable.');
 assert.deepEqual(released,[true]);
});
test('a connection acquired after cancellation is destroyed without running a query',async()=>{
 let provide;const released=[];let queried=false;
 const shutdown=new AbortController();
 const store=createVoiceControllerStore({connect:()=>new Promise(resolve=>{provide=resolve;})});
 const pending=store.claim(id,{signal:shutdown.signal});await new Promise(resolve=>setImmediate(resolve));shutdown.abort();
 await assert.rejects(pending,/unavailable/);
 provide({query:async()=>{queried=true;},release:x=>released.push(x)});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(queried,false);assert.deepEqual(released,[true]);
});
test('hung database query or connection acquisition times out without awaiting the driver',async()=>{
 const released=[];
 const queryStore=createVoiceControllerStore({connect:async()=>({query:()=>new Promise(()=>{}),release:x=>released.push(x)})},{timeoutMs:10});
 await assert.rejects(queryStore.claim(id),/unavailable/);assert.deepEqual(released,[true]);
 const connectStore=createVoiceControllerStore({connect:()=>new Promise(()=>{})},{timeoutMs:10});
 await assert.rejects(connectStore.claim(id),/unavailable/);
});
test('pre-aborted calls do not acquire a database connection',async()=>{
 let connected=false;const shutdown=new AbortController();shutdown.abort();
 const store=createVoiceControllerStore({connect:async()=>{connected=true;}});
 await assert.rejects(store.claim(id,{signal:shutdown.signal}),/unavailable/);assert.equal(connected,false);
});
test('query errors and malformed responses release connections and reveal no database content',async()=>{
 for(const query of [async()=>{throw Error('postgres://private-secret');},async()=>({rows:[{result:'bad'}]})]) {
  const released=[];const store=createVoiceControllerStore({connect:async()=>({query,release:x=>released.push(x)})});
  await assert.rejects(store.poll(id),error=>error.message==='Voice controller store is unavailable.');
  assert.deepEqual(released,[true]);
 }
});

test('Cloudflare actor phases use exact parameterized restricted SQL and retain the hashed actor',async()=>{
 const queries=[],released=[];const token='a'.repeat(64);
 const pool={connect:async()=>({query:async q=>{queries.push(q);return {rows:[{result:{ok:true}}]};},release:x=>released.push(x)})};
 const store=createCloudflareVoiceStore(pool);
 const phases=['floor-prepare','relay-operation','relay-plan','relay-receive','relay-renew-prepare','relay-ack','relay-commit','floor-fail'];
 for(const action of phases)await store.rpc(action,{operationId:id,generation:4,sessionId:id},token);
 assert.deepEqual(queries.map(q=>q.values[0]),phases);
 assert(queries.every(q=>q.text==='select navrang_voice_worker_api.actor($1::text,$2::jsonb,$3::text) as result'&&q.values[2]===token));
 assert.equal(released.length,phases.length);
 const before=queries.length;
 for(const action of ['controller-claim','controller-relay-ack','daily-plan','daily-commit','voice-renew','unsafe'])
  assert.throws(()=>store.rpc(action,{},token),/Private authenticated relay/);
 assert.throws(()=>store.rpc('relay-plan',{},''),/Private authenticated relay/);
 assert.equal(queries.length,before);
});
test('Cloudflare controller acknowledgement preserves exact plan receipt and cleanup generation with empty app token',async()=>{
 let query;const store=createVoiceControllerStore({connect:async()=>({query:async q=>{query=q;return {rows:[{result:{state:'acked'}}]};},release(){}})});
 const command={operationId:id,commandId:id,generation:8},plan={provider:'navrang-relay-v1',generation:7},receipt={revoked:true,generation:7};
 await store.ackRelay(id,command,plan,receipt);
 assert.equal(query.text,statement);assert.equal(query.values[0],'controller-relay-ack');
 assert.deepEqual(JSON.parse(query.values[1]),{controllerId:id,operationId:id,commandId:id,generation:8,plan,receipt});
 assert.equal(query.values.length,2);
});
