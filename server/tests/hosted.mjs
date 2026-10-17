// Destructive only to synthetic registrations in a fresh test project. Never run against a live event.
import {validateHostedTarget,assertEmptyHostedProject} from './hosted-safety.mjs';
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
const API=process.env.NAVRANG_TEST_API,credsPath=process.env.NAVRANG_TEST_CREDENTIALS;
validateHostedTarget(API,process.env.NAVRANG_TEST_ALLOW_MUTATIONS);
if(!credsPath)throw Error('Set NAVRANG_TEST_CREDENTIALS for the separate, disposable test project.');
const creds=JSON.parse(fs.readFileSync(credsPath,'utf8'));
async function call(action,payload={},token){const started=performance.now();const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({action,payload})});return{status:r.status,body:await r.json(),ms:performance.now()-started};}
const good=(id,name='Synthetic Student')=>({id,name,amount:100,quantity:1,refund:0,description:'Transaction completed successfully'});
const request=ticketId=>({ticketId,requestId:randomUUID(),deviceId:'integration-test-device'});
test('hosted single-entry admission service',async t=>{
 let admin,A,B,staffA,staffB,winner,results;
 // Do not put this abort gate inside a subtest: failed subtests otherwise let
 // the subsequent import and admission jobs continue. No mutation precedes it.
 const login=await call('login',{username:creds.username,password:creds.password});
 assert.equal(login.status,200);assert.equal(login.body.profile?.role,'admin');admin=login.body.token;
 assertEmptyHostedProject(await call('sync',{dataRevision:-1,afterSeq:0},admin));
 await t.test('anonymous check-in denied',async()=>{assert.equal((await call('checkin',request('DEMO0001'))).status,401)});
 await t.test('admin login and distinct checker codes',async()=>{
  let a=await call('staff-create',{name:'Synthetic Checker A'},admin),b=await call('staff-create',{name:'Synthetic Checker B'},admin);assert.equal(a.status,200);assert.equal(b.status,200);staffA=a.body.checker.id;staffB=b.body.checker.id;
  const ar=await call('checker-login',{code:a.body.code}),br=await call('checker-login',{code:b.body.code});assert.equal(ar.status,200);assert.equal(br.status,200);A=ar.body.token;B=br.body.token;
  if(process.env.NAVRANG_TEST_STATE){fs.writeFileSync(process.env.NAVRANG_TEST_STATE,JSON.stringify({admin,A,B,staffA,staffB,codeA:a.body.code,codeB:b.body.code}),{mode:0o600});fs.chmodSync(process.env.NAVRANG_TEST_STATE,0o600);}
 });
 await t.test('protected import and checker synchronization',async()=>{const r=await call('import',{eventId:'O9KL3',source:'Synthetic integration suite',records:[good('DEMO0001'),good('DEMO0002'),{...good('DEMO0003'),description:'Transaction failed'},good('DEMO0004')]},admin);assert.equal(r.status,200,JSON.stringify(r.body));const s=await call('sync',{dataRevision:-1,afterSeq:0},A);assert.equal(s.status,200,JSON.stringify(s.body));assert.equal(s.body.staffSummary,true);assert.deepEqual(s.body.stats,{ownScans:0,totalEntries:0});assert.equal(s.body.records,null);assert.deepEqual(s.body.entries,[]);assert.equal('checkers' in s.body,false);const full=await call('sync',{dataRevision:-1,afterSeq:0},admin);assert.equal(full.body.stats.total,4);assert.equal(full.body.stats.eligible,3);});
 await t.test('16 simultaneous check-ins produce exactly one global winner',async()=>{
  const jobs=Array.from({length:16},(_,i)=>({payload:request('DEMO0001'),token:i%2?A:B}));results=await Promise.all(jobs.map(async job=>({...await call('checkin',job.payload,job.token),job})));
  for(const r of results)assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(results.filter(r=>r.body.code==='admitted').length,1);assert.equal(results.filter(r=>r.body.code==='duplicate').length,15);
  winner=results.find(r=>r.body.code==='admitted');for(const r of results){assert.equal(r.body.entry.checker,winner.body.entry.checker);assert.equal(r.body.entry.at,winner.body.entry.at)}
  const times=results.map(r=>r.ms).sort((a,b)=>a-b);console.log('Hosted concurrency response time: median '+Math.round(times[8])+'ms, maximum '+Math.round(times[15])+'ms (workspace to Mumbai; not venue Wi-Fi).');
 });
 await t.test('lost-response retry returns original receipt and binds request to ticket/device',async()=>{const retry=await call('checkin',winner.job.payload,winner.job.token);assert.deepEqual(retry.body,winner.body);assert.equal((await call('checkin',{...winner.job.payload,ticketId:'DEMO0002'},winner.job.token)).status,409);const s=await call('sync',{dataRevision:0,afterSeq:0},admin);assert.equal(s.body.stats.admitted,1);const a=await call('sync',{},A),b=await call('sync',{},B);assert.equal(a.body.stats.ownScans+b.body.stats.ownScans,1);assert.equal(a.body.stats.totalEntries,1);assert.equal(b.body.stats.totalEntries,1)});
 await t.test('failed, unknown and tampered eligibility never admit',async()=>{assert.equal((await call('checkin',request('DEMO0003'),A)).body.code,'blocked');assert.equal((await call('checkin',request('DEMO9999'),A)).body.code,'not_found');const r=await call('upsert',{eventId:'O9KL3',source:'Synthetic update',records:[{...good('DEMO0005'),eligible:true,description:'Transaction failed'}]},admin);assert.equal(r.status,200);assert.equal((await call('checkin',request('DEMO0005'),A)).body.code,'blocked')});
 await t.test('admin update reaches checker; replacement retains original admission',async()=>{await call('upsert',{eventId:'O9KL3',records:[good('DEMO0005')],source:'Synthetic update'},admin);const s=await call('sync',{dataRevision:-1,afterSeq:0},admin);assert.ok(s.body.records.some(r=>r.id==='DEMO0005'&&r.eligible));const staff=await call('sync',{dataRevision:-1,afterSeq:0},B);assert.equal(staff.body.records,null);assert.deepEqual(staff.body.entries,[]);assert.equal(staff.body.stats.totalEntries,1);await call('import',{eventId:'O9KL3',records:[good('DEMO0005')],source:'Synthetic replacement'},admin);assert.equal((await call('checkin',request('DEMO0001'),B)).body.code,'duplicate');assert.equal((await call('checkin',request('DEMO0002'),B)).body.code,'not_found');const after=await call('sync',{dataRevision:-1,afterSeq:0},admin);assert.equal(after.body.stats.total,1);assert.equal(after.body.stats.admitted,1);assert.equal(after.body.entries[0].checker,winner.body.entry.checker)});
 await t.test('checker cannot import, manage staff or elevate role',async()=>{assert.equal((await call('import',{eventId:'O9KL3',records:[good('DEMO0006')]},A)).status,403);assert.equal((await call('staff-create',{name:'Unauthorized'},A)).status,403);assert.equal((await call('session-create',{role:'admin'},A)).status,400)});
 await t.test('suspension immediately disables existing session',async()=>{assert.equal((await call('staff-update',{id:staffA,active:false},admin)).status,200);assert.equal((await call('sync',{dataRevision:-1,afterSeq:0},A)).status,403);assert.equal((await call('checkin',request('DEMO0005'),A)).status,403);await call('staff-update',{id:staffA,active:true},admin)});
 await t.test('forged Google token cannot create a checker',async()=>{assert.equal((await call('google-login',{accessToken:'forged',role:'admin'})).status,401)});
 await t.test('no changes returns no registration payload; malformed import preserves data',async()=>{const s=await call('sync',{dataRevision:-1,afterSeq:0},B);const same=await call('sync',{dataRevision:s.body.dataRevision,afterSeq:s.body.cursor},B);assert.equal(same.body.records,null);assert.deepEqual(same.body.entries,[]);assert.equal((await call('import',{eventId:'O9KL3',records:[]},admin)).status,400);assert.equal((await call('sync',{dataRevision:-1,afterSeq:0},admin)).body.stats.total,1)});
});
