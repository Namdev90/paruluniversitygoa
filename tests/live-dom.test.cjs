// DOM + IndexedDB integration, not a rendered-browser or physical Android test.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb'),{webcrypto}=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),credentialPath=process.env.NAVRANG_TEST_CREDENTIALS,statePath=process.env.NAVRANG_TEST_STATE;
const enabled=credentialPath&&statePath;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(work,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){if(await work())return;await delay(80)}throw Error('Timed out: '+label);}
function launch(factory,session,offlineFlag,requests){
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(fs.readFileSync(ROOT+'/app/assets/index.html','utf8'),{url:'https://gate.test/#home',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});const w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortController=AbortController;w.indexedDB=factory;w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
 if(session)w.sessionStorage.setItem('navrang-session',session);
 w.fetch=async(url,options)=>{const body=options?.body?JSON.parse(options.body):null;if(body)requests.push(body);if(offlineFlag.value)throw TypeError('Network unavailable');return fetch(url,options)};
 for(const file of ['vendor/xlsx.full.min.js','core.js','workbook.js','package.js','live-core.js','store.js','config.js','client.js','gate.js'])w.eval(fs.readFileSync(ROOT+'/app/assets/'+file,'utf8')+'\n//# sourceURL='+file);
 return{dom,w,errors};
}
test('live UI auth, local conversion and durable offline admission recovery',{skip:!enabled,timeout:150000},async t=>{
 const credentials=JSON.parse(fs.readFileSync(credentialPath)),staff=JSON.parse(fs.readFileSync(statePath));const factory=new IDBFactory(),offline={value:false},requests=[];
 let app=launch(factory,null,offline,requests),w=app.w,$=id=>w.document.getElementById(id);
 try{
  await t.test('admin sign-in opens actual shared data and safe detail popup',async()=>{
   $('[data-view]');w.document.querySelector('[data-view="admin"]').click();$('admin-password').value=credentials.password;$('admin-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
   await until(()=>$('admin-console').hidden===false&&$('stat-total').textContent==='1','admin dashboard');
   assert.equal($('registration-rows').textContent.includes('DEMO0005'),true);assert.equal($('registration-rows').textContent.includes('Synthetic Student'),true);
   $('registration-rows').querySelector('button').click();assert.equal($('dialog-name').textContent,'Synthetic Student');$('close-student').click();
  });
  await t.test('real Excel converts locally with preserved data counts',async()=>{
   const workbook=process.env.NAVRANG_TEST_XLSX;if(!workbook)throw Error('Set NAVRANG_TEST_XLSX for the real-file DOM integration.');
   w.document.querySelector('[data-view="files"]').click();const data=fs.readFileSync(workbook);
   const file={name:'private-export.xlsx',size:data.length,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};
   Object.defineProperty($('data-file'),'files',{configurable:true,value:[file]});$('data-file').dispatchEvent(new w.Event('change'));
   await until(()=>$('preview-total').textContent==='997','Excel preview');assert.equal($('preview-paid').textContent,'926');assert.equal($('preview-blocked').textContent,'71');assert.equal($('apply-shared').disabled,false);
   $('apply-local').click();await until(()=>$('cache-count').textContent==='997','offline cache');
  });
  await t.test('checker login grants its named station and forbids shared file updates',async()=>{
   $('sign-out').click();await until(()=>$('signin-panel').hidden===false,'sign-out');$('checker-code').value=staff.codeA;$('checker-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
   await until(()=>$('checker-name').textContent==='Synthetic Checker A'&&$('scan').disabled===false,'checker sign-in');assert.equal($('apply-shared').disabled,true);
  });
  let pendingId,session;
  await t.test('offline scan stays amber and saves its request before transport',async()=>{
   // This ticket was created by hosted.mjs, never an attendee. Refuse any other fixture.
   const live=await w.GateClient.api('sync',{dataRevision:-1,afterSeq:0});assert.equal(live.records.length,1);assert.equal(live.records[0].id,'DEMO0005');assert.equal(live.records[0].name,'Synthetic Student');
   offline.value=true;$('ticket-id').value='DEMO0005';$('manual-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
   await until(()=>$('pending-count').textContent==='1','durable outbox');assert.equal($('result-title').textContent,'Awaiting confirmation');assert.equal($('result-popup').classList.contains('pending'),true);
   pendingId=requests.filter(r=>r.action==='checkin').at(-1)?.payload.requestId;
   if(!pendingId){await until(()=>requests.some(r=>r.action==='checkin'),'first send attempt');pendingId=requests.filter(r=>r.action==='checkin').at(-1).payload.requestId}
   session=w.sessionStorage.getItem('navrang-session');assert.deepEqual(app.errors,[]);app.dom.window.close();
  });
  await t.test('new script context retries the same saved UUID and clears outbox only after confirmation',async()=>{
   offline.value=false;app=launch(factory,session,offline,requests);w=app.w;$=id=>w.document.getElementById(id);
   await until(()=>$('result-title').textContent==='✓ Entry confirmed','server confirmation after restart');
   assert.equal(requests.filter(r=>r.action==='checkin').at(-1).payload.requestId,pendingId);
   await until(()=>$('pending-count').textContent==='0','acknowledged outbox cleared');
   assert.ok($('result-details').textContent.includes('Synthetic Checker A'));
  });
  await t.test('another scan shows the original checker and no second admission',async()=>{
   $('ticket-id').value='DEMO0005';$('manual-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>$('result-title').textContent==='Already admitted','duplicate response');assert.ok($('result-details').textContent.includes('Synthetic Checker A'));await until(()=>$('pending-count').textContent==='0','duplicate request settled');
   assert.deepEqual(app.errors,[]);
  });
 }finally{app.dom.window.close();}
});
