import {createEdgeVoiceForwarder} from '../../cloudflare-platform/edge-forwarder.mjs';
import {isCommunicationAction} from './communications-contract.mjs';
import {isLocatorAction} from './locator-contract.mjs';
import {createHandler} from './handler.mjs';
import {createVoiceServiceBoundary} from './voice-service.mjs';
const base=Deno.env.get('SUPABASE_URL')!;
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const publicKey=Deno.env.get('SUPABASE_ANON_KEY')!;
let google=false,checked=0;
async function rpc(action:string,payload:unknown,hash:string,{signal}:{signal?:AbortSignal}={}){
  const report=action.startsWith('reports-');
  const operation=action==='reports-summary-prepare'||action==='reports-save-outcome'||action==='reports-export'&&(payload as Record<string,unknown>)?.format!=null;
  const rpcName=action.startsWith('staff-device-')?'navrang_staff_device':operation?'navrang_report_operations':report?'navrang_reports':isLocatorAction(action)?'navrang_locator':isCommunicationAction(action)?'navrang_communications':'navrang_gate';
  const dbAction=operation?(action==='reports-export'?'prepare-export':action==='reports-summary-prepare'?'prepare-summary':'outcome'):report?action.slice('reports-'.length):action;
  const deadline=AbortSignal.timeout(15000);
  const r=await fetch(base+'/rest/v1/rpc/'+rpcName,{method:'POST',headers:{apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},body:JSON.stringify({p_action:dbAction,p:payload,p_token:hash}),signal:signal?AbortSignal.any([signal,deadline]):deadline});
  if(!r.ok)throw Error('Database request failed');return r.json();
}
const handler=createHandler({
 renewalEnabled:false,
 rpc,
 // No acceptance/configuration boolean can activate provider operations here.
 // An accepted private service transport remains a separate integration gate.
 voiceService:createVoiceServiceBoundary({rpc}),
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
const forwardVoice=createEdgeVoiceForwarder({origin:undefined});
Deno.serve(request=>forwardVoice(request,handler));
