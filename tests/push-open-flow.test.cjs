const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const id='00000000-0000-4000-8000-000000000001';
const stamp='2026-10-25T00:00:00.000Z';
const profile={role:'checker',checkerId:id,active:true,reports:true};
const feed=(ids=[id])=>({revision:1,serverTime:stamp,activeIds:ids,items:ids.map(id=>({id,revision:1,kind:'announcement',title:'Synthetic',body:'Fixture',at:stamp,read:false,destination:'account'})),dashboard:null});
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function fixture(){
 const dom=new JSDOM('<header><div class="top-actions"></div></header><button data-view="account">Account</button>',{url:'https://fixture.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
 let current=profile,handle=async action=>action==='me'?current:feed();const calls=[],listeners=new Set();
 const client={profile:()=>current,on:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},api:async(action,payload)=>{calls.push({action,payload});return handle(action,payload)}};
 dom.window.eval(fs.readFileSync(path.join(__dirname,'../app/assets/notifications.js'),'utf8'));
 const api=dom.window.NavrangNotificationCenter.mount({client,autoStart:false,poll:false});
 return {dom,calls,api,handler:fn=>{handle=fn},emit:data=>{for(const fn of listeners)fn({type:'push-open',data})},signout:()=>{current=null;for(const fn of listeners)fn({type:'auth'})},opened:()=>dom.window.document.getElementById('notifications-center').hasAttribute('open'),close:()=>{api.destroy();dom.window.close()}};
}
test('push tap reauthorizes then reconciles current feed before opening center',async()=>{
 const f=fixture();try{f.emit({id});await settle();await settle();assert.deepEqual(f.calls.map(call=>call.action),['me','notifications-feed']);assert.equal(f.opened(),true);}finally{f.close()}
});
test('stale event cannot open from cached or removed feed rows',async()=>{
 const f=fixture();try{await f.api.refresh();f.handler(async action=>action==='me'?profile:feed([]));f.emit({id});await settle();assert.equal(f.opened(),false);}finally{f.close()}
});
test('sign-out while fresh authority is pending suppresses push tap',async()=>{
 const f=fixture();try{let finish;f.handler(()=>new Promise(resolve=>{finish=resolve}));f.emit({id});f.signout();finish(profile);await settle();assert.equal(f.opened(),false);assert.equal(f.calls.length,1);}finally{f.close()}
});
test('offline failure, forbidden response and injected destination never open center',async()=>{
 for(const status of [0,403]){const f=fixture();try{f.handler(async()=>{throw Object.assign(Error('Synthetic failure'),{status})});f.emit({id});await settle();assert.equal(f.opened(),false);}finally{f.close()}}
 const f=fixture();try{f.emit({id,destination:'admin',url:'https://example.invalid'});await settle();assert.equal(f.calls.length,0);assert.equal(f.opened(),false);}finally{f.close()}
});
