// SPDX-License-Identifier: MIT
// Local-only runtime integration. No JWTs or credential material are created.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const root=process.cwd();
const runtime=path.resolve(root,'../cloudflare-platform/node_modules/miniflare/dist/src/index.js');
const {Miniflare,convertV4MiniflareOptions}=await import(pathToFileURL(runtime));
const modules=async(entry)=>Promise.all([entry,'src/core.mjs','src/storage.mjs','src/protocol.mjs','src/auth.mjs','src/route.mjs'].map(async name=>({type:'ESModule',path:path.join(root,name),contents:await readFile(path.join(root,name),'utf8')})));
const mf=new Miniflare(convertV4MiniflareOptions({
  modules:await modules('src/worker.mjs'),
  compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],
  durableObjects:{ROOMS:{className:'NavrangRoom',useSQLite:true}},
  durableObjectsPersist:path.join(root,'.local-state/emulator-prod'),
}));
try {
  const unauth=await mf.dispatchFetch('http://localhost/v1/rooms/room/socket',{headers:{Upgrade:'websocket'}});
  assert.equal(unauth.status,503);
  assert.equal((await mf.dispatchFetch('http://localhost/v1/rooms/room/socket?token=forbidden')).status,404);
  assert.equal((await mf.dispatchFetch('http://localhost/v1/rooms/room/socket')).status,400);
  console.log('PASS production module in workerd: missing verifier503, query token404, missing clock nonce400');
} finally {await mf.dispose();}

// Test harness has no public endpoint or auth bypass in production source/config.
// It runs server core + SQLite + real hibernatable WS inside local workerd only.
const local=new Miniflare(convertV4MiniflareOptions({modules:await modules('test/runtime-harness.mjs'),
  compatibilityDate:'2026-10-19',compatibilityFlags:['nodejs_compat'],
  durableObjects:{TESTROOM:{className:'TestRoom',useSQLite:true}},durableObjectsPersist:path.join(root,'.local-state/emulator-harness')}));
const receive=ws=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.removeEventListener('message',on);reject(new Error('message timeout'));},3000);
  const on=event=>{clearTimeout(timer);ws.removeEventListener('message',on);resolve(event.data);};ws.addEventListener('message',on);
});
try {
  const connect=async(role)=>{
    const r=await local.dispatchFetch(`http://localhost/${role}`,{headers:{Upgrade:'websocket'}});assert.equal(r.status,101);const ws=r.webSocket;const ready=receive(ws);ws.accept();assert.equal(JSON.parse(await ready).type,'ready');return ws;
  };
  const c=await connect('controller'),s=await connect('speaker'),l=await connect('listener');
  const cg=receive(c),sg=receive(s),lg=receive(l);c.send('{"type":"grant","subject":"speaker"}');
  const g=JSON.parse(await cg);await sg;await lg;
  const {frame}=await import('./helpers.mjs');
  const delivered=receive(l);s.send(frame(g));assert.deepEqual(new Uint8Array(await delivered),new Uint8Array(frame(g)));
  const status=await local.dispatchFetch('http://localhost/status');const state=await status.json();assert.equal(state.sequence,1);assert.equal(state.deadline,g.deadline);
  // No ack: sequence2 accepted/consumed but not sent. State endpoint is an event-order barrier.
  s.send(frame(g,2));await new Promise(r=>setTimeout(r,50));const after=await(await local.dispatchFetch('http://localhost/status')).json();assert.equal(after.sequence,2);assert.equal(after.outstanding.sequence,1);
  // Force core reconstruction with real serialized socket attachments and SQLite data.
  assert.equal((await local.dispatchFetch('http://localhost/reconstruct')).status,200);
  const restored=await(await local.dispatchFetch('http://localhost/status')).json();assert.equal(restored.deadline,undefined);assert.equal(restored.sequence,undefined);assert.equal(restored.outstanding.sequence,1);
  const cg2=receive(c),sg2=receive(s),lg2=receive(l);c.send('{"type":"grant","subject":"speaker"}');
  const g2=JSON.parse(await cg2);await sg2;await lg2;assert.ok(g2.epoch>g.epoch);
  const revoked=receive(l);c.close(1000,'controller death');assert.equal(JSON.parse(await revoked).type,'revoked');
  const closed=new Promise(resolve=>s.addEventListener('close',resolve,{once:true}));s.send(frame(g,3));await closed;
  l.close();console.log('PASS local workerd/SQLite/hibernation API: binary bytes, durable seq/deadline, outstanding credit, actor reconstruction, controller-close revoke, stale send closes');
} finally {await local.dispose();}
