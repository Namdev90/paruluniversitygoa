import {createHandler} from './handler.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
let google=false,checked=0;
const handler=createHandler({
 async rpc(action:string,payload:unknown,hash:string){
  const report=action.startsWith('reports-');
  const rpcName=report?'navrang_reports':'navrang_gate';
  const dbAction=report?action.slice('reports-'.length):action;
  const r=await fetch(base+'/rest/v1/rpc/'+rpcName,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_action:dbAction,p:payload,p_token:hash}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('Database request failed');return r.json();
 },
 async googleUser(accessToken:string){
  if(!accessToken)return null;
  const r=await fetch(base+'/auth/v1/user',{headers:{apikey:publicKey,Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(8000)});
  return r.ok?r.json():null;
 },
 async googleEnabled(){
  if(Date.now()-checked<300000)return google;
  try{const r=await fetch(base+'/auth/v1/settings',{headers:{apikey:publicKey},signal:AbortSignal.timeout(5000)});const s=await r.json();google=s.external?.google===true;checked=Date.now()}catch{}
  return google;
 }
});
Deno.serve(handler);
