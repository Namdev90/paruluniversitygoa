const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const asset=n=>fs.readFileSync(path.join(__dirname,'../app/assets',n),'utf8');
function setup(){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test',runScripts:'outside-only'}),w=dom.window,calls=[],listeners=[];let profile=null;
 w.GateClient={native:true,profile:()=>profile,on:f=>{listeners.push(f);return()=>{}},googleLogin:op=>{calls.push(['google',op])},googleBrowserLogin:async()=>calls.push(['browser']),api:async()=>{throw Error('Role choice must not call the server')}};
 try{w.eval(asset('auth-flow.js'))}catch(e){dom.window.close();throw e}
 return{w,dom,calls,$:id=>w.document.getElementById(id),emit:e=>listeners.forEach(f=>f(e)),profile:p=>profile=p};
}
test('administrator and staff stages precede role-specific sign-in',()=>{
 const t=setup();try{
  assert.equal(t.w.NavrangAuth.stage(),'welcome');assert.equal(t.$('signin-panel').hidden,true);
  t.$('auth-staff').click();assert.equal(t.w.NavrangAuth.stage(),'roles');
  t.w.document.querySelector('[data-login-role="faculty"]').click();assert.equal(t.w.NavrangAuth.stage(),'signin');assert.equal(t.$('code-login').hidden,true);assert.equal(t.calls.length,0);
  t.w.NavrangAuth.back();assert.equal(t.w.NavrangAuth.stage(),'roles');t.w.NavrangAuth.back();assert.equal(t.w.NavrangAuth.stage(),'welcome');t.$('show-admin-login').click();assert.equal(t.w.NavrangAuth.stage(),'admin');assert.equal(t.$('admin-signin').hidden,false);
 }finally{t.dom.window.close()}
});
test('role intent persists on back without granting permissions',()=>{
 const t=setup();try{t.$('auth-staff').click();t.w.document.querySelector('[data-login-role="helpdesk"]').click();assert.equal(t.w.sessionStorage.getItem('navrang-login-intent'),'helpdesk');assert.equal(t.w.GateClient.profile(),null);t.w.NavrangAuth.back();assert.equal(t.w.document.querySelector('[data-login-role="helpdesk"]').getAttribute('aria-pressed'),'true');assert.equal(t.calls.length,0)}finally{t.dom.window.close()}
});
test('native cancellation reveals fallback and ignores a stale operation',async()=>{
 const t=setup();try{t.$('auth-staff').click();t.w.document.querySelector('[data-login-role="checker"]').click();assert.equal(t.$('google-browser-signin').hidden,true);t.$('google-signin').click();await Promise.resolve();const op=t.calls[0][1];assert.equal(t.$('google-signin').disabled,true);
  t.emit({type:'credential',data:{operationId:'old-operation',phase:'cancelled',generation:1}});assert.equal(t.$('google-signin').disabled,true);assert.equal(t.$('google-browser-signin').hidden,true);
  t.emit({type:'credential',data:{operationId:op,phase:'cancelled',generation:1}});assert.equal(t.$('google-signin').disabled,false);assert.equal(t.$('google-browser-signin').hidden,false);assert.equal(t.calls.filter(c=>c[0]==='browser').length,0);
 }finally{t.dom.window.close()}
});
test('successful identity resets pending login and stale callbacks cannot restore it',()=>{
 const t=setup();try{t.$('auth-staff').click();t.w.document.querySelector('[data-login-role="checker"]').click();t.$('google-signin').click();const op=t.calls[0][1];t.profile({role:'checker',active:true});t.emit({type:'auth'});t.emit({type:'credential',data:{operationId:op,phase:'failed',generation:1}});assert.equal(t.$('google-browser-signin').hidden,true);assert.equal(t.$('google-signin').disabled,false)}finally{t.dom.window.close()}
});
test('native begin-login clearing the old session does not reset the active sign-in step',()=>{
 const t=setup();try{t.$('auth-staff').click();t.w.document.querySelector('[data-login-role="checker"]').click();t.$('google-signin').click();t.w.NavrangAuth.reset({preservePending:true});assert.equal(t.w.NavrangAuth.stage(),'signin');assert.equal(t.$('google-signin').disabled,true)}finally{t.dom.window.close()}
});
test('unrelated native errors cannot unlock or replace an active credential operation',()=>{
 const t=setup();try{t.$('auth-staff').click();t.w.document.querySelector('[data-login-role="checker"]').click();t.$('google-signin').click();const op=t.calls[0][1];t.emit({type:'error',data:{message:'Unrelated background error'}});assert.equal(t.$('google-signin').disabled,true);t.$('google-signin').click();assert.equal(t.calls.length,1);t.emit({type:'credential',data:{operationId:op,phase:'failed',generation:1}});assert.equal(t.$('google-signin').disabled,false)}finally{t.dom.window.close()}
});
test('approved static combined artwork precedes the active welcome stage',()=>{
 const t=setup();try{const card=t.w.document.querySelector('.login-card'),children=[...card.children];assert.ok(children.indexOf(card.querySelector('.combined-brand-login'))<children.indexOf(t.$('auth-welcome')));assert.equal(card.querySelectorAll('.combined-brand-login').length,1)}finally{t.dom.window.close()}
});
