(function(root){
 'use strict';
 const native=!!(root.Native&&typeof root.Native.local==='function'),L=root.NavrangLive,config=root.NavrangConfig;
 const callbacks=new Map(),listeners=new Set();let initPromise,draining=false,automaticRegion=false,authGeneration=0,profileSequence=0,appliedProfile=0,syncSequence=0,appliedStaffSync=0;
 let nativeProfileLoaded=false,nativeProfile=null;
 const emit=(type,data)=>{for(const f of listeners)f({type,data});};
 function fail(message,status){const e=Error(message);e.status=status||0;return e;}
 function refreshNativeProfile(){
  nativeProfileLoaded=true;nativeProfile=null;
  try{const r=JSON.parse(Native.local('session','{}'));if(r.ok&&r.data?.profile)nativeProfile=JSON.stringify(r.data.profile);}catch{}
 }
 // Refresh at native state/response boundaries, not once per UI permission check.
 // Each caller receives a copy; queued event payloads never become authoritative.
 function profile(){if(native){if(!nativeProfileLoaded)refreshNativeProfile();return nativeProfile?JSON.parse(nativeProfile):null;}try{return JSON.parse(sessionStorage.getItem('navrang-session')||'null')?.profile||null}catch{return null}}
 function auth(){try{return JSON.parse(sessionStorage.getItem('navrang-session')||'null')}catch{return null}}
 function actor(p){return p?.role==='admin'?'admin':p?.checkerId||''}
 const accessScope=p=>JSON.stringify(p?.role==='admin'?['admin',!!p.active]:[p?.role,p?.checkerId,!!p?.active,p?.scanner!==false,!!p?.helpdesk,p?.station,p?.nameConfirmed!==false,p?.reports===true]);
 const canScan=p=>!!p?.active&&(p.role==='admin'||p.role==='checker'&&p.scanner!==false&&(p.station==null||p.station==='checker')&&(p.method!=='google'||p.nameConfirmed!==false));
 root.onApiResponse=raw=>{try{const r=JSON.parse(raw),cb=callbacks.get(r.id);if(cb){if(native)refreshNativeProfile();callbacks.delete(r.id);clearTimeout(cb.timer);r.body.ok?cb.resolve(r.body):cb.reject(fail(r.body.error||'Request failed.',r.status));}}catch{}};
 root.onGateEvent=raw=>{try{const e=JSON.parse(raw);if(e.type==='auth')authGeneration++;if(native&&(e.type==='auth'||e.type==='profile'))refreshNativeProfile();emit(e.type,e.data)}catch{}};
 root.onNativeError=text=>emit('error',{message:text});
 root.onNativeSaved=name=>emit('notice',{message:'Saved '+name});
 async function api(action,payload={},sessionOverride){
  const changesIdentity=['login','checker-login','google-login','logout'].includes(action),changesOwnProfile=['checker-profile','staff-request'].includes(action),generation=changesIdentity?++authGeneration:authGeneration,scope=accessScope(profile()),profileRequest=action==='me'?++profileSequence:0;
  // A name/station save can trigger the native profile refresh before its acknowledgement.
  // These acknowledgements contain no student data; identity guards still apply.
  if(native)return new Promise((resolve,reject)=>{const id=L.uuid(),timer=setTimeout(()=>{callbacks.delete(id);reject(fail('Server response timed out. Unconfirmed scans stay only in memory while the app is open.'));},25000);callbacks.set(id,{resolve:value=>generation!==authGeneration?reject(fail('Sign-in changed while this request was running.',409)):!changesIdentity&&!changesOwnProfile&&action!=='me'&&scope!==accessScope(profile())?reject(fail('Your station access changed while this request was running.',403)):resolve(value),reject,timer});Native.api(action,JSON.stringify(payload),id);});
  const a=sessionOverride||auth();
  if(action==='logout')sessionStorage.removeItem('navrang-session');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let r,b;
  try{r=await fetch(config.api+(automaticRegion?'':'?forceFunctionRegion=ap-south-1'),{method:'POST',headers:{'Content-Type':'application/json',...(a?.token?{Authorization:'Bearer '+a.token}:{})},body:JSON.stringify({action,payload}),signal:controller.signal,cache:'no-store'});b=await r.json();}
  catch{automaticRegion=!automaticRegion;throw fail('Connection interrupted. Unconfirmed scans stay only in memory while the app is open.');}finally{clearTimeout(timer)}
  if(r.status>=500)automaticRegion=!automaticRegion;
  if(!b.ok){
   if(r.status===401&&!changesIdentity&&a?.token&&generation===authGeneration&&auth()?.token===a.token){authGeneration++;resetMemory();sessionStorage.removeItem('navrang-session');emit('auth',null);}
   throw fail(b.error||'Request failed.',r.status);
  }
  if(!changesIdentity&&a?.token&&(generation!==authGeneration||auth()?.token!==a.token))throw fail('Sign-in changed while this request was running.',409);
  if(!changesIdentity&&!changesOwnProfile&&action!=='me'&&a?.token&&scope!==accessScope(profile()))throw fail('Your station access changed while this request was running.',403);
  if(b.token&&b.profile){if(generation!==authGeneration)throw fail('Sign-in changed while this request was running.',409);resetMemory();sessionStorage.setItem('navrang-session',JSON.stringify({token:b.token,profile:b.profile}));}
  if(action==='me'&&a){if(generation!==authGeneration||auth()?.token!==a.token)throw fail('Sign-in changed while this request was running.',409);if(profileRequest<appliedProfile)throw fail('A newer account refresh already arrived.',409);appliedProfile=profileRequest;if(b.role!=='admin'&&(!canScan(b)||a.profile?.role==='admin')){const old=memory;resetMemory();if(b.active){memory.stats={ownScans:old.stats.ownScans,totalEntries:old.stats.totalEntries};memory.lastSync=old.lastSync;}}sessionStorage.setItem('navrang-session',JSON.stringify({token:a.token,profile:b}));}
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
 async function applySync(p,generation,scope){
  if(native)return;await init();if(generation!==authGeneration)throw fail('Sign-in changed.',409);if(scope!==accessScope(profile()))throw fail('Your station access changed while this request was running.',403);
  if(p.staffSummary){memory={dataRevision:-1,cursor:0,records:{},entries:{},stats:{ownScans:p.stats.ownScans,totalEntries:p.stats.totalEntries},source:'',lastSync:new Date().toISOString()};if(!p.scanner)jobs.clear();return;}
  const old=memory,merged=L.merge(old,p);
  if(p.dataRevision<old.dataRevision||(p.cursor||0)<old.cursor)merged.stats=old.stats;
  memory={...merged,lastSync:new Date().toISOString()};
 }
 async function sync(cursors){
  const generation=authGeneration,scope=accessScope(profile()),sequence=++syncSequence,s=await local('snapshot');const p=await api('sync',cursors||{dataRevision:s.dataRevision,afterSeq:s.cursor});if(generation!==authGeneration)throw fail('Sign-in changed.');if(profile()?.role==='checker'&&(!profile().active||p.staffSummary!==true))throw fail('Staff access changed. Only your scan summary is available.',403);if(!native&&p.staffSummary){if(sequence<appliedStaffSync)return{...p,stats:{...memory.stats}};appliedStaffSync=sequence;}await applySync(p,generation,scope);const snapshot=await local('snapshot');if(generation!==authGeneration)throw fail('Sign-in changed.',409);emit('sync',snapshot);if(!native)drain();return p;
 }
 async function queue(id){
  if(native){Native.submit(id);return}
  const p=profile(),generation=authGeneration;if(!canScan(p))throw fail('Checker access is required. Choose your assigned station.');
  if(!/^[A-Z0-9]{8}$/.test(id))throw fail('Enter the exact eight-character transaction ID.');
  const a=actor(p),key=a+':'+id;let job=jobs.get(key);
  if(!job){job={requestId:L.uuid(),ticketId:id,actor:a,deviceId,createdAt:new Date().toISOString()};jobs.set(key,job)}
  const lookup=await local('lookup',{id});if(generation!==authGeneration||!canScan(profile())||actor(profile())!==a)throw fail('Your sign-in or station changed before this scan could be sent.',409);feedback('scan');emit('result',{code:'pending',id,record:lookup.record,message:'Awaiting server confirmation. Temporary request stays only while this app is open.'});drain();return job;
 }
 async function drain(){
  if(native||draining)return;draining=true;const drainGeneration=authGeneration;let currentJob;
  try{for(let i=0;i<20;i++){const a=auth(),who=actor(a?.profile),generation=authGeneration;if(!canScan(a?.profile))break;const pair=[...jobs].find(([,j])=>j.actor===who);if(!pair)break;const [key,job]=pair;currentJob=job;const r=await api('checkin',job,a);if(generation!==authGeneration||!canScan(profile()))break;L.confirm(job,r);if(profile()?.role==='admin')memory=L.merge(memory,{dataRevision:memory.dataRevision,entries:r.entry?[r.entry]:[]});jobs.delete(key);emit('result',r);emit('sync',await local('snapshot'));}}
  catch(e){if(drainGeneration===authGeneration&&canScan(profile()))emit('result',{code:'pending',id:currentJob?.ticketId,message:e.message+' No universal entry is confirmed.'});}
  finally{draining=false}
 }
 async function signOut(){const request=api('logout');resetMemory();if(native){nativeProfileLoaded=true;nativeProfile=null;}else sessionStorage.removeItem('navrang-session');emit('auth',profile());await request;}
 async function googleLogin(){
  if(native){Native.googleLogin();return}
  const cfg=await api('config');if(!cfg.googleEnabled)throw fail('Google sign-in awaits provider setup. Ask the admin for an assigned checker code.');
  if(location.protocol!=='https:')throw fail('Google sign-in needs the hosted HTTPS app or Android APK.');
  const verifier=L.uuid()+L.uuid(),bytes=new TextEncoder().encode(verifier),digest=await crypto.subtle.digest('SHA-256',bytes),challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  sessionStorage.setItem('navrang-pkce',verifier);const redirect=location.origin+location.pathname;
  location.assign(config.project+'/auth/v1/authorize?provider=google&redirect_to='+encodeURIComponent(redirect)+'&code_challenge='+challenge+'&code_challenge_method=s256');
 }
 async function googleBrowserLogin(){
  if(native){if(typeof Native.googleBrowserLogin!=='function')throw fail('Update the Android app to use browser sign-in.');Native.googleBrowserLogin();return}
  return googleLogin();
 }
 async function finishGoogle(){
  if(native)return;const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1)),error=url.searchParams.get('error')||fragment.get('error')||url.searchParams.get('error_code')||fragment.get('error_code');
  if(error){const description=url.searchParams.get('error_description')||fragment.get('error_description')||'',cancel=/access_denied|cancel/i.test(error+' '+description);sessionStorage.removeItem('navrang-pkce');history.replaceState(null,'',location.pathname);throw fail(cancel?'Google sign-in was cancelled. Tap Continue with Google to try again.':'Google sign-in setup needs the organizer’s attention. Namdev must check the Google client ID and client secret in Supabase. Use an assigned checker code meanwhile.')}
  const code=url.searchParams.get('code');if(!code)return;const generation=authGeneration,verifier=sessionStorage.getItem('navrang-pkce');sessionStorage.removeItem('navrang-pkce');history.replaceState(null,'',location.pathname);if(!verifier)throw fail('This Google sign-in request has expired. Tap Continue with Google to start again.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let r,data;
  try{r=await fetch(config.project+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({auth_code:code,code_verifier:verifier}),signal:controller.signal,cache:'no-store'});data=await r.json();}catch{throw fail('Google sign-in was interrupted. Tap Continue with Google to try again.');}finally{clearTimeout(timer)}
  if(generation!==authGeneration)throw fail('Sign-in changed while Google was connecting. Keep using your current account.',409);if(!r.ok||!data.access_token)throw fail('Google sign-in could not be exchanged. Tap Continue with Google to try again.');await api('google-login',{accessToken:data.access_token});emit('auth',profile());
 }
 function saveReport(name,mime,bytes){
  if(!(bytes instanceof Uint8Array))throw fail('Invalid report file.');
  if(bytes.length>12*1024*1024)throw fail('This report is too large to save from the app.');
  if(native){
   if(typeof Native.saveReport!=='function')throw fail('Please install Navrang Gate 0.7.7 to download reports.');
   let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
   Native.saveReport(name,mime,btoa(binary));return;
  }
  const blob=new Blob([bytes],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function save(name,mime,content){
  if(native&&typeof Native.save==='function'){Native.save(name,mime,content);return}
  const blob=new Blob([content],{type:mime}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 async function copy(text){if(native&&typeof Native.copy==='function'){Native.copy(text);return}if(navigator.clipboard){await navigator.clipboard.writeText(text);return}throw fail('Copy is unavailable in this browser. Use the Android app or HTTPS portal.')}
 function destination(value){if(native&&typeof Native.destination==='function')return Native.destination(value||'');if(value)sessionStorage.setItem('navrang-destination',value);return sessionStorage.getItem('navrang-destination')||'home'}
 function readiness(action='status'){if(native&&typeof Native.readiness==='function')return JSON.parse(Native.readiness(action));return{native:false,message:'Use the Android app for camera, volume, vibration and brightness controls.'}}

 let audio,lastScan=0,introGeneration=0;const sampleBuffers=new Map(),sampleLoads=new Map(),introSources=new Set();
 const sampleKinds=new Set(['intro','tap','scan','success','issue','duplicate','invalid','pending','transition','close']);
 function sample(kind){if(sampleBuffers.has(kind))return Promise.resolve(sampleBuffers.get(kind));if(!sampleLoads.has(kind))sampleLoads.set(kind,fetch('audio/'+kind+'.ogg').then(r=>{if(!r.ok)throw Error('Audio unavailable');return r.arrayBuffer()}).then(bytes=>audio.decodeAudioData(bytes)).then(buffer=>{sampleBuffers.set(kind,buffer);return buffer}).catch(e=>{sampleLoads.delete(kind);throw e}));return sampleLoads.get(kind)}
 function feedback(kind,ignoredEnabled=true){
  if(native&&typeof Native.feedback==='function'){Native.feedback(kind,true);return}
  if(kind==='stop-intro'){introGeneration++;for(const source of introSources)try{source.stop()}catch{}introSources.clear();return}if(!sampleKinds.has(kind))return;
  try{audio=audio||new (root.AudioContext||root.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});const generation=introGeneration,now=performance.now();if(kind==='scan')lastScan=now;const delay=['success','issue','duplicate','invalid'].includes(kind)?Math.max(0,330-(now-lastScan))/1000:0;
   sample(kind).then(buffer=>{if(kind==='intro'&&generation!==introGeneration)return;const source=audio.createBufferSource(),gain=audio.createGain();source.buffer=buffer;gain.gain.value=kind==='tap'?.7:1;source.connect(gain);gain.connect(audio.destination);if(kind==='intro'){introSources.add(source);source.onended=()=>introSources.delete(source)}source.start(audio.currentTime+delay)}).catch(()=>{});
  }catch{}
 }
 function update(action='status',enabled=true){if(native&&typeof Native.update==='function')return JSON.parse(Native.update(action,enabled));return{currentVersion:null,available:false,ready:false,automatic:false,notifications:true,message:'App updates are managed in the Android app.'}}
 root.GateClient={copy,feedback,update,destination,readiness,native,api,local,sync,submit:queue,profile,signOut,googleLogin,googleBrowserLogin,finishGoogle,save,saveReport,on:f=>{listeners.add(f);return()=>listeners.delete(f)},scan:()=>{if(native)Native.scan();else emit('notice',{message:'Camera scanning runs in the Android app. Use manual entry here.'})}};
})(globalThis);
