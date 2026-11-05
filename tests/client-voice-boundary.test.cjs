const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const assets=path.join(__dirname,'../app/assets');
const sessionId='00000000-0000-4000-8000-000000000001';
const allowedKeys=['available','canTalk','message','microphone','ready','state'];
const publicState={available:true,ready:true,state:'listening',microphone:false,canTalk:true,message:'Listening. Hold Talk to speak.'};
function fixture({native=true,voice=true}={}){
 const dom=new JSDOM('',{url:'https://fixture.invalid/',runScripts:'outside-only'}),w=dom.window,calls={voice:[],api:[],fetch:[],local:[]};
 let result=JSON.stringify(publicState),throws=false;
 w.fetch=async(url,options)=>{calls.fetch.push({url,options});return{status:200,json:async()=>({ok:true,googleEnabled:false})}};
 if(native){
  w.Native={local(action){calls.local.push(action);return JSON.stringify({ok:true,data:{profile:{role:'admin',active:true}}})},api(action,payload,id){calls.api.push({action,payload,id});w.onApiResponse(JSON.stringify({id,status:200,body:{ok:true,googleEnabled:false}}))}};
  if(voice)w.Native.voice=(action,payload)=>{calls.voice.push({action,payload});if(throws)throw Error('PRIVATE_NATIVE_DETAIL');return result};
 }
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(path.join(assets,file),'utf8'));
 return{w,dom,calls,C:w.GateClient,setResult:value=>{result=typeof value==='string'?value:JSON.stringify(value)},setThrows:()=>{throws=true},close:()=>w.close()};
}
function unavailable(value){assert.equal(value.available,false);assert.equal(value.ready,false);assert.equal(value.state,'unavailable');assert.equal(value.microphone,false);assert.equal(value.canTalk,false);assert.deepEqual(Object.keys(value).sort(),allowedKeys);}

test('actual voice wrapper exports only public fields and strips provider credentials and nested descriptors',()=>{
 const f=fixture();try{
  f.setResult({...publicState,token:'PRIVATE_TOKEN',roomUrl:'PRIVATE_URL',identity:'PRIVATE_ID',dutyId:sessionId,leaseId:sessionId,receive:{token:'PRIVATE_RECEIVE'},transmit:{token:'PRIVATE_TRANSMIT'}});
  const value=f.C.voice();assert.deepEqual(JSON.parse(JSON.stringify(value)),publicState);assert.deepEqual(Object.keys(value).sort(),allowedKeys);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|dutyId|leaseId|receive|transmit/);
  assert.deepEqual(f.calls.voice,[{action:'status',payload:'{}'}]);assert.equal(f.calls.api.length+f.calls.fetch.length,0);
 }finally{f.close()}
});
test('actual voice wrapper passes only permitted explicit commands and opaque join identifier',()=>{
 const f=fixture();try{
  for(const action of ['status','join','leave','press','release','cancel'])f.C.voice(action);
  f.C.voice('join',{sessionId});assert.deepEqual(f.calls.voice.map(call=>call.action),['status','join','leave','press','release','cancel','join']);
  assert.ok(f.calls.voice.slice(0,6).every(call=>call.payload==='{}'));assert.deepEqual(JSON.parse(f.calls.voice[6].payload),{sessionId});assert.equal(f.calls.api.length+f.calls.fetch.length,0);
 }finally{f.close()}
});
test('unknown commands, injected routes and malformed payloads never cross the native voice bridge',()=>{
 const f=fixture();try{
  for(const [action,payload]of [['publish',{}],['voice-join',{}],['join',{url:'https://private.invalid'}],['join',{sessionId,token:'secret'}],['press',{sessionId}],['release',{leaseId:sessionId}],['join',{sessionId:'javascript:alert(1)'}],['join',{sessionId:123}],['join',[]],['join',null],['join','{}']])unavailable(f.C.voice(action,payload));
  assert.equal(f.calls.voice.length+f.calls.api.length+f.calls.fetch.length,0);
 }finally{f.close()}
});
test('malformed native snapshots and bridge exceptions return a bounded unavailable result',()=>{
 const f=fixture();try{
  for(const raw of ['not JSON','null','[]',{...publicState,available:'true'},{...publicState,ready:1},{...publicState,microphone:'false'},{...publicState,canTalk:null},{...publicState,state:'PRIVATE_STATE'},{...publicState,message:'x'.repeat(161)},{...publicState,message:{token:'PRIVATE'}}]){f.setResult(raw);unavailable(f.C.voice('status'));}
  f.setThrows();const result=f.C.voice('press');unavailable(result);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_NATIVE_DETAIL/);assert.equal(f.calls.api.length+f.calls.fetch.length,0);
 }finally{f.close()}
});
for(const options of [{native:false},{native:true,voice:false}])test('missing native voice capability is unavailable without a browser media or server fallback '+JSON.stringify(options),()=>{
 const f=fixture(options);try{for(const action of ['status','join','press','release','leave','cancel'])unavailable(f.C.voice(action));assert.equal(f.calls.voice.length+f.calls.api.length+f.calls.fetch.length,0);assert.equal(f.w.navigator.mediaDevices,undefined);}finally{f.close()}
});
const restricted=['duty-join','duty-heartbeat','duty-leave','voice-join','voice-floor','voice-renew','voice-release','voice-broadcast-start','voice-broadcast-end','voice-invite','voice-future-action'];
for(const native of [true,false])test('generic API rejects every voice and duty route before transport '+(native?'native':'browser'),async()=>{
 const f=fixture({native});try{
  for(const action of restricted)await assert.rejects(f.C.api(action,{sessionId,token:'NEVER_SEND'},{token:'NEVER_SEND'}),error=>error.status===503&&/native voice controls/.test(error.message));
  assert.deepEqual(f.calls,{voice:[],api:[],fetch:[],local:[]});
 }finally{f.close()}
});
for(const native of [true,false])test('voice API restriction preserves ordinary API requests '+(native?'native':'browser'),async()=>{
 const f=fixture({native});try{const result=await f.C.api('config');assert.equal(result.ok,true);assert.equal(result.googleEnabled,false);assert.equal(native?f.calls.api.length:f.calls.fetch.length,1);assert.equal(f.calls.voice.length,0);}finally{f.close()}
});
