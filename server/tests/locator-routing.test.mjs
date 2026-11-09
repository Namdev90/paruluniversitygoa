import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const previousFetch=globalThis.fetch,previousDeno=globalThis.Deno,calls=[];
let handler;
before(async()=>{
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon'})[key]},serve:fn=>handler=fn};
 globalThis.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return Response.json({items:[]})};
 await import('../functions/navrang-gate/index.ts');
});
after(()=>{globalThis.fetch=previousFetch;if(previousDeno)globalThis.Deno=previousDeno;else delete globalThis.Deno});
const bearer='b'.repeat(64),hash=createHash('sha256').update(bearer).digest('hex');
const post=(payload,auth=bearer)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:auth?{Authorization:'Bearer '+auth}:{},body:JSON.stringify({action:'locator-roster',payload})}));
test('locator metadata is routed to its service-only RPC using a hashed bearer',async()=>{
 assert.equal((await post({eventId:'O9KL3'})).status,200);
 assert.deepEqual(calls.at(-1),{url:'https://synthetic.invalid/rest/v1/rpc/navrang_locator',body:{p_action:'locator-roster',p:{eventId:'O9KL3'},p_token:hash}});
});
test('unauthenticated or spoofed locator requests never reach a store',async()=>{
 const before=calls.length;
 assert.equal((await post({eventId:'O9KL3'},'')).status,401);
 assert.equal((await post({eventId:'O9KL3',principal:'admin'})).status,400);
 assert.equal(calls.length,before);
});
