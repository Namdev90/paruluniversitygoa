// Server-side state preparation only. A configured relay must independently pass
// real transport/revocation acceptance; these adapters never fabricate delivery.
export function voiceReadiness(state = {}, now = Date.now()) {
 const blockers=[];
 if(state.configured!==true)blockers.push('RELAY_NOT_CONFIGURED');
 if(state.leaseEnforced!==true||state.workerDeathVerified!==true)blockers.push('ACTIVE_MEDIA_FAILSAFE_NOT_VERIFIED');
 if(state.revocationVerified!==true || !['cloud-explicit-cutoff','guarded-admission'].includes(state.revocationMode))blockers.push('REVOCATION_NOT_VERIFIED');
 if(!Number.isFinite(state.workerAt) || now-state.workerAt>3000 || state.workerAt>now+1000)blockers.push('WORKER_NOT_FRESH');
 return {ready:blockers.length===0,blockers};
}
const unavailable=()=>({error:'Voice is unavailable. Rejoin when communications are ready.',status:503});
export function createVoiceControl({rpc,relay,clock=Date.now,relayTimeoutMs=2000}) {
 if(typeof rpc!=='function')throw TypeError('Voice RPC adapter required');
 if(!Number.isFinite(relayTimeoutMs)||relayTimeoutMs<=0||relayTimeoutMs>2000)throw TypeError('Bounded relay timeout required');
 async function bounded(work) {
  let timer;const controller=new AbortController();
  try {return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Relay deadline exceeded'));},relayTimeoutMs);})]);}
  finally {clearTimeout(timer);}
 }
 async function ready() {try{return voiceReadiness(await bounded(()=>relay?.readiness?.()),clock()).ready;}catch{return false;}}
 async function acquire(payload,token,{prepare='floor-prepare'}={}) {
  if(!relay || typeof relay.revoke!=='function' || typeof relay.grant!=='function' ||
     !await ready())return unavailable();
  let operation;
  try {operation=await bounded(()=>rpc(prepare,payload,token));}catch{return unavailable();}
  if(operation?.error)return operation;
  if(!operation?.operationId || !operation.room || !operation.identity || !Number.isSafeInteger(operation.generation))return unavailable();
  const expiresAt=Date.parse(operation.expiresAt);
  if(!operation.leaseId||!Number.isFinite(expiresAt)||expiresAt<=clock()||expiresAt>clock()+15000) {
   try{await bounded(()=>rpc('floor-fail',{operationId:operation.operationId,generation:operation.generation,ambiguousGrant:false},token));}catch{}
   return unavailable();
  }
  if(operation.state==='active')return operation;
  let grantAttempted=false,grantConfirmed=false,compensated=false;
  try {
   await Promise.all((operation.revoke??[]).map(async previous=>{
    const result=await bounded(signal=>relay.revoke({...previous,strict:true,cutoff:Math.floor(clock()/1000),generation:previous.generation??operation.generation},{signal}));
    if(result?.revoked!==true)throw Error('Revoke not acknowledged');
   }));
   // Configuration/worker health can change while a preemption RPC is pending.
   if(!await ready()||expiresAt<=clock())throw Error('Worker or lease lost');
   grantAttempted=true;
   const result=await bounded(signal=>relay.grant({room:operation.room,identity:operation.identity,generation:operation.generation,leaseId:operation.leaseId,expiresAt:operation.expiresAt,sources:['microphone']},{signal}));
   if(result?.granted!==true||result.leaseEnforced!==true||result.leaseId!==operation.leaseId||
      result.generation!==operation.generation||result.expiresAt!==operation.expiresAt||expiresAt<=clock())throw Error('Fenced grant not acknowledged');
   grantConfirmed=true;
   const committed=await bounded(()=>rpc('floor-commit',{operationId:operation.operationId,generation:operation.generation},token));
   if(committed?.error||committed?.state!=='active'||committed.leaseId!==operation.leaseId||
      committed.generation!==operation.generation||committed.expiresAt!==operation.expiresAt||expiresAt<=clock())throw Error('State or lease changed');
   return committed;
  } catch {
   // Retain durable work even if compensation itself fails. A real worker must
   // reconcile it before another lease can be granted; never return a token here.
   if(grantAttempted)try {const revoked=await bounded(signal=>relay.revoke({room:operation.room,identity:operation.identity,strict:true,cutoff:Math.floor(clock()/1000),generation:operation.generation},{signal}));compensated=revoked?.revoked===true;}catch{}
   try {await bounded(()=>rpc('floor-fail',{operationId:operation.operationId,generation:operation.generation,ambiguousGrant:grantAttempted&&(!grantConfirmed||!compensated)},token));}catch{}
   return unavailable();
  }
 }
 return Object.freeze({acquire,transportEvidence:'NOT_RUN'});
}
