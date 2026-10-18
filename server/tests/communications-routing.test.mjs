import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const previousFetch=globalThis.fetch,previousDeno=globalThis.Deno,calls=[];
let handler;
before(async()=>{
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon'})[key]},serve:fn=>handler=fn};
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({allowed:true,revision:0,items:[],activeIds:[]})};
 await import('../functions/navrang-gate/index.ts');
});
after(()=>{globalThis.fetch=previousFetch;if(previousDeno)globalThis.Deno=previousDeno;else delete globalThis.Deno});
const bearer='b'.repeat(64),hash=createHash('sha256').update(bearer).digest('hex');
const post=(action,payload={},token=bearer)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify({action,payload})}));
test('private communication actions route to dedicated RPC with a hashed bearer',async()=>{
 assert.equal((await post('notifications-feed',{afterRevision:0})).status,200);
 assert.deepEqual(calls.at(-1),{url:'https://synthetic.invalid/rest/v1/rpc/navrang_communications',body:{p_action:'notifications-feed',p:{afterRevision:0},p_token:hash}});
});
test('communication parser canonical output is used by the handler',async()=>{
 const template={type:'announcement',title:'  Meeting  ',body:' Please attend. ',urgency:'normal'};
 assert.equal((await post('notifications-preview',{template,audience:{type:'roles',roles:['faculty','checker','faculty']}})).status,200);
 assert.equal(calls.at(-1).body.p.template.title,'Meeting');assert.deepEqual(calls.at(-1).body.p.audience.roles,['checker','faculty']);
});
test('missing authentication and spoofed actors never reach the communication RPC',async()=>{
 const before=calls.length;assert.equal((await post('notifications-feed',{afterRevision:0},'')).status,401);
 assert.equal((await post('notifications-feed',{afterRevision:0,principal:'admin'})).status,400);assert.equal(calls.length,before);
});
test('proof-based unregister is the only narrow unauthenticated communication route',async()=>{
 const p={installationId:'11111111-1111-4111-8111-111111111111',bindingId:'22222222-2222-4222-8222-222222222222',unlinkProof:'a'.repeat(64)};
 assert.equal((await post('notifications-unregister',p,'')).status,200);assert.equal(calls.at(-1).body.p_token,'');assert.equal(calls.at(-1).body.p_action,'notifications-unregister');
 const before=calls.length;assert.equal((await post('notifications-unregister',{...p,unlinkProof:'bad'},'')).status,400);assert.equal(calls.length,before);
});
