import {createCloudflareVoiceRuntime} from '../workers/cloudflare-voice.mjs';
import {createCloudflareIssuer} from '../voice/cloudflare-issuer.mjs';
import {createWorkerConnector} from './connector.mjs';
import {createHandler} from '../functions/navrang-gate/handler.mjs';
const unavailable=()=>new Response(JSON.stringify({ok:false,error:'Voice unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
/** Durable owner logic independent of cloud imports, for deterministic lifecycle tests. */
export class PlatformOwner {
 constructor(ctx,env,{poolFactory,subtle=crypto.subtle,runtimeFactory=createCloudflareVoiceRuntime}={}){
  this.ctx=ctx;this.env=env;this.poolFactory=poolFactory;this.subtle=subtle;this.runtimeFactory=runtimeFactory;this.workerAt=0;this.activeRequests=0;this.cleanupCycle=null;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS usage_budget (id INTEGER PRIMARY KEY CHECK(id=1), day INTEGER NOT NULL, operations INTEGER NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS owner_state (id INTEGER PRIMARY KEY CHECK(id=1), last_activity INTEGER NOT NULL)');
 }
 budget(){const day=Math.floor(Date.now()/86400000);const row=this.ctx.storage.sql.exec('SELECT day,operations FROM usage_budget WHERE id=1').toArray()[0];if(row&&day<row.day)throw Error('Clock rollback');const count=row?.day===day?row.operations:0;if(count>=80000)throw Error('Daily controller budget exhausted');this.ctx.storage.sql.exec('INSERT INTO usage_budget(id,day,operations) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,operations=excluded.operations',day,count+1);}
 async initialize(){
  if(this.initializing)return this.initializing;
  this.initializing=(async()=>{
   const e=this.env;
   if(e.VOICE_ENABLED!=='true'||!e.AUTH_DB?.connectionString||e.AUTH_DB_CACHE_DISABLED!=='true'||!e.ISSUER_PRIVATE_JWK||!e.RELAY_ORIGIN||!e.CONTROLLER_ID||!e.QUALIFICATION_JSON)throw Error('Absent approved bindings');
   const qualification=JSON.parse(e.QUALIFICATION_JSON);
   const key=await this.subtle.importKey('jwk',JSON.parse(e.ISSUER_PRIVATE_JWK),{name:'Ed25519'},false,['sign']);
   const pool=this.poolFactory(e.AUTH_DB.connectionString);
   this.pool={end:()=>pool.end(),connect:async()=>{const client=await pool.connect();return {release:destroy=>client.release(destroy),query:async value=>{this.budget();return client.query(value);}};}};
   const issuer=createCloudflareIssuer({key,issuer:e.AUTH_ISSUER,kid:e.AUTH_KEY_ID,origin:e.RELAY_ORIGIN,enabled:true});
   this.runtime=this.runtimeFactory({pool:this.pool,issuer,connector:createWorkerConnector({origin:e.RELAY_ORIGIN}),origin:e.RELAY_ORIGIN,
    controllerIdentity:e.CONTROLLER_ID,controllerId:e.CONTROLLER_ID,enabled:true,qualification:()=>({...qualification,workerAt:this.workerAt})});
   // Existing request validator and raw bearer hashing remain the only ingress.
   this.handler=createHandler({rpc:async()=>{throw Error('Voice-only endpoint');},googleUser:async()=>null,googleEnabled:async()=>false,voiceService:this.runtime.service});
  })();
  try{await this.initializing;}catch{this.initializing=null;const runtime=this.runtime,pool=this.pool;this.runtime=null;this.pool=null;try{runtime?.close();}catch{}try{await pool?.end();}catch{}throw Error('Platform unavailable');}
 }
 cycle(){
  const runtime=this.runtime;
  // Fetches and alarms can interleave at an await. They must share the actual
  // cleanup result, not interpret the controller's overlap-only BUSY as failure
  // or let a request proceed before that cleanup finishes.
  if(this.cleanupCycle&&this.cleanupCycle.runtime===runtime)return this.cleanupCycle.promise;
  const promise=Promise.resolve().then(async()=>{
   try{
    const result=await runtime.controller.cycle();
    if(this.runtime===runtime)this.workerAt=result.state==='CLEANUP_ONLY'?Date.now():0;
    return result;
   }catch(error){if(this.runtime===runtime)this.workerAt=0;throw error;}
   finally{if(this.cleanupCycle?.promise===promise)this.cleanupCycle=null;}
  });
  this.cleanupCycle={runtime,promise};return promise;
 }
 async fetch(request){
  this.activeRequests++;try{return await this.handle(request);}finally{this.activeRequests--;}
 }
 async handle(request){
  if(request.method!=='POST'||!/^Bearer [a-f0-9]{64}$/.test(request.headers.get('Authorization')??''))return unavailable();
  try{
   // Bound before forwarding into the original handler, which validates again.
   const reader=request.body?.getReader();let bytes=0,chunks=[];
   if(!reader)return unavailable();let timer;const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('Request timeout'));},2000);});try{for(;;){const part=await Promise.race([reader.read(),expired]);if(part.done)break;bytes+=part.value.length;if(bytes>12288){await reader.cancel();return unavailable();}chunks.push(part.value);}}finally{clearTimeout(timer);reader.releaseLock();}
   const body=new Uint8Array(bytes);let offset=0;for(const part of chunks){body.set(part,offset);offset+=part.length;}
   const parsed=JSON.parse(new TextDecoder().decode(body));
   if(!['duty-join','duty-heartbeat','duty-leave','voice-join','voice-floor','voice-renew','voice-release','voice-broadcast-start','voice-broadcast-end','voice-invite'].includes(parsed.action))return unavailable();
   await this.initialize();
   // Persist cleanup wakeup before any grant-related work. Alarm is cleanup only;
   // relay deadlines enforce cutoff independently of alarm scheduling.
   await this.ctx.storage.setAlarm(Date.now()+1000);await this.cycle();
   const response=await this.handler(new Request(request.url,{method:'POST',headers:request.headers,body,signal:request.signal}));
   if(response.status===200)this.ctx.storage.sql.exec('INSERT INTO owner_state(id,last_activity) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_activity=excluded.last_activity',Date.now());
   return response;
  }catch{return unavailable();}
 }
 async alarm(){
  try{await this.initialize();await this.cycle();
   const row=this.ctx.storage.sql.exec('SELECT last_activity FROM owner_state WHERE id=1').toArray()[0];
   if(this.activeRequests>0||row&&Date.now()-row.last_activity<300000)await this.ctx.storage.setAlarm(Date.now()+1000);
   else{this.workerAt=0;const runtime=this.runtime,pool=this.pool;this.initializing=null;this.runtime=null;this.pool=null;runtime.close();await pool.end();}
  }catch{this.workerAt=0;const row=this.ctx.storage.sql.exec('SELECT last_activity FROM owner_state WHERE id=1').toArray()[0];if(this.env.VOICE_ENABLED==='true'&&row&&Date.now()-row.last_activity<300000)await this.ctx.storage.setAlarm(Date.now()+30000);}
 }
}
