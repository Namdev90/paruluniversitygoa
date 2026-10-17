(function(root){
 'use strict';
 const native=!!(root.Native&&typeof root.Native.local==='function'),L=root.NavrangLive,config=root.NavrangConfig;
 const callbacks=new Map(),listeners=new Set();let initPromise,draining=false,automaticRegion=false,authGeneration=0;
 const emit=(type,data)=>{for(const f of listeners)f({type,data});};
 function fail(message,status){const e=Error(message);e.status=status||0;return e;}
 function profile(){if(native){const r=JSON.parse(Native.local('session','{}'));return r.data?.profile||null;}try{return JSON.parse(sessionStorage.getItem('navrang-session')||'null')?.profile||null}catch{return null}}
 function auth(){try{return JSON.parse(sessionStorage.getItem('navrang-session')||'null')}catch{return null}}
 function actor(p){return p?.role==='admin'?'admin':p?.checkerId||''}
 root.onApiResponse=raw=>{try{const r=JSON.parse(raw),cb=callbacks.get(r.id);if(cb){callbacks.delete(r.id);clearTimeout(cb.timer);r.body.ok?cb.resolve(r.body):cb.reject(fail(r.body.error||'Request failed.',r.status));}}catch{}};
 root.onGateEvent=raw=>{try{const e=JSON.parse(raw);emit(e.type,e.data)}catch{}};
 root.onNativeError=text=>emit('error',{message:text});
 root.onNativeSaved=name=>emit('notice',{message:'Saved '+name});
 async function api(action,payload={},sessionOverride){
  if(native)return new Promise((resolve,reject)=>{const id=L.uuid(),timer=setTimeout(()=>{callbacks.delete(id);reject(fail('Server response timed out. Unconfirmed scans stay only in memory while the app is open.'));},25000);callbacks.set(id,{resolve,reject,timer});Native.api(action,JSON.stringify(payload),id);});
  const a=sessionOverride||auth(),changesIdentity=['login','checker-login','google-login','logout'].includes(action),generation=changesIdentity?++authGeneration:authGeneration;
  if(action==='logout')sessionStorage.removeItem('navrang-session');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let r,b;
  try{r=await fetch(config.api+(automaticRegion?'':'?forceFunctionRegion=ap-south-1'),{method:'POST',headers:{'Content-Type':'application/json',...(a?.token?{Authorization:'Bearer '+a.token}:{})},body:JSON.stringify({action,payload}),signal:controller.signal,cache:'no-store'});b=await r.json();}
  catch{automaticRegion=!automaticRegion;throw fail('Connection interrupted. Unconfirmed scans stay only in memory while the app is open.');}finally{clearTimeout(timer)}
  if(r.status>=500)automaticRegion=!automaticRegion;
  if(!b.ok)throw fail(b.error||'Request failed.',r.status);
  if(b.token&&b.profile){if(generation!==authGeneration)throw fail('Sign-in changed while this request was running.',409);sessionStorage.setItem('navrang-session',JSON.stringify({token:b.token,profile:b.profile}));}
  if(action==='me'&&a){if(generation!==authGeneration||auth()?.token!==a.token)throw fail('Sign-in changed while this request was running.',409);sessionStorage.setItem('navrang-session',JSON.stringify({token:a.token,profile:b}));}
  return b;
 }
 let memory={dataRevision:-1,cursor:0,records:{},entries:{},stats:{},source:'',lastSync:''},jobs=new Map(),deviceId='browser-'+L.uuid();
 async function init(){
  if(native)return;
  if(!initPromise)initPromise=new Promise(resolve=>{
   // Retire historical persistent student caches. New data stays in RAM only.
   try{if(!root.indexedDB){resolve();return}indexedDB.deleteDatabase('navrang-offline-v1');const r=indexedDB.deleteDatabase('navrang-live-v2');r.onsuccess=()=>resolve();r.onerror=()=>resolve();r.onblocked=()=>{emit('notice',{message:'Close older Navrang tabs to remove their previous device cache.'});resolve()};}catch{resolve()}
  });
  return initPromise;
 }
 function resetMemory(){memory={dataRevision:-1,cursor:0,records:{},entries:{},stats:{},source:'',lastSync:''};jobs.clear();}
 async function local(action,p={}){
  if(native){const r=JSON.parse(Native.local(action,JSON.stringify(p)));if(!r.ok)throw fail(r.error||'Temporary memory is unavailable.');return r.data;}
  await init();
  if(action==='session')return{profile:profile()};
  if(action==='lookup')return{record:memory.records[p.id],entry:memory.entries[p.id]};
  if(action!=='snapshot')throw fail('Student data is server-only. Local import and backup are disabled.');
  return {deviceId,dataRevision:memory.dataRevision,cursor:memory.cursor,source:memory.source,lastSync:memory.lastSync,stats:memory.stats,localCount:Object.keys(memory.records).length,pending:jobs.size,legacyCount:0,entries:Object.values(memory.entries).sort((a,b)=>b.seq-a.seq).slice(0,15)};
 }
 async function applySync(p){
  if(native)return;await init();const old=memory,merged=L.merge(old,p);
  if(p.dataRevision<old.dataRevision||(p.cursor||0)<old.cursor)merged.stats=old.stats;
  memory={...merged,lastSync:new Date().toISOString()};
 }
 async function sync(cursors){
  const generation=authGeneration,s=await local('snapshot');const p=await api('sync',cursors||{dataRevision:s.dataRevision,afterSeq:s.cursor});if(generation!==authGeneration)throw fail('Sign-in changed.');await applySync(p);emit('sync',await local('snapshot'));if(!native)drain();return p;
 }
 async function queue(id){
  if(native){Native.submit(id);return}
  const p=profile();if(!p?.active)throw fail('Sign in with an approved checker account first.');
  if(!/^[A-Z0-9]{8}$/.test(id))throw fail('Enter the exact eight-character transaction ID.');
  const a=actor(p),key=a+':'+id;let job=jobs.get(key);
  if(!job){job={requestId:L.uuid(),ticketId:id,actor:a,deviceId,createdAt:new Date().toISOString()};jobs.set(key,job)}
  const lookup=await local('lookup',{id});emit('result',{code:'pending',id,record:lookup.record,message:'Awaiting server confirmation. Temporary request stays only while this app is open.'});drain();return job;
 }
 async function drain(){
  if(native||draining)return;draining=true;
  try{for(let i=0;i<20;i++){const a=auth(),who=actor(a?.profile),generation=authGeneration;if(!a)break;const pair=[...jobs].find(([,j])=>j.actor===who);if(!pair)break;const [key,job]=pair,r=await api('checkin',job,a);if(generation!==authGeneration)break;L.confirm(job,r);memory=L.merge(memory,{dataRevision:memory.dataRevision,entries:r.entry?[r.entry]:[]});jobs.delete(key);emit('result',r);emit('sync',await local('snapshot'));}}
  catch(e){emit('result',{code:'pending',message:e.message+' No universal entry is confirmed.'});}
  finally{draining=false}
 }
 async function signOut(){try{await api('logout')}finally{resetMemory();if(!native)sessionStorage.removeItem('navrang-session');emit('auth',profile())}}
 async function googleLogin(){
  if(native){Native.googleLogin();return}
  const cfg=await api('config');if(!cfg.googleEnabled)throw fail('Google sign-in awaits provider setup. Ask the admin for an assigned checker code.');
  if(location.protocol!=='https:')throw fail('Google sign-in needs the hosted HTTPS app or Android APK.');
  const verifier=L.uuid()+L.uuid(),bytes=new TextEncoder().encode(verifier),digest=await crypto.subtle.digest('SHA-256',bytes),challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  sessionStorage.setItem('navrang-pkce',verifier);const redirect=location.origin+location.pathname;
  location.assign(config.project+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect)+'&code_challenge='+challenge+'&code_challenge_method=s256');
 }
 async function finishGoogle(){
  if(native)return;const code=new URL(location.href).searchParams.get('code');if(!code)return;const verifier=sessionStorage.getItem('navrang-pkce');if(!verifier)throw fail('Google callback has no saved sign-in request.');
  const r=await fetch(config.project+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier})});const data=await r.json();if(!r.ok)throw fail('Google sign-in could not be exchanged. Try again.');await api('google-login',{accessToken:data.access_token});sessionStorage.removeItem('navrang-pkce');history.replaceState(null,'',location.pathname);emit('auth',profile());
 }
 function save(name,mime,content){
  if(native&&typeof Native.save==='function'){Native.save(name,mime,content);return}
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function destination(value){if(native&&typeof Native.destination==='function')return Native.destination(value||'');if(value)sessionStorage.setItem('navrang-destination',value);return sessionStorage.getItem('navrang-destination')||'home'}
 function readiness(action='status'){if(native&&typeof Native.readiness==='function')return JSON.parse(Native.readiness(action));return{native:false,message:'Use the Android app for camera, volume, vibration and brightness controls.'}}

 let audio;function feedback(kind,enabled=true){
  if(native&&typeof Native.feedback==='function'){Native.feedback(kind,enabled);return}
  if(kind==='stop-intro'||!enabled)return;try{audio=audio||new (root.AudioContext||root.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const t=audio.currentTime,notes=kind==='intro'?[392,523,659]:kind==='success'?[659,880]:kind==='issue'?[220,165]:[kind==='tap'?420:330];for(let i=0;i<notes.length;i++){const o=audio.createOscillator(),g=audio.createGain(),at=t+i*.1;o.frequency.value=notes[i];g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(kind==='tap'?.025:.09,at+.009);g.gain.exponentialRampToValueAtTime(.0001,at+(kind==='tap'?.035:.14));o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+.16)}}catch{}
 }
 function update(action='status',enabled=true){if(native&&typeof Native.update==='function')return JSON.parse(Native.update(action,enabled));return{currentVersion:'0.5.0',available:false,ready:false,automatic:false,notifications:true,message:'App updates are managed in the Android app.'}}
 root.GateClient={feedback,update,destination,readiness,native,api,local,sync,submit:queue,profile,signOut,googleLogin,finishGoogle,save,on:f=>{listeners.add(f);return()=>listeners.delete(f)},scan:()=>{if(native)Native.scan();else emit('notice',{message:'Camera scanning runs in the Android app. Use manual entry here.'})}};
})(globalThis);
