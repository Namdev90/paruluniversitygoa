import C from './core.mjs';
import D from './desk-core.mjs';
import {token,sha256,passwordHash,passwordMatches,validateRequest} from './security.mjs';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
function canonical(p){
 if(p.eventId!==C.EVENT)throw Error('Wrong event.');
 if(!Array.isArray(p.records)||p.records.length>50000)throw Error('Invalid record list.');
 const b=C.normalizeRows(p.records.map(r=>({TransactionID:r.id,Customer:r.name,LinkID:p.eventId,Amount:r.amount,Quantity:r.quantity,RefundAmount:r.refund,Description:r.description})));
 return Object.values(b.records);
}
export function createHandler({rpc,googleUser,googleEnabled}){
 return async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  try{
   if(req.method!=='POST'&&req.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
   const len=Number(req.headers.get('content-length')||0);if(len>8*1024*1024)return json({ok:false,error:'Request too large.'},413);
   let body;
   if(req.method==='GET')body={action:'config',payload:{}};
   else {const reader=req.body?.getReader(),chunks=[];let size=0;if(reader){try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8*1024*1024){await reader.cancel();return json({ok:false,error:'Request too large.'},413)}chunks.push(part.value)}}finally{reader.releaseLock()}}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}try{body=JSON.parse(new TextDecoder().decode(bytes))}catch{return json({ok:false,error:'Invalid JSON.'},400)}}
   try{validateRequest(body)}catch(e){return json({ok:false,error:e.message},400)}
   const {action}=body;let p={...body.payload};
   const bearer=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
   const hash=/^[a-f0-9]{64}$/.test(bearer)?await sha256(bearer):'';
   async function budget(scope){
    const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';
    const one=await rpc('budget',{key:await sha256(scope+':'+ip),limit:scope==='admin'?10:40},'');
    const all=await rpc('budget',{key:await sha256(scope+':global'),limit:scope==='admin'?50:500},'');
    return one.allowed&&all.allowed;
   }
   async function session(role,checkerId){const value=token();const profile=await rpc('session-create',{hash:await sha256(value),role,checkerId},'');if(profile.error)return json({ok:false,error:profile.error},profile.status||403);return json({ok:true,token:value,profile});}
   if(action==='config')return json({ok:true,...await rpc('config',{},''),googleEnabled:await googleEnabled()});
   if(action==='login'){
    if(!await budget('admin'))return json({ok:false,error:'Too many sign-in attempts. Try again in five minutes.'},429);
    const username=(p.username||'').trim().toLowerCase();
    const stored=await rpc('credentials',{username},'');
    const matches=await passwordMatches(p.password||'',stored);
    if(!stored.hash||!matches)return json({ok:false,error:'Incorrect username or password.'},401);
    return session('admin',null);
   }
   if(action==='checker-login'){
    if(!await budget('checker'))return json({ok:false,error:'Too many sign-in attempts. Try again in five minutes.'},429);
    const checker=await rpc('checker-credentials',{hash:await sha256((p.code||'').trim().toUpperCase())},'');
    if(!checker.id||!checker.active)return json({ok:false,error:'Checker code is invalid or suspended. Ask the admin.'},401);
    return session('checker',checker.id);
   }
   if(action==='google-login'){
    if(!await budget('google'))return json({ok:false,error:'Too many sign-in attempts.'},429);
    const user=await googleUser(p.accessToken||'');
    if(!user||!user.id||!user.email_confirmed_at||user.is_anonymous||!(user.app_metadata?.providers||[user.app_metadata?.provider]).includes('google'))return json({ok:false,error:'Google sign-in could not be verified.'},401);
    const ck=await rpc('google-register',{id:user.id,name:String(user.user_metadata?.given_name||user.user_metadata?.full_name?.split(' ')[0]||'Checker').slice(0,40),email:user.email||''},'');
    if(!ck.id)return json({ok:false,error:ck.error||'Checker account could not be created.'},ck.status||400);
    return session('checker',ck.id);
   }
   if(!hash)return json({ok:false,error:'Sign in first.'},401);
   if(action==='helpdesk-save'||action==='helpdesk-edit'){
    try{p={...p,details:D.normalize(p.details)}}catch(e){return json({ok:false,error:e.message},400)}
   }
   let extra={};
   if(action==='import'||action==='upsert'){
    try{p={eventId:C.EVENT,records:canonical(p),source:String(p.source||'Manual update').slice(0,200)}}catch(e){return json({ok:false,error:e.message},400)}
    if(action==='upsert'&&p.records.length!==1)return json({ok:false,error:'Update one ticket at a time.'},400);
   }
   if(action==='staff-create'){
    if(!p.name?.trim()||p.name.trim().length>128)return json({ok:false,error:'Enter a checker name, up to 128 characters.'},400);
    const code='NG-'+token().slice(0,16).toUpperCase();p={name:p.name.trim(),hash:await sha256(code)};extra={code};
   }
   if(action==='staff-update'){
    if(typeof p.active!=='boolean'||typeof p.id!=='string'||!/^[0-9a-f-]{36}$/i.test(p.id))return json({ok:false,error:'Invalid checker update.'},400);
    if(p.helpdesk!=null&&typeof p.helpdesk!=='boolean')return json({ok:false,error:'Invalid help desk permission.'},400);
   }
   if(action==='admin-password'){
    if(typeof p.password!=='string'||p.password.length<12)return json({ok:false,error:'Use at least 12 characters.'},400);
    const salt=token();p={salt,hash:await passwordHash(p.password,salt)};
   }
   const result=await rpc(action,p,hash);
   if(result.error)return json({ok:false,error:result.error},result.status||400);
   if(action==='helpdesk-export'){
    if(result.records.length>10000)return json({ok:false,error:'Export exceeds 10,000 records. Ask the organizer for a server export.'},413);
    return json({ok:true,csv:D.csv(result.records),count:result.records.length,filename:'Navrang-Help-Desk-'+new Date().toISOString().slice(0,10)+'.csv'});
   }
   return json({ok:true,...result,...extra});
  }catch(e){console.error('Navrang API operation failed:',e?.name||'Error');return json({ok:false,error:'The server could not complete this request. Retry with the same request ID.'},503);}
 };
}
