import {createReleaseHintTransport} from '../functions/navrang-gate/release-hints.mjs';

const unavailable=()=>({state:'UNAVAILABLE'});
function canonical(release){
 try{
  if(!release||typeof release!=='object'||Array.isArray(release)||
    !(Object.getPrototypeOf(release)===Object.prototype||Object.getPrototypeOf(release)===null))return null;
  const fields=Object.getOwnPropertyDescriptors(release);
  if(Object.keys(fields).sort().join(',')!=='sha256,versionCode'||!('value' in fields.versionCode)||!('value' in fields.sha256))return null;
  const versionCode=fields.versionCode.value,sha256=fields.sha256.value;
  if(!Number.isSafeInteger(versionCode)||versionCode<1||versionCode>2147483647||typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256))return null;
  return Object.freeze({versionCode,sha256});
 }catch{return null;}
}

/** Server-only release trigger. No endpoint, identity, credentials, DB or network is created here.
 * authorize must compare the candidate with an independently verified, signed,
 * published release manifest and the trusted server-side caller; it may never accept
 * a client-supplied assertion or a principal check alone.
 * ledger.reserve must durably and atomically claim the immutable version+digest before
 * any publish; it must reject a version reused with a different digest. Duplicate or
 * uncertain claims remain fenced across process restarts. Neither
 * this function nor the ledger may automatically retry an ambiguous provider response.
 */
export function createCloudflareReleaseHintTrigger({enabled=false,authorize,ledger,projectId,accessToken,fetchImpl=globalThis.fetch,timeoutMs=10000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw TypeError('Bounded release trigger required');
 let closed=false;const operations=new Set();
 const dependencies=()=>typeof authorize==='function' && typeof ledger?.reserve==='function' && typeof ledger?.finish==='function' &&
  /^[a-z][a-z0-9-]{4,62}$/.test(projectId??'') && typeof accessToken==='function' && typeof fetchImpl==='function';
 const configured=()=>enabled===true && !closed && dependencies();
 async function publish(release,trustedContext,{signal}={}){
  const candidate=canonical(release);
  if(!configured()||!candidate||signal?.aborted)return unavailable();
  const stop=new AbortController();operations.add(stop);let timer,onAbort;
  const cancelled=()=>stop.signal.aborted||closed;
  const alive=()=>{if(cancelled())throw Error('Release request unavailable');};
  const interrupted=new Promise((_,reject)=>{
   stop.signal.addEventListener('abort',()=>reject(Error('Release request unavailable')),{once:true});
   onAbort=()=>stop.abort();
   signal?.addEventListener('abort',onAbort,{once:true});
   if(signal?.aborted)onAbort();
   timer=setTimeout(onAbort,timeoutMs);
  });
  const work=(async()=>{
   try{
    if(await authorize(trustedContext,candidate,{signal:stop.signal})!==true)return unavailable();alive();
    const claim=await ledger.reserve(candidate,{signal:stop.signal});alive();
    if(claim==='duplicate')return {state:'ALREADY_CLAIMED'};
    if(claim!=='claimed')return unavailable();
    // Revocation while the claim was being persisted must prevent a send.
    if(await authorize(trustedContext,candidate,{signal:stop.signal})!==true)return unavailable();alive();
    const guardedToken=async options=>{alive();const token=await accessToken(options);alive();
     if(await authorize(trustedContext,candidate,{signal:stop.signal})!==true)throw Error('Release request unavailable');
     alive();return token;};
    const guardedFetch=async (url,options)=>{
     alive();if(options.signal?.aborted)throw Error('Release request unavailable');
     const response=await fetchImpl(url,options);alive();
     if(!response?.body||response.redirected)throw Error('Release request unavailable');
     const reader=response.body.getReader(),parts=[];let size=0;
     const cancelReader=()=>{void reader.cancel().catch(()=>{});};stop.signal.addEventListener('abort',cancelReader,{once:true});
     try{for(;;){alive();const part=await reader.read();alive();if(part.done)break;
       size+=part.value.length;if(size>16384){void reader.cancel().catch(()=>{});throw Error('Release request unavailable');}parts.push(part.value);}}
     finally{stop.signal.removeEventListener('abort',cancelReader);reader.releaseLock();}
     const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
     let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
     return {ok:response.ok,json:async()=>data};
    };
    const transport=createReleaseHintTransport({projectId,accessToken:guardedToken,fetchImpl:guardedFetch});
    const result=await transport.publish(candidate,{signal:stop.signal});alive();
    if(result?.accepted!==true){await ledger.finish(candidate,'unknown',{signal:stop.signal});return unavailable();}
    await ledger.finish(candidate,'accepted',{signal:stop.signal});alive();
    return {state:'ACCEPTED'};
   }catch{return unavailable();}
  })();
  try{return await Promise.race([work,interrupted]);}catch{return unavailable();}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);operations.delete(stop);stop.abort();}
 }
 return Object.freeze({configured,publish,close(){closed=true;for(const operation of operations)operation.abort();}});
}
