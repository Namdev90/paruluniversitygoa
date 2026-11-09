(function(root){
 'use strict';
 const AUTH='navrang-browser-auth-v1',LOGOUT='navrang-browser-logout-v1',LOCK='navrang-browser-session-v1';
 const failure=(message,status=503)=>Object.assign(Error(message),{status});
 const scope=p=>JSON.stringify([p?.role,p?.checkerId,p?.active,p?.scanner,p?.helpdesk,p?.reports,p?.station,p?.nameConfirmed,p?.accessExpiresAt]);
 function create({base,onProfile=()=>{},onClear=()=>{}}){
  if(base!=='/navrang'||root.location.protocol!=='https:'||typeof root.navigator?.locks?.request!=='function')throw failure('This browser needs secure coordinated sign-in. Use a supported HTTPS browser or the Android app.');
  try{const probe='navrang-browser-storage-check';root.localStorage.setItem(probe,'1');root.localStorage.removeItem(probe);root.sessionStorage.removeItem('navrang-session');}
  catch{throw failure('Browser sign-in storage is unavailable. Enable site storage or use the Android app.');}
  let profileText=null,epoch=0,closed=false,logoutTask,profileSequence=0,appliedProfile=0;
  const controllers=new Set(),now=()=>root.performance.now(),profile=()=>profileText?JSON.parse(profileText):null;
  const pending=()=>root.localStorage.getItem(LOGOUT)==='1';
  const marker=kind=>{const bytes=root.crypto.getRandomValues(new Uint8Array(16));root.localStorage.setItem(AUTH,kind+':'+Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join(''));};
  const current=captured=>{if(closed||captured!==epoch)throw failure('Sign-in changed while the request was running.',409);};
  function clear(reason,external=false){profileText=null;onClear({reason,external});}
  function adopt(value,sequence,announce=false){
   if(sequence<appliedProfile)throw failure('A newer account verification already arrived.',409);
   if(!value||!['admin','checker'].includes(value.role)||typeof value.active!=='boolean')throw failure('The browser account response could not be verified.');
   const previous=profile(),copy=JSON.parse(JSON.stringify(value));appliedProfile=sequence;profileText=JSON.stringify(copy);onProfile(JSON.parse(profileText),{changed:!!previous&&scope(previous)!==scope(copy)});
   if(announce)marker('login');else if(previous&&scope(previous)!==scope(copy))marker('grants');
  }
  async function post(path,body,deadline){
   const remaining=deadline-now();if(remaining<=0)throw failure('Sign-in verification timed out. Your saved session is retained.');
   const controller=new root.AbortController();controllers.add(controller);const timer=root.setTimeout(()=>controller.abort(),remaining);
   try{
    const response=await root.fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Navrang-Request':'1'},
     credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,body:JSON.stringify(body)});
    const value=await response.json();
    if(!value||typeof value.ok!=='boolean'||['token','accessToken','refreshToken','nextRefreshToken'].some(key=>Object.prototype.hasOwnProperty.call(value,key)))throw Error('Invalid gateway response');
    return {status:response.status,body:value};
   }catch{throw failure('Connection interrupted. Your saved sign-in is retained; reconnect and retry.');}
   finally{root.clearTimeout(timer);controllers.delete(controller);}
  }
  async function locked(deadline,work){
   const controller=new root.AbortController(),remaining=deadline-now();if(remaining<=0)throw failure('Sign-in verification timed out.');
   const timer=root.setTimeout(()=>controller.abort(),remaining);
   try{return await root.navigator.locks.request(LOCK,{mode:'exclusive',signal:controller.signal},work);}
   catch(error){if(error?.status)throw error;throw failure('Browser sign-in is busy. Retry when connected.');}
   finally{root.clearTimeout(timer);}
  }
  function checked(reply){
   const value=reply.body;
   if(value.code==='AUTH_REVOKED'){
    epoch++;clear('revoked');root.localStorage.removeItem(LOGOUT);marker('logout');
    throw failure('Sign in again.',401);
   }
   if(value.code==='AUTH_LOGOUT_PENDING'){epoch++;clear('logout');root.localStorage.setItem(LOGOUT,'1');throw failure('Finish signing out when connected.',403);}
   if(reply.status<200||reply.status>=300||value.ok!==true)throw failure(typeof value.error==='string'?value.error.slice(0,240):'Browser request failed.',reply.status);
   return value;
  }
  async function flushLogout(){
   if(logoutTask)return logoutTask;
   const deadline=now()+20000;
   logoutTask=locked(deadline,async()=>{
    try{const reply=await post('/logout',{},deadline);if(reply.status===200&&reply.body.ok===true&&reply.body.signedOut===true){root.localStorage.removeItem(LOGOUT);return true;}}
    catch{}
    return false;
   }).catch(()=>false).finally(()=>{logoutTask=null;});
   return logoutTask;
  }
  async function logout(){
   epoch++;clear('logout');root.localStorage.setItem(LOGOUT,'1');marker('logout');
   const confirmed=await flushLogout();return {ok:true,signedOut:true,revocationPending:!confirmed};
  }
  async function request(action,payload={}){
   if(action==='logout')return logout();
   const signingIn=['login','checker-login','google-login'].includes(action);
   if(pending()){
    if(!signingIn||!await flushLogout())throw failure('Reconnect to finish the pending sign-out before continuing.',503);
   }
   const deadline=now()+20000;
   if(signingIn){
    const captured=++epoch,sequence=++profileSequence;clear('identity');
    return locked(deadline,async()=>{const reply=await post('/api',{action,payload},deadline);current(captured);const value=checked(reply);adopt(value.profile,sequence,true);return value;});
   }
   const captured=epoch,requestScope=scope(profile());let sequence=action==='me'?++profileSequence:0;
   if(!['me','config'].includes(action)&&!profile())throw failure('Verify your browser account before continuing.',401);
   let reply=await post('/api',{action,payload},deadline);current(captured);
   if(reply.status===401&&reply.body.code==='RENEW_REQUIRED'){
    reply=await locked(deadline,async()=>{
     current(captured);
     // A different tab may already have renewed while this request waited.
     if(action==='me')sequence=++profileSequence;
     let result=await post('/api',{action,payload},deadline);current(captured);
     if(result.status!==401||result.body.code!=='RENEW_REQUIRED')return result;
     checked(await post('/session/prepare',{},deadline));current(captured);
     const renewalSequence=++profileSequence,renewed=checked(await post('/session/commit',{},deadline));current(captured);adopt(renewed.profile,renewalSequence);
     if(action==='me')sequence=++profileSequence;
     result=await post('/api',{action,payload},deadline);current(captured);return result;
    });
   }
   current(captured);const value=checked(reply);
   if(!['me','config'].includes(action)&&requestScope!==scope(profile()))throw failure('Your account access changed while the request was running.',403);
   if(action==='me')adopt(value,sequence);return value;
  }
  async function restore(){
   if(pending()){clear('logout');await flushLogout();return null;}
   try{await request('me');return profile();}catch(error){if(error.status===401)return null;throw error;}
  }
  function changed(event){
   if(event.key!==AUTH||closed)return;
   epoch++;clear('identity',true);
   if(!pending()&&!String(event.newValue||'').startsWith('logout:'))restore().catch(()=>{});
  }
  const online=()=>{if(!closed&&pending())flushLogout();};
  root.addEventListener('storage',changed);root.addEventListener('online',online);
  function dispose(){if(closed)return;closed=true;epoch++;profileText=null;for(const controller of controllers)controller.abort();controllers.clear();root.removeEventListener('storage',changed);root.removeEventListener('online',online);}
  return Object.freeze({request,restore,logout,profile,dispose});
 }
 root.NavrangBrowserSession=Object.freeze({create});
})(globalThis);
