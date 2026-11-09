import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationStore,createMetadataTokenProvider,runNotificationLoop} from '../workers/notification-store.mjs';
test('private delivery SQL uses parameterized existing functions and releases connections',async()=>{
  const calls=[],released=[]; const store=createNotificationStore({connect:async()=>({query:async q=>{calls.push(q);return {rows:[{result:{ok:true}}]}},release:x=>released.push(x)})});
  await store.claim(20);await store.check(3,'fixture');await store.finish(3,'fixture','accepted');
  assert.equal(calls.length,3);assert.deepEqual(calls[2].values,[3,'fixture','accepted']);
  assert.ok(calls.every(q=>q.text.startsWith('select navrang_private.') && q.query_timeout===8000));assert.equal(released.length,3);
});
test('abort destroys the checked-out database connection once',async()=>{
  const stop=new AbortController(),released=[];
  const store=createNotificationStore({connect:async()=>({query:async()=>{stop.abort();throw Error('closed')},release:x=>released.push(x)})});
  await assert.rejects(store.claim(20,{signal:stop.signal}));assert.deepEqual(released,[true]);
});
test('workload metadata validates origin marker, caches and refreshes short-lived tokens',async()=>{
  let count=0,now=0;const token=createMetadataTokenProvider({clock:()=>now,fetchImpl:async(url,options)=>{
    assert.equal(url,'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token');
    assert.equal(options.redirect,'error');assert.equal(options.headers['Metadata-Flavor'],'Google');count++;
    return Response.json({access_token:'fixture-'+count,token_type:'Bearer',expires_in:120},{headers:{'Metadata-Flavor':'Google'}});
  }});
  assert.equal(await token(),'fixture-1');assert.equal(await token(),'fixture-1');now=61000;assert.equal(await token(),'fixture-2');
  const bad=createMetadataTokenProvider({fetchImpl:async()=>Response.json({access_token:'untrusted',token_type:'Bearer',expires_in:120})});
  await assert.rejects(bad(),/Workload identity/);
});
test('standalone runner serializes bounded batches and stops without another poll',async()=>{
  const stop=new AbortController();let active=0,calls=0,waits=0;
  await runNotificationLoop({signal:stop.signal,worker:{dispatchBatch:async({limit})=>{assert.equal(limit,20);assert.equal(active++,0);calls++;active--;return {state:'COMPLETE'}}},
    wait:async ms=>{assert.equal(ms,15000);waits++;stop.abort()}});
  assert.equal(calls,1);assert.equal(waits,1);
});
