import {test} from 'node:test';
import assert from 'node:assert/strict';

let contract;
try { contract = await import('../functions/navrang-gate/communications-contract.mjs'); }
catch { contract = {}; }

const id = '12345678-1234-4234-9234-123456789abc';
const other = '22345678-1234-4234-9234-123456789abc';
const hash = 'a'.repeat(64);
const template = {type:'announcement',title:'Gate update',body:'Please use the north gate.'};
const audience = {type:'everyone'};
const samples = {
  'notifications-feed':{afterRevision:0},
  'notifications-read':{id},
  'notifications-dashboard':{hidden:false},
  'notifications-preview':{template,audience},
  'notifications-send':{requestId:id,template,audience,previewHash:hash},
  'notifications-end':{id},
  'notifications-device':{installationId:'android-'+id,providerTarget:{type:'fid',value:'c123456789012345678901'},bindingId:id},
  'notifications-unregister':{installationId:'android-'+id,bindingId:id,unlinkProof:hash},
  'duty-join':{installationId:'android-'+id},
  'duty-heartbeat':{dutyId:id},
  'duty-leave':{dutyId:id},
  'voice-join':{dutyId:id,sessionId:other},
  'voice-floor':{sessionId:id,requestId:other},
  'voice-renew':{sessionId:id,leaseId:other},
  'voice-release':{sessionId:id,leaseId:other},
  'voice-broadcast-start':{requestId:id,audience,previewHash:hash},
  'voice-broadcast-end':{sessionId:id},
  'voice-invite':{requestId:id,staffId:other,previewHash:hash},
};
const parse = (action,payload) => {
  assert.equal(typeof contract.validateCommunication,'function','contract parser is available');
  return contract.validateCommunication(action,payload);
};

test('communication action recognition is an exact allowlist',()=>{
  assert.equal(typeof contract.isCommunicationAction,'function');
  for (const action of Object.keys(samples)) assert.equal(contract.isCommunicationAction(action),true,action);
  for (const action of ['notifications-unknown','voice-token','voice-join-extra','__proto__','constructor','reports-summary','login','',null,{},' notifications-feed']) {
    assert.equal(contract.isCommunicationAction(action),false,String(action));
  }
});

for (const [action,payload] of Object.entries(samples)) {
  test(`strict contract accepts ${action} without mutating its input`,()=>{
    const before=JSON.stringify(payload), result=parse(action,payload);
    assert.equal(typeof result,'object');
    assert.notEqual(result,payload);
    assert.equal(JSON.stringify(payload),before);
    assert.deepEqual(Object.keys(result).sort(),Object.keys(payload).sort());
  });
  test(`strict contract rejects client authority and unknown fields for ${action}`,()=>{
    for (const key of ['actor','principal','role','permissions','capabilityRevision','destination','unknown']) {
      assert.throws(()=>parse(action,{...payload,[key]:'admin'}));
    }
  });
}

test('payload must be a plain bounded JSON object',()=>{
  for (const payload of [null,undefined,[],1,'feed',new Date(),Object.create({afterRevision:0})]) {
    assert.throws(()=>parse('notifications-feed',payload));
  }
  const cycle={};cycle.self=cycle;
  assert.throws(()=>parse('notifications-feed',cycle));
  assert.throws(()=>parse('notifications-preview',{template:{...template,body:'x'.repeat(9000)},audience}));
  assert.throws(()=>parse('notifications-feed',JSON.parse('{"afterRevision":0,"__proto__":{"admin":true}}')));
  assert.throws(()=>parse('notifications-unknown',{}));
});

test('revision and dashboard flags have strict primitive types',()=>{
  assert.deepEqual(parse('notifications-feed',{}),{afterRevision:0});
  assert.deepEqual(parse('notifications-feed',{afterRevision:42}),{afterRevision:42});
  for(const value of [-1,0.1,'0',null,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>parse('notifications-feed',{afterRevision:value}));
  for(const value of [0,1,'false',null])assert.throws(()=>parse('notifications-dashboard',{hidden:value}));
});

test('identifiers are bounded canonical values, never arbitrary targets',()=>{
  assert.equal(parse('notifications-read',{id:id.toUpperCase()}).id,id);
  for(const value of ['', 'admin','https://example.invalid/'+id,id+'x',null])assert.throws(()=>parse('notifications-read',{id:value}));
  for(const value of ['', ' '.repeat(5),'../../private','https://example.invalid','a'.repeat(129)])assert.throws(()=>parse('duty-join',{installationId:value}));
  assert.throws(()=>parse('voice-renew',{sessionId:id,leaseId:'lease'}));
  assert.throws(()=>parse('voice-floor',{sessionId:id}));
});

test('administrator audiences are discriminated and canonical',()=>{
  const roles=parse('notifications-preview',{template,audience:{type:'roles',roles:['helpdesk','checker','checker','administrator']}}).audience;
  assert.deepEqual(roles,{type:'roles',roles:['administrator','checker','helpdesk']});
  const staff=parse('notifications-preview',{template,audience:{type:'staff',staffIds:[other,id.toUpperCase(),id]}}).audience;
  assert.deepEqual(staff,{type:'staff',staffIds:[id,other]});
  for(const invalid of [
    {type:'everyone',roles:['administrator']}, {type:'roles',roles:[]},
    {type:'roles',roles:['admin']}, {type:'roles',roles:['teacher']},
    {type:'staff',staffIds:[]}, {type:'staff',staffIds:['admin']},
    {type:'staff',staffIds:Array(101).fill(id)}, {type:'staff',staffIds:[id],enabled:true},
    {type:'all'}, {type:'roles',roles:'checker'}, null,
  ])assert.throws(()=>parse('notifications-preview',{template,audience:invalid}));
});

test('six approved template types are explicit and canonical',()=>{
  for(const type of ['announcement','emergency','meeting','call-request','update','live-broadcast']) {
    const result=parse('notifications-preview',{template:{type,title:'  Notice  ',body:' Line one\r\nLine two '},audience});
    assert.equal(result.template.type,type);
    assert.equal(result.template.title,'Notice');
    assert.equal(result.template.body,'Line one\nLine two');
    assert.equal(result.template.urgency,type==='emergency'?'emergency':'normal');
  }
  assert.throws(()=>parse('notifications-preview',{template:{...template,type:'telephone'},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,title:'  '},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,title:'x'.repeat(101)},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,body:'x'.repeat(1001)},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,urgency:'critical'},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,type:'emergency',urgency:'normal'},audience}));
});

test('template fields reject HTML, URLs, uploads and forged identity',()=>{
  for(const body of ['<b>North gate</b>','<script>alert(1)</script>','<img src=x onerror=alert(1)>','<!-- comment -->','<!DOCTYPE html>','https://example.invalid','www.example.invalid','javascript:alert(1)','intent://call','data:text/html,hello']) {
    assert.throws(()=>parse('notifications-preview',{template:{...template,body},audience}),body);
  }
  for(const [key,value] of [['actor','admin'],['image','photo.png'],['attachment',{}],['url','https://example.invalid'],['destination','admin']]) {
    assert.throws(()=>parse('notifications-preview',{template:{...template,[key]:value},audience}));
  }
  assert.throws(()=>parse('notifications-preview',{template:{...template,title:'A\u0000B'},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,title:'Two\nlines'},audience}));
});

test('meeting time is a real ISO timestamp and unrelated fields are rejected',()=>{
  const result=parse('notifications-preview',{template:{type:'meeting',title:'Meeting',body:'',meetingLocation:'  Gate office ',meetingTime:'2026-10-19T10:30:00+05:30'},audience});
  assert.equal(result.template.meetingTime,'2026-10-19T05:00:00.000Z');
  assert.equal(result.template.meetingLocation,'Gate office');
  for(const meetingTime of ['tomorrow','2026-10-19','2026-02-30T10:30:00Z','2026-10-19T25:30:00Z',null])assert.throws(()=>parse('notifications-preview',{template:{type:'meeting',title:'Meeting',body:'',meetingTime},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{...template,meetingTime:'2026-10-19T10:30:00Z'},audience}));
  assert.throws(()=>parse('notifications-preview',{template:{type:'meeting',title:'Meeting',body:'',meetingLocation:'x'.repeat(121)},audience}));
});

test('send, broadcast and call invitation require a reviewed preview fingerprint',()=>{
  for(const action of ['notifications-send','voice-broadcast-start','voice-invite']) {
    const {previewHash,...without}=samples[action];
    assert.throws(()=>parse(action,without));
    for(const invalid of ['', 'a'.repeat(63),'A'.repeat(64),'https://example.invalid'])assert.throws(()=>parse(action,{...samples[action],previewHash:invalid}));
  }
});

test('device registration supports only bounded FID or legacy token targets',()=>{
  for(const type of ['fid','legacyToken']) {
    const result=parse('notifications-device',{...samples['notifications-device'],providerTarget:{type,value:'provider_ABC-123:token'}});
    assert.deepEqual(result.providerTarget,{type,value:'provider_ABC-123:token'});
  }
  for(const providerTarget of [null,{}, {type:'topic',value:'everyone'}, {type:'fid',value:''}, {type:'fid',value:'line\nbreak'}, {type:'fid',value:'x'.repeat(257)}, {type:'legacyToken',value:'x'.repeat(4097)}, {type:'fid',value:'ok',role:'admin'}])assert.throws(()=>parse('notifications-device',{...samples['notifications-device'],providerTarget}));
});

test('unlink proof is required and grants no extra payload authority',()=>{
  const {unlinkProof,...without}=samples['notifications-unregister'];
  assert.throws(()=>parse('notifications-unregister',without));
  for(const invalid of ['', 'a'.repeat(63),'A'.repeat(64)])assert.throws(()=>parse('notifications-unregister',{...without,unlinkProof:invalid}));
  assert.throws(()=>parse('notifications-unregister',{...samples['notifications-unregister'],newPrincipal:id}));
});

test('cross-account device replacement accepts only an optional existing unlink proof',()=>{
  const payload={...samples['notifications-device'],previousUnlinkProof:hash};
  assert.equal(parse('notifications-device',payload).previousUnlinkProof,hash);
  for(const invalid of ['',hash.toUpperCase(),'a'.repeat(63),null])assert.throws(()=>parse('notifications-device',{...payload,previousUnlinkProof:invalid}));
});
