// Real gate.js in the DOM with a deterministic clock; no network or native scanner.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const asset=name=>fs.readFileSync(path.join(__dirname,'../app/assets',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function clock(w){
 let now=0,next=1,wallOffset=0;
 const timers=new Map();
 w.Date.now=()=>now+wallOffset;
 w.setTimeout=(fn,delay=0)=>{const id=next++;timers.set(id,{at:now+Math.max(0,Number(delay)||0),fn});return id};
 w.clearTimeout=id=>timers.delete(id);
 // Polling is unrelated to result deadlines; all result timeouts still run normally.
 w.setInterval=()=>0;
 return{shiftWall(ms){wallOffset+=ms},advance(ms){
  const end=now+ms;
  for(;;){
   const due=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
   if(!due)break;
   now=due[1].at;timers.delete(due[0]);due[1].fn();
  }
  now=end;
 }};
}
async function launch(t){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,$=id=>w.document.getElementById(id),time=clock(w),feedback=[];
 let profile={role:'checker',checkerId:'test-checker',name:'Test Checker',active:true,station:'checker',scanner:true},listener;
 w.matchMedia=()=>({matches:true});
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};
 w.HTMLDialogElement.prototype.show=function(){this.setAttribute('open','')};
 w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 w.eval(asset('live-core.js'));
 w.GateClient={native:false,profile:()=>profile,on:fn=>listener=fn,finishGoogle:async()=>{},feedback:kind=>feedback.push(kind),
  local:async()=>({entries:[],stats:{},localCount:0,pending:0}),api:async action=>action==='me'?profile:{googleEnabled:false},
  sync:async()=>({dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]})};
 w.eval(asset('gate.js'));
 await tick();
 t.after(async()=>{await tick();dom.window.close()});
 return{$,time,feedback,result:r=>listener({type:'result',data:r}),ack:()=>$('close-result').click(),
  auth:p=>{profile=p;listener({type:'auth',data:p})},profile:()=>profile};
}
const pending=id=>({code:'pending',...(id?{id}:{}),message:'Awaiting server confirmation.'});
const admitted=id=>({code:'admitted',id,entry:{ticketId:id,name:id,checker:'Test Checker',at:'2026-10-17T12:00:00Z'}});
const blocked=id=>({code:'blocked',id,message:'Payment needs review.'});
function held(app,id,state='pending'){
 assert.equal(app.$('result-popup').open,true);
 assert.equal(app.$('result-popup').dataset.state,state);
 assert.equal(app.$('result-name').textContent,id);
 assert.equal(app.$('result-popup').dataset.modal,'true');
 assert.equal(app.$('scan').disabled,true);
 assert.equal(app.$('manual-submit').disabled,true);
 assert.equal(app.$('help-desk').hidden,false);
}

test('each ticket keeps its original warning deadline when another pending result arrives',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(2000);app.result(pending('DEMO0002'));
 app.time.advance(499);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0001');
 app.ack();app.time.advance(1999);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0002');
});

test('moving the wall clock backwards cannot consume and lose a pending warning',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(2000);app.time.shiftWall(-10000);
 app.time.advance(499);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0001');
});

test('moving the wall clock forwards cannot turn a retry into an early warning',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(500);app.time.shiftWall(10000);
 app.result(pending('DEMO0001'));assert.equal(app.$('scan').disabled,false);
 app.time.advance(1999);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0001');
});

test('another ticket receipt and its automatic dismissal cannot cancel a pending deadline',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(500);app.result(admitted('DEMO0002'));
 app.time.advance(1500);assert.equal(app.$('result-popup').open,false);
 app.time.advance(500);held(app,'DEMO0001');
});

test('pending deadlines queue behind a held issue in deadline order',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(1000);app.result(pending('DEMO0002'));
 app.result(blocked('DEMO0003'));app.time.advance(2500);held(app,'DEMO0003','issue');
 app.ack();app.time.advance(200);held(app,'DEMO0001');
 app.ack();app.time.advance(200);held(app,'DEMO0002');
 app.ack();app.time.advance(10000);assert.equal(app.$('result-popup').open,false);
});

test('pending results received behind a held issue still get a deadline',async t=>{
 const app=await launch(t);
 app.result(blocked('DEMO0002'));app.result(pending('DEMO0001'));app.time.advance(2500);
 held(app,'DEMO0002','issue');app.ack();app.time.advance(200);held(app,'DEMO0001');
});

test('retries do not reset the deadline or interrupt a warning already on screen',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(1000);app.result(pending('DEMO0001'));
 app.time.advance(1499);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0001');
 const warnings=app.feedback.filter(kind=>kind==='pending').length;
 app.result(pending('DEMO0001'));held(app,'DEMO0001');
 assert.equal(app.feedback.filter(kind=>kind==='pending').length,warnings);
});

test('acknowledged pending retries stay quiet while other ticket warnings remain active',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(2000);app.result(pending('DEMO0002'));
 app.time.advance(500);held(app,'DEMO0001');app.ack();
 for(let i=0;i<4;i++){app.result(pending('DEMO0001'));app.time.advance(500)}
 held(app,'DEMO0002');app.ack();app.time.advance(200);
 app.result(pending('DEMO0001'));app.result(pending('DEMO0002'));app.time.advance(10000);
 assert.equal(app.$('result-popup').open,false);assert.equal(app.$('scan').disabled,false);
});

test('a receipt replaces a queued pending warning instead of replaying stale pending data',async t=>{
 const app=await launch(t);
 app.result(blocked('DEMO0002'));app.result(pending('DEMO0001'));app.time.advance(2500);
 app.result(admitted('DEMO0001'));app.ack();app.time.advance(200);
 assert.equal(app.$('result-popup').dataset.state,'confirmed');
 assert.equal(app.$('result-name').textContent,'DEMO0001');
 app.time.advance(10000);assert.equal(app.$('result-popup').open,false);assert.equal(app.$('scan').disabled,false);
});

test('a receipt during the delayed queue handoff cannot resurrect its pending warning',async t=>{
 const app=await launch(t);
 app.result(blocked('DEMO0002'));app.result(pending('DEMO0001'));app.time.advance(2500);
 app.ack();app.time.advance(100);app.result(admitted('DEMO0001'));app.time.advance(100);
 assert.equal(app.$('result-popup').dataset.state,'confirmed');assert.equal(app.$('scan').disabled,false);
 app.time.advance(5000);assert.equal(app.$('result-popup').open,false);
});

test('a matching server receipt reconciles a held pending warning immediately',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(2500);held(app,'DEMO0001');
 app.result(admitted('DEMO0001'));
 assert.equal(app.$('result-popup').dataset.state,'confirmed');assert.equal(app.$('result-popup').dataset.modal,'false');
 assert.equal(app.$('scan').disabled,false);app.time.advance(10000);assert.equal(app.$('result-popup').open,false);
});

test('closing a nonmodal pending card does not discard the ticket warning deadline',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(1000);app.ack();
 assert.equal(app.$('result-popup').open,false);app.time.advance(1500);held(app,'DEMO0001');
});

test('anonymous pending notices never create an unidentified ticket warning',async t=>{
 const app=await launch(t);
 app.result(pending());app.time.advance(10000);
 assert.equal(app.$('result-popup').dataset.modal,'false');assert.equal(app.$('scan').disabled,false);
 assert.equal(app.feedback.includes('pending'),false);
 app.result(pending('DEMO0001'));app.time.advance(2500);held(app,'DEMO0001');
});

test('session cleanup cancels all pending deadlines and delayed warning handoffs',async t=>{
 const app=await launch(t),profile=app.profile();
 app.result(blocked('DEMO0003'));app.result(pending('DEMO0001'));app.time.advance(1000);app.result(pending('DEMO0002'));
 app.time.advance(1500);app.ack();app.auth(null);app.auth(profile);app.time.advance(10000);
 assert.equal(app.$('result-popup').open,false);assert.equal(app.$('result-name').textContent,'');assert.equal(app.$('scan').disabled,false);
 app.result(pending('DEMO0001'));app.time.advance(2500);held(app,'DEMO0001');
 app.result(pending('DEMO0002'));app.time.advance(2500);app.ack();app.time.advance(200);held(app,'DEMO0002');
});

test('a receipt before its deadline cancels only the matching ticket warning',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(1000);app.result(pending('DEMO0002'));
 app.time.advance(1000);app.result(admitted('DEMO0001'));
 app.time.advance(500);assert.equal(app.$('result-popup').dataset.state,'confirmed');assert.equal(app.$('scan').disabled,false);
 app.time.advance(1000);held(app,'DEMO0002');
});

test('repeated overdue updates queue one warning without displacing a newer held issue',async t=>{
 const app=await launch(t);
 app.result(blocked('DEMO0003'));app.result(pending('DEMO0001'));app.time.advance(2500);
 app.result(pending('DEMO0001'));app.result(pending('DEMO0001'));app.ack();
 app.time.advance(100);app.result(blocked('DEMO0002'));app.time.advance(100);
 held(app,'DEMO0002','issue');app.ack();app.time.advance(200);held(app,'DEMO0001');
 app.ack();app.time.advance(10000);assert.equal(app.$('result-popup').open,false);
 assert.equal(app.feedback.filter(kind=>kind==='pending').length,1);
});

test('final results clear a pending acknowledgement so a later scan gets a fresh deadline',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(2500);held(app,'DEMO0001');app.ack();
 app.result(pending('DEMO0001'));app.time.advance(2500);assert.equal(app.$('result-popup').open,false);
 app.result(admitted('DEMO0001'));app.time.advance(1500);app.result(pending('DEMO0001'));
 app.time.advance(2499);assert.equal(app.$('scan').disabled,false);
 app.time.advance(1);held(app,'DEMO0001');
});

test('reconciling a held warning hands off queued warnings despite continuous scan results',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.time.advance(500);app.result(pending('DEMO0002'));
 app.time.advance(2500);held(app,'DEMO0001');app.result(admitted('DEMO0001'));
 for(let i=0;i<2;i++){
  app.result(pending('DEMO0003'));app.time.advance(50);app.result(admitted('DEMO0003'));app.time.advance(50);
 }
 held(app,'DEMO0002');
});

test('a receipt cancels a queued warning during the reconciliation handoff',async t=>{
 const app=await launch(t);
 app.result(pending('DEMO0001'));app.result(pending('DEMO0002'));app.time.advance(2500);
 held(app,'DEMO0001');app.result(admitted('DEMO0001'));app.time.advance(100);
 app.result(admitted('DEMO0002'));app.time.advance(100);
 assert.equal(app.$('result-popup').dataset.state,'confirmed');assert.equal(app.$('result-name').textContent,'DEMO0002');
 app.time.advance(10000);assert.equal(app.$('result-popup').open,false);assert.equal(app.$('scan').disabled,false);
});

test('dequeueing a receipt cannot starve the overdue warning behind it',async t=>{
 const app=await launch(t);
 app.result(blocked('DEMO0001'));app.result(admitted('DEMO0002'));app.result(pending('DEMO0003'));
 app.time.advance(2500);held(app,'DEMO0001','issue');app.ack();app.time.advance(200);
 assert.equal(app.$('result-popup').dataset.state,'confirmed');assert.equal(app.$('result-name').textContent,'DEMO0002');
 for(let i=0;i<2;i++){
  app.result(pending('DEMO0004'));app.time.advance(50);app.result(admitted('DEMO0004'));app.time.advance(50);
 }
 held(app,'DEMO0003');
});
