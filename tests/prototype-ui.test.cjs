const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),asset=n=>fs.readFileSync(root+'/app/assets/'+n,'utf8');
function ui(profile){const dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;w.matchMedia=()=>({matches:true});w.scrollTo=()=>{};let listener,writes=[];w.eval(asset('core.js'));w.eval(asset('live-core.js'));w.GateClient={native:false,profile:()=>profile,on:f=>listener=f,finishGoogle:async()=>{},feedback:()=>{},local:async()=>({entries:[],stats:{},localCount:0}),api:async(a,p)=>{writes.push(a);return a==='me'?profile:{googleEnabled:true}},sync:async()=>({dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:[]}),scan:()=>writes.push('camera'),submit:async()=>writes.push('checkin')};w.eval(asset('pagination.js'));w.eval(asset('gate.js'));return{w,dom,writes,event:e=>listener(e)}}
const tick=()=>new Promise(r=>setImmediate(r));
test('removed file tools are absent and checker cannot open admin or editor controls',async()=>{const {w,dom,writes}=ui({role:'checker',name:'Raju',active:true,method:'google',nameConfirmed:true});try{await tick();assert.equal(w.document.querySelector('input[type=file]'),null);for(const id of ['backup','export-all','export-entries','download-package','data-file'])assert.equal(w.document.getElementById(id),null);assert.equal(w.document.getElementById('admin-account-tools').hidden,true);w.document.getElementById('admin-nav').click();assert.equal(w.document.getElementById('view-admin').hidden,true);w.document.getElementById('add-registration').click();assert.equal(w.document.getElementById('edit-dialog').open,false);assert.equal(w.document.getElementById('toggle-sim'),null);assert.equal(w.document.getElementById('view-simulation'),null);assert.ok(!writes.includes('upsert'))}finally{await tick();await tick();dom.window.close()}});
test('help desk issues block check-in until manual acknowledgment',async()=>{const {w,dom,writes,event}=ui({role:'checker',name:'Raju',active:true,method:'code'});try{await tick();event({type:'result',data:{code:'blocked',id:'DEMO0001',message:'Payment failed'}});assert.equal(w.document.getElementById('help-desk').hidden,false);assert.equal(w.document.getElementById('scan').disabled,true);event({type:'result',data:{code:'admitted',id:'DEMO0002',entry:{name:'Other student',ticketId:'DEMO0002',checker:'Raju',at:new Date().toISOString(),seq:2}}});assert.equal(w.document.getElementById('result-name').textContent,'DEMO0001','another result replaced the held issue');w.document.getElementById('ticket-id').value='DEMO0003';w.document.getElementById('manual-form').dispatchEvent(new w.Event('submit',{cancelable:true}));assert.ok(!writes.includes('checkin'));w.document.getElementById('close-result').click();assert.equal(w.document.getElementById('scan').disabled,false)}finally{await tick();await tick();dom.window.close()}});
test('repeated unchanged admin updates keep existing row and button nodes',async()=>{const {w,dom}=ui({role:'admin',name:'namdev',active:true});try{w.GateClient.sync=async()=>({dataRevision:2,cursor:0,records:[{id:'DEMO0001',name:'Sample',eligible:true,amount:100}],entries:[],stats:{total:1},checkers:[]});await tick();await tick();w.document.getElementById('admin-refresh').click();await tick();await tick();const row=w.document.querySelector('#registration-rows tr'),button=row.querySelector('button');w.document.getElementById('admin-refresh').click();await tick();await tick();assert.strictEqual(w.document.querySelector('#registration-rows tr'),row);assert.strictEqual(w.document.querySelector('#registration-rows button'),button);}finally{await tick();await tick();dom.window.close()}});

test('branded close dialog warns about unconfirmed scans and unsaved Help Desk drafts',async()=>{const {w,dom}=ui({role:'checker',name:'Raju',active:true,method:'code'});try{
 await tick();assert.equal(w.document.getElementById('sound'),null);w.GateClient.local=async()=>({pending:2});await w.onBackRequested();assert.equal(w.document.getElementById('exit-dialog').open,true);assert.match(w.document.getElementById('exit-message').textContent,/2 scan.*awaiting/);w.document.getElementById('exit-keep').click();
 w.GateClient.local=async()=>({pending:0});w.NavrangDesk={hasDraft:()=>true};await w.onBackRequested();assert.match(w.document.getElementById('exit-message').textContent,/unsaved/);w.document.getElementById('exit-keep').click();
 w.NavrangDesk.hasDraft=()=>false;await w.onBackRequested();assert.match(w.document.getElementById('exit-message').textContent,/stored on the server/);
 }finally{await tick();dom.window.close()}});

test('session expiry clears hidden admin rows, codes and dialogs and ignores late scan results',async()=>{
 const {w,dom,event}=ui({role:'admin',name:'namdev',active:true});try{
  await tick();await tick();const $=id=>w.document.getElementById(id);
  for(const id of ['registration-rows','all-entry-rows','recent-entries','checker-list','dialog-details'])$(id).textContent='Private test contact';
  for(const id of ['edit-name','staff-name','real-name','new-checker-name','admin-password','new-admin-password'])$(id).value='Private test contact';
  $('new-checker-code').textContent='NG-PRIVATE';$('result-name').textContent='Private test contact';$('checker-name').textContent='Private test contact';
  for(const id of ['staff-dialog','code-dialog','student-dialog','edit-dialog','password-dialog','result-popup'])$(id).setAttribute('open','');
  let cleared=0;w.NavrangDesk={clear:()=>cleared++};w.GateClient.profile=()=>null;event({type:'auth',data:null});
  for(const id of ['registration-rows','all-entry-rows','recent-entries','checker-list','dialog-details','new-checker-code','result-name','checker-name'])assert.equal($(id).textContent,'',id);
  for(const id of ['edit-name','staff-name','real-name','new-checker-name','admin-password','new-admin-password'])assert.equal($(id).value,'',id);
  assert.equal(w.document.querySelector('dialog[open]'),null);assert.equal($('view-login').hidden,false);assert.equal(cleared,1);
  event({type:'result',data:{code:'blocked',id:'DEMO0001',record:{name:'Private test contact'},message:'Late response'}});
  assert.equal($('result-popup').open,false);assert.equal($('result-name').textContent,'');
 }finally{await tick();dom.window.close()}
});

test('a slow sign-out receipt cannot reset the station screen of a newer login',async()=>{
 const {w,dom,event}=ui({role:'admin',name:'namdev',active:true});let deliver;try{
  await tick();w.GateClient.signOut=()=>{w.GateClient.profile=()=>null;event({type:'auth',data:null});return new Promise(r=>deliver=r)};
  w.document.getElementById('sign-out').click();w.document.getElementById('confirm-signout').click();assert.equal(w.document.getElementById('view-login').hidden,false);
  w.GateClient.profile=()=>({role:'checker',checkerId:'new',name:'Raju',active:true,scanner:true});event({type:'auth'});
  deliver();await tick();assert.equal(w.document.getElementById('view-home').hidden,false);assert.equal(w.document.getElementById('view-login').hidden,true);
 }finally{await tick();dom.window.close()}
});

test('admin access removal immediately clears private views and returns to the assigned station',async()=>{
 const {w,dom,event}=ui({role:'admin',name:'namdev',active:true});try{
  await tick();await tick();const $=id=>w.document.getElementById(id);$('admin-nav').click();
  for(const id of ['registration-rows','all-entry-rows','checker-list','dialog-details'])$(id).textContent='Private contact';
  $('new-checker-code').textContent='NG-PRIVATE';$('edit-name').value='Private contact';$('staff-name').value='Private staff';$('new-admin-password').value='private-password';
  for(const id of ['student-dialog','edit-dialog','code-dialog','staff-dialog','password-dialog'])$(id).setAttribute('open','');
  w.GateClient.profile=()=>({role:'checker',checkerId:'staff',name:'Raju',active:true,station:'checker',scanner:true});event({type:'profile'});
  assert.equal($('view-admin').hidden,true);assert.equal($('view-home').hidden,false);assert.equal($('admin-account-tools').hidden,true);assert.equal($('account-tool-back').hidden,true);
  for(const id of ['registration-rows','all-entry-rows','checker-list','dialog-details','new-checker-code'])assert.equal($(id).textContent,'',id);
  for(const id of ['edit-name','staff-name','new-admin-password'])assert.equal($(id).value,'',id);
  for(const id of ['student-dialog','edit-dialog','code-dialog','staff-dialog','password-dialog'])assert.equal($(id).open,false,id);
 }finally{await tick();dom.window.close()}
});

test('Admin tools live under Account and each child returns to its parent',async()=>{
 const {w,dom,event}=ui({role:'admin',name:'Synthetic Admin',active:true});try{
  await tick();const $=id=>w.document.getElementById(id),route=()=>w.document.body.dataset.route;
  const account=$('main-nav').querySelector('[data-view=account]');
  assert.equal(route(),'account');assert.equal($('admin-account-tools').hidden,false);
  assert.equal($('admin-nav').closest('#main-nav'),null);assert.equal($('reports-nav').hidden,true);
  for(const [button,target] of [['admin-nav','admin'],['admin-account-reports','reports'],['account-settings','settings']]){
   $(button).click();assert.equal(route(),target);assert.equal(account.getAttribute('aria-current'),'page');assert.equal($('account-tool-back').hidden,false);
   await w.onBackRequested();assert.equal(route(),'account');assert.equal($('exit-dialog').open,false);assert.equal($('account-tool-back').hidden,true);
  }
  $('admin-nav').click();$('account-tool-back').click();assert.equal(route(),'account');
  let refreshed=0;w.NavrangReports={refresh:()=>refreshed++};$('admin-account-reports').click();
  w.GateClient.profile=()=>({role:'checker',checkerId:'synthetic-faculty',name:'Synthetic Faculty',active:true,reports:true,scanner:false});event({type:'profile'});
  assert.equal($('admin-account-tools').hidden,true);assert.equal($('reports-nav').hidden,false);
  assert.equal(route(),'reports');assert.equal($('reports-nav').getAttribute('aria-current'),'page');
  assert.equal($('account-tool-back').hidden,true);assert.equal(refreshed,2);
 }finally{await tick();dom.window.close()}
});

test('section information opens from its button and restores focus on dismissal',async()=>{
 const {w,dom}=ui({role:'admin',name:'Synthetic Admin',active:true});try{
  await tick();const $=id=>w.document.getElementById(id),trigger=w.document.querySelector('[data-section-info=account]');
  trigger.focus();trigger.click();
  assert.equal($('section-info').open,true);assert.equal($('section-info-title').textContent,'Account');
  assert.match($('section-info-text').textContent,/permissions are assigned by the server/);
  assert.equal(w.document.activeElement,$('close-section-info'));
  $('section-info').dispatchEvent(new w.Event('cancel',{cancelable:true}));
  assert.equal($('section-info').open,false);assert.equal(w.document.activeElement,trigger);
  trigger.click();await w.onBackRequested();assert.equal($('section-info').open,false);
  assert.equal(w.document.activeElement,trigger);assert.equal($('exit-dialog').open,false);
 }finally{await tick();dom.window.close()}
});

test('a staff code completed before a slow refresh never appears after sign-out',async()=>{
 const {w,dom,event}=ui({role:'admin',name:'namdev',active:true});let deliver;try{
  await tick();await tick();const $=id=>w.document.getElementById(id);
  w.GateClient.api=async action=>action==='staff-create'?{code:'NG-PRIVATE-LATE'}:{};
  w.GateClient.sync=()=>new Promise(r=>deliver=r);
  $('open-code').click();$('new-checker-name').value='Sample volunteer';$('create-checker-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(typeof deliver,'function');
  w.GateClient.profile=()=>null;event({type:'auth',data:null});deliver({dataRevision:7,cursor:0,records:[{id:'DEMO0001',name:'Private student',eligible:true}],entries:[],stats:{total:1},checkers:[]});await tick();await tick();
  assert.equal($('view-login').hidden,false);assert.equal($('new-checker-code').textContent,'');assert.equal($('new-code-panel').hidden,true);assert.equal($('registration-rows').textContent,'');assert.equal($('code-dialog').open,false);
 }finally{await tick();dom.window.close()}
});

test('admin tabs support arrow, home and end navigation and announce the active panel',async()=>{
 const {w,dom}=ui({role:'admin',name:'namdev',active:true});try{
  await tick();const $=id=>w.document.getElementById(id),tabs=[...w.document.querySelectorAll('[data-admin-tab]')];
  assert.equal(tabs[0].getAttribute('aria-selected'),'true');assert.equal(tabs[0].tabIndex,0);assert.equal(tabs[1].tabIndex,-1);
  tabs[0].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement,tabs[1]);assert.equal($('admin-admissions').hidden,false);assert.equal($('admin-registrations').hidden,true);assert.equal(tabs[1].getAttribute('aria-selected'),'true');
  tabs[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'End',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement,$('tab-updates'));assert.equal($('admin-updates').hidden,false);
  $('tab-updates').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}));assert.equal(w.document.activeElement,tabs[0]);assert.equal($('admin-registrations').hidden,false);
 }finally{await tick();dom.window.close()}
});

test('saved staff have no station-switch navigation and scan outcomes use distinct text and symbols',async()=>{
 const {w,dom,event}=ui({role:'checker',checkerId:'staff',name:'Raju',active:true,station:'checker',scanner:true});try{
  await tick();const $=id=>w.document.getElementById(id);assert.equal($('station-nav').hidden,true);assert.equal($('scan-nav').getAttribute('aria-current'),'page');
  event({type:'result',data:{code:'admitted',id:'DEMO0001',entry:{name:'Sample',ticketId:'DEMO0001',checker:'Raju',at:new Date().toISOString(),seq:1}}});
  assert.equal($('result-popup').dataset.state,'confirmed');assert.equal($('result-symbol').textContent,'✓');assert.equal($('result-popup').dataset.modal,'false');
  event({type:'result',data:{code:'duplicate',id:'DEMO0001',entry:{name:'Sample',ticketId:'DEMO0001',checker:'Raju',at:new Date().toISOString(),seq:1}}});
  assert.equal($('result-popup').dataset.state,'duplicate');assert.equal($('result-symbol').textContent,'↺');assert.equal($('result-popup').dataset.modal,'true');assert.equal($('help-desk').hidden,false);
  $('close-result').click();assert.equal($('result-popup').open,false);
 }finally{await tick();dom.window.close()}
});
