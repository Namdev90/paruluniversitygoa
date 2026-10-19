'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,'app/assets',file),'utf8');
const operationId='11111111-1111-4111-8111-111111111111';
const stamp='2026-10-18T12:00:00Z';
const faculty={role:'checker',checkerId:'22222222-2222-4222-8222-222222222222',name:'Synthetic Faculty',method:'google',active:true,reports:true,scanner:false,helpdesk:false,nameConfirmed:true};
const stats={registered:3,eligible:2,blocked:1,attended:2,registeredAttended:1,organizerConfirmed:1,noShow:1,serverIssues:2,issueTickets:1,duplicateAttempts:1,pendingHelpDesk:0,generatedAt:stamp};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}};
function launch(profile=faculty){
 const dom=new JSDOM(read('index.html'),{url:'https://fixture.invalid/',runScripts:'outside-only'}),w=dom.window,calls=[],saves=[],listeners=[];
 let current=profile,handler;
 w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;
 w.GateClient={native:false,profile:()=>current,on:f=>listeners.push(f),api:async(action,payload={})=>{calls.push({action,payload});if(handler){const result=await handler(action,payload);if(result!==undefined)return result;}if(action==='me')return current;if(action==='reports-summary')return{stats};if(action==='reports-members')return{members:[]};if(action==='reports-export')return{kind:payload.kind,count:1,generatedAt:stamp,rows:[{'Ticket ID':'DEMO0001',Name:'=HYPERLINK("https://example.invalid")','Attendance':'Admitted'}]};throw Error('Unexpected fixture request: '+action);},saveReport:(name,mime,bytes,metadata)=>{saves.push({name,mime,bytes,metadata});return{operationId:metadata?.operationId,outcome:'initiated'}}};
 for(const file of ['report-export.js','reports.js'])w.eval(read(file));
 return{dom,w,calls,saves,$:id=>w.document.getElementById(id),setHandler:f=>handler=f,setProfile:(p,emit=true)=>{current=p;if(emit)listeners.forEach(f=>f({type:'profile'}));},close:()=>dom.window.close()};
}
test('every faculty dataset downloads CSV and XLSX with fresh server authorization',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();const kinds=[...a.$('report-kind').options].map(x=>x.value);assert.equal(kinds.length,12);
 for(const kind of kinds)for(const format of ['csv','xlsx']){
  a.$('report-kind').value=kind;const before=a.calls.length;await a.$('report-'+format).onclick();const saved=a.saves.at(-1);
  assert.match(saved.name,new RegExp('^Navrang-'+kind+'-\\d{4}-\\d{2}-\\d{2}\\.'+format+'$'));
  assert.deepEqual(a.calls.slice(before).map(c=>c.action),['me','reports-export']);
  assert.deepEqual(JSON.parse(JSON.stringify(a.calls.slice(before).find(c=>c.action==='reports-export').payload)),{kind});
  assert.match(saved.metadata.operationId,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if(format==='csv'){if(kind!=='activity')assert.match(new TextDecoder().decode(saved.bytes),/'=HYPERLINK/);assert.match(new TextDecoder().decode(saved.bytes),/Report generated UTC/);}
  else assert.equal(Buffer.from(saved.bytes).subarray(0,4).toString('hex'),'504b0304');
 }
 assert.equal(a.saves.length,24);assert.equal(new Set(a.saves.map(save=>save.metadata.operationId)).size,24);assert.equal(a.calls.some(c=>c.action==='reports-members'),false);
 }finally{a.close()}
});
test('PDF gets a fresh summary and does not fetch participant rows',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();const before=a.calls.length;await a.$('report-pdf').onclick();assert.deepEqual(a.calls.slice(before).map(c=>c.action),['me','reports-summary']);assert.deepEqual(JSON.parse(JSON.stringify(a.calls.at(-1).payload)),{});assert.equal(a.saves.length,1);assert.equal(a.saves[0].mime,'application/pdf');assert.match(Buffer.from(a.saves[0].bytes).toString(),/Total admitted: 2/);}finally{a.close()}
});
test('denied faculty, scanner and signed-out identities cannot refresh or download reports',async()=>{
 for(const profile of [null,{...faculty,reports:false},{...faculty,active:false}]){const a=launch(profile);try{await a.w.NavrangReports.refresh();await a.$('report-csv').onclick();assert.equal(a.calls.length,0);assert.equal(a.saves.length,0);assert.equal(a.$('report-csv').disabled,true);}finally{a.close()}}
});
test('revocation and account replacement during export never deliver a file',async()=>{
 for(const next of [null,{...faculty,reports:false},{...faculty,checkerId:'33333333-3333-4333-8333-333333333333'}]){const a=launch(),hold=deferred();try{await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-export'?hold.promise:undefined);const job=a.$('report-csv').onclick();await settle();a.setProfile(next);hold.resolve({rows:[{Name:'Synthetic'}],count:1,generatedAt:stamp});await job;assert.equal(a.saves.length,0);assert.equal(a.$('report-stats').textContent,'');}finally{a.close()}}
});
test('server export failures remain errors and can be retried',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler(action=>{if(action==='reports-export')throw Error('Synthetic server failure');});await a.$('report-csv').onclick();assert.equal(a.saves.length,0);assert.match(a.$('report-status').textContent,/Synthetic server failure/);assert.equal(a.$('report-csv').disabled,false);a.setHandler(null);await a.$('report-csv').onclick();assert.equal(a.saves.length,1);}finally{a.close()}
});
test('repeated clicks create a single export while a request is running',async()=>{
 const a=launch(),hold=deferred();try{await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-export'?hold.promise:undefined);const job=a.$('report-csv').onclick();await settle();await a.$('report-xlsx').onclick();assert.equal(a.calls.filter(c=>c.action==='reports-export').length,1);hold.resolve({kind:'all',rows:[],count:0,generatedAt:stamp});await job;assert.equal(a.saves.length,1);}finally{a.close()}
});
test('empty datasets retain meaningful column headers in downloaded files',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler((action,payload)=>action==='reports-export'?{kind:payload.kind,rows:[],count:0,generatedAt:stamp}:undefined);await a.$('report-csv').onclick();const csv=new TextDecoder().decode(a.saves[0].bytes);assert.match(csv,/Ticket ID/);assert.match(csv,/Report generated UTC/);assert.match(a.$('report-status').textContent,/No records/);}finally{a.close()}
});
test('changing the dataset while authorization is pending preserves the clicked selection',async()=>{
 const a=launch(),hold=deferred();try{await a.w.NavrangReports.refresh();a.$('report-kind').value='attended';a.setHandler(action=>action==='me'?hold.promise:undefined);const job=a.$('report-csv').onclick();a.$('report-kind').value='blocked';hold.resolve(faculty);await job;assert.equal(a.calls.find(c=>c.action==='reports-export').payload.kind,'attended');}finally{a.close()}
});
test('failed refresh clears stale summary and a later refresh recovers',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler(action=>{if(action==='reports-summary')throw Error('Synthetic offline');});await a.w.NavrangReports.refresh();assert.equal(a.$('report-stats').textContent,'');assert.equal(a.$('report-csv').disabled,true);a.setHandler(null);await a.w.NavrangReports.refresh();assert.equal(a.$('report-csv').disabled,false);}finally{a.close()}
});
test('admin membership failure does not break report downloads',async()=>{
 const a=launch({...faculty,role:'admin'});try{a.setHandler(action=>{if(action==='reports-members')throw Error('Synthetic admin-list failure');});await a.w.NavrangReports.refresh();assert.equal(a.$('report-csv').disabled,false);assert.match(a.$('report-teachers').textContent,/unavailable/);await a.$('report-csv').onclick();assert.equal(a.saves.length,1);}finally{a.close()}
});

test('unexpected response columns are excluded from faculty downloads',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler((action,payload)=>action==='reports-export'?{kind:payload.kind,rows:[{'Ticket ID':'DEMO0001',Name:'Synthetic',email:'private-fixture@example.invalid',phone:'fixture-only',accessToken:'not-a-real-token'}],count:1,generatedAt:stamp}:undefined);
 for(const format of ['csv','xlsx']){await a.$('report-'+format).onclick();const content=Buffer.from(a.saves.at(-1).bytes).toString();assert.doesNotMatch(content,/private-fixture|fixture-only|not-a-real-token/);assert.match(content,/DEMO0001/);}
 }finally{a.close()}
});
test('malformed or mismatched datasets fail closed instead of downloading an invalid file',async()=>{
 for(const result of [{kind:'blocked',rows:[],count:0,generatedAt:stamp},{kind:'all',rows:null,count:0,generatedAt:stamp},{kind:'all',rows:[],count:2,generatedAt:stamp},{kind:'all',rows:[null],count:1,generatedAt:stamp},{kind:'all',rows:[],count:0,generatedAt:'invalid'}]){
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-export'?result:undefined);await a.$('report-csv').onclick();assert.equal(a.saves.length,0);assert.match(a.$('report-status').textContent,/incomplete dataset/);}finally{a.close()}}
});
test('invalid summary never enables downloads or leaves stale totals visible',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-summary'?{stats:{...stats,organizerConfirmed:-1}}:undefined);await a.w.NavrangReports.refresh();assert.equal(a.$('report-csv').disabled,true);assert.equal(a.$('report-stats').textContent,'');assert.match(a.$('report-status').textContent,/incomplete report/);}finally{a.close()}
});
test('an older cancelled export cannot unlock a newer account export',async()=>{
 const a=launch(),old=deferred(),next=deferred();try{await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-export'?old.promise:undefined);const job=a.$('report-csv').onclick();await settle();a.setProfile(null);a.setProfile({...faculty,checkerId:'33333333-3333-4333-8333-333333333333'});await a.w.NavrangReports.refresh();a.setHandler(action=>action==='reports-export'?next.promise:undefined);const second=a.$('report-csv').onclick();await settle();old.resolve({kind:'all',rows:[],count:0,generatedAt:stamp});await job;assert.equal(a.$('report-csv').disabled,true);await a.$('report-xlsx').onclick();assert.equal(a.calls.filter(c=>c.action==='reports-export').length,2);next.resolve({kind:'all',rows:[],count:0,generatedAt:stamp});await second;assert.equal(a.saves.length,1);assert.equal(a.$('report-csv').disabled,false);}finally{a.close()}
});

test('actual Android client bridge preserves report binary bytes across Base64 chunks',()=>{
 const dom=new JSDOM('',{url:'https://fixture.invalid/',runScripts:'outside-only'}),w=dom.window,saved=[];
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile:faculty}}),saveReport:(name,mime,data)=>saved.push({name,mime,data})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(read(file));
 try{
  for(const length of [0,1,16383,16384,16385,65537]){const bytes=new w.Uint8Array(length);for(let i=0;i<length;i++)bytes[i]=i%256;w.GateClient.saveReport('Navrang-synthetic.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes);assert.deepEqual(Buffer.from(saved.at(-1).data,'base64'),Buffer.from(bytes));}
  assert.throws(()=>w.GateClient.saveReport('Navrang-invalid.csv','text/csv','not-bytes'),/Invalid report/);
  assert.throws(()=>w.GateClient.saveReport('Navrang-too-large.csv','text/csv',new w.Uint8Array(12*1024*1024+1)),/too large/);
  delete w.Native.saveReport;assert.throws(()=>w.GateClient.saveReport('Navrang-unsupported.csv','text/csv',new w.Uint8Array()),/install Navrang/);
 }finally{dom.window.close()}
});
test('actual browser client creates a typed blob, clicks the filename and releases its URL',()=>{
 const dom=new JSDOM('',{url:'https://fixture.invalid/',runScripts:'outside-only'}),w=dom.window,blobs=[],clicks=[],released=[],scheduled=[];
 w.URL.createObjectURL=blob=>{blobs.push(blob);return 'blob:synthetic-report';};w.URL.revokeObjectURL=url=>released.push(url);w.setTimeout=fn=>scheduled.push(fn);
 w.HTMLAnchorElement.prototype.click=function(){clicks.push({href:this.href,name:this.download,connected:this.isConnected})};
 for(const file of ['live-core.js','config.js','client.js'])w.eval(read(file));
 try{w.GateClient.saveReport('Navrang-all.csv','text/csv',new w.Uint8Array([239,187,191,65]));assert.equal(blobs.length,1);assert.equal(blobs[0].type,'text/csv');assert.equal(blobs[0].size,4);assert.deepEqual(clicks,[{href:'blob:synthetic-report',name:'Navrang-all.csv',connected:true}]);assert.equal(w.document.querySelectorAll('a').length,0);assert.deepEqual(released,[]);scheduled[0]();assert.deepEqual(released,['blob:synthetic-report']);}finally{dom.window.close()}
});

test('server-side revocation clears cached totals even before a profile event arrives',async()=>{
 for(const stage of ['me','reports-export']){const a=launch();try{await a.w.NavrangReports.refresh();a.setHandler(action=>{if(action!==stage)return;if(stage==='me'){a.setProfile({...faculty,reports:false},false);return{...faculty,reports:false};}throw Object.assign(Error('Reporting permission revoked.'),{status:403});});await a.$('report-csv').onclick();assert.equal(a.saves.length,0);assert.equal(a.$('report-stats').textContent,'');assert.equal(a.$('report-caveat').textContent,'');assert.equal(a.$('report-csv').disabled,true);assert.match(a.$('report-status').textContent,/access changed|revoked/);}finally{a.close()}}
});


test('browser download QA uses paced visible clicks without disabling browser guards',()=>{
 const harness=fs.readFileSync(path.join(ROOT,'tests/teacher-reports-browser-check.py'),'utf8');
 assert.match(harness,/page\.wait_for_timeout\(500\)/);
 assert.match(harness,/page\.locator\('#report-'\+fmt\)\.click\(\)/);
 assert.match(harness,/page\.locator\('#report-kind'\)\.select_option\(kind\)/);
 assert.match(harness,/failure\.json/);assert.match(harness,/console_messages/);
 assert.ok(!harness.includes('force=True'));assert.ok(!harness.includes('disable-ipc-flooding-protection'));
});
test('native save waits through the picker and reports cancellation without saved success',async()=>{
 const a=launch(),hold=deferred();try{a.w.GateClient.native=true;a.w.GateClient.saveReport=(name,mime,bytes,metadata)=>{a.saves.push({name,mime,bytes,metadata});return hold.promise};await a.w.NavrangReports.refresh();const job=a.$('report-csv').onclick();await settle();assert.equal(a.$('report-csv').disabled,true);assert.equal(a.saves.length,1);const localId=a.saves[0].metadata.operationId;assert.match(localId,/^[0-9a-f-]{36}$/i);hold.resolve({operationId:localId,outcome:'cancelled'});await job;assert.deepEqual(a.calls.map(c=>c.action),['reports-summary','me','reports-export']);assert.match(a.$('report-status').textContent,/cancelled/i);assert.doesNotMatch(a.$('report-status').textContent,/saved|receipt/i);assert.equal(a.$('report-csv').disabled,false)}finally{a.close()}
});
test('production v7 responses need no server operation identity or save receipt endpoints',async()=>{
 const a=launch();try{await a.w.NavrangReports.refresh();for(const format of ['csv','xlsx','pdf'])await a.$('report-'+format).onclick();assert.equal(a.saves.length,3);assert.equal(a.calls.some(c=>['reports-summary-prepare','reports-save-outcome'].includes(c.action)),false);assert.match(a.$('report-status').textContent,/Browser download initiated/);assert.doesNotMatch(a.$('report-status').textContent,/saved|receipt|acknowledged/i);}finally{a.close()}
});
test('native saved and failed outcomes remain device-confirmed terminal results',async()=>{
 for(const outcome of ['saved','failed']){const a=launch();try{a.w.GateClient.native=true;a.w.GateClient.saveReport=(name,mime,bytes,metadata)=>{a.saves.push({name,mime,bytes,metadata});return Promise.resolve({operationId:metadata.operationId,outcome})};await a.w.NavrangReports.refresh();await a.$('report-pdf').onclick();assert.match(a.$('report-status').textContent,outcome==='saved'?/saved on this device/:/Could not save report/);assert.equal(a.calls.some(c=>c.action==='reports-save-outcome'),false);assert.equal(a.$('report-pdf').disabled,false);}finally{a.close()}}
});
test('a stale native picker completion cannot unlock or overwrite a new account save',async()=>{
 const a=launch(),old=deferred(),next=deferred();try{a.w.GateClient.native=true;a.w.GateClient.saveReport=(name,mime,bytes,metadata)=>{a.saves.push({name,mime,bytes,metadata});return a.saves.length===1?old.promise:next.promise};await a.w.NavrangReports.refresh();const first=a.$('report-csv').onclick();await settle();a.setProfile(null);a.setProfile({...faculty,checkerId:'33333333-3333-4333-8333-333333333333'});await a.w.NavrangReports.refresh();const second=a.$('report-xlsx').onclick();await settle();assert.equal(a.saves.length,2);old.resolve({operationId:a.saves[0].metadata.operationId,outcome:'saved'});await first;assert.equal(a.$('report-csv').disabled,true);assert.doesNotMatch(a.$('report-status').textContent,/saved on this device/);next.resolve({operationId:a.saves[1].metadata.operationId,outcome:'cancelled'});await second;assert.match(a.$('report-status').textContent,/cancelled/);assert.equal(a.$('report-csv').disabled,false);assert.equal(a.calls.some(c=>c.action==='reports-save-outcome'),false);}finally{a.close()}
});
test('unconfirmed or mismatched native terminal outcomes never claim a successful save',async()=>{
 for(const outcome of ['initiated','unknown','mismatched']){const a=launch();try{a.w.GateClient.native=true;a.w.GateClient.saveReport=(name,mime,bytes,metadata)=>Promise.resolve({operationId:outcome==='mismatched'?operationId:metadata.operationId,outcome:outcome==='mismatched'?'saved':outcome});await a.w.NavrangReports.refresh();await a.$('report-csv').onclick();assert.match(a.$('report-status').textContent,/did not confirm/i);assert.doesNotMatch(a.$('report-status').textContent,/saved on this device/);}finally{a.close()}}
});
