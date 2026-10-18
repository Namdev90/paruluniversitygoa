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
 assert.equal(w.document.querySelector('.intro-content .classic-event-logo').getAttribute('src'),'art/app-icon.png');
 assert.equal(w.document.querySelector('#skip-intro').parentElement.id,'intro');
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
