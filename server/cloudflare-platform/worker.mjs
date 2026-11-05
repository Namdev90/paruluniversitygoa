import {DurableObject} from 'cloudflare:workers';
import {Pool} from 'pg';
import {PlatformOwner} from './owner.mjs';
export default {async fetch(request,env){
 if(env.VOICE_ENABLED!=='true'||!env.CONTROLLERS||new URL(request.url).pathname!=='/voice')return new Response('Unavailable',{status:503});
 // Forward raw Authorization through binding, never accept a caller-supplied hash.
 return env.CONTROLLERS.getByName('navrang-voice-controller-v1').fetch(request);
}};
export class NavrangController extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.owner=new PlatformOwner(ctx,env,{poolFactory:connectionString=>new Pool({connectionString,max:2,connectionTimeoutMillis:1000,statement_timeout:1000,query_timeout:1200})});}
 fetch(request){return this.owner.fetch(request);}
 alarm(){return this.owner.alarm();}
}
