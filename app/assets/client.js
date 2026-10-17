(function(root){
 'use strict';
 const native=!!(root.Native&&typeof root.Native.local==='function'),L=root.NavrangLive,config=root.NavrangConfig;
 const callbacks=new Map(),listeners=new Set();let dbPromise,initPromise,draining=false,automaticRegion=false,authGeneration=0;
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
  if(native)return new Promise((resolve,reject)=>{const id=L.uuid(),timer=setTimeout(()=>{callbacks.delete(id);reject(fail('Server response timed out. Pending scans stay saved.'));},25000);callbacks.set(id,{resolve,reject,timer});Native.api(action,JSON.stringify(payload),id);});
  const a=sessionOverride||auth(),changesIdentity=['login','checker-login','google-login','logout'].includes(action),generation=changesIdentity?++authGeneration:authGeneration;
  if(action==='logout')sessionStorage.removeItem('navrang-session');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let r,b;
  try{r=await fetch(config.api+(automaticRegion?'':'?forceFunctionRegion=ap-south-1'),{method:'POST',headers:{'Content-Type':'application/json',...(a?.token?{Authorization:'Bearer '+a.token}:{})},body:JSON.stringify({action,payload}),signal:controller.signal});b=await r.json();}
  catch{automaticRegion=!automaticRegion;throw fail('Connection interrupted. Pending scans stay saved.');}finally{clearTimeout(timer)}
  if(r.status>=500)automaticRegion=!automaticRegion;
  if(!b.ok)throw fail(b.error||'Request failed.',r.status);
  if(b.token&&b.profile){if(generation!==authGeneration)throw fail('Sign-in changed while this request was running.',409);sessionStorage.setItem('navrang-session',JSON.stringify({token:b.token,profile:b.profile}));}
  if(action==='me'&&a){if(generation!==authGeneration||auth()?.token!==a.token)throw fail('Sign-in changed while this request was running.',409);sessionStorage.setItem('navrang-session',JSON.stringify({token:a.token,profile:b}));}
  return b;
 }
 function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('navrang-live-v2',1);r.onupgradeneeded=()=>{const d=r.result;for(const name of ['meta','tickets','entries','legacy'])d.createObjectStore(name);const o=d.createObjectStore('outbox');o.createIndex('actor_ticket',['actor','ticketId'],{unique:true});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(fail('Device storage could not open. Keep app data.'));r.onblocked=()=>reject(fail('Close other copies of this app and retry.'));});return dbPromise}
 async function read(store,key){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(store,'readonly'),r=key===undefined?t.objectStore(store).getAll():t.objectStore(store).get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function write(stores,work){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction(stores,'readwrite');let result;try{result=work(t)}catch(e){t.abort();reject(e);return}t.oncomplete=()=>resolve(result);t.onabort=()=>reject(fail('Could not save on this device. Entry is NOT confirmed.'));t.onerror=()=>{};});}
 async function init(){
  if(native)return;
  if(!initPromise)initPromise=(async()=>{let device=await read('meta','deviceId');if(!device)await write(['meta'],t=>{t.objectStore('meta').put('browser-'+L.uuid(),'deviceId');t.objectStore('meta').put(-1,'dataRevision');t.objectStore('meta').put(0,'cursor');});
   if(!await read('meta','legacyMigrated')){let old=null;try{if(root.NavrangStore)old=await root.NavrangStore.read()}catch{}await write(['meta','tickets','legacy'],t=>{if(old){for(const r of Object.values(old.records||{}))t.objectStore('tickets').put(r,r.id);for(const e of Object.values(old.admissions||{}))t.objectStore('legacy').put(e,e.ticketId);}t.objectStore('meta').put(true,'legacyMigrated');});}
  })();
  return initPromise;
 }
 async function local(action,p={}){
  if(native){const r=JSON.parse(Native.local(action,JSON.stringify(p)));if(!r.ok)throw fail(r.error||'Device storage failed.');return r.data;}
  await init();
  if(action==='session')return{profile:profile()};
  if(action==='lookup'){const [record,entry,legacyEntry]=await Promise.all([read('tickets',p.id),read('entries',p.id),read('legacy',p.id)]);return{record,entry,legacyEntry}}
  if(action==='import'){await write(['tickets','meta'],t=>{const s=t.objectStore('tickets');s.clear();for(const r of p.records)s.put(r,r.id);t.objectStore('meta').put(-1,'dataRevision');t.objectStore('meta').put('Local file: '+p.source,'source');});return local('snapshot')}
  const [deviceId,dataRevision,cursor,source,lastSync,stats,records,entries,outbox,legacy]=await Promise.all([read('meta','deviceId'),read('meta','dataRevision'),read('meta','cursor'),read('meta','source'),read('meta','lastSync'),read('meta','stats'),read('tickets'),read('entries'),read('outbox'),read('legacy')]);
  const snapshot={deviceId,dataRevision:dataRevision??-1,cursor:cursor||0,source:source||'',lastSync:lastSync||'',stats:stats||{},localCount:records.length,pending:outbox.length,legacyCount:legacy.length,entries:entries.sort((a,b)=>b.seq-a.seq).slice(0,15)};
  if(action==='backup')return{...snapshot,format:'navrang.device-backup',version:2,records,allEntries:entries,legacyEntries:legacy,outbox};
  return snapshot;
 }
 async function applySync(p){
  if(native)return;
  await init();const d=await db();
  await new Promise((resolve,reject)=>{
   const t=d.transaction(['meta','tickets','entries'],'readwrite'),meta=t.objectStore('meta'),values={},keys=['dataRevision','cursor','source','stats'];let remaining=keys.length+1,problem;
   const abort=e=>{problem=e;try{t.abort()}catch{}};
   const ready=()=>{if(--remaining)return;try{
    const old={dataRevision:values.dataRevision??-1,cursor:values.cursor||0,source:values.source||'',stats:values.stats||{},entries:Object.fromEntries(values.entries.map(e=>[e.ticketId,e]))},merged=L.merge(old,p);
    if(Array.isArray(p.records)&&p.dataRevision>=old.dataRevision){const tickets=t.objectStore('tickets');tickets.clear();for(const r of p.records)tickets.put(r,r.id);meta.put(p.dataRevision,'dataRevision');}
    for(const e of p.entries||[])t.objectStore('entries').put(e,e.ticketId);
    const fresh=p.dataRevision>=old.dataRevision&&(p.cursor||0)>=old.cursor;
    for(const [k,v]of Object.entries({cursor:merged.cursor,stats:fresh?merged.stats:old.stats,source:p.dataRevision>=old.dataRevision?(p.source||old.source):old.source,lastSync:new Date().toISOString()}))meta.put(v,k);
   }catch(e){abort(e)}};
   for(const key of keys){const r=meta.get(key);r.onsuccess=()=>{values[key]=r.result;ready()};}
   const entries=t.objectStore('entries').getAll();entries.onsuccess=()=>{values.entries=entries.result;ready()};
   t.oncomplete=resolve;t.onabort=()=>reject(problem||fail('Could not save the shared update on this device.'));t.onerror=()=>{};
  });
 }
 async function sync(cursors){
  const s=await local('snapshot');const p=await api('sync',cursors||{dataRevision:s.dataRevision,afterSeq:s.cursor});await applySync(p);emit('sync',await local('snapshot'));if(!native)drain();return p;
 }
 async function queue(id){
  if(native){Native.submit(id);return}
  const p=profile();if(!p?.active)throw fail('Sign in with an approved checker account first.');
  if(!/^[A-Z0-9]{8}$/.test(id))throw fail('Enter the exact eight-character transaction ID.');
  const a=actor(p),s=await local('snapshot'),d=await db();
  const job=await new Promise((resolve,reject)=>{const t=d.transaction('outbox','readwrite'),store=t.objectStore('outbox'),r=store.index('actor_ticket').get([a,id]);let value;r.onsuccess=()=>{value=r.result||{requestId:L.uuid(),ticketId:id,actor:a,deviceId:s.deviceId,createdAt:new Date().toISOString()};if(!r.result)store.put(value,value.requestId)};t.oncomplete=()=>resolve(value);t.onabort=()=>reject(fail('Could not save the scan. Entry is NOT confirmed.'));t.onerror=()=>{};});
  const lookup=await local('lookup',{id});emit('result',{code:'pending',id,record:lookup.record,message:'Awaiting server confirmation. Request saved on this device.'});drain();return job;
 }
 async function drain(){
  if(native||draining)return;draining=true;
  try{for(let i=0;i<20;i++){const a=auth(),who=actor(a?.profile);if(!a)break;const jobs=(await read('outbox')).filter(j=>j.actor===who).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));if(!jobs.length)break;const job=jobs[0];const r=await api('checkin',job,a);L.confirm(job,r);await write(['entries','outbox'],t=>{if(r.entry)t.objectStore('entries').put(r.entry,r.entry.ticketId);t.objectStore('outbox').delete(job.requestId);});emit('result',r);emit('sync',await local('snapshot'));}}
  catch(e){emit('result',{code:'pending',message:e.message+' No universal entry is confirmed.'});}
  finally{draining=false}
 }
 async function signOut(){try{await api('logout')}finally{emit('auth',profile())}}
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
 function save(){throw fail('File export is not available in this prototype.')}
 let audio;function feedback(kind,enabled=true){
  if(native&&typeof Native.feedback==='function'){Native.feedback(kind,enabled);return}
  if(!enabled)return;try{audio=audio||new (root.AudioContext||root.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const t=audio.currentTime,notes=kind==='intro'?[392,523,659]:kind==='success'?[659,880]:kind==='issue'?[220,165]:[kind==='tap'?420:330];for(let i=0;i<notes.length;i++){const o=audio.createOscillator(),g=audio.createGain(),at=t+i*.1;o.frequency.value=notes[i];g.gain.setValueAtTime(.0001,at);g.gain.exponentialRampToValueAtTime(kind==='tap'?.025:.09,at+.009);g.gain.exponentialRampToValueAtTime(.0001,at+(kind==='tap'?.035:.14));o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+.16)}}catch{}
 }
 root.GateClient={feedback,native,api,local,sync,submit:queue,profile,signOut,googleLogin,finishGoogle,save,on:f=>{listeners.add(f);return()=>listeners.delete(f)},scan:()=>{if(native)Native.scan();else emit('notice',{message:'Camera scanning runs in the Android app. Use manual entry here.'})}};
})(globalThis);
