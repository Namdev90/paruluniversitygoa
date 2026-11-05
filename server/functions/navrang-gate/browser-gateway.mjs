import {validateRequest,token,sha256} from './security.mjs';

export const COOKIE=Object.freeze({access:'__Host-navrang-access',refresh:'__Host-navrang-refresh',
 pending:'__Host-navrang-pending',device:'__Host-navrang-device',revoke:'__Host-navrang-revoke'});
const names=new Set(Object.values(COOKIE)),hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const device=value=>typeof value==='string'&&/^browser-[a-f0-9-]{36}$/i.test(value);
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const secretKeys=new Set(['token','accessToken','refreshToken','nextRefreshToken','nextRefreshHash','password',
 'refreshFamilyId','refreshExpiresAt','absoluteExpiresAt','unlinkProof','providerTarget']);
const definitive=body=>body?.ok===false&&typeof body.error==='string'&&
 /^(?:Sign in (?:again|first)\.|Session expired\.|Staff access expired\.)/.test(body.error);
class GatewayIssue extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const reject=(status,code,message)=>{throw new GatewayIssue(status,code,message);};
function cookies(request){
 const raw=request.headers.get('cookie')||'';if(raw.length>8192)reject(400,'INVALID_COOKIE','Browser session could not be verified.');
 const values=new Map();for(const item of raw.split(';')){
  const at=item.indexOf('=');if(at<0)continue;const key=item.slice(0,at).trim(),value=item.slice(at+1).trim();
  if(!names.has(key))continue;
  if(values.has(key)||value.length>2048||!/^[A-Za-z0-9_-]*$/.test(value))reject(400,'INVALID_COOKIE','Browser session could not be verified.');
  if(value)values.set(key,value);
 }return values;
}
const pack=value=>btoa(JSON.stringify(value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function unpack(value){
 if(!value)return null;
 try{return JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));}catch{reject(400,'INVALID_COOKIE','Browser session could not be verified.');}
}
function refreshCookie(value){
 const parsed=unpack(value);if(!parsed)return null;
 if(!exact(parsed,['token','family','idle','absolute'])||!hex(parsed.token)||!uuid(parsed.family)||
  typeof parsed.idle!=='string'||typeof parsed.absolute!=='string'||!Number.isFinite(Date.parse(parsed.idle))||
  !Number.isFinite(Date.parse(parsed.absolute))||Date.parse(parsed.idle)>Date.parse(parsed.absolute))reject(400,'INVALID_COOKIE','Browser session could not be verified.');
 return parsed;
}
function pendingCookie(value){
 const parsed=unpack(value);if(!parsed)return null;
 if(!exact(parsed,['refreshToken','nextRefreshToken','requestId','installationId','createdAt'])||!hex(parsed.refreshToken)||
  !hex(parsed.nextRefreshToken)||!uuid(parsed.requestId)||!device(parsed.installationId)||!Number.isSafeInteger(parsed.createdAt))reject(400,'INVALID_COOKIE','Browser renewal could not be verified.');
 return parsed;
}
function revokeCookie(value){
 const parsed=unpack(value);if(!parsed)return null;
 if(!exact(parsed,['refreshToken','installationId','until'])||!hex(parsed.refreshToken)||!device(parsed.installationId)||!Number.isSafeInteger(parsed.until))reject(400,'INVALID_COOKIE','Browser sign-out could not be verified.');
 return parsed;
}
function setCookie(headers,name,value,seconds){headers.append('Set-Cookie',`${name}=${value}; Max-Age=${Math.max(0,Math.floor(seconds))}; Path=/; Secure; HttpOnly; SameSite=Strict`);}
function clear(headers,retainRevoke=false){for(const name of names)if(!retainRevoke||name!==COOKIE.revoke)setCookie(headers,name,'',0);}
function publicValue(value,secrets,depth=0){
 if(depth>24)throw Error('Response nesting limit');
 if(typeof value==='string'){for(const secret of secrets)if(typeof secret==='string'&&secret.length>=32)value=value.replaceAll(secret,'[redacted]');return value;}
 if(Array.isArray(value)){if(value.length>50000)throw Error('Response list limit');return value.map(item=>publicValue(item,secrets,depth+1));}
 if(object(value)){const result=Object.create(null);for(const [key,item]of Object.entries(value))if(!secretKeys.has(key))result[key]=publicValue(item,secrets,depth+1);return result;}
 return value;
}
async function readBody(request,limit){
 if(!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get('content-type')||'')||
  request.headers.has('content-encoding'))reject(400,'INVALID_REQUEST','Use a JSON browser request.');
 if(Number(request.headers.get('content-length')||0)>limit)reject(413,'REQUEST_TOO_LARGE','Request is too large.');
 const reader=request.body?.getReader(),chunks=[];let size=0;
 if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
  if(size>limit){await reader.cancel();reject(413,'REQUEST_TOO_LARGE','Request is too large.');}chunks.push(part.value);
 }}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
 try{const value=JSON.parse(new TextDecoder().decode(bytes));if(!object(value))throw Error();return value;}
 catch{reject(400,'INVALID_REQUEST','Use a valid JSON browser request.');}
}

/** No listener, credential provisioning or network is started by constructing this factory. */
export function createBrowserGateway({origin,call,clock=Date.now,newSecret=token,newUUID=()=>crypto.randomUUID()}){
 if(typeof call!=='function'||new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin)throw TypeError('Same-origin HTTPS gateway and existing backend required');
 return async request=>{
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
   Pragma:'no-cache','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
  let hidden=[];
  const json=(body,status=200)=>Response.json(publicValue(body,hidden),{status,headers});
  async function upstream(action,payload,access=''){
   const controller=new AbortController();let timer;
   const abort=()=>controller.abort();request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
   try{
    const bounded=new Promise((_,deny)=>{timer=setTimeout(()=>{controller.abort();deny(Error('Request deadline'));},20000);});
    const reply=await Promise.race([call({action,payload,token:access,signal:controller.signal}),bounded]);
    if(!Number.isInteger(reply?.status)||reply.status<200||reply.status>599||!object(reply.body))throw Error('Invalid backend response');
    for(const key of ['token','refreshToken','nextRefreshToken'])if(hex(reply.body[key]))hidden.push(reply.body[key]);
    return reply;
   }catch{return {status:503,body:{ok:false,error:'Sign-in verification is unavailable. Reconnect and retry.'}};}
   finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
  }
  try{
   const url=new URL(request.url);
   if(url.origin!==origin||request.headers.get('origin')!==origin||request.headers.get('x-navrang-request')!=='1'||
    request.headers.has('authorization')||request.headers.get('sec-fetch-site')==='cross-site')reject(403,'ORIGIN_REJECTED','Use the same Navrang browser site.');
   if(request.method!=='POST')reject(405,'METHOD_NOT_ALLOWED','Use a browser POST request.');
   if(url.search||!['/navrang/api','/navrang/session/prepare','/navrang/session/commit','/navrang/logout'].includes(url.pathname))reject(404,'NOT_FOUND','Browser route is unavailable.');
   const jar=cookies(request),refresh=refreshCookie(jar.get(COOKIE.refresh)),pending=pendingCookie(jar.get(COOKIE.pending)),revoke=revokeCookie(jar.get(COOKIE.revoke));
   const access=jar.get(COOKIE.access)||'',installation=jar.get(COOKIE.device)||'';
   if(access&&!hex(access)||installation&&!device(installation))reject(400,'INVALID_COOKIE','Browser session could not be verified.');
   hidden=[access,refresh?.token,pending?.refreshToken,pending?.nextRefreshToken,revoke?.refreshToken].filter(Boolean);
   const body=await readBody(request,url.pathname==='/navrang/api'?8*1024*1024:2048),now=clock();
   if(url.pathname!=='/navrang/api'&&Object.keys(body).length)reject(400,'INVALID_REQUEST','Browser session actions do not accept credentials.');
   async function logout(){
    const proof=revoke||(refresh&&installation?{refreshToken:refresh.token,installationId:installation,until:Math.min(Date.parse(refresh.idle),Date.parse(refresh.absolute))}:null);
    clear(headers,true);
    if(!proof){setCookie(headers,COOKIE.revoke,'',0);return json({ok:true,signedOut:true});}
    setCookie(headers,COOKIE.revoke,pack(proof),Math.max(60,Math.min(7*86400,(proof.until-now)/1000)));
    const result=await upstream('logout',{refreshToken:proof.refreshToken,installationId:proof.installationId},access);
    if(result.status===200&&result.body.ok===true&&result.body.signedOut===true){setCookie(headers,COOKIE.revoke,'',0);return json({ok:true,signedOut:true});}
    return json({ok:false,code:'LOGOUT_PENDING',error:'Signed out on this browser. Server revocation will retry when connected.'},503);
   }
   if(url.pathname==='/navrang/logout')return await logout();
   if(revoke)return json({ok:false,code:'AUTH_LOGOUT_PENDING',error:'Finish the pending sign-out before continuing.'},403);
   function issue(bundle,successor,expected){
    const p=bundle?.profile,idle=Date.parse(bundle?.refreshExpiresAt),absolute=Date.parse(bundle?.absoluteExpiresAt),expires=Date.parse(p?.expiresAt),deadline=p?.accessExpiresAt?Date.parse(p.accessExpiresAt):Infinity;
    if(bundle?.ok!==true||!hex(bundle.token)||!hex(successor)||!uuid(bundle.refreshFamilyId)||!object(p)||
     expected&&(bundle.refreshFamilyId!==expected.family||absolute!==Date.parse(expected.absolute))||!Number.isFinite(idle)||!Number.isFinite(absolute)||!Number.isFinite(expires)||
     idle<=now||absolute<idle||expires<=now||expires>now+960000||idle>now+7*86400000+60000||absolute>now+30*86400000+60000||
     !(deadline>now))throw Error('Renewable session unavailable');
    const record={token:successor,family:bundle.refreshFamilyId,idle:bundle.refreshExpiresAt,absolute:bundle.absoluteExpiresAt};
    setCookie(headers,COOKIE.access,bundle.token,Math.min(900,(expires-now)/1000,(deadline-now)/1000));
    setCookie(headers,COOKIE.refresh,pack(record),Math.min(7*86400,(idle-now)/1000,(absolute-now)/1000,(deadline-now)/1000));
    setCookie(headers,COOKIE.pending,'',0);setCookie(headers,COOKIE.revoke,'',0);
   }
   if(url.pathname==='/navrang/session/prepare'){
    if(!refresh||!installation||Math.min(Date.parse(refresh.idle),Date.parse(refresh.absolute))<=now){clear(headers);return json({ok:false,code:'AUTH_REVOKED',error:'Sign in again.'},401);}
    let proof=pending;
    if(!proof||proof.refreshToken!==refresh.token||proof.installationId!==installation||now-proof.createdAt<0||now-proof.createdAt>=120000){
     proof={refreshToken:refresh.token,nextRefreshToken:newSecret(),requestId:newUUID(),installationId:installation,createdAt:now};
     if(!hex(proof.nextRefreshToken)||!uuid(proof.requestId))throw Error('Renewal entropy unavailable');
    }
    setCookie(headers,COOKIE.pending,pack(proof),120);return json({ok:true,prepared:true});
   }
   if(url.pathname==='/navrang/session/commit'){
    if(!refresh||!pending||pending.refreshToken!==refresh.token||pending.installationId!==installation||now-pending.createdAt<0||now-pending.createdAt>=120000)reject(409,'PREPARE_REQUIRED','Prepare this browser renewal again.');
    const result=await upstream('session-refresh',{refreshToken:pending.refreshToken,nextRefreshHash:await sha256(pending.nextRefreshToken),requestId:pending.requestId,installationId:installation});
    if(result.status===401&&definitive(result.body)){clear(headers);return json({ok:false,code:'AUTH_REVOKED',error:'Sign in again.'},401);}
    if(result.status!==200||result.body.ok!==true)return json({ok:false,error:'Sign-in renewal is unavailable. Your saved session is retained.'},result.status===429?429:503);
    issue(result.body,pending.nextRefreshToken,refresh);return json({ok:true,profile:result.body.profile});
   }
   if(!exact(body,['action','payload'])||!object(body.payload))reject(400,'INVALID_REQUEST','Use a valid browser API request.');
   const {action}=body,payload={...body.payload};
   if(typeof action!=='string'||action==='session-refresh'||/^(voice|duty)-/.test(action))reject(400,'NATIVE_ACTION','Use the native controls for this action.');
   if(Object.keys(payload).some(key=>['token','refreshToken','nextRefreshToken','nextRefreshHash','authProtocol','installationId'].includes(key)))reject(400,'CREDENTIAL_OVERRIDE','Browser credentials must come from protected cookies.');
   if(action==='logout')return await logout();
   const signingIn=['login','checker-login','google-login'].includes(action);
   let chosenDevice=installation;
   if(signingIn){
    if(refresh){const signedOut=await logout();if(signedOut.status!==200)return signedOut;chosenDevice='';}
    chosenDevice=chosenDevice||'browser-'+newUUID();if(!device(chosenDevice))throw Error('Installation entropy unavailable');
    payload.authProtocol=1;payload.installationId=chosenDevice;
   }
   try{validateRequest({action,payload});}catch{reject(400,'INVALID_REQUEST','Browser API request is invalid.');}
   if(!signingIn&&action!=='config'&&!access)return json({ok:false,code:refresh?'RENEW_REQUIRED':'AUTH_REVOKED',error:'Sign in again.'},401);
   const result=await upstream(action,payload,signingIn?'':access);
   if(signingIn&&result.status===200&&result.body.ok===true){
    try{issue(result.body,result.body.refreshToken);setCookie(headers,COOKIE.device,chosenDevice,30*86400);}
    catch{if(hex(result.body.token))await upstream('logout',{},result.body.token);clear(headers);return json({ok:false,error:'Renewable browser sign-in is not configured.'},503);}
    return json({ok:true,profile:result.body.profile});
   }
   if(result.status===401&&!signingIn){
    if(!definitive(result.body))return json({ok:false,error:'Sign-in verification is unavailable. Your saved session is retained.'},503);
    if(refresh)return json({ok:false,code:'RENEW_REQUIRED',error:'Renew this browser session.'},401);
    clear(headers);return json({ok:false,code:'AUTH_REVOKED',error:'Sign in again.'},401);
   }
   return json(result.body,result.status);
  }catch(failure){return json({ok:false,code:failure instanceof GatewayIssue?failure.code:'UNAVAILABLE',error:failure instanceof GatewayIssue?failure.message:'Browser sign-in is unavailable. Reconnect and retry.'},failure instanceof GatewayIssue?failure.status:503);}
 };
}

/** Server-side adapter to the existing project only; never forwards browser headers. */
export function createBrowserBackend({endpoint,fetchImpl=fetch,publicKey}){
 const url=new URL(endpoint);
 if(url.protocol!=='https:'||!/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)||url.port||url.pathname!=='/functions/v1/navrang-gate'||url.search||url.hash||url.username||url.password)throw TypeError('Existing HTTPS Navrang function required');
 if(publicKey!==undefined&&!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(publicKey))throw TypeError('Only the project public publishable key is accepted');
 return async({action,payload,token:access,signal})=>{
  const headers={'Content-Type':'application/json'};if(access)headers.Authorization='Bearer '+access;if(publicKey)headers.apikey=publicKey;
  const response=await fetchImpl(url.href,{method:'POST',redirect:'error',headers,body:JSON.stringify({action,payload}),signal});
  const reader=response.body?.getReader(),chunks=[];let size=0;
  if(reader)try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32*1024*1024){await reader.cancel();throw Error('Backend response too large');}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {status:response.status,body:JSON.parse(new TextDecoder().decode(bytes))};
 };
}
