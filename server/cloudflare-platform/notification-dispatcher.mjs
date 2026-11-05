// A scheduled invocation only: no HTTP entry point, implicit credentials, or background loop.
import {createCloudflareNotificationStore} from '../workers/notification-store.mjs';
import {createDeliveryWorker} from '../functions/navrang-gate/communications.mjs';
import {createFcmTransport} from '../functions/navrang-gate/fcm-transport.mjs';
import {createFcmOAuthProvider} from '../voice/fcm-oauth.mjs';

/** The deployment must inject a durable, shared, atomic quota.consume({kind,signal}).
 * True means a reservation was persisted before the operation. It must reject
 * quota exhaustion and clock rollback. An in-memory per-isolate counter is not
 * a valid production quota. Construction performs no I/O or key import.
 */
export function createScheduledNotificationDispatcher({enabled=false,pool,quota,projectId,key,email,kid,
 fetchImpl=globalThis.fetch,subtle=globalThis.crypto?.subtle,clock=Date.now,
 budgetMs=12000,adapterTimeoutMs=2000,limit=20}={}) {
 if(!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>30000||!Number.isSafeInteger(adapterTimeoutMs)||
    adapterTimeoutMs<1||adapterTimeoutMs>budgetMs||!Number.isSafeInteger(limit)||limit<1||limit>20)throw TypeError('Invalid scheduled delivery budget');
 let busy=false,closed=false,active;
 const off=()=>({state:'NOT_RUN',accepted:0,retried:0,removed:0,cancelled:0,deferred:0});
 const unavailable=()=>Error('Scheduled notification unavailable');
 const structurallyConfigured=()=>!closed&&enabled===true&&typeof pool?.connect==='function'&&typeof quota?.consume==='function'&&
   typeof fetchImpl==='function'&&/^[a-z][a-z0-9-]{4,62}$/.test(projectId??'');
 async function scheduled({signal}={}) {
  if(!structurallyConfigured()||signal?.aborted)return off();
  if(busy)return {...off(),state:'BUSY'};
  busy=true;const stop=new AbortController();active=stop;
  const external=()=>stop.abort();signal?.addEventListener('abort',external,{once:true});
  let timer;
  const invalid=()=>{if(stop.signal.aborted||signal?.aborted||closed)throw unavailable();};
  const combined=other=>other?AbortSignal.any([stop.signal,other]):stop.signal;
  async function reserve(kind,other){
   invalid();const scoped=combined(other);scoped.throwIfAborted();
   if(await quota.consume({kind,signal:scoped})!==true)throw unavailable();
   scoped.throwIfAborted();invalid();
  }
  const limitedPoolFor=operationSignal=>({async connect(){
   invalid();operationSignal.throwIfAborted();const pending=Promise.resolve().then(()=>{invalid();operationSignal.throwIfAborted();return pool.connect();});let client,released=false;
   const release=(c,destroy)=>{if(c&&!released){released=true;c.release(destroy);}};
   // A late acquisition is immediately destroyed, never used after shutdown.
   pending.then(c=>{if(stop.signal.aborted||operationSignal.aborted||closed)try{release(c,true);}catch{}}).catch(()=>{});
   client=await pending;
   if(stop.signal.aborted||operationSignal.aborted||closed){try{release(client,true);}catch{}throw unavailable();}
   return {release:destroy=>release(client,destroy),async query(query){await reserve('database',operationSignal);invalid();operationSignal.throwIfAborted();return client.query(query);}};
  }});
  const guardedFetch=async(url,options={})=>{
   invalid();const endpoint=String(url);
   if(endpoint!=='https://oauth2.googleapis.com/token'&&endpoint!==`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`)throw unavailable();
   const scoped=combined(options.signal);await reserve(endpoint.startsWith('https://fcm.googleapis.com/')?'fcm':'oauth',scoped);
   scoped.throwIfAborted();invalid();
   const response=await fetchImpl(endpoint,{...options,signal:scoped,redirect:'error'});scoped.throwIfAborted();invalid();
   if(response.redirected||!response.body)throw unavailable();
   // Bound FCM JSON as well as OAuth JSON; never log or return remote error bodies.
   const reader=response.body.getReader();const parts=[];let size=0;
   const cancelBody=()=>{void reader.cancel().catch(()=>{});};scoped.addEventListener('abort',cancelBody,{once:true});
   if(scoped.aborted)cancelBody();
   try{for(;;){scoped.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){void reader.cancel().catch(()=>{});throw unavailable();}parts.push(part.value);}}
   finally{scoped.removeEventListener('abort',cancelBody);reader.releaseLock();}
   scoped.throwIfAborted();invalid();const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   return new Response(bytes,{status:response.status,headers:{'Content-Type':response.headers.get('Content-Type')??'application/json'}});
  };
  let token;
  try{
   invalid();token=createFcmOAuthProvider({key,email,kid,enabled:true,subtle,fetchImpl:guardedFetch,clock,timeoutMs:Math.min(3000,budgetMs)});
   if(!token.configured())return off();
   const store={};for(const action of ['claim','check','finish'])store[action]=async(...args)=>{
    invalid();const supplied=args.at(-1);if(!supplied||typeof supplied!=='object')throw unavailable();
    const operationSignal=combined(supplied.signal);
    args[args.length-1]={...supplied,signal:operationSignal};
    const value=await createCloudflareNotificationStore(limitedPoolFor(operationSignal))[action](...args);operationSignal.throwIfAborted();invalid();return value;
   };
   const raw=createFcmTransport({projectId,accessToken:token,fetchImpl:guardedFetch});
   const push={configured:true,async send(job,options={}){invalid();const value=await raw.send(job,{...options,signal:combined(options.signal)});invalid();return value;}};
   const worker=createDeliveryWorker({store,push,adapterTimeoutMs,batchBudgetMs:budgetMs});
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stop.abort();reject(unavailable());},budgetMs);});
   const aborted=new Promise((_,reject)=>stop.signal.addEventListener('abort',()=>reject(unavailable()),{once:true}));
   const result=await Promise.race([worker.dispatchBatch({limit}),deadline,aborted]);invalid();return result;
  }catch{return {...off(),state:'UNAVAILABLE'};}
  finally{clearTimeout(timer);stop.abort();signal?.removeEventListener('abort',external);token?.close();if(active===stop)active=null;busy=false;}
 }
 function close(){closed=true;active?.abort();}
 return Object.freeze({scheduled,close,configured:structurallyConfigured});
}
