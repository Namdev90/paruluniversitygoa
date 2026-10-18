const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('restored shell uses the original logo without removing faculty routes or fixed-list controls',()=>{
 const dom=new JSDOM(read('app/assets/index.html'),{runScripts:'outside-only',url:'https://fixture.invalid/'});
 const w=dom.window;
 w.GateClient={profile:()=>({role:'admin',active:true,reports:true}),on(){},api:async()=>({ok:true})};
 w.eval(read('app/assets/art/brand-shell.js'));
 assert.equal(w.document.querySelector('.brand>.classic-header-logo').getAttribute('src'),'art/navrang-transparent.png');
 assert.equal(w.document.querySelector('.intro-content .combined-brand-mark img').getAttribute('src'),'art/navrang-parul-combined.png');
 assert.ok(w.document.getElementById('station-faculty'));
 assert.ok(w.document.getElementById('reports-nav'));
 assert.ok(w.document.querySelector('#admin-registrations .rows-scroll'));
 assert.ok(w.document.querySelector('#view-entries .rows-scroll'));
 const sheets=[...w.document.querySelectorAll('link[rel="stylesheet"]')].map(n=>n.getAttribute('href'));
 assert.equal(sheets.at(-1),'art/classic-restore.css');
 dom.window.close();
});

test('failed durable sign-out blocks new sign-in until retry succeeds in the restored interface',async()=>{
 const dom=new JSDOM(read('app/assets/index.html'),{runScripts:'outside-only',url:'https://fixture.invalid/'});
 const w=dom.window;
 let profile={role:'checker',checkerId:'synthetic',name:'Synthetic Checker',active:true,scanner:true,station:'checker',nameConfirmed:true};
 let listener,attempts=0;
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.GateClient={native:true,profile:()=>profile,on:f=>listener=f,finishGoogle:async()=>{},feedback(){},
  destination:()=> 'home',local:async()=>({entries:[],stats:{},pending:0,localCount:0}),
  update:()=>({}),readiness:()=>({native:true}),sync:async()=>({staffSummary:true,stats:{},entries:[],records:[]}),
  api:async action=>action==='config'?{googleEnabled:true}:profile,
  signOut:async()=>{profile=null;listener?.({type:'auth',data:null});if(++attempts===1)throw Error('Synthetic durable storage failure');},
 };
 for(const name of ['core.js','live-core.js','pagination.js','gate.js'])w.eval(read('app/assets/'+name));
 try{
 await new Promise(r=>setTimeout(r,10));
 w.document.getElementById('sign-out').click();
 assert.equal(w.document.getElementById('signout-confirm').open,true);
 assert.equal(attempts,0);
 w.document.getElementById('cancel-signout').click();
 assert.equal(attempts,0);
 assert.equal(w.GateClient.profile(),profile);
 w.document.getElementById('sign-out').click();
 w.document.getElementById('confirm-signout').click();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('classic-signout-pending').hidden,false);
 assert.equal(w.document.getElementById('classic-signout-retry').hidden,false);
 assert.match(w.document.getElementById('classic-signout-message').textContent,/Private access is blocked/);
 w.document.getElementById('classic-signout-retry').click();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('classic-signout-pending').hidden,true);
 assert.equal(attempts,2);
 }finally{dom.window.close();}
});

test('restored document saves refresh server authority before opening either destination',()=>{
 const java=read('app/java/in/navrang/gate/MainActivity.java');
 const write=java.slice(java.indexOf('private void writeDocument('),java.indexOf('private void beginScan('));
 assert.ok(write.includes('boolean adminOnly=request.kind==ReportSaveCoordinator.Kind.HELP_DESK'));
 assert.ok(write.indexOf('refreshExportAccess(request.generation,adminOnly)')<write.indexOf('AuthorizedDocumentWriter.write'));
 assert.match(write,/AuthorizedDocumentWriter\.write\(bytes,[\s\S]*openOutputStream[\s\S]*saveAllowed\(request\)/);
 assert.match(java,/documentSaves\.claimPicker\(request\)/);
 assert.match(java,/runtime\.api\.call\("me",new JSONObject\(\),token\)/);
});

test('restored build retains native Credential Manager and CameraX instead of the Material app shell',()=>{
 const main=read('native-app/src/main/kotlin/in/navrang/gate/MainActivity.kt');
 assert.match(main,/class MainActivity : ClassicActivity\(\)/);
 assert.match(main,/CredentialManager/);assert.match(main,/googleIdToken\(token, nonce, generation\)/);
 assert.doesNotMatch(main,/setContent\s*\{/);
 assert.match(read('native-app/src/main/kotlin/in/navrang/gate/ClassicScannerActivity.kt'),/ScannerScreen\(state, model, close\)/);
 const manifest=read('native-app/src/main/AndroidManifest.xml');
 assert.ok(manifest.includes('android:icon="@drawable/app_icon"'));
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
 assert.equal(hash('app/assets/art/app-icon.png'),'b3c9bec6b50d466c244e5b127b87cace038a16d3a236303f4b141e5ea285de9a');
});

test('restoration release cannot reuse another version approval or changed source/logo',()=>{
 require('node:child_process').execFileSync('python3',['tests/restoration-release-gate-check.py'],{cwd:root,stdio:'pipe',timeout:15000});
});

test('classic host generation rejects missing or ambiguous Android back-navigation hooks',()=>{
 require('node:child_process').execFileSync('python3',['tests/classic-host-generation-check.py'],{cwd:root,stdio:'pipe',timeout:15000});
});

test('packaged launcher verification rejects substituted artwork despite a correct web logo',()=>{
 require('node:child_process').execFileSync('python3',['tests/restoration-artwork-check.py'],{cwd:root,stdio:'pipe',timeout:15000});
});

test('browser fallback client invokes the native PKCE bridge without invoking Credential Manager',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://fixture.invalid/'});let browser=0;const w=dom.window;
 w.Native={local:()=>JSON.stringify({ok:true,data:{profile:null}}),googleBrowserLogin:()=>browser++,googleLogin:()=>{throw Error('Credential Manager must not run')}};
 try{for(const name of ['live-core.js','config.js','client.js'])w.eval(read('app/assets/'+name));await w.GateClient.googleBrowserLogin();assert.equal(browser,1)}finally{dom.window.close()}
});

test('approved combined branding is available before scripts without duplicate university marks',()=>{
 const dom=new JSDOM(read('app/assets/index.html'),{runScripts:'outside-only',url:'https://fixture.invalid/'});
 const w=dom.window,d=w.document;
 for(const region of ['.intro-content','.login-card']){
  const marks=d.querySelectorAll(region+' .combined-brand-mark');assert.equal(marks.length,1);
  assert.equal(marks[0].getAttribute('aria-label'),'Navrang · Parul University Goa');
  const image=marks[0].querySelector('img');
  assert.equal(image.getAttribute('src'),'art/navrang-parul-combined.png');
  assert.equal(image.getAttribute('width'),'2400');assert.equal(image.getAttribute('height'),'1280');
  assert.equal(image.alt,'');assert.equal(d.querySelector(region+' .official-logo'),null);
 }
 w.GateClient={profile:()=>null,on(){},api:async()=>({ok:true})};w.eval(read('app/assets/art/brand-shell.js'));
 assert.equal(d.querySelectorAll('.combined-brand-mark').length,2);
 assert.equal(d.querySelector('.brand .header-logo'),null);
 assert.equal(d.querySelector('.login-foot img'),null);
 assert.equal(d.querySelector('meta[name="theme-color"]').content,'#260919');
 dom.window.close();
});

test('combined mark keeps the exact owner-approved PNG and a contain-only aspect ratio',()=>{
 const bytes=fs.readFileSync(path.join(root,'app/assets/art/navrang-parul-combined.png'));
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'8744a792295a49aad9c6ff65fae4f3bf1f6fbb66c766c59acfa4616f179e3397');
 assert.equal(bytes.readUInt32BE(16),2400);assert.equal(bytes.readUInt32BE(20),1280);
 const css=read('app/assets/art/classic-restore.css');
 assert.match(css,/\.combined-brand-mark\{[^}]*aspect-ratio:15\/8/);
 assert.match(css,/\.combined-brand-mark>img\{[^}]*object-fit:contain/);
 assert.match(css,/radial-gradient\(ellipse at center,#680724 0%,#260919 100%\)/);
});
