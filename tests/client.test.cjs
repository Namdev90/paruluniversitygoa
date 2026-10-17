const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
test('a failed forced-region request retries future calls with automatic region selection',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window,seen=[];
 w.fetch=async(url)=>{seen.push(url);return new Response(JSON.stringify(seen.length===1?{ok:false,error:'Region unavailable'}:{ok:true,googleEnabled:false}),{status:seen.length===1?503:200,headers:{'Content-Type':'application/json'}})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{await assert.rejects(w.GateClient.api('config'),/Region unavailable/);await w.GateClient.api('config');assert.ok(seen[0].includes('forceFunctionRegion=ap-south-1'));assert.equal(seen[1].includes('forceFunctionRegion'),false)}finally{w.close()}
});

test('Google provider errors in query or fragment explain setup without exposing credentials or codes',async()=>{
 for(const suffix of ['?error=server_error&error_description=Unable+to+exchange+external+code%3A+SECRET-CODE','#error=server_error&error_code=unexpected_failure']){
  const dom=new JSDOM('',{url:'https://gate.test/'+suffix,runScripts:'outside-only'}),w=dom.window;w.sessionStorage.setItem('navrang-pkce','test-only');
  for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
  try{await assert.rejects(w.GateClient.finishGoogle(),e=>/client secret/.test(e.message)&&!/cancelled|SECRET-CODE/.test(e.message));assert.equal(w.sessionStorage.getItem('navrang-pkce'),null);assert.equal(w.location.href,'https://gate.test/')}finally{w.close()}
 }
});
test('scan audio plays a bundled sample even when an old caller passes mute false',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;let started=0,paths=[];
 w.AudioContext=class{constructor(){this.state='running';this.currentTime=0;this.destination={}}decodeAudioData(){return Promise.resolve({})}createBufferSource(){return{connect(){},start(){started++},stop(){}}}createGain(){return{gain:{},connect(){}}}};
 w.fetch=async url=>{paths.push(url);return{ok:true,arrayBuffer:async()=>new ArrayBuffer(1)}};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{w.GateClient.feedback('scan',false);await new Promise(r=>setImmediate(r));assert.equal(started,1);assert.deepEqual(paths,['audio/scan.ogg']);w.GateClient.feedback('scan',false);await new Promise(r=>setImmediate(r));assert.equal(started,2);assert.equal(paths.length,1)}finally{w.close()}
});

test('the Android bridge rejects late private responses after its auth session changes',async()=>{
 const dom=new JSDOM('',{url:'https://gate.test/',runScripts:'outside-only'}),w=dom.window;let request;
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile:{role:'admin',active:true}}}),api:(action,payload,id)=>request=id};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(fs.readFileSync(root+'/app/assets/'+file,'utf8'));
 try{
  const pending=w.GateClient.api('helpdesk-export'),denied=assert.rejects(pending,/Sign-in changed/);
  w.onGateEvent(JSON.stringify({type:'auth',data:null}));w.onApiResponse(JSON.stringify({id:request,status:200,body:{ok:true,csv:'private test contact'}}));await denied;
 }finally{w.close()}
});
