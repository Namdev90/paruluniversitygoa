const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const asset=name=>fs.readFileSync(path.join(__dirname,'../app/assets',name),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const id=n=>'DEMO'+String(n).padStart(4,'0');
function setup(native=false){
 let profile={role:'admin',name:'Synthetic Administrator',active:true},listener;
 const records=Array.from({length:120},(_,n)=>({id:id(n),name:'Student '+String(n).padStart(3,'0'),eligible:n%2===0,amount:100}));
 const entries=records.map((r,n)=>({ticketId:r.id,name:r.name,checker:'Checker '+n,seq:n+1,at:'2026-10-17T12:00:00Z',...(n===0?{admissionBasis:'organizer_confirmed'}:{})}));
 const crew=Array.from({length:120},(_,n)=>({id:'staff-'+n,name:'Staff '+String(n).padStart(3,'0'),active:true,method:'code',scanner:true,helpdesk:false,entries:n}));
 let update={dataRevision:1,cursor:120,records,entries,checkers:crew,stats:{total:200,admitted:793}};
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,$=id=>w.document.getElementById(id);
 w.matchMedia=()=>({matches:true});w.eval(asset('live-core.js'));w.NavrangDesk={refresh(){},clear(){},hasDraft:()=>false};
 w.GateClient={native,profile:()=>profile,on:f=>listener=f,finishGoogle:async()=>{},feedback(){},local:async()=>({stats:{},pending:0,localCount:120}),sync:async()=>update,api:async action=>action==='config'?{googleEnabled:true}:profile};
 w.eval(asset('pagination.js'));w.eval(asset('gate.js'));
 return{w,dom,$,records,entries,crew,event:event=>listener(event),setUpdate:value=>update={...update,...value},setProfile:value=>{profile=value;listener({type:'profile'})},search:(target,value)=>{$(target).value=value;$(target).dispatchEvent(new w.Event('input'))}};
}
function scroll(t,target){const box=t.$(target).closest('.rows-scroll')||t.$(target);Object.defineProperty(box,'clientHeight',{configurable:true,value:300});Object.defineProperty(box,'scrollHeight',{configurable:true,value:5000});box.scrollTop=4800;box.dispatchEvent(new t.w.Event('scroll'));return box}

function touch(t,target,type,touches,changedTouches=touches){
 const event=new t.w.Event(type,{bubbles:true});
 Object.assign(event,{touches,changedTouches});target.dispatchEvent(event);
}
function swipe(t,target,from,to,finish='touchend'){
 const start={identifier:1,clientX:from[0],clientY:from[1]},end={identifier:1,clientX:to[0],clientY:to[1]};
 touch(t,target,'touchstart',[start]);touch(t,target,'touchmove',[end]);touch(t,target,finish,[],[end]);
}

test('horizontal swipe follows the visible tab order without wrapping or bypassing role access',async()=>{
 const t=setup();try{await tick();t.$('intro').hidden=true;
  const route=()=>t.w.document.body.dataset.route;
  for(const tab of t.$('main-nav').querySelectorAll('button[data-view]'))tab.getClientRects=()=>tab.style.display==='none'?[]:[{}];
  assert.equal(route(),'account');swipe(t,t.$('view-account'),[160,320],[320,320]);assert.equal(route(),'entries');
  swipe(t,t.$('view-entries'),[320,320],[160,320]);assert.equal(route(),'account');
  swipe(t,t.$('view-account'),[320,320],[160,320]);assert.equal(route(),'account');
  t.$('admin-nav').click();swipe(t,t.$('view-admin'),[320,320],[160,320]);assert.equal(route(),'admin');
  t.$('account-tool-back').click();t.$('admin-account-reports').click();
  swipe(t,t.$('view-reports'),[160,320],[320,320]);assert.equal(route(),'reports');
  t.$('station-nav').style.display='none';t.$('scan-nav').click();
  swipe(t,t.$('view-home'),[160,320],[320,320]);assert.equal(route(),'home');
  t.setProfile({role:'checker',checkerId:'synthetic',name:'Synthetic Staff',active:true,scanner:true,station:'checker'});await tick();
  assert.equal(route(),'home');swipe(t,t.$('view-home'),[320,320],[160,320]);assert.equal(route(),'account');
  swipe(t,t.$('view-account'),[160,320],[320,320]);assert.equal(route(),'home');
  t.setProfile({role:'checker',checkerId:'synthetic-faculty',name:'Synthetic Faculty',active:true,scanner:false,reports:true});await tick();
  assert.equal(route(),'reports');swipe(t,t.$('view-reports'),[320,320],[160,320]);assert.equal(route(),'account');
  swipe(t,t.$('view-account'),[160,320],[320,320]);assert.equal(route(),'reports');
 }finally{await tick();t.dom.window.close()}
});

test('swipe leaves scrolling, forms, modals, screen edges and cancelled touches alone',async()=>{
 const t=setup();try{await tick();t.$('intro').hidden=true;
  t.$('entries-nav').click();
  const view=t.$('view-entries'),route=()=>t.w.document.body.dataset.route;
  swipe(t,view,[320,320],[285,322]);swipe(t,view,[320,320],[235,460]);
  swipe(t,view,[12,320],[170,320]);swipe(t,view,[320,320],[160,320],'touchcancel');
  swipe(t,t.$('entry-search'),[320,320],[160,320]);
  const start={identifier:1,clientX:320,clientY:320};
  touch(t,view,'touchstart',[start,{...start,identifier:2}]);touch(t,view,'touchend',[],[{...start,clientX:160}]);
  t.$('student-dialog').setAttribute('open','');swipe(t,view,[320,320],[160,320]);
  t.$('student-dialog').removeAttribute('open');
  const scroller=t.$('all-entry-rows').closest('.rows-scroll');
  scroller.style.overflowX='auto';Object.defineProperties(scroller,{scrollWidth:{value:400},clientWidth:{value:250}});
  swipe(t,scroller,[320,320],[160,320]);assert.equal(route(),'entries');
 }finally{await tick();t.dom.window.close()}
});

test('all active lists retain accessible search and status controls',()=>{
 const dom=new JSDOM(asset('index.html'));try{const d=dom.window.document;assert.equal(d.querySelector('.pager'),null);for(const name of ['student-search','recent-search','entry-search','staff-search','desk-search']){const input=d.getElementById(name);assert.equal(input.type,'search');assert.ok(input.getAttribute('aria-label'));assert.ok(d.getElementById(input.getAttribute('aria-controls')))}for(const name of ['entry-coverage','registration-count','all-entry-count','staff-count','desk-list-status'])assert.equal(d.getElementById(name).getAttribute('role'),'status')}finally{dom.window.close()}
});

test('Students search covers every record with all rows reachable and working row actions',async()=>{
 for(const native of [false,true]){const t=setup(native);try{await tick();assert.equal(t.$('registration-rows').children.length,120);assert.match(t.$('registration-count').textContent,/120 results · 120 loaded · 200 server total/);
  assert.equal(t.w.document.querySelector('.compact-pager'),null);
  t.search('student-search','demo0119');assert.equal(t.$('registration-rows').children.length,1);assert.match(t.$('registration-count').textContent,/1 results · 120 loaded · 200 server total/);assert.equal(t.$('registration-rows').closest('.rows-scroll').scrollTop,0);t.$('registration-rows').querySelector('button').click();assert.equal(t.$('dialog-name').textContent,'Student 119');
  t.search('student-search','missing');assert.equal(t.$('registration-rows').children.length,0);assert.equal(t.$('registrations-empty').hidden,false);
  t.search('student-search','');t.$('payment-filter').value='eligible';t.$('payment-filter').dispatchEvent(new t.w.Event('change'));assert.match(t.$('registration-count').textContent,/60 results/);
 }finally{await tick();t.dom.window.close()}}
});

test('both entry lists search full RAM receipts and distinguish loaded receipts from server totals',async()=>{
 const t=setup();try{await tick();await tick();assert.equal(t.$('recent-entries').children.length,120);assert.equal(t.$('all-entry-rows').children.length,120);assert.match(t.$('entry-coverage').textContent,/120 loaded · 793 server total/);
  assert.match(t.$('recent-entries').textContent,/DEMO0000/);
  t.search('recent-search','demo0000');assert.equal(t.$('recent-entries').children.length,1);assert.match(t.$('recent-entries').textContent,/physical entry time unknown/);
  t.search('entry-search','checker 119');assert.equal(t.$('all-entry-rows').children.length,1);assert.match(t.$('all-entry-rows').textContent,/DEMO0119/);assert.match(t.$('all-entry-count').textContent,/1 results · 120 loaded · 793 server total/);
  t.search('entry-search','missing');assert.equal(t.$('all-entry-empty').hidden,false);assert.match(t.$('all-entry-empty').textContent,/No loaded entries/);
 }finally{await tick();t.dom.window.close()}
});
test('entry details open from an authorized compact receipt without an edit action',async()=>{
 const t=setup();try{await tick();await tick();t.$('all-entry-rows').querySelector('button').click();assert.equal(t.$('student-dialog').open,true);assert.match(t.$('dialog-details').textContent,/DEMO0119/);assert.equal(t.$('edit-student').hidden,true)}finally{await tick();t.dom.window.close()}
});

test('periodic changes preserve scroll, focused actions and unchanged row identity',async()=>{
 const t=setup();try{await tick();const box=scroll(t,'registration-rows');const row=t.$('registration-rows').children[2],button=row.querySelector('button');button.focus();t.setUpdate({stats:{total:200,admitted:794}});t.$('admin-refresh').click();await tick();await tick();assert.equal(t.$('registration-rows').children.length,120);assert.equal(t.$('registration-rows').children[2],row);assert.equal(t.w.document.activeElement,button);assert.equal(box.scrollTop,4800);
  t.search('student-search','Student 119');t.$('admin-refresh').click();await tick();assert.equal(t.$('registration-rows').children.length,1);assert.equal(t.$('student-search').value,'Student 119');
 }finally{await tick();t.dom.window.close()}
});

test('Staff search finds offscreen people without changing full active count and access loss clears list caches',async()=>{
 const t=setup();try{await tick();assert.equal(t.$('checker-list').children.length,120);t.search('staff-search','Staff 119');assert.equal(t.$('checker-list').children.length,1);t.$('checker-list').querySelector('button').click();assert.equal(t.$('staff-name').value,'Staff 119');assert.match(t.$('namu-message').textContent,/120 active staff/);
  t.search('recent-search','Checker');t.setProfile({role:'checker',checkerId:'staff-0',name:'Staff',active:true,scanner:true,station:'checker'});await tick();for(const target of ['registration-rows','recent-entries','all-entry-rows','checker-list']){scroll(t,target);assert.equal(t.$(target).children.length,0)}for(const target of ['student-search','recent-search','entry-search','staff-search'])assert.equal(t.$(target).value,'');
 }finally{await tick();t.dom.window.close()}
});


test('student details show available payment/entry provenance and omit fields missing from the record',async()=>{
 const t=setup();try{Object.assign(t.records[0],{quantity:1,refund:0,description:'Transaction completed successfully',source:'Imported ticket row'});Object.assign(t.entries[0],{source:'Organizer correction',observedScanAt:'2026-10-17T11:58:00Z',note:'Confirmed by organizer'});t.setUpdate({source:'Current import file'});await tick();t.search('student-search','DEMO0000');t.$('registration-rows').querySelector('button').click();
  const text=t.$('dialog-details').textContent;for(const value of ['Quantity','Refund','₹0','Transaction completed successfully','Organizer-confirmed attendance','Recorded by','Checker 0','Correction recorded','Observed scan','Organizer correction','Confirmed by organizer','Imported ticket row','Current registration dataset'])assert.ok(text.includes(value),value);assert.ok(!text.includes('Physical entry'));
  t.search('student-search','DEMO0119');t.$('registration-rows').querySelector('button').click();const labels=[...t.$('dialog-details').querySelectorAll('dt')].map(n=>n.textContent);for(const label of ['Quantity','Refund','Payment status','Registration source','Entry note'])assert.ok(!labels.includes(label),label);assert.ok(!/Not recorded|unavailable/.test(t.$('dialog-details').textContent));
 }finally{await tick();t.dom.window.close()}
});

test('scan result details retain optional payment facts and correction provenance without inventing payment fields',async()=>{
 const t=setup();try{await tick();t.event({type:'result',data:{code:'duplicate',id:'DEMO0000',record:{id:'DEMO0000',name:'Student 000',quantity:1,refund:0,description:'Verified payment'},entry:{...t.entries[0],source:'Organizer note',observedScanAt:'2026-10-17T11:58:00Z'}}});const text=t.$('result-details').textContent;
  for(const value of ['Quantity: 1','Refund: ₹0','Payment status: Verified payment','Entry basis: Organizer-confirmed attendance','Recorded by: Checker 0','Correction recorded:','Observed scan:','Receipt source: Organizer note'])assert.ok(text.includes(value),value);for(const value of ['Amount:','Payment method:','Payment date:','Physical entry:','undefined','Not recorded','unavailable'])assert.ok(!text.includes(value),value);
 }finally{await tick();t.dom.window.close()}
});


test('manual entry validates ASCII before uppercase so Unicode cannot change the ticket',async()=>{
 for(const [raw,expected] of [['TEßT001',null],['ABﬀCD12',null],['test0001','TEST0001']]){
  const t=setup();try{await tick();const calls=[];t.w.GateClient.submit=async id=>calls.push(id);t.$('ticket-id').value=raw;t.$('manual-form').dispatchEvent(new t.w.Event('submit',{cancelable:true}));await tick();assert.deepEqual(calls,expected?[expected]:[]);if(!expected)assert.match(t.$('result-title').textContent,/not allowed/)}finally{t.dom.window.close()}
 }
});

test('list search caches sorted normalized data and clears that cache with access loss',()=>{
 const source=asset('gate.js');assert.match(source,/searchIndex\('students',m.records/);assert.match(source,/searchIndex\('entries',model.entries/);assert.match(source,/function clearLists\(\)\{searchIndexes.clear\(\)/);
 assert.match(source,/cached.source!==source/);
});


test('scan results display optional returned payment facts and actor ID without inventing empty receipt metadata',async()=>{
 const t=setup();try{await tick();t.event({type:'result',data:{code:'duplicate',id:'DEMO0000',record:{name:'Student',paymentAt:'2026-10-17T10:30:00Z',paymentMethod:'Synthetic method',paymentReference:'SYNTHETIC-REF',source:'Synthetic source'},entry:{checkerId:'synthetic-checker'}}});
  const text=t.$('result-details').textContent;for(const value of ['Payment date and time:','Payment method: Synthetic method','Payment reference: SYNTHETIC-REF','Registration source: Synthetic source','Checker ID: synthetic-checker'])assert.ok(text.includes(value),value);
 }finally{await tick();t.dom.window.close()}
 const empty=setup();try{await tick();empty.event({type:'result',data:{code:'not_found',id:'DEMO0000',record:{},entry:{}}});assert.ok(!empty.$('result-details').textContent.includes('Entry basis:'));assert.ok(!empty.$('result-details').textContent.includes('Payment method:'))}finally{await tick();empty.dom.window.close()}
});


test('saved Help Desk records grow naturally and retain real-pointer QA',()=>{
 const css=asset('art/classic-restore.css');
 assert.match(css,/#view-desk\.desk-list-mode\{/);
 assert.match(css,/\.list-footer\{flex-wrap:wrap\}/);
 assert.match(css,/\.list-footer \.list-status\{flex:1 1 150px;min-width:0\}/);
 assert.match(css,/#view-desk\.desk-list-mode \.desk-workspace\{flex:1 0 auto;overflow:visible\}/);
 assert.match(css,/#view-desk\.desk-list-mode #desk-records\{flex:1 0 auto;min-height:112px\}/);
 const harness=fs.readFileSync(path.join(__dirname,'responsive-browser-check.py'),'utf8');
 assert.match(harness,/collapsedHelpDeskList/);
 assert.match(css,/#desk-review-dialog \.update-actions \.button\{min-height:44px/);
 assert.match(harness,/'#desk-approve','Help Desk approve'/);
 assert.match(harness,/p\.matches\('dialog:modal'\)\)break/);
 assert.match(harness,/document\.elementFromPoint\(x,y\)/);
 assert.match(harness,/page\.locator\('#desk-records \.button'\)\.first\.click\(\)/);
 assert.ok(!harness.includes('force=True'),'pointer interception must fail the render check');
});
