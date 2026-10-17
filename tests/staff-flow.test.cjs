const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..'),asset=n=>fs.readFileSync(root+'/app/assets/'+n,'utf8'),tick=()=>new Promise(r=>setImmediate(r));
function setup(initial,{native=false,crew=[]}={}){
 let profile=initial,listener,destination='home';const calls=[],dom=new JSDOM(asset('index.html'),{url:'https://gate.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.matchMedia=()=>({matches:true});w.eval(asset('live-core.js'));w.NavrangDesk={refresh:()=>{},clear:()=>{},hasDraft:()=>false};
 w.GateClient={native,profile:()=>profile,on:f=>listener=f,finishGoogle:async()=>{},feedback:()=>{},destination:value=>value?(destination=value):destination,local:async()=>({entries:[],stats:{},pending:0,localCount:0}),update:()=>({}),scan:()=>calls.push({action:'camera'}),submit:()=>calls.push({action:'checkin'}),googleLogin:async()=>calls.push({action:'google-browser'}),signOut:async()=>{profile=null},copy:async text=>calls.push({action:'copy',text}),sync:async()=>{calls.push({action:'sync'});return{dataRevision:1,cursor:0,records:[],entries:[],stats:{},checkers:crew}},api:async(action,payload={})=>{calls.push({action,payload});if(action==='config')return{googleEnabled:true};if(action==='checker-profile'){profile={...profile,name:payload.name,nameConfirmed:true};return{saved:true}}if(action==='staff-request'){profile={...profile,requestedRole:payload.station};return{requested:payload.station}}if(action==='me')return profile;if(action==='staff-create')return{code:'NG-SYNTHETIC-CODE'};return{saved:true}}};
 w.eval(asset('gate.js'));return{w,dom,calls,setProfile:p=>profile=p,event:e=>listener(e),click:id=>w.document.getElementById(id).click(),$:(id)=>w.document.getElementById(id)};
}
test('Google stays available; saving a real name leads to station choice without launching the camera',async()=>{
 const t=setup(null,{native:true}),{w,dom,calls,$}=t;try{await tick();t.click('google-signin');await tick();assert.ok(calls.some(c=>c.action==='google-browser'));
 t.click('skip-intro');t.setProfile({role:'checker',checkerId:'test',name:'Google name',method:'google',nameConfirmed:false,active:true,scanner:true,helpdesk:true});t.event({type:'auth'});assert.equal($('name-dialog').open,true);
 $('real-name').value='Raju';$('name-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal($('view-station').hidden,false);assert.ok(!calls.some(c=>c.action==='camera'));
 t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);assert.ok(!calls.some(c=>c.action==='camera'));
 t.click('switch-station');t.click('station-checker');await tick();assert.equal($('view-home').hidden,false);assert.equal(calls.filter(c=>c.action==='camera').length,1);
 }finally{dom.window.close()}
});
test('Help Desk-only staff cannot open scanner, check in manually or fetch the checker roster',async()=>{
 const t=setup({role:'checker',checkerId:'desk',name:'Raju',method:'code',active:true,scanner:false,helpdesk:true}),{w,dom,calls,$}=t;try{await tick();assert.equal($('scan-nav').hidden,true);assert.equal($('entries-nav').hidden,true);
 t.click('scan');t.click('scan-nav');$('ticket-id').value='DEMO0001';$('manual-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal($('view-station').hidden,false);assert.ok(!calls.some(c=>['camera','checkin','sync'].includes(c.action)));
 t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);
 }finally{dom.window.close()}
});
test('a station request never self-authorizes; approved access appears on the existing session',async()=>{
 const pending={role:'checker',checkerId:'pending',name:'Raju',method:'google',nameConfirmed:true,active:false,scanner:false,helpdesk:false};const t=setup(pending),{dom,calls,$}=t;
 try{await tick();t.click('station-helpdesk');await tick();assert.equal(calls.find(c=>c.action==='staff-request').payload.station,'helpdesk');assert.equal($('station-helpdesk').disabled,true);assert.equal($('view-desk').hidden,true);assert.ok(!calls.some(c=>c.action==='sync'));
 t.setProfile({...pending,active:true,helpdesk:true,requestedRole:''});t.event({type:'profile'});assert.equal($('station-helpdesk').disabled,false);assert.match($('station-helpdesk-action').textContent,/Open Help Desk/);t.click('station-helpdesk');await tick();assert.equal($('view-desk').hidden,false);
 }finally{dom.window.close()}
});
test('admin assigns a requested station, saves the real name and creates a role-specific staff code',async()=>{
 const crew=[{id:'12345678-1234-4234-9234-123456789abc',name:'Raju',method:'google',active:false,scanner:false,helpdesk:false,requestedRole:'helpdesk',entries:0}];const t=setup({role:'admin',name:'namdev',active:true},{crew}),{w,dom,calls,$}=t;
 try{await tick();w.document.querySelector('#checker-list button').click();assert.equal($('staff-role').value,'helpdesk');$('staff-name').value='Raju Naik';$('staff-active').checked=true;$('staff-access-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 const saved=calls.find(c=>c.action==='staff-update');assert.equal(saved.payload.name,'Raju Naik');assert.equal(saved.payload.active,true);assert.equal(saved.payload.scanner,false);assert.equal(saved.payload.helpdesk,true);
 t.click('open-code');$('new-checker-name').value='Raju';$('new-checker-role').value='helpdesk';$('create-checker-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();const created=calls.find(c=>c.action==='staff-create');assert.equal(created.payload.scanner,false);assert.equal(created.payload.helpdesk,true);assert.equal($('new-checker-code').textContent,'NG-SYNTHETIC-CODE');t.click('copy-code');await tick();assert.ok(calls.some(c=>c.action==='copy'&&c.text==='NG-SYNTHETIC-CODE'));
 }finally{dom.window.close()}
});
