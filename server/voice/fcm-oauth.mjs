// Existing server-side identity only. No key import, generation, persistence or discovery.
const ENDPOINT='https://oauth2.googleapis.com/token';
const SCOPE='https://www.googleapis.com/auth/firebase.messaging';
const fail=()=>Error('FCM authorization unavailable');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function createFcmOAuthProvider({key,email,kid,enabled=false,subtle=globalThis.crypto?.subtle,
 fetchImpl=globalThis.fetch,clock=Date.now,timeoutMs=3000}={}) {
 if(typeof clock!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw TypeError('Bounded OAuth dependencies required');
 let cached,expires=0,last=-1,closed=false,pending;
 const configured=()=>!closed&&enabled===true&&key?.type==='private'&&key.extractable===false&&
  key.algorithm?.name==='RSASSA-PKCS1-v1_5'&&key.algorithm?.hash?.name==='SHA-256'&&key.algorithm?.modulusLength>=2048&&
  key.usages?.includes('sign')&&typeof subtle?.sign==='function'&&typeof fetchImpl==='function'&&
  /^[a-zA-Z0-9._-]{1,100}@[a-z0-9-]{1,63}\.iam\.gserviceaccount\.com$/.test(email??'')&&/^[A-Za-z0-9_-]{1,128}$/.test(kid??'');
 function now(){let value;try{value=clock();}catch{closed=true;cached=undefined;throw fail();}if(!Number.isSafeInteger(value)||value<0||value<last){closed=true;cached=undefined;throw fail();}last=value;return value;}
 async function refresh(){
  const stop=new AbortController();let timer;
  try{
   const start=now();const iat=Math.floor(start/1000);
   const work=(async()=>{
    const unsigned=encode({alg:'RS256',typ:'JWT',kid})+'.'+encode({iss:email,scope:SCOPE,aud:ENDPOINT,iat,exp:iat+300});
    const signature=await subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
    if(stop.signal.aborted||!configured())throw fail();
    const assertion=unsigned+'.'+Buffer.from(signature).toString('base64url');
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal:stop.signal,
     headers:{'Content-Type':'application/x-www-form-urlencoded'},
     body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()});
    if(!response.ok||response.redirected||!response.body||!response.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))throw fail();
    const reader=response.body.getReader();let size=0;const parts=[];
    try{for(;;){if(stop.signal.aborted)throw fail();const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw fail();}parts.push(part.value);}}
    finally{reader.releaseLock();}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
    if(stop.signal.aborted||!configured()||body.token_type!=='Bearer'||typeof body.access_token!=='string'||
     !/^[A-Za-z0-9._~+\/-]{16,8192}$/.test(body.access_token)||!Number.isSafeInteger(body.expires_in)||body.expires_in<120||body.expires_in>3600)throw fail();
    const until=start+body.expires_in*1000;
    if(now()>=until-60000)throw fail();
    cached=body.access_token;expires=until;return cached;
   })();
   const interrupted=new Promise((_,reject)=>{timer=setTimeout(()=>{stop.abort();reject(fail());},timeoutMs);});
   return await Promise.race([work,interrupted]);
  }catch{cached=undefined;expires=0;throw fail();}finally{clearTimeout(timer);stop.abort();}
 }
 async function accessToken({signal}={}){
  if(signal?.aborted||!configured())throw fail();
  const current=now();if(cached&&current<expires-60000)return cached;
  if(!pending){pending=refresh();pending.finally(()=>{pending=undefined;}).catch(()=>{});}
  if(!signal)return pending;
  let abort;
  try{return await Promise.race([pending,new Promise((_,reject)=>{abort=()=>reject(fail());signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);}
  finally{signal.removeEventListener('abort',abort);}
 }
 accessToken.configured=configured;
 accessToken.close=()=>{closed=true;cached=undefined;expires=0;};
 return accessToken;
}
