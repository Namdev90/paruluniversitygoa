(function(root){
 'use strict';
 const C=root.NavrangCore, native=root.Native&&typeof root.Native.readState==='function';let dbPromise,queue=Promise.resolve();
 function deviceId(){const b=new Uint8Array(12);crypto.getRandomValues(b);return 'phone-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
 function initial(){return C.newState(deviceId());}
 function db(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open('navrang-offline-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Local storage could not open. Keep your app data and try again.'));r.onblocked=()=>reject(Error('Close other copies of the app, then try again.'));});return dbPromise;}
 async function read(){
  if(native){const raw=root.Native.readState();return raw?C.validateState(JSON.parse(raw)):null;}
  const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('state','readonly'),r=t.objectStore('state').get('current');r.onsuccess=()=>{try{resolve(r.result?C.validateState(r.result):null);}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});
 }
 async function commit(change){
  if(native){const old=await read()||initial(), out=change(old);C.validateState(out.state);if(root.Native.writeState(JSON.stringify(out.state))!==true)throw Error('Could not save to this phone. Entry is NOT confirmed. Free some storage and try again.');return out.result;}
  const d=await db();return new Promise((resolve,reject)=>{
   const t=d.transaction('state','readwrite'),store=t.objectStore('state'),r=store.get('current');let value,failure;
   r.onsuccess=()=>{try{const out=change(r.result?C.validateState(r.result):initial());C.validateState(out.state);value=out.result;store.put(out.state,'current');}catch(e){failure=e;t.abort();}};
   t.oncomplete=()=>resolve(value);t.onabort=()=>reject(failure||Error('Could not save to this phone. Entry is NOT confirmed.'));t.onerror=()=>{failure=failure||Error('Could not save to this phone. Entry is NOT confirmed.');};
  });
 }
 function mutate(change){const work=queue.then(()=>commit(change));queue=work.catch(()=>{});return work;}
 root.NavrangStore={read,mutate};
})(globalThis);
