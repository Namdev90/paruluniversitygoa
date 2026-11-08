const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const asset=n=>fs.readFileSync(path.join(__dirname,'../app/assets',n),'utf8');
function layout(admin=true){const dom=new JSDOM(asset('index.html'),{url:'https://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;let profile={role:admin?'admin':'checker',active:true,reports:true};const listeners=[];w.GateClient={profile:()=>profile,on:f=>listeners.push(f)};w.eval(asset('pagination.js'));w.eval(asset('report-layout.js'));return{dom,w,$:id=>w.document.getElementById(id),set:p=>{profile=p;listeners.forEach(f=>f({type:'profile'}))}}}
test('pagination clamps after filtering and exposes all items exactly once',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;try{w.eval(asset('pagination.js'));const items=Array.from({length:11},(_,i)=>i),all=[];for(let page=0;page<3;page++)all.push(...w.NavrangPages.pageItems(items,{page,size:4}).items);assert.deepEqual(all,items);const p=w.NavrangPages.pageItems(items.slice(0,2),{page:8,size:4});assert.equal(p.page,0);assert.equal(p.pages,1);assert.equal(p.total,2)}finally{w.close()}
});
test('report tabs expose one panel and faculty cannot select teacher access',()=>{
 const t=layout(false);try{assert.equal(t.$('report-downloads').hidden,false);assert.equal(t.$('report-overview').hidden,true);assert.equal(t.$('report-tab-teachers').hidden,true);t.$('report-tab-overview').click();assert.equal(t.$('report-overview').hidden,false);assert.equal(t.$('report-downloads').hidden,true);t.$('report-tab-teachers').click();assert.equal(t.$('report-manage').hidden,true)}finally{t.dom.window.close()}
});
test('all eleven metrics remain visible without paging controls',()=>{const t=layout();try{t.w.NavrangReportLayout.setMetrics(Array.from({length:11},(_,i)=>['Metric '+i,i]));t.$('report-tab-overview').click();assert.equal(t.w.document.querySelectorAll('#report-stats article:not([hidden])').length,11);assert.equal(t.w.document.querySelector('.compact-pager'),null)}finally{t.dom.window.close()}});

test('role loss immediately removes teacher access and restores a permitted tab',()=>{
 const t=layout();try{t.$('report-tab-teachers').click();assert.equal(t.$('report-manage').hidden,false);t.set({role:'checker',active:true,reports:true});assert.equal(t.$('report-manage').hidden,true);assert.equal(t.$('report-tab-teachers').hidden,true);assert.equal(t.$('report-downloads').hidden,false)}finally{t.dom.window.close()}
});
test('inactive administrators lose private report state and teacher access',()=>{
 const t=layout();try{
  t.w.NavrangReportLayout.setMetrics([['Private attendance total',42]]);
  t.$('report-tab-teachers').click();t.$('report-notes-dialog').setAttribute('open','');
  t.set({role:'admin',active:false,reports:true});
  assert.equal(t.$('report-tab-teachers').hidden,true);assert.equal(t.$('report-manage').hidden,true);
  assert.equal(t.$('report-stats').childElementCount,0);assert.equal(t.$('report-notes-dialog').open,false);
 }finally{t.dom.window.close()}
});
test('report tab keyboard navigation skips forbidden tabs',()=>{
 const t=layout(false);try{t.$('report-tab-downloads').dispatchEvent(new t.w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));assert.equal(t.$('report-tab-overview').getAttribute('aria-selected'),'true');assert.equal(t.w.document.activeElement.id,'report-tab-overview')}finally{t.dom.window.close()}
});
test('rapid navigation commits synchronously and sensitive navigation cancels motion',()=>{
 const dom=new JSDOM('<main><section class="view"><article class="panel">Private</article></section></main>',{runScripts:'outside-only'}),w=dom.window;try{w.matchMedia=()=>({matches:false});w.eval(asset('presentation-motion.js'));let state='';w.NavrangMotion.navigate(()=>{state='first'},{sensitive:false});w.NavrangMotion.navigate(()=>{state='latest'},{sensitive:true});assert.equal(state,'latest');assert.equal(w.document.querySelectorAll('[data-motion-snapshot]').length,0)}finally{w.close()}
});
test('downloads expose each canonical format without intermediate steps',()=>{const t=layout();try{for(const kind of ['csv','xlsx','pdf']){const button=t.$('report-'+kind);t.$('view-reports').hidden=false;assert.ok(button);assert.equal(button.closest('[hidden]'),null)}assert.equal(t.$('report-download-next'),null)}finally{t.dom.window.close()}});

test('native reduced motion immediately cancels running navigation and marks CSS policy',()=>{
 const dom=new JSDOM('<main><section class="view"><article class="panel">Private</article></section></main>',{runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;try{w.matchMedia=()=>({matches:false});const panel=w.document.querySelector('.panel');panel.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});let cancelled=0;panel.animate=()=>({cancel:()=>cancelled++});w.eval(asset('presentation-motion.js'));w.NavrangMotion.navigate(()=>{});w.NavrangMotion.setReducedMotion(true);assert.equal(cancelled,1);assert.equal(w.document.body.dataset.reducedMotion,'true');w.NavrangMotion.navigate(()=>{});assert.equal(cancelled,1)}finally{w.close()}
});
test('teacher search filters all members and report dialogs close on access loss',()=>{
 const t=layout();try{const members=t.$('report-teachers');for(const name of ['Aarya Faculty','Namdev Organizer']){const n=t.w.document.createElement('div');n.className='report-member';n.textContent=name;members.append(n)}t.$('report-tab-teachers').click();const search=t.$('report-teacher-search');assert.ok(search,'teacher search is available');search.value='aarya';search.dispatchEvent(new t.w.Event('input'));assert.equal([...members.children].filter(n=>!n.hidden).length,1);assert.match([...members.children].find(n=>!n.hidden).textContent,/Aarya/);t.$('report-notes-dialog').setAttribute('open','');t.set({role:'checker',active:true,reports:false});assert.equal(t.w.document.querySelector('dialog[open]'),null)}finally{t.dom.window.close()}
});
test('overview errors are visible without switching to Downloads',()=>{
 const t=layout();try{t.$('view-reports').hidden=false;t.$('report-tab-overview').click();t.w.NavrangReportLayout.setStatus('Could not refresh server totals.',{error:true});assert.equal(t.$('report-message-dialog').open,true);assert.match(t.$('report-message-dialog').textContent,/Could not refresh/)}finally{t.dom.window.close()}
});
