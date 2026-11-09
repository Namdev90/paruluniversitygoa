import {createCloudflareConnector} from '../voice/cloudflare-connector.mjs';
/** Worker fetch Upgrade implementation; bounded lifetime control bytes, no audio. */
export function createWorkerConnector({origin,fetchImpl=fetch}={}){
 const clockPort=createCloudflareConnector({origin,fetchImpl,WebSocket:class{}});
 return {clock:clockPort.clock,async connect({url,headers,signal,onMessage,onClose,onError}){
  const target=new URL(url),expected=new URL(origin);
  if(target.protocol!=='wss:'||target.host!==expected.host||target.search||target.hash||target.username||target.password||!/^\/v1\/rooms\/[A-Za-z0-9_-]{1,64}\/socket$/.test(target.pathname))throw Error('Controller target rejected');
  const bearer=headers?.Authorization;
  if(typeof bearer!=='string'||bearer.length>4096||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(bearer))throw Error('Controller credential rejected');
  let ws,closed=false,total=0;const times=[];
  const close=()=>{if(closed)return;closed=true;signal?.removeEventListener('abort',close);try{ws?.close(1000,'Controller stopped');}catch{}onClose();};
  if(signal?.aborted)throw Error('Controller stopped');signal?.addEventListener('abort',close,{once:true});
  try{
   const response=await fetchImpl('https://'+target.host+target.pathname,{method:'GET',headers:{Authorization:bearer,Upgrade:'websocket'},redirect:'error',signal});
   if(response.status!==101||!response.webSocket)throw Error('Controller upgrade rejected');ws=response.webSocket;
   if(closed){ws.close(1000,'Controller stopped');throw Error('Controller stopped');}
   const account=text=>{const at=performance.now();while(times.length&&times[0]<at-1000)times.shift();
    if(times.length>=100||typeof text!=='string'||new TextEncoder().encode(text).length>1024||(total+=new TextEncoder().encode(text).length)>262144)throw Error('Controller bounds');times.push(at);};
   ws.addEventListener('message',event=>{try{account(event.data);onMessage(event.data);}catch{onError(Error('Controller unavailable'));close();}});
   ws.addEventListener('close',close);ws.addEventListener('error',()=>{onError(Error('Controller unavailable'));close();});ws.accept();
   return {send(text){if(closed)throw Error('Controller stopped');account(text);if(text.length>512||!['prepare','activate','inspect','inspect-room','revoke-prepared'].includes(JSON.parse(text).type))throw Error('Controller control rejected');ws.send(text);},close};
  }catch{close();throw Error('Controller unavailable');}
 }};
}
