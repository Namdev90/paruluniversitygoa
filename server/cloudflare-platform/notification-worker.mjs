import {DurableObject} from 'cloudflare:workers';
import {Pool} from 'pg';
import {NotificationOwner} from './notification-owner.mjs';

// No schedule, URL or operational bindings are configured by default.
export default {
 async fetch(request,env){
  if(env.RELEASE_HINT_ENABLED!=='true'||!env.NOTIFICATION_OWNER||request.method!=='POST'||new URL(request.url).pathname!=='/release-hint')return new Response('Unavailable',{status:404});
  return env.NOTIFICATION_OWNER.getByName('navrang-notification-owner-v1').fetch(request);
 },
 async scheduled(_event,env,ctx){
  if(env.NOTIFICATION_ENABLED!=='true'||!env.NOTIFICATION_OWNER)return;
  ctx.waitUntil(env.NOTIFICATION_OWNER.getByName('navrang-notification-owner-v1').run());
 }
};
export class NavrangNotificationOwner extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.owner=new NotificationOwner(ctx,env,{poolFactory:connectionString=>new Pool({connectionString,max:2,connectionTimeoutMillis:1000,statement_timeout:1500,query_timeout:1800})});}
 run(){return this.owner.scheduled();}
 async fetch(request){
  if(request.method!=='POST'||!/^Bearer [a-f0-9]{64}$/.test(request.headers.get('Authorization')??'')||!request.body)return new Response('Unavailable',{status:503});
  const reader=request.body.getReader();let timer,parts=[],size=0;
  try{
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('Body timeout'));},2000);});
   for(;;){const part=await Promise.race([reader.read(),deadline]);if(part.done)break;size+=part.value.length;if(size>1024){void reader.cancel().catch(()=>{});throw Error('Body too large');}parts.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   const result=await this.owner.releaseHint(value,request.headers.get('Authorization'),{signal:request.signal});
   return Response.json(result,{status:result.state==='ACCEPTED'||result.state==='ALREADY_CLAIMED'?200:503,headers:{'Cache-Control':'no-store'}});
  }catch{return new Response('Unavailable',{status:503});}
  finally{clearTimeout(timer);try{reader.releaseLock();}catch{}}
 }
}
