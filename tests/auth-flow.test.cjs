const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const asset=n=>fs.readFileSync(path.join(__dirname,'../app/assets',n),'utf8');
function setup({native=true,googleError,browserError}={}){
 const dom=new JSDOM(asset('index.html'),{url:'https://gate.test',runScripts:'outside-only'}),w=dom.window,calls=[],listeners=[];let profile=null;
 w.GateClient={native,profile:()=>profile,on:f=>{listeners.push(f);return()=>{}},googleLogin:op=>{calls.push(['google',op]);if(googleError)throw Error(googleError)},googleBrowserLogin:async op=>{calls.push(['browser',op]);if(browserError)throw Error(browserError);return true},api:async()=>{throw Error('Opening a sign-in panel must not call the server')}};
 try{w.eval(asset('auth-flow.js'))}catch(e){dom.window.close();throw e}
 return{w,dom,calls,$:id=>w.document.getElementById(id),emit:e=>listeners.forEach(f=>f(e)),profile:p=>profile=p};
}
test('Google and the staff code are available on the first screen',()=>{
 const t=setup();try{
  assert.equal(t.w.NavrangAuth.stage(),'signin');
  assert.equal(t.$('signin-panel').hidden,false);
  assert.equal(t.$('google-signin').disabled,false);
  assert.equal(t.$('code-login').hidden,false);
  assert.equal(t.$('google-browser-signin'),null);
  assert.equal(t.w.document.querySelector('[data-login-role]'),null);
  assert.equal(t.calls.length,0);
  t.$('google-signin').click();
  assert.equal(t.calls[0][0],'google');
  assert.equal(t.w.GateClient.profile(),null);
 }finally{t.dom.window.close()}
});
test('administrator form and native back return directly to the same sign-in screen',()=>{
 const t=setup();try{
  t.$('show-admin-login').click();
  assert.equal(t.$('admin-signin').hidden,false);
  assert.equal(t.$('signin-panel').hidden,true);
  assert.equal(t.w.document.activeElement,t.$('admin-signin-title'));
  t.$('show-checker-login').click();
  assert.equal(t.$('signin-panel').hidden,false);
  assert.equal(t.w.document.activeElement,t.$('signin-title'));
  t.$('code-login').open=true;
  assert.equal(t.w.NavrangAuth.back(),true);
  assert.equal(t.$('code-login').open,false);
  assert.equal(t.w.document.activeElement,t.$('code-login').querySelector('summary'));
  assert.equal(t.w.NavrangAuth.back(),false);
  assert.equal(t.calls.length,0);
 }finally{t.dom.window.close()}
});
test('native dismissal stays in the app until the user taps Google again',()=>{
 const t=setup();try{
  t.$('google-signin').click();const op=t.calls[0][1];
  assert.equal(t.$('google-signin').disabled,true);
  assert.equal(t.$('show-admin-login').disabled,true);
  assert.equal(t.$('code-login').inert,true);
  assert.equal(t.w.NavrangAuth.back(),true);
  t.emit({type:'credential',data:{operationId:'old-operation',phase:'cancelled'}});
  assert.equal(t.$('google-signin').disabled,true);
  t.emit({type:'credential',data:{operationId:op,phase:'cancelled'}});
  assert.equal(t.$('google-signin').disabled,false);
  assert.equal(t.$('show-admin-login').disabled,false);
  assert.equal(t.$('code-login').inert,false);
  t.emit({type:'credential',data:{operationId:op,phase:'failed'}});
  assert.equal(t.calls.length,1);
  t.$('google-signin').click();const retry=t.calls[1][1];
  assert.equal(t.calls[1][0],'browser');assert.notEqual(retry,op);
  t.emit({type:'credential',data:{operationId:retry,phase:'browser-opened'}});
  assert.equal(t.$('google-signin').disabled,false);
 }finally{t.dom.window.close()}
});
test('native failure opens one browser and ignores duplicate or stale events',()=>{
 const t=setup();try{
  t.$('google-signin').click();const op=t.calls[0][1];
  t.emit({type:'credential',data:{operationId:op,phase:'failed'}});
  assert.deepEqual(t.calls,[['google',op],['browser',op]]);
  t.emit({type:'credential',data:{operationId:op,phase:'failed'}});
  t.emit({type:'credential',data:{operationId:op,phase:'cancelled'}});
  t.$('google-signin').click();
  assert.equal(t.calls.length,2);
  assert.equal(t.$('google-signin').disabled,true);
  t.emit({type:'credential',data:{operationId:'stale',phase:'browser-opened'}});
  assert.equal(t.$('google-signin').disabled,true);
  t.emit({type:'credential',data:{operationId:op,phase:'browser-opened'}});
  assert.equal(t.$('google-signin').disabled,false);
  assert.equal(t.$('google-status').textContent,'Complete sign-in in your browser.');
  t.$('google-signin').click();const retry=t.calls[2][1];
  assert.equal(t.calls[2][0],'browser');
  t.emit({type:'credential',data:{operationId:op,phase:'browser-failed'}});
  assert.equal(t.$('google-signin').disabled,true);
  t.emit({type:'credential',data:{operationId:retry,phase:'browser-failed'}});
  assert.equal(t.$('google-signin').disabled,false);
  assert.match(t.$('google-status').textContent,/could not start/);
 }finally{t.dom.window.close()}
});
test('native and browser startup errors keep the same Google action retryable',async()=>{
 const t=setup({googleError:'Native provider unavailable.',browserError:'Install a browser.'});try{
  await t.$('google-signin').onclick();
  assert.deepEqual(t.calls.map(([method])=>method),['google','browser']);
  assert.equal(t.$('google-signin').disabled,false);
  assert.equal(t.$('google-status').textContent,'Install a browser.');
 }finally{t.dom.window.close()}
});
test('successful identity resets pending login and stale callbacks cannot restore it',()=>{
 const t=setup();try{t.$('google-signin').click();const op=t.calls[0][1];t.profile({role:'checker',active:true});t.emit({type:'auth'});t.emit({type:'credential',data:{operationId:op,phase:'failed',generation:1}});assert.equal(t.calls.length,1);assert.equal(t.$('google-signin').disabled,false)}finally{t.dom.window.close()}
});
test('native begin-login clearing the old session does not reset the active sign-in step',()=>{
 const t=setup();try{t.$('google-signin').click();t.w.NavrangAuth.reset({preservePending:true});assert.equal(t.w.NavrangAuth.stage(),'signin');assert.equal(t.$('google-signin').disabled,true)}finally{t.dom.window.close()}
});
test('unrelated native errors cannot unlock or replace an active credential operation',()=>{
 const t=setup();try{t.$('google-signin').click();const op=t.calls[0][1];t.emit({type:'error',data:{message:'Unrelated background error'}});assert.equal(t.$('google-signin').disabled,true);t.$('google-signin').click();assert.equal(t.calls.length,1);t.emit({type:'credential',data:{operationId:op,phase:'completed',generation:1}});assert.equal(t.$('google-signin').disabled,false)}finally{t.dom.window.close()}
});
test('browser sign-in errors are visible and leave the direct button retryable',()=>{
 const t=setup({native:false,googleError:'Google sign-in needs HTTPS.'});try{
  t.$('google-signin').click();
  assert.equal(t.$('google-status').textContent,'Google sign-in needs HTTPS.');
  assert.equal(t.$('google-signin').disabled,false);
  assert.equal(t.calls.length,1);
 }finally{t.dom.window.close()}
});
test('approved static combined artwork precedes the active sign-in panel',()=>{
 const t=setup();try{const card=t.w.document.querySelector('.login-card'),children=[...card.children];assert.ok(children.indexOf(card.querySelector('.combined-brand-login'))<children.indexOf(t.$('signin-panel')));assert.equal(card.querySelectorAll('.combined-brand-login').length,1)}finally{t.dom.window.close()}
});
test('shipped Android launcher reaches the classic login stylesheet',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
 assert.match(read('native-app/src/main/AndroidManifest.xml'),/android:name="\.MainActivity"/);
 assert.match(read('native-app/src/main/kotlin/in/navrang/gate/MainActivity.kt'),/class MainActivity : ClassicActivity\(\)/);
 assert.match(read('tools/prepare-classic-host.py'),/public class ClassicActivity extends androidx\.fragment\.app\.FragmentActivity/);
 assert.match(read('app/java/in/navrang/gate/MainActivity.java'),/web\.loadUrl\("file:\/\/\/android_asset\/index\.html"\)/);
 assert.ok(asset('index.html').includes('href="art/classic-restore.css"'));
});
test('quiet classic login styling remains scoped and preserves secret fields',()=>{
 const css=asset('art/classic-restore.css').split('/* Quiet sign-in forms only.')[1].split('@media(max-height:620px)')[0];
 assert.ok(css.includes('#view-login input{min-height:48px'));
 assert.ok(css.includes('#view-login :is(button,summary){min-height:48px}'));
 assert.ok(css.includes('#view-login .google-button{height:auto;min-height:48px;padding:12px;line-height:1.4}'));
 assert.ok(css.includes('#view-login h2{overflow-wrap:anywhere}'));
 assert.ok(css.includes('outline:2px solid #f6f2f5'));
 assert.ok(css.includes('#view-login .primary{background:#702449'));
 assert.ok(!css.includes('gradient('));
 for(const rule of css.split('}')){
  const selector=rule.slice(rule.lastIndexOf('*/')+2).split('{')[0].trim();
  if(selector&&!selector.startsWith('@media'))assert.ok(selector.startsWith('#view-login'),selector);
 }
 const t=setup();try{
  assert.equal(t.$('checker-code').type,'password');assert.equal(t.$('admin-password').type,'password');
  assert.equal(t.$('checker-code').maxLength,64);
 }finally{t.dom.window.close()}
});

test('browser and native auth use the same real public project configuration',()=>{
 const native=JSON.parse(asset('gate-config.json')),context={};
 require('node:vm').runInNewContext(asset('config.js'),context);
 const browser=context.NavrangConfig;
 for(const key of ['api','project','publishableKey','oauthRedirect','pollMs'])assert.equal(browser[key],native[key],key+' differs between hosts');
 assert.equal(native.project,'https://mzesveurjzxjybkejqmx.supabase.co');
 assert.equal(native.api,native.project+'/functions/v1/navrang-gate');
 assert.equal(native.oauthRedirect,'navranggate://auth-callback');
 assert.match(native.publishableKey,/^sb_publishable_[A-Za-z0-9_-]+$/);
 assert.doesNotMatch(native.publishableKey,/REQUIRED|PLACEHOLDER|sb_secret_|service_role/);
 assert.ok(native.publishableKey.length>30);
});
