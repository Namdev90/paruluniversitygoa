// Server-only HTTP v1 transport. Credentials come from the operator's workload
// identity; this module never creates, stores, or returns a private credential.
export function createFcmTransport({projectId,accessToken,fetchImpl=fetch}) {
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId||'')||typeof accessToken!=='function')throw TypeError('Owned FCM project and token provider required');
 return Object.freeze({configured:true,async send(job,{signal}={}) {
  if(job.providerTarget?.type!=='legacyToken')return {accepted:false,unsupportedTarget:true};
  const target=job.providerTarget.value;
  if(typeof target!=='string'||!target.length||target.length>4096)throw TypeError('Invalid registration token');
  if(![job.eventId,job.bindingId].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x))||!Number.isSafeInteger(job.revision)||job.revision<0)throw TypeError('Invalid opaque notification envelope');
  const data={eventId:job.eventId,bindingId:job.bindingId,revision:String(job.revision)};
  if(Object.hasOwn(job,'domain')) {
   if(!['records','staff','access','helpdesk'].includes(job.domain))throw TypeError('Invalid notification domain');
   data.domain=job.domain;
  }
  // A wake-up is deliberately short lived, including invitations/live prompts.
  // Clients reconcile current authorized server state, never replay this as audio.
  const token=await accessToken({signal});if(typeof token!=='string'||!token)throw Error('FCM authorization unavailable');
  const response=await fetchImpl(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,{method:'POST',signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({message:{token:target,data,android:{ttl:'30s',priority:'normal'}}})});
  let body;try{body=await response.json()}catch{return {accepted:false}};
  if(response.ok&&typeof body?.name==='string')return {accepted:true};
  // INVALID_ARGUMENT can mean a payload/configuration bug; never delete all
  // device bindings on that general error. Only explicit UNREGISTERED is final.
  const unregistered=body?.error?.details?.some(d=>d['@type']==='type.googleapis.com/google.firebase.fcm.v1.FcmError'&&d.errorCode==='UNREGISTERED');
  return {accepted:false,permanentFailure:unregistered===true};
 }});
}

// Independent scheduler authentication; an app user's session is never a worker grant.
export function createDeliveryEndpoint({worker,expectedTokenHash}) {
 if(!worker?.dispatchBatch||!/^[a-f0-9]{64}$/.test(expectedTokenHash||''))throw TypeError('Worker and private scheduler token hash required');
 let busy=false;
 return async request=>{
  if(request.method!=='POST')return new Response(null,{status:405});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer [a-f0-9]{64}$/.test(authorization))return new Response(null,{status:401});
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(authorization.slice(7))));
  const actual=Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');let diff=0;for(let i=0;i<64;i++)diff|=actual.charCodeAt(i)^expectedTokenHash.charCodeAt(i);
  if(diff)return new Response(null,{status:401});
  if(busy)return new Response(null,{status:409});busy=true;
  try{return Response.json(await worker.dispatchBatch({limit:20}))}catch{return Response.json({state:'UNAVAILABLE'},{status:503})}finally{busy=false}
 };
}
