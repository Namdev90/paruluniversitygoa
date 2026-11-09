/** Resolve a raw app bearer with the restricted active-administrator boundary; never trust caller-supplied hashes or roles. */
export function createReleaseActorVerifier({pool,quota,subtle=globalThis.crypto?.subtle}={}) {
 if(typeof pool?.connect!=='function'||typeof quota?.consume!=='function'||typeof subtle?.digest!=='function')throw TypeError('Private actor verification required');
 return async (bearer,_candidate,{signal}={})=>{
  if(typeof bearer!=='string'||!/^Bearer [a-f0-9]{64}$/.test(bearer)||signal?.aborted)return false;
  let client,released=false;
  const release=destroy=>{if(client&&!released){released=true;client.release(destroy);}};
  const onAbort=()=>release(true);
  try {
   const digest=new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(bearer.slice(7))));signal?.throwIfAborted();
   const hash=Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');digest.fill(0);
   const pending=Promise.resolve().then(()=>{signal?.throwIfAborted();return pool.connect();});
   pending.then(c=>{if(signal?.aborted&&!released){released=true;c.release(true);}}).catch(()=>{});
   client=await pending;signal?.throwIfAborted();signal?.addEventListener('abort',onAbort,{once:true});
   if(await quota.consume({kind:'database',signal})!==true)return false;signal?.throwIfAborted();
   const r=await client.query({text:'select navrang_notification_bridge.is_active_admin($1::text) as result',values:[hash],query_timeout:1500});signal?.throwIfAborted();
   return r.rows?.[0]?.result===true;
  }catch{release(true);return false;}finally{signal?.removeEventListener('abort',onAbort);release(false);}
 };
}
