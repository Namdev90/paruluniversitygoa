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
 assert.equal(w.document.querySelector('.brand>.classic-header-logo').getAttribute('src'),'art/app-icon.png');
 assert.equal(w.document.querySelector('.intro-content .classic-event-logo').getAttribute('src'),'art/app-icon.png');
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
 for(const name of ['core.js','live-core.js','gate.js'])w.eval(read('app/assets/'+name));
 await new Promise(r=>setTimeout(r,10));
 w.document.getElementById('sign-out').click();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('classic-signout-pending').hidden,false);
 assert.equal(w.document.getElementById('classic-signout-retry').hidden,false);
 assert.match(w.document.getElementById('classic-signout-message').textContent,/Private access is blocked/);
 w.document.getElementById('classic-signout-retry').click();
 await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('classic-signout-pending').hidden,true);
 assert.equal(attempts,2);
 dom.window.close();
});

test('restored document saves refresh server authority before opening either destination',()=>{
 const java=read('app/java/in/navrang/gate/MainActivity.java');
 for(const role of ['false','true'])assert.ok(java.includes('refreshExportAccess(generation,'+role+')'));
 const report=java.slice(java.indexOf('if(request==REPORT_DOCUMENT)'),java.indexOf('@Override protected void onNewIntent'));
 assert.ok(report.indexOf('refreshExportAccess(generation,false)')<report.indexOf('openOutputStream'));
 const csv=report.slice(report.indexOf('if(request!=EXPORT_DOCUMENT)'));
 assert.ok(csv.indexOf('refreshExportAccess(generation,true)')<csv.indexOf('openOutputStream'));
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
