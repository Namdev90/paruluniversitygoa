import {test} from 'node:test';
import assert from 'node:assert/strict';
let communications;try{communications=await import('../functions/navrang-gate/communications.mjs');}catch{communications={};}

function fixture({configured=true,revoked=false,send,workerOptions={}}={}) {
  const state=new Map([[1,{status:'queued',attempts:0,principal:'synthetic',bindingId:'binding-one',revision:5}]]);
  const deliveries=[];
  const store={
    async claim(limit){const rows=[];for(const [id,job] of state){if(job.status==='queued'&&rows.length<limit){job.status='leased';job.attempts++;rows.push({id,leaseId:'lease-'+job.attempts,revision:job.revision});}}return rows;},
    async check(id){const job=state.get(id);if(revoked){job.status='cancelled';return {allowed:false,reason:'access-or-binding-changed'};}return {allowed:job.status==='leased',bindingId:job.bindingId,eventId:'event-one',revision:job.revision,providerTarget:{type:'fid',value:'synthetic-provider-id'}};},
    async finish(id,leaseId,outcome){const job=state.get(id);job.status=outcome==='retry'?'queued':outcome;return {completed:true};},
  };
  const push={configured,async send(payload){deliveries.push(payload);return send?send(payload):{accepted:true};}};
  assert.equal(typeof communications.createDeliveryWorker,'function','worker implementation exists');
  return {worker:communications.createDeliveryWorker({store,push,...workerOptions}),store,push,state,deliveries};
}

test('an unconfigured adapter never claims queued work or reports delivery success',async()=>{
  const {worker,state,deliveries}=fixture({configured:false});const result=await worker.dispatchBatch();
  assert.equal(result.state,'NOT_RUN');assert.equal(result.accepted,0);assert.equal(state.get(1).status,'queued');assert.equal(deliveries.length,0);
});
test('provider acceptance settles durable job and sends only a generic event wake',async()=>{
  const {worker,state,deliveries}=fixture();const result=await worker.dispatchBatch();
  assert.equal(result.accepted,1);assert.equal(state.get(1).status,'accepted');
  assert.deepEqual(Object.keys(deliveries[0]).sort(),['bindingId','eventId','idempotencyKey','providerTarget','revision']);
  assert.ok(!JSON.stringify(result).includes('synthetic-provider-id'));
  const again=await worker.dispatchBatch();assert.equal(again.accepted,0);assert.equal(deliveries.length,1);
});
test('fresh dispatch authorization cancels revoked queued delivery',async()=>{
  const {worker,state,deliveries}=fixture({revoked:true});const result=await worker.dispatchBatch();
  assert.equal(result.cancelled,1);assert.equal(state.get(1).status,'cancelled');assert.equal(deliveries.length,0);
});
test('provider outage schedules a retry without claiming provider acceptance',async()=>{
  const {worker,state}=fixture({send:()=>{throw Error('private provider detail');}});const result=await worker.dispatchBatch();
  assert.equal(result.retried,1);assert.equal(result.accepted,0);assert.equal(state.get(1).status,'queued');assert.ok(!JSON.stringify(result).includes('private provider detail'));
});
test('permanent provider invalid-target response retires only its leased binding job',async()=>{
  const {worker,state}=fixture({send:()=>({accepted:false,permanentFailure:true})});const result=await worker.dispatchBatch();
  assert.equal(result.removed,1);assert.equal(state.get(1).status,'invalid');assert.equal(result.accepted,0);
});
test('worker enforces a bounded batch before touching the queue',async()=>{
  const {worker,state}=fixture();for(const limit of [0,51,'10',NaN])await assert.rejects(()=>worker.dispatchBatch({limit}));
  assert.equal(state.get(1).status,'queued');
});
test('a hung provider times out to retry and leaves later leases reclaimable',async()=>{
  let elapsed=0;
  const {worker,state,store}=fixture({send:()=>{elapsed+=5;return new Promise(()=>{});},workerOptions:{adapterTimeoutMs:5,batchBudgetMs:8,clock:()=>elapsed}});
  state.set(2,{status:'queued',attempts:0,principal:'synthetic',bindingId:'binding-two',revision:6});
  const result=await Promise.race([worker.dispatchBatch(),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),100))]);
  assert.notEqual(result.hung,true);assert.equal(result.retried,1);assert.equal(state.get(1).status,'queued');assert.equal(state.get(2).status,'leased');
  state.get(2).status='queued'; // Simulate durable lease expiry, not cancellation.
  const recovered=communications.createDeliveryWorker({store,push:{configured:true,send:async()=>({accepted:true})}});
  assert.equal((await recovered.dispatchBatch()).accepted,2);
});
test('a hung authorization store leaves its lease to expire without cancelling it',async()=>{
  const {worker,state,store}=fixture({workerOptions:{adapterTimeoutMs:5,batchBudgetMs:20}});
  store.check=async()=>new Promise(()=>{});
  const result=await Promise.race([worker.dispatchBatch(),new Promise(resolve=>setTimeout(()=>resolve({hung:true}),100))]);
  assert.notEqual(result.hung,true);assert.equal(result.deferred,1);assert.equal(state.get(1).status,'leased');assert.equal(result.cancelled,0);
});
test('an expired lease is deferred instead of converted into permanent cancellation',async()=>{
  const {worker,state,store}=fixture();store.check=async()=>({allowed:false,reason:'lease-unavailable'});
  const result=await worker.dispatchBatch();assert.equal(result.deferred,1);assert.equal(result.cancelled,0);assert.equal(state.get(1).status,'leased');
});
