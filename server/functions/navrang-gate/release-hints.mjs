// Public release metadata only. Never put identities, event data, coordinates,
// URLs, credentials, notification text or media on this public topic.
export function createReleaseHintTransport({projectId,accessToken,fetchImpl=fetch}) {
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId||'')||typeof accessToken!=='function')throw TypeError('Owned FCM project and workload token provider required');
 return Object.freeze({async publish(release,{signal}={}){
  if(!release||Object.keys(release).sort().join(',')!=='sha256,versionCode'||
   !Number.isSafeInteger(release.versionCode)||release.versionCode<1||release.versionCode>2147483647||
   !/^[a-f0-9]{64}$/.test(release.sha256||''))throw TypeError('Public version and digest required');
  signal?.throwIfAborted();
  const token=await accessToken({signal});if(typeof token!=='string'||!token)throw Error('FCM authorization unavailable');
  const timeout=AbortSignal.timeout(8000);
  const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,{
   method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,timeout]):timeout,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({message:{topic:'navrang-public-releases-v1',
    data:{kind:'app-release',versionCode:String(release.versionCode),sha256:release.sha256},
    android:{ttl:'3600s',priority:'normal',collapse_key:'navrang-release'}}})});
  let body;try{body=await response.json();}catch{return {accepted:false};}
  return {accepted:response.ok&&typeof body?.name==='string'};
 }});
}
