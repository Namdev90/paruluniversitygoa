const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('launch uses separate content, dancer and action regions without replacing original artwork',()=>{
 const dom=new JSDOM(read('app/assets/index.html'),{runScripts:'outside-only',url:'https://fixture.invalid/'});
 const w=dom.window;w.GateClient={profile:()=>null,on(){},api:async()=>({ok:true})};
 w.eval(read('app/assets/art/brand-shell.js'));
 const stage=w.document.querySelector('.intro-dancers');
 assert.equal(stage.children.length,2);
 assert.equal(stage.querySelectorAll('.dancer').length,2);
 assert.equal(w.document.querySelector('.intro-content .classic-event-logo').getAttribute('src'),'art/navrang-transparent.png');
 assert.equal(w.document.querySelector('#skip-intro').parentElement.id,'intro');
 assert.equal(w.document.querySelector('.intro-content h1').hidden,true);
 assert.equal(w.document.querySelector('.intro-content>.official-logo').hidden,false);
 assert.match(read('app/assets/art/classic-restore.css'),/intro-content>\.intro-tagline,\.intro-content>\.pill\{position:static/);
 assert.match(read('app/assets/art/classic-restore.css'),/grid-template-rows:auto minmax\(0,1fr\) auto/);
 assert.match(read('app/assets/art/classic-restore.css'),/prefers-reduced-motion:reduce/);
 dom.window.close();
});
test('requested screenshots are enabled without changing session or permission contracts',()=>{
 const host=read('app/java/in/navrang/gate/MainActivity.java');
 assert.match(host,/clearFlags\(android\.view\.WindowManager\.LayoutParams\.FLAG_SECURE\)/);
 assert.doesNotMatch(host,/addFlags\(android\.view\.WindowManager\.LayoutParams\.FLAG_SECURE\)/);
 assert.match(read('native-app/src/main/kotlin/in/navrang/gate/MainActivity.kt'),/RegistrationImport\.payload\(rows\)/);
});
test('admin tabs retain accessible semantics and matching raised touch targets',()=>{
 const dom=new JSDOM(read('app/assets/index.html'));
 const tabs=[...dom.window.document.querySelectorAll('.admin-tabs button')];
 assert.equal(tabs.length,4);
 for(const tab of tabs){assert.equal(tab.getAttribute('role'),'tab');assert.ok(tab.getAttribute('aria-controls'));}
 const css=read('app/assets/art/classic-restore.css');
 assert.match(css,/\.admin-tabs button\{min-height:44px;height:44px;padding:6px 4px;border:1px/);
 assert.match(css,/\.admin-tabs button:focus-visible\{outline:2px solid #f4cf91/);
 dom.window.close();
});
