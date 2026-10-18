// An independently authenticated scheduler supplies the service-only SQL store.
// Provider acceptance is separate from device receipt/read acknowledgement.
export function createDeliveryWorker({store,push,adapterTimeoutMs=10000,batchBudgetMs=45000,clock=()=>performance.now()}) {
  if (!store || !['claim','check','finish'].every(key=>typeof store[key]==='function')) throw Error('A durable notification store is required.');
  if (!Number.isFinite(adapterTimeoutMs) || adapterTimeoutMs<1 || adapterTimeoutMs>15000 ||
      !Number.isFinite(batchBudgetMs) || batchBudgetMs<adapterTimeoutMs || batchBudgetMs>45000 || typeof clock!=='function') throw Error('Invalid notification worker deadline.');
  return {
    async dispatchBatch({limit=20}={}) {
      if (!Number.isSafeInteger(limit) || limit<1 || limit>50) throw Error('Notification batch size must be between 1 and 50.');
      const result={state:'COMPLETE',accepted:0,retried:0,removed:0,cancelled:0,deferred:0};
      if (push?.configured!==true || typeof push.send!=='function') return {...result,state:'NOT_RUN',reason:'Push provider is not configured.'};
      const started=clock(),remaining=()=>batchBudgetMs-(clock()-started);
      async function bounded(operation) {
        const wait=Math.min(adapterTimeoutMs,remaining());
        if (wait<1) throw Error('Notification worker deadline exceeded.');
        const controller=new AbortController();let timer;
        try {
          return await Promise.race([
            Promise.resolve().then(()=>operation(controller.signal)),
            new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Notification adapter deadline exceeded.'));},wait);}),
          ]);
        } finally {clearTimeout(timer);}
      }
      let jobs;
      try {jobs=await bounded(signal=>store.claim(limit,{signal}));}
      catch {return {...result,state:'PARTIAL',reason:'Notification store is unavailable.'};}
      if (!Array.isArray(jobs) || jobs.length>limit) throw Error('Invalid notification delivery batch.');
      for (let index=0;index<jobs.length;index++) {
        if (remaining()<adapterTimeoutMs) {result.deferred+=jobs.length-index;break;}
        const job=jobs[index];let current;
        try {current=await bounded(signal=>store.check(job.id,job.leaseId,{signal}));}
        catch {result.deferred++;continue;}
        if (current?.allowed!==true) {
          // The SQL checker itself settles confirmed revocation. An unavailable
          // or expired lease is left alone so another worker can reclaim it.
          if (current?.reason==='access-or-binding-changed') result.cancelled++;
          else result.deferred++;
          continue;
        }
        async function settle(outcome) {
          try {
            const receipt=await bounded(signal=>store.finish(job.id,job.leaseId,outcome,{signal}));
            if (receipt?.completed===true) return true;
          } catch {}
          result.deferred++;return false;
        }
        let response;
        try {
          response=await bounded(signal=>push.send({providerTarget:current.providerTarget,eventId:current.eventId,bindingId:current.bindingId,
            revision:current.revision,idempotencyKey:'notification-'+job.id+'-'+current.revision},{signal}));
        } catch {
          // No raw provider error or identifier enters logs/receipts. A failed
          // settlement leaves the bounded durable lease available for expiry.
          if (await settle('retry')) result.retried++;
          continue;
        }
        if (response?.accepted===true) {
          result.accepted++;await settle('accepted');
        } else if (response?.permanentFailure===true) {
          if (await settle('invalid')) result.removed++;
        } else if (await settle('retry')) result.retried++;
      }
      if (result.deferred) result.state='PARTIAL';
      return result;
    },
  };
}
