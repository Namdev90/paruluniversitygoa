import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {strictDailyDeletion} from './daily-service.mjs';
import {strictCloudflareRevocation} from './cloudflare-service.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A persistent cleanup process, never an Edge invocation per second. The
// durable SQL queue survives this process; media expiry must separately be
// enforced inside the relay even if this process and its network disappear.
// The injected store calls the existing private voice function over an already
// authorized database connection. No client action or public endpoint is added.
export function createVoiceController({store,relay,controllerId=randomUUID(),intervalMs=1000,
 adapterTimeoutMs=1500,cycleBudgetMs=2500,clock=()=>performance.now(),wait=sleep}={}) {
 if(!store||!['claim','poll','ack','heartbeat','release'].every(key=>typeof store[key]==='function'))throw TypeError('Durable voice store required.');
 if(!relay||typeof relay.revoke!=='function')throw TypeError('Strict revocation adapter required.');
 if(!uuid.test(controllerId)||!Number.isInteger(intervalMs)||intervalMs<100||intervalMs>1000||
    !Number.isInteger(adapterTimeoutMs)||adapterTimeoutMs<1||adapterTimeoutMs>2000||
    !Number.isInteger(cycleBudgetMs)||cycleBudgetMs<adapterTimeoutMs||cycleBudgetMs>3000||
    typeof clock!=='function'||typeof wait!=='function')throw TypeError('Invalid controller deadlines.');
 let running=false,cycleRunning=false;
 async function cycle({signal}={}) {
  if(cycleRunning)return {state:'BUSY',acked:0};
  cycleRunning=true;
  const began=clock();let acked=0;
  const remaining=()=>cycleBudgetMs-(clock()-began);
  async function bounded(operation) {
   if(signal?.aborted||remaining()<=0)throw Error('Controller stopped.');
   const aborter=new AbortController();let timer;
   const abort=()=>aborter.abort();signal?.addEventListener('abort',abort,{once:true});
   try {
    return await Promise.race([
     Promise.resolve().then(()=>operation(aborter.signal)),
     new Promise((_,reject)=>{
      timer=setTimeout(()=>{aborter.abort();reject(Error('Controller deadline exceeded.'));},Math.min(adapterTimeoutMs,remaining()));
      aborter.signal.addEventListener('abort',()=>reject(Error('Controller operation aborted.')),{once:true});
     }),
    ]);
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  try {
   const claim=await bounded(signal=>store.claim(controllerId,{signal}));
   if(claim?.claimed!==true)return {state:'STANDBY',acked};
   const batch=await bounded(signal=>store.poll(controllerId,{signal}));
   if(!Array.isArray(batch?.commands)||batch.commands.length>32)throw Error('Invalid durable voice batch.');
   for(const command of batch.commands) {
    if(command.operation!=='revoke'||!uuid.test(command.commandId)||!uuid.test(command.room)||
       !uuid.test(command.identity)||!Number.isSafeInteger(command.generation)||command.generation<0)throw Error('Invalid removal command.');
    if(remaining()<adapterTimeoutMs)return {state:'PARTIAL',acked};
    let receipt;
    if(command.plan?.provider==='daily') {
     if(typeof relay.deleteLeaseRoom!=='function'||typeof store.ackDaily!=='function')throw Error('Daily room cleanup unavailable.');
     const result=await bounded(signal=>relay.deleteLeaseRoom(command.plan,{signal}));
     if(!strictDailyDeletion(result,command.plan))throw Error('Strict room deletion unacknowledged.');
     receipt=await bounded(signal=>store.ackDaily(controllerId,command,command.plan,result,{signal}));
    } else if(command.plan?.provider==='navrang-relay-v1') {
     if(typeof store.ackRelay!=='function')throw Error('Relay room cleanup unavailable.');
     const result=await bounded(signal=>relay.revoke(command.plan,{signal}));
     if(!strictCloudflareRevocation(result,command.plan))throw Error('Strict relay cutoff unacknowledged.');
     receipt=await bounded(signal=>store.ackRelay(controllerId,command,command.plan,result,{signal}));
    } else {
    // A provider-bound plan can never fall back to legacy participant removal.
    if(command.plan!=null)throw Error('Unknown immutable provider plan.');
    const result=await bounded(signal=>relay.revoke({room:command.room,identity:command.identity,
     generation:command.generation,strict:true},{signal}));
    // Being sent, a 404, or absence in a participant listing does not prove
    // revoked cached credentials. Only strict cutoff acceptance can ACK.
    if(result?.revoked!==true)throw Error('Strict removal unacknowledged.');
    receipt=await bounded(signal=>store.ack(controllerId,command.commandId,command.generation,{signal}));
    }
    if(receipt?.state!=='acked')throw Error('Removal receipt rejected.');
    acked++;
   }
   if(batch.more===true)return {state:'PARTIAL',acked};
   const heartbeat=await bounded(signal=>store.heartbeat(controllerId,{signal}));
   if(heartbeat?.observed!==true)throw Error('Heartbeat rejected.');
   return {state:'CLEANUP_ONLY',acked};
  }catch{return {state:signal?.aborted?'STOPPED':'DEGRADED',acked};}
  finally{cycleRunning=false;}
 }
 async function run({signal,onCycle=()=>{}}={}) {
  if(!signal)throw TypeError('A shutdown signal is required.');
  if(running)throw Error('Controller is already running.');
  running=true;
  try {
   while(!signal.aborted) {
    const began=clock();const result=await cycle({signal});
    // Observability receives only fixed status/counts, never room IDs, tokens,
    // staff identities, backend responses or provider error messages.
    try{onCycle(result);}catch{}
    if(!signal.aborted)try{await wait(Math.max(10,intervalMs-(clock()-began)),undefined,{signal});}catch{if(!signal.aborted)break;}
   }
  }finally{
   running=false;
   // Abrupt death relies on SQL ownership timeout and the independent media
   // fence. Graceful release is an optimization, never a safety proof.
   let timer;
   try{await Promise.race([Promise.resolve().then(()=>store.release(controllerId,{signal:AbortSignal.timeout(adapterTimeoutMs)})),
    new Promise(resolve=>{timer=setTimeout(resolve,adapterTimeoutMs);})]);}catch{}
   finally{clearTimeout(timer);}
  }
 }
 return Object.freeze({cycle,run,controllerId,transportEvidence:'NOT_RUN'});
}

