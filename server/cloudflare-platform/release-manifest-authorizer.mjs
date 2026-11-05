// The location is fixed by the existing Android updater policy, not supplied by a caller.
export const PUBLISHED_MANIFEST='https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/updates/latest.json';
const ROOT='https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/';
const MAX=32768;
function signatureBytes(value){
 if(typeof value!=='string'||value.length>3000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw Error();
 const decoded=atob(value);if(decoded.length<32||decoded.length>2048)throw Error();
 return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
// java.security.Signature returns strict ASN.1 DER; Web Crypto ECDSA expects fixed-width r||s.
export function ecdsaDerToRaw(der,width){
 let p=0;const length=()=>{let n=der[p++];if(n===undefined)throw Error();if(n<128)return n;
  const bytes=n&127;if(bytes<1||bytes>2||p+bytes>der.length||der[p]===0)throw Error();n=0;
  for(let i=0;i<bytes;i++)n=n*256+der[p++];if(n<128)throw Error();return n;};
 if(der[p++]!==0x30)throw Error();const contentLength=length(),actualEnd=p+contentLength;if(actualEnd!==der.length||!Number.isInteger(width)||width<1||width>66)throw Error();
 const readInteger=()=>{if(der[p++]!==0x02)throw Error();let n=length();if(n<1||p+n>actualEnd)throw Error();
  let bytes=der.subarray(p,p+n);p+=n;if(bytes[0]&128)throw Error();
  if(bytes.length>1&&bytes[0]===0){if(!(bytes[1]&128))throw Error();bytes=bytes.subarray(1);}
  if(bytes.length>width)throw Error();const out=new Uint8Array(width);out.set(bytes,width-bytes.length);return out;};
 const r=readInteger(),s=readInteger();if(p!==actualEnd)throw Error();const raw=new Uint8Array(width*2);raw.set(r);raw.set(s,width);return raw;
}
function canonical(m,candidate){
 if(!m||typeof m!=='object'||Array.isArray(m)||m.packageName!=='in.navrang.gate'||
  !Number.isSafeInteger(m.versionCode)||m.versionCode<1||m.versionCode>2147483647||
  typeof m.versionName!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(m.versionName)||
  !Number.isSafeInteger(m.size)||m.size<100000||m.size>25*1024*1024||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||
  m.versionCode!==candidate?.versionCode||m.sha256!==candidate?.sha256)throw Error();
 const stem=ROOT+'downloads/Navrang-Gate-'+m.versionName;
 if(m.apkUrl!==stem+'.apk')throw Error(); // Existing updater requires a universal top-level channel.
 return new TextEncoder().encode('navrang-release-v1\n'+m.packageName+'\n'+m.versionCode+'\n'+m.versionName+'\n'+m.apkUrl+'\n'+m.size+'\n'+m.sha256+'\n');
}
/** Inject ONLY the separately verified original APK signing public key and a server-side caller guard. */
export function createPublishedReleaseAuthorizer({publicKey,verifyCaller,fetchImpl=globalThis.fetch,subtle=globalThis.crypto?.subtle,timeoutMs=3000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw TypeError('Bounded manifest verification required');
 const alg=publicKey?.algorithm?.name,curve=publicKey?.algorithm?.namedCurve;
 const rsa=alg==='RSASSA-PKCS1-v1_5'&&publicKey?.algorithm?.hash?.name==='SHA-256';
 const width={'P-256':32,'P-384':48,'P-521':66}[curve];
 const configured=publicKey?.type==='public'&&publicKey?.usages?.includes('verify')&&(rsa||alg==='ECDSA'&&width)&&
  typeof verifyCaller==='function'&&typeof fetchImpl==='function'&&typeof subtle?.verify==='function';
 return async(trustedContext,candidate,{signal}={})=>{
  if(!configured||signal?.aborted)return false;
  const aborter=new AbortController();let timer,onAbort;
  const stopped=new Promise((_,reject)=>{aborter.signal.addEventListener('abort',()=>reject(Error()),{once:true});
   onAbort=()=>aborter.abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();timer=setTimeout(onAbort,timeoutMs);});
  const alive=()=>{if(aborter.signal.aborted)throw Error();};
  const work=(async()=>{try{
   if(await verifyCaller(trustedContext,candidate,{signal:aborter.signal})!==true)return false;alive();
   const res=await fetchImpl(PUBLISHED_MANIFEST,{method:'GET',redirect:'error',cache:'no-store',headers:{'Cache-Control':'no-store'},signal:aborter.signal});alive();
   if(!res?.ok||res.redirected||res.url&&res.url!==PUBLISHED_MANIFEST||!res.body)throw Error();
   const reader=res.body.getReader(),parts=[];let size=0;
   const cancel=()=>{void reader.cancel().catch(()=>{});};aborter.signal.addEventListener('abort',cancel,{once:true});
   try{for(;;){alive();const part=await reader.read();alive();if(part.done)break;size+=part.value.length;if(size>MAX){cancel();throw Error();}parts.push(part.value);}}
   finally{aborter.signal.removeEventListener('abort',cancel);reader.releaseLock();}
   const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}
   let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}finally{bytes.fill(0);}
   const payload=canonical(manifest,candidate),sig=signatureBytes(manifest.signature);
   const verifyAlgorithm=rsa?{name:'RSASSA-PKCS1-v1_5'}:{name:'ECDSA',hash:'SHA-256'};
   const wireSignature=rsa?sig:ecdsaDerToRaw(sig,width);
   const verified=await subtle.verify(verifyAlgorithm,publicKey,wireSignature,payload);alive();
   if(verified!==true)return false;
   return await verifyCaller(trustedContext,candidate,{signal:aborter.signal})===true&&!aborter.signal.aborted;
  }catch{return false;}})();
  try{return await Promise.race([work,stopped]);}catch{return false;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);aborter.abort();}
 };
}
