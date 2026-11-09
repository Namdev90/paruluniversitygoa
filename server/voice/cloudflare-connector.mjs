// Narrow I/O boundary for an already configured private controller. No socket,
// HTTP request, credential discovery, signer or listener is created at import/construction.
const ROOM=/^[A-Za-z0-9_-]{1,64}$/;
const OUTBOUND=new Set(['prepare','activate','inspect','inspect-room','revoke-prepared']);
const INBOUND=new Set(['ready','prepared','grant','revoked','inspected','revoked-prepared','room-inspected']);
const MAX_BODY=1024,MAX_CONTROL=512,MAX_TOTAL=262144;
function originValid(value){try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.port&&!u.username&&!u.password&&
 /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(u.hostname)&&u.hostname.includes('.')&&!/^[0-9.]+$/.test(u.hostname);}catch{return false;}}
export function createCloudflareConnector({origin,fetchImpl=globalThis.fetch,WebSocket,timeoutMs=1000,maxBufferedBytes=4096}={}){
 if(!originValid(origin)||typeof fetchImpl!=='function'||typeof WebSocket!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>2000||
  !Number.isInteger(maxBufferedBytes)||maxBufferedBytes<MAX_BODY||maxBufferedBytes>16384)throw TypeError('Pinned private relay connector required');
 function route(value,websocket){
  const base=(websocket?origin.replace(/^https:/,'wss:'):origin)+'/v1/rooms/';
  if(typeof value!=='string'||!value.startsWith(base)||!value.endsWith('/socket'))throw Error('Invalid controller target');
  const room=value.slice(base.length,-'/socket'.length);
  if(!ROOM.test(room)||value!==base+room+'/socket')throw Error('Invalid controller route');return room;
 }
 function headers(input,room,probe){
  const values=new Headers(input),allowed=probe?['authorization','x-navrang-time-nonce']:['authorization'];
  for(const [key,value]of values)if(!allowed.includes(key)||value.length>4096)throw Error('Invalid controller header');
  const authorization=values.get('Authorization');
  if(!authorization||authorization.length>4096||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))throw Error('Invalid controller authorization');
  // Unverified parsing ONLY narrows permitted use; the relay must still verify
  // signature/issuer/current authorization. These claims never authorize access here.
  let claims;try{claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url').toString('utf8'));}catch{throw Error('Invalid controller scope');}
  if(!claims||claims.role!=='controller'||claims.aud!=='navrang-relay-v1'||claims.room!==room)throw Error('Controller-only transport required');
  const result={Authorization:authorization};
  if(probe){const nonce=values.get('X-Navrang-Time-Nonce');if(!/^[a-f0-9]{32}$/.test(nonce??''))throw Error('Invalid clock nonce');result['X-Navrang-Time-Nonce']=nonce;}
  return result;
 }
 async function clock({url,headers:input,signal}={}){
  let timer,reader;
  const aborter=new AbortController();let rejectStop;
  const stopped=new Promise((_,reject)=>{rejectStop=reject;});
  const stop=()=>{aborter.abort();if(reader)void reader.cancel().catch(()=>{});rejectStop(Error('Relay clock unavailable'));};
  try{
   const room=route(url,false),checked=headers(input,room,true);
   if(signal?.aborted)throw Error();signal?.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,timeoutMs);
   const work=(async()=>{
    const response=await fetchImpl(url,{method:'GET',headers:checked,redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:aborter.signal});
    if(aborter.signal.aborted||response?.status!==200||response.redirected===true||response.url&&response.url!==url||
     !/^application\/json(?:;|$)/i.test(response.headers?.get('Content-Type')??'')||
     !/\bno-store\b/i.test(response.headers?.get('Cache-Control')??'')||typeof response.body?.getReader!=='function')throw Error();
    for(const name of ['Content-Type','Cache-Control','X-Navrang-Relay-Capabilities'])if((response.headers.get(name)??'').length>256)throw Error();
    const length=response.headers.get('Content-Length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))throw Error();
    reader=response.body.getReader();let size=0;const chunks=[];
    for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_BODY)throw Error();chunks.push(part.value);}
    if(aborter.signal.aborted)throw Error();
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!body||Object.keys(body).length!==3||body.version!==1||body.nonce!==checked['X-Navrang-Time-Nonce']||!Number.isSafeInteger(body.serverTime)||body.serverTime<0)throw Error();
    return new Response(bytes,{status:200,headers:{'Content-Type':'application/json','Cache-Control':response.headers.get('Cache-Control'),
     'X-Navrang-Relay-Capabilities':response.headers.get('X-Navrang-Relay-Capabilities')??''}});
   })();
   return await Promise.race([work,stopped]);
  }catch{aborter.abort();if(reader)void reader.cancel().catch(()=>{});throw Error('Relay clock unavailable');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);if(reader)try{reader.releaseLock();}catch{}}
 }
 async function connect({url,headers:input,signal,onMessage,onClose,onError}={}){
  let socket;
  try{
   const room=route(url,true),checked=headers(input,room,false);
   if(signal?.aborted||![onMessage,onClose,onError].every(fn=>typeof fn==='function'))throw Error();
   return await new Promise((resolve,reject)=>{
    let opened=false,ended=false,settled=false,closing=false,sent=0,received=0;const sendTimes=[],receiveTimes=[];
    const notify=(fn,...args)=>{try{fn(...args);}catch{}};
    const rejectOpen=()=>{if(!settled){settled=true;reject(Error('Relay controller unavailable'));}};
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const finish=()=>{if(ended)return;ended=true;cleanup();rejectOpen();notify(onClose);};
    const fail=()=>{if(closing||ended)return;closing=true;rejectOpen();notify(onError,Error('Relay controller unavailable'));
     try{socket?.close(1008,'Controller unavailable');}catch{}try{socket?.terminate?.();}catch{}finish();};
    const abort=()=>fail();
    const timer=setTimeout(fail,timeoutMs);
    const rate=sending=>{const at=performance.now(),times=sending?sendTimes:receiveTimes;
     while(times.length&&times[0]<=at-1000)times.shift();if(times.length>=100)throw Error();times.push(at);};
    signal?.addEventListener('abort',abort,{once:true});
    try{
     socket=new WebSocket(url,{headers:checked,followRedirects:false,handshakeTimeout:timeoutMs,maxPayload:MAX_BODY,
      perMessageDeflate:false,autoPong:false,rejectUnauthorized:true,maxHeaderSize:8192,maxRedirects:0});
     if(typeof socket.on!=='function'||typeof socket.send!=='function'||typeof socket.close!=='function')throw Error();
     socket.on('error',fail);socket.on('close',finish);socket.on('unexpected-response',fail);socket.on('redirect',fail);
     socket.on('ping',data=>{if(ended||closing)return;try{
      if(!Buffer.isBuffer(data)||data.length>125||typeof socket.pong!=='function'||!Number.isFinite(socket.bufferedAmount)||
       socket.bufferedAmount<0||socket.bufferedAmount+data.length>maxBufferedBytes||sent>MAX_TOTAL-data.length)throw Error();
      rate(false);rate(true);sent+=data.length;socket.pong(data,error=>{if(error)fail();});
     }catch{fail();}});
     socket.on('pong',()=>{try{rate(false);}catch{fail();}});
     socket.on('message',(data,isBinary)=>{
      if(ended||closing)return;
      try{
       if(!opened||isBinary===true||!(typeof data==='string'||Buffer.isBuffer(data)))throw Error();
       const bytes=typeof data==='string'?Buffer.from(data):data;if(bytes.length>MAX_BODY||received>MAX_TOTAL-bytes.length)throw Error();
       const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
       if(!value||!INBOUND.has(value.type)||value.type==='ready'&&value.role!=='controller')throw Error();
       rate(false);received+=bytes.length;notify(onMessage,text);
      }catch{fail();}
     });
     socket.on('open',()=>{
      if(ended||closing){try{socket.close();}catch{}return;}opened=true;clearTimeout(timer);settled=true;
      resolve(Object.freeze({send(text){
       try{
        if(ended||closing||!opened||typeof text!=='string')throw Error();const bytes=Buffer.byteLength(text);
        if(bytes<1||bytes>MAX_CONTROL||sent>MAX_TOTAL-bytes||!Number.isFinite(socket.bufferedAmount)||socket.bufferedAmount<0||socket.bufferedAmount+bytes>maxBufferedBytes)throw Error();
        const value=JSON.parse(text);if(!value||!OUTBOUND.has(value.type))throw Error();rate(true);sent+=bytes;
        socket.send(text,error=>{if(error)fail();});
       }catch{fail();throw Error('Relay controller unavailable');}
      },close(code=1000,reason='Controller stopped'){
       if(ended||closing)return;closing=true;try{socket.close(code===1000?1000:1008,'Controller stopped');}catch{}try{socket.terminate?.();}catch{}finish();
      }}));
     });
    }catch{fail();}
   });
  }catch{try{socket?.terminate?.();}catch{}throw Error('Relay controller unavailable');}
 }
 return Object.freeze({clock,connect});
}
