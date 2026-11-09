import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createCloudflareConnector} from '../voice/cloudflare-connector.mjs';
const origin='https://relay.fixture.invalid',room='nr_'+'a'.repeat(32),nonce='b'.repeat(32);
const url=origin+'/v1/rooms/'+room+'/socket',wss=url.replace('https:','wss:');
// Unsigned text fixtures only. No operational credential, key or signer exists.
const jwt=(claims={})=>Buffer.from('{"alg":"EdDSA","typ":"JWT"}').toString('base64url')+'.'+
 Buffer.from(JSON.stringify({aud:'navrang-relay-v1',role:'controller',room,...claims})).toString('base64url')+'.synthetic';
const headers={'Authorization':'Bearer '+jwt(),'X-Navrang-Time-Nonce':nonce};
const socketHeaders={Authorization:headers.Authorization};
const callbacks=()=>({messages:[],errors:[],closes:0,onMessage(value){this.messages.push(value);},onError(value){this.errors.push(value);},onClose(){this.closes++;}});
function fixture(extra={}){
 const requests=[],sockets=[];let response=()=>Response.json({version:1,nonce,serverTime:1000000},{headers:{'Cache-Control':'no-store, private','X-Navrang-Relay-Capabilities':'clock-v1, staged-grant-v1, scoped-control-v1'}});
 class Socket extends EventEmitter{
  constructor(target,options){super();this.target=target;this.options=options;this.bufferedAmount=0;this.sent=[];this.closes=[];this.terminated=0;sockets.push(this);queueMicrotask(()=>this.emit('open'));}
  send(text,done){this.sent.push(text);done?.();}
  pong(data,done){this.ponged=(this.ponged??0)+1;done?.();}
  close(code,reason){this.closes.push({code,reason});this.emit('close');}
  terminate(){this.terminated++;this.emit('close');}
 }
 const connector=createCloudflareConnector({origin,WebSocket:Socket,fetchImpl:async(...args)=>{requests.push(args);return response(...args);},timeoutMs:20,...extra});
 async function connect(options={}){const c=callbacks(),wire=await connector.connect({url:wss,headers:socketHeaders,
  onMessage:c.onMessage.bind(c),onError:c.onError.bind(c),onClose:c.onClose.bind(c),...options});return {wire,c,socket:sockets.at(-1)};}
 return {connector,requests,sockets,Socket,connect,setResponse:value=>{response=typeof value==='function'?value:()=>value;}};
}

test('construction creates no fetch/socket and clock uses exact pinned no-redirect no-cache authorization',async()=>{
 const f=fixture();assert.equal(f.requests.length,0);assert.equal(f.sockets.length,0);
 const response=await f.connector.clock({url,headers});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{version:1,nonce,serverTime:1000000});
 const [actual,input]=f.requests[0];assert.equal(actual,url);assert.equal(input.method,'GET');assert.equal(input.redirect,'error');
 assert.equal(input.cache,'no-store');assert.equal(input.credentials,'omit');assert.deepEqual(input.headers,headers);
 assert.equal(response.headers.get('X-Navrang-Relay-Capabilities'),'clock-v1, staged-grant-v1, scoped-control-v1');
});

test('foreign targets, queries, nonexact paths and native credentials are rejected before I/O',async()=>{
 const f=fixture();
 for(const target of [url+'?',url+'?token=fixture',url+'#x',url+'/',url.replace(origin,'https://foreign.fixture.invalid'),url.replace('https:','http:'),url.replace(room,'%61')])
  await assert.rejects(f.connector.clock({url:target,headers}),/Relay clock unavailable/);
 for(const claims of [{role:'speaker'},{role:'listener'},{aud:'other'},{room:'foreign'}])
  await assert.rejects(f.connector.clock({url,headers:{...headers,Authorization:'Bearer '+jwt(claims)}}));
 assert.equal(f.requests.length,0);assert.equal(f.sockets.length,0);
 const c=callbacks();
 for(const target of [wss+'?token=x',wss.replace('wss:','ws:'),wss.replace(origin.replace('https:','wss:'),'wss://foreign.fixture.invalid')])
  await assert.rejects(f.connector.connect({url:target,headers:socketHeaders,onMessage:()=>{},onClose:()=>{},onError:()=>{}}));
 assert.equal(f.sockets.length,0);
});

test('extra or oversized headers and malformed nonce fail before credentials reach fetch or socket',async()=>{
 const f=fixture();
 for(const bad of [{...headers,Cookie:'private'}, {...headers,'X-Navrang-Time-Nonce':'A'.repeat(32)},
  {...headers,Authorization:'Bearer '+ 'a'.repeat(4096)}, {...headers,Authorization:'Bearer invalid'}])
  await assert.rejects(f.connector.clock({url,headers:bad}));
 await assert.rejects(f.connector.connect({url:wss,headers,onMessage:()=>{},onClose:()=>{},onError:()=>{}}),'clock nonce must not be sent in upgrade');
 assert.equal(f.requests.length,0);assert.equal(f.sockets.length,0);
});

test('clock rejects redirects, oversized/invalid bodies, unsafe time, missing no-store and wrong nonce',async()=>{
 const fixtures=[()=>new Response(null,{status:302,headers:{Location:'https://foreign.fixture.invalid'}}),
  ()=>Response.json({version:1,nonce,serverTime:1000000}),
  ()=>Response.json({version:1,nonce:'a'.repeat(32),serverTime:1000000},{headers:{'Cache-Control':'no-store'}}),
  ()=>Response.json({version:1,nonce,serverTime:Number.MAX_SAFE_INTEGER+1},{headers:{'Cache-Control':'no-store'}}),
  ()=>new Response('x'.repeat(1025),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}),
  ()=>new Response(new Uint8Array([255]),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}),
  ()=>Response.json({version:1,nonce,serverTime:1},{headers:{'Cache-Control':'no-store','X-Navrang-Relay-Capabilities':'x'.repeat(257)}})];
 for(const make of fixtures){const f=fixture();f.setResponse(make);await assert.rejects(f.connector.clock({url,headers}),error=>error.message==='Relay clock unavailable');}
});

test('hung HTTP/stream and ignored cancellation remain bounded without exposing errors',async()=>{
 const f=fixture({timeoutMs:10});f.setResponse(()=>new Promise(()=>{}));
 await assert.rejects(f.connector.clock({url,headers}),/Relay clock unavailable/);
 const stream=fixture({timeoutMs:10});stream.setResponse(()=>new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){return new Promise(()=>{});}}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
 await assert.rejects(stream.connector.clock({url,headers}),/Relay clock unavailable/);
 const aborted=fixture();await assert.rejects(aborted.connector.clock({url,headers,signal:AbortSignal.abort()}));assert.equal(aborted.requests.length,0);
});

test('ws-compatible options pin TLS, disable redirects/compression and bound headers/messages',async()=>{
 const f=fixture(),{wire,socket}=await f.connect();
 assert.equal(socket.target,wss);assert.deepEqual(socket.options.headers,socketHeaders);assert.equal(socket.options.followRedirects,false);
 assert.equal(socket.options.rejectUnauthorized,true);assert.equal(socket.options.perMessageDeflate,false);assert.equal(socket.options.autoPong,false);assert.equal(socket.options.maxPayload,1024);
 assert.equal(socket.options.maxHeaderSize,8192);assert.equal(socket.options.handshakeTimeout,20);
 wire.send(JSON.stringify({type:'inspect-room',subject:'synthetic',deadline:1000015}));assert.equal(socket.sent.length,1);
 wire.close();assert.equal(socket.closes[0].reason,'Controller stopped');
});

test('text-only control frames are delivered; binary/oversized/malformed/role-confused inbound data closes once',async()=>{
 const good=fixture(),{wire,c,socket}=await good.connect();
 socket.emit('message',Buffer.from('{"type":"ready","role":"controller","subject":"synthetic"}'),false);
 socket.emit('message','{"type":"room-inspected"}',false);assert.equal(c.messages.length,2);wire.close();assert.equal(c.closes,1);
 for(const [data,binary]of [[Buffer.from([1]),true],['x'.repeat(1025),false],['not JSON',false],['{"type":"audio"}',false],['{"type":"ready","role":"speaker"}',false]]){
  const f=fixture(),x=await f.connect();x.socket.emit('message',data,binary);assert.equal(x.c.messages.length,0);assert.equal(x.c.closes,1);assert.equal(x.c.errors.length,1);
  assert.equal(x.c.errors[0].message,'Relay controller unavailable');
 }
});

test('outbound audio/legacy commands, excessive buffering and send callback errors fence the connection',async()=>{
 for(const value of [new Uint8Array([1]),'{"type":"ack"}','{"type":"grant"}','{"type":"activate","x":"'+'x'.repeat(512)+'"}']){
  const f=fixture(),x=await f.connect();assert.throws(()=>x.wire.send(value),/Relay controller unavailable/);assert.equal(x.socket.sent.length,0);assert.equal(x.c.closes,1);
 }
 const buffered=fixture(),x=await buffered.connect();x.socket.bufferedAmount=4096;
 assert.throws(()=>x.wire.send('{"type":"inspect"}'));assert.equal(x.socket.sent.length,0);
 const callback=fixture(),y=await callback.connect();y.socket.send=(text,done)=>done(Error('secret-socket-error'));
 y.wire.send('{"type":"inspect"}');assert.equal(y.c.closes,1);assert.equal(y.c.errors[0].message,'Relay controller unavailable');
});

test('abort after open closes transport and late callbacks cannot revive or deliver frames',async()=>{
 const f=fixture(),aborter=new AbortController(),x=await f.connect({signal:aborter.signal});aborter.abort();
 assert.equal(x.c.closes,1);x.socket.emit('open');x.socket.emit('message','{"type":"grant"}',false);assert.equal(x.c.messages.length,0);
 assert.throws(()=>x.wire.send('{"type":"inspect"}'));x.wire.close();assert.equal(x.c.closes,1);
});

test('failed, redirected and hung handshakes reject without leaking transport details',async()=>{
 for(const event of ['error','unexpected-response','redirect']){
  class Socket extends EventEmitter{constructor(){super();this.bufferedAmount=0;queueMicrotask(()=>this.emit(event,Error('secret')));}send(){}close(){this.emit('close');}terminate(){}}
  const f=fixture({WebSocket:Socket});await assert.rejects(f.connect(),error=>error.message==='Relay controller unavailable');
 }
 class Hung extends EventEmitter{constructor(){super();this.bufferedAmount=0;}send(){}close(){this.emit('close');}terminate(){}}
 const f=fixture({WebSocket:Hung,timeoutMs:10});await assert.rejects(f.connect(),/Relay controller unavailable/);
});

test('control floods are bounded instead of retaining unlimited inbound or outbound text',async()=>{
 const f=fixture(),x=await f.connect();for(let i=0;i<101;i++)x.socket.emit('message','{"type":"grant"}',false);
 assert.ok(x.c.messages.length<=100);assert.equal(x.c.closes,1);
 const g=fixture(),y=await g.connect();let failed=false;
 for(let i=0;i<101;i++)try{y.wire.send('{"type":"inspect"}');}catch{failed=true;break;}
 assert.equal(failed,true);assert.ok(y.socket.sent.length<=100);
 const h=fixture(),z=await h.connect();z.socket.emit('ping',Buffer.from('bounded'));assert.equal(z.socket.ponged,1);
 z.socket.bufferedAmount=4096;z.socket.emit('ping',Buffer.from('blocked'));assert.equal(z.socket.ponged,1);assert.equal(z.c.closes,1);
});
