// Direct access through an existing operator-provisioned database identity.
// No public endpoint, role switch, privilege change or dynamic SQL function.
function createVoiceCaller(pool,{timeoutMs=1200}={},authenticated=false,narrow=false) {
 if(typeof pool?.connect!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1500)throw TypeError('Bounded PostgreSQL pool required.');
 async function call(action,p,{signal}={},actorToken='') {
  const stop=new AbortController();let timer,client,released=false,rejectAbort;
  const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
  const cancel=()=>stop.abort();
  const interrupted=new Promise((_,reject)=>{rejectAbort=reject;});
  const onAbort=()=>{release(true);rejectAbort(Error('Voice database request stopped.'));};
  stop.signal.addEventListener('abort',onAbort,{once:true});
  signal?.addEventListener('abort',cancel,{once:true});
  // Attach the race before asynchronous acquisition so late connections are
  // destroyed after cancellation rather than leaked or used for delayed work.
  const connect=Promise.resolve().then(()=>{
   if(signal?.aborted||stop.signal.aborted)throw Error('Stopped.');
   return pool.connect();
  }).then(value=>{
   if(stop.signal.aborted){value.release(true);throw Error('Stopped.');}
   client=value;return value;
  });
  try {
   timer=setTimeout(cancel,timeoutMs);
   await Promise.race([connect,interrupted]);
   if(signal?.aborted||stop.signal.aborted)throw Error('Stopped.');
   const response=await Promise.race([client.query({
    text:narrow?(authenticated?"select navrang_voice_worker_api.actor($1::text,$2::jsonb,$3::text) as result":
     "select navrang_voice_worker_api.controller($1::text,$2::jsonb) as result"):
     (authenticated?"select navrang_private.voice_rpc($1::text,$2::jsonb,$3::text) as result":
     "select navrang_private.voice_rpc($1::text,$2::jsonb,''::text) as result"),
    values:authenticated?[action,JSON.stringify(p),actorToken]:[action,JSON.stringify(p)],query_timeout:timeoutMs,
   }),interrupted]);
   if(signal?.aborted||stop.signal.aborted)throw Error('Stopped.');
   const data=response.rows[0]?.result;
   if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid store response.');
   return data;
  }catch{release(true);throw Error('Voice controller store is unavailable.');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);stop.signal.removeEventListener('abort',onAbort);release();}
 }
 return call;
}
export function createVoiceControllerStore(pool,options) {
 const call=createVoiceCaller(pool,options);
 return Object.freeze({
  claim:(controllerId,options)=>call('controller-claim',{controllerId},options),
  poll:(controllerId,options)=>call('controller-poll',{controllerId},options),
  ack:(controllerId,commandId,generation,options)=>call('controller-ack',{controllerId,commandId,generation},options),
  ackDaily:(controllerId,command,plan,receipt,options)=>call('controller-daily-ack',{controllerId,
   operationId:command.operationId,commandId:command.commandId,generation:command.generation,plan,receipt},options),
  ackRelay:(controllerId,command,plan,receipt,options)=>call('controller-relay-ack',{controllerId,
   operationId:command.operationId,commandId:command.commandId,generation:command.generation,plan,receipt},options),
  heartbeat:(controllerId,options)=>call('controller-heartbeat',{controllerId},options),
  release:(controllerId,options)=>call('controller-release',{controllerId},options),
 });
}

// These are server-private operations, not additional public/app actions.
const dailyActions=new Set(['duty-join','duty-heartbeat','duty-leave','voice-join','voice-invite','voice-broadcast-start',
 'voice-broadcast-end','voice-release','floor-prepare','floor-fail','daily-plan','daily-receive','daily-renew-prepare','daily-ack','daily-commit']);
export function createDailyVoiceStore(pool,options) {
 const call=createVoiceCaller(pool,options,true);
 return Object.freeze({rpc(action,p,actorToken,options){
  if(!dailyActions.has(action)||typeof actorToken!=='string'||!/^[a-f0-9]{64}$/.test(actorToken))throw TypeError('Private authenticated voice action required.');
  return call(action,p,options,actorToken);
 }});
}

// Actor-bound Cloudflare phases stay private; the parameterized SQL function
// retains its own actor/duty/audience/current-operation authorization checks.
const cloudflareActions=new Set(['duty-join','duty-heartbeat','duty-leave','voice-join','voice-invite','voice-broadcast-start',
 'voice-broadcast-end','voice-release','floor-prepare','floor-fail','relay-operation','relay-plan','relay-receive',
 'relay-renew-prepare','relay-ack','relay-commit']);
export function createCloudflareVoiceStore(pool,options) {
 const call=createVoiceCaller(pool,options,true,true);
 return Object.freeze({rpc(action,p,actorToken,options){
  if(!cloudflareActions.has(action)||typeof actorToken!=='string'||!/^[a-f0-9]{64}$/.test(actorToken))
   throw TypeError('Private authenticated relay action required.');
  return call(action,p,options,actorToken);
 }});
}

// Cloudflare credentials receive only the reviewed boundary capability. Legacy
// providers keep the explicitly separate private adapter above. No fallback.
export function createCloudflareVoiceControllerStore(pool,options) {
 const call=createVoiceCaller(pool,options,false,true);
 return Object.freeze({
  claim:(controllerId,options)=>call('controller-claim',{controllerId},options),
  poll:(controllerId,options)=>call('controller-poll',{controllerId},options),
  ack:(controllerId,commandId,generation,options)=>call('controller-ack',{controllerId,commandId,generation},options),
  ackRelay:(controllerId,command,plan,receipt,options)=>call('controller-relay-ack',{controllerId,
   operationId:command.operationId,commandId:command.commandId,generation:command.generation,plan,receipt},options),
  heartbeat:(controllerId,options)=>call('controller-heartbeat',{controllerId},options),
  release:(controllerId,options)=>call('controller-release',{controllerId},options),
 });
}
