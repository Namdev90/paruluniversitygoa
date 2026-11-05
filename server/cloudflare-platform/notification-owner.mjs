import {createScheduledNotificationDispatcher} from './notification-dispatcher.mjs';
import {createCloudflareReleaseHintTrigger} from './release-hint-trigger.mjs';
import {createPublishedReleaseAuthorizer} from './release-manifest-authorizer.mjs';
import {createReleaseActorVerifier} from './release-actor.mjs';
import {ReleaseLedger} from './release-ledger.mjs';
import {importOriginalReleaseSigner} from './release-certificate.mjs';
import {createFcmOAuthProvider} from '../voice/fcm-oauth.mjs';

/** One SQLite-backed scheduled owner. Defaults remain disabled; construction performs no I/O beyond local metadata. */
export class NotificationOwner {
 constructor(ctx,env,{poolFactory,subtle=globalThis.crypto?.subtle,fetchImpl=globalThis.fetch,clock=Date.now,dispatcherFactory=createScheduledNotificationDispatcher}={}) {
  this.ctx=ctx;this.env=env;this.poolFactory=poolFactory;this.subtle=subtle;this.fetchImpl=fetchImpl;this.clock=clock;this.dispatcherFactory=dispatcherFactory;this.busy=false;this.poisoned=false;
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS notification_budget (kind TEXT PRIMARY KEY, day INTEGER NOT NULL, operations INTEGER NOT NULL)');
 }
 consume({kind,signal}={}) {
  signal?.throwIfAborted();const limits={database:10000,release_actor:100,oauth:1000,fcm:1000,manifest:1000};
  if(!Object.hasOwn(limits,kind))return false;
  const now=this.clock();if(!Number.isSafeInteger(now)||now<0)return false;const day=Math.floor(now/86400000);
  const row=this.ctx.storage.sql.exec('SELECT day,operations FROM notification_budget WHERE kind=?',kind).toArray()[0];
  if(row&&day<row.day)return false;const count=row?.day===day?row.operations:0;if(count>=limits[kind])return false;
  this.ctx.storage.sql.exec('INSERT INTO notification_budget(kind,day,operations) VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET day=excluded.day,operations=excluded.operations',kind,day,count+1);return true;
 }
 async scheduled() {
  const e=this.env;
  if(this.poisoned)return {state:'UNAVAILABLE'};
  if(this.busy)return {state:'BUSY'};
  if(e.NOTIFICATION_ENABLED!=='true'||e.NOTIFICATION_QUALIFIED!=='true'||e.AUTH_DB_CACHE_DISABLED!=='true'||
    !e.NOTIFICATION_DB?.connectionString||!e.FCM_SERVICE_ACCOUNT_KEY||!e.FCM_PROJECT_ID||!e.FCM_SERVICE_ACCOUNT_EMAIL||!e.FCM_KEY_ID||
    typeof this.poolFactory!=='function'||typeof this.subtle?.importKey!=='function')return {state:'NOT_RUN'};
  this.busy=true;let pool,dispatcher,timer;const stop=new AbortController();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stop.abort();reject(Error('Scheduled deadline'));},15000);});
  const work=(async()=>{
   const key=await this.subtle.importKey('jwk',JSON.parse(e.FCM_SERVICE_ACCOUNT_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
   stop.signal.throwIfAborted();pool=this.poolFactory(e.NOTIFICATION_DB.connectionString);stop.signal.throwIfAborted();
   dispatcher=this.dispatcherFactory({enabled:true,pool,quota:{consume:args=>this.consume(args)},projectId:e.FCM_PROJECT_ID,key,
    email:e.FCM_SERVICE_ACCOUNT_EMAIL,kid:e.FCM_KEY_ID,fetchImpl:this.fetchImpl,subtle:this.subtle,clock:this.clock});
   return await dispatcher.scheduled({signal:stop.signal});
  })();
  try{return await Promise.race([work,deadline]);}
  catch{return {state:'UNAVAILABLE'};}
  finally{
   clearTimeout(timer);stop.abort();try{dispatcher?.close();}catch{this.poisoned=true;}
   if(pool){let closeTimer;try{await Promise.race([pool.end(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Pool close timeout')),1500);})]);}
    catch{this.poisoned=true;}finally{clearTimeout(closeTimer);}}
   this.busy=false;
  }
 }
 /** Called only through the Worker entrypoint; actor and published signed manifest are independently rechecked. */
 async releaseHint(candidate,bearer,{signal}={}){
  const e=this.env;
  if(signal?.aborted||this.busy||this.poisoned||e.RELEASE_SIGNER_VERIFIED!=='true'||e.RELEASE_HINT_ENABLED!=='true'||e.RELEASE_HINT_QUALIFIED!=='true'||e.AUTH_DB_CACHE_DISABLED!=='true'||
   !e.NOTIFICATION_DB?.connectionString||!e.FCM_SERVICE_ACCOUNT_KEY||!e.FCM_PROJECT_ID||!e.FCM_SERVICE_ACCOUNT_EMAIL||!e.FCM_KEY_ID||
   !e.RELEASE_SIGNER_CERTIFICATE_DER||!/^Bearer [a-f0-9]{64}$/.test(bearer??'')||
   typeof this.poolFactory!=='function'||typeof this.subtle?.importKey!=='function')return {state:'UNAVAILABLE'};
  this.busy=true;let pool,token,trigger,timer;const stop=new AbortController();
  const abort=()=>stop.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{stop.abort();reject(Error('Release deadline'));},15000);});
  const interrupted=new Promise((_,reject)=>{if(stop.signal.aborted)reject(Error('Release cancelled'));else stop.signal.addEventListener('abort',()=>reject(Error('Release cancelled')),{once:true});});
  const work=(async()=>{
   const publicKey=await importOriginalReleaseSigner(e.RELEASE_SIGNER_CERTIFICATE_DER,{subtle:this.subtle});stop.signal.throwIfAborted();
   const key=await this.subtle.importKey('jwk',JSON.parse(e.FCM_SERVICE_ACCOUNT_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);stop.signal.throwIfAborted();
   pool=this.poolFactory(e.NOTIFICATION_DB.connectionString);stop.signal.throwIfAborted();
   const quota={consume:args=>this.consume(args)};
   const fetchGuard=async(url,options={})=>{
    stop.signal.throwIfAborted();const value=String(url);
    const kind=value==='https://oauth2.googleapis.com/token'?'oauth':value===`https://fcm.googleapis.com/v1/projects/${e.FCM_PROJECT_ID}/messages:send`?'fcm':value==='https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/updates/latest.json'?'manifest':null;
    if(!kind||!this.consume({kind,signal:stop.signal}))throw Error('Release quota exhausted');
    const signal=options.signal?AbortSignal.any([stop.signal,options.signal]):stop.signal;signal.throwIfAborted();
    const response=await this.fetchImpl(value,{...options,redirect:'error',signal});signal.throwIfAborted();return response;
   };
   token=createFcmOAuthProvider({key,email:e.FCM_SERVICE_ACCOUNT_EMAIL,kid:e.FCM_KEY_ID,enabled:true,subtle:this.subtle,fetchImpl:fetchGuard,clock:this.clock});
   if(!token.configured())throw Error('Issuer unavailable');
   const releaseActorQuota={consume:args=>quota.consume({...args,kind:'release_actor'})};
   const verifyCaller=createReleaseActorVerifier({pool,quota:releaseActorQuota,subtle:this.subtle});
   const authorize=createPublishedReleaseAuthorizer({publicKey,verifyCaller,fetchImpl:fetchGuard,subtle:this.subtle});
   trigger=createCloudflareReleaseHintTrigger({enabled:true,authorize,ledger:new ReleaseLedger(this.ctx.storage.sql),projectId:e.FCM_PROJECT_ID,accessToken:token,fetchImpl:fetchGuard});
   return await trigger.publish(candidate,bearer,{signal:stop.signal});
  })();
  try{return await Promise.race([work,deadline,interrupted]);}catch{return {state:'UNAVAILABLE'};}
  finally{
   clearTimeout(timer);stop.abort();signal?.removeEventListener('abort',abort);try{trigger?.close();token?.close();}catch{this.poisoned=true;}
   if(pool){let closeTimer;try{await Promise.race([pool.end(),new Promise((_,reject)=>{closeTimer=setTimeout(()=>reject(Error('Pool close timeout')),1500);})]);}
    catch{this.poisoned=true;}finally{clearTimeout(closeTimer);}}
   this.busy=false;
  }
 }

}
