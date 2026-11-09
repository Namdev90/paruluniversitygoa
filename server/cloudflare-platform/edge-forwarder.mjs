import {validateCommunication} from '../functions/navrang-gate/communications-contract.mjs';
const controlOrigin='https://navrang-voice-control.navrang-gate.workers.dev';
export function configuredVoiceControlOrigin(value){
 return value===controlOrigin?value:undefined;
}
const actions=new Set(['duty-join','duty-heartbeat','duty-leave','voice-join','voice-floor','voice-renew','voice-release','voice-broadcast-start','voice-broadcast-end','voice-invite']);
const fail=()=>new Response(JSON.stringify({ok:false,error:'Voice unavailable'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
/** Only existing validated voice intent and the raw existing bearer cross this boundary. */
export function createEdgeVoiceForwarder({origin,fetchImpl=fetch}={}){
 let endpoint;
 if(origin){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.port||u.username||u.password||!u.hostname.includes('.')||/^[0-9.]+$/.test(u.hostname))throw Error('Approved control origin required');endpoint=origin+'/voice';}
 return async(request,fallback)=>{
  if(!endpoint||request.method!=='POST')return fallback(request);
  let reader,timer;
  try{
   const clone=request.clone();reader=clone.body?.getReader();if(!reader)return fallback(request);
   const stop=new Promise((_,reject)=>{timer=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(Error('Body timeout'));},2000);});let size=0,chunks=[];
   for(;;){const part=await Promise.race([reader.read(),stop]);if(part.done)break;size+=part.value.length;if(size>12288){void reader.cancel().catch(()=>{});return fallback(request);}chunks.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const body=JSON.parse(new TextDecoder().decode(bytes));if(!actions.has(body.action))return fallback(request);
   if(Object.keys(body).some(k=>!['action','payload'].includes(k)))return fail();
   const payload=validateCommunication(body.action,body.payload);
   const authorization=request.headers.get('Authorization');if(!/^Bearer [a-f0-9]{64}$/.test(authorization??''))return fail();
   const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',headers:{Authorization:authorization,'Content-Type':'application/json'},body:JSON.stringify({action:body.action,payload}),signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])});
   if(response.redirected||!response.body||!response.headers.get('Content-Type')?.startsWith('application/json'))return fail();
   const r=response.body.getReader();let n=0,parts=[];try{for(;;){const part=await r.read();if(part.done)break;n+=part.value.length;if(n>16384){await r.cancel();return fail();}parts.push(part.value);}}finally{r.releaseLock();}
   const result=new Uint8Array(n);offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}
   return new Response(result,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
  }catch{return fail();}finally{clearTimeout(timer);if(reader)try{reader.releaseLock();}catch{}}
 };
}
