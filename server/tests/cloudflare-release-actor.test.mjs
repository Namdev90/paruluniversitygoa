import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto,createHash} from 'node:crypto';import {createReleaseActorVerifier} from '../cloudflare-platform/release-actor.mjs';
test('only current server-resolved admin can authorize; raw bearer is hashed before query',async()=>{
 let values;const bearer='a'.repeat(64);const verify=createReleaseActorVerifier({subtle:webcrypto.subtle,quota:{consume:()=>true},pool:{connect:async()=>({query:async q=>{values=q.values;return{rows:[{result:true}]};},release(){}})}});
 assert.equal(await verify('Bearer '+bearer,{}),true);assert.equal(values[0],createHash('sha256').update(bearer).digest('hex'));assert.notEqual(values[0],bearer);
});
test('missing bearer, quota exhaustion and non-admin actor cannot authorize',async()=>{
 let queried=0;const pool={connect:async()=>({query:async()=>{queried++;return{rows:[{result:false}]};},release(){}})};
 const denied=createReleaseActorVerifier({subtle:webcrypto.subtle,pool,quota:{consume:()=>false}});assert.equal(await denied('Bearer '+'a'.repeat(64),{}),false);assert.equal(queried,0);
 const verify=createReleaseActorVerifier({subtle:webcrypto.subtle,pool,quota:{consume:()=>true}});assert.equal(await verify('invalid',{}),false);assert.equal(await verify('Bearer '+'a'.repeat(64),{}),false);
});

test('failed SQL destroys the connection',async()=>{let destroyed;const verify=createReleaseActorVerifier({subtle:webcrypto.subtle,quota:{consume:()=>true},pool:{connect:async()=>({query:async()=>{throw Error('failed')},release:value=>{destroyed=value;}})}});assert.equal(await verify('Bearer '+'a'.repeat(64),{}),false);assert.equal(destroyed,true);});
test('abort during delayed connection destroys late client without querying',async()=>{
 let resolveConnect,queries=0,destroyed;const stop=new AbortController();
 const verify=createReleaseActorVerifier({subtle:webcrypto.subtle,quota:{consume:()=>true},pool:{connect:()=>new Promise(resolve=>{resolveConnect=resolve;})}});
 const pending=verify('Bearer '+'a'.repeat(64),{},{signal:stop.signal});
 while(!resolveConnect)await new Promise(resolve=>setImmediate(resolve));stop.abort();
 resolveConnect({query:async()=>{queries++;return{rows:[]};},release:x=>{destroyed=x;}});
 assert.equal(await pending,false);assert.equal(queries,0);assert.equal(destroyed,true);
});
test('published-manifest authorizer propagates cancellation into actual SQL actor verifier',async()=>{
 const {createPublishedReleaseAuthorizer}=await import('../cloudflare-platform/release-manifest-authorizer.mjs');
 let resolveConnect,destroyed,queries=0,fetches=0;const stop=new AbortController();
 const actor=createReleaseActorVerifier({subtle:webcrypto.subtle,quota:{consume:()=>true},pool:{connect:()=>new Promise(resolve=>{resolveConnect=resolve;})}});
 const publicKey={type:'public',usages:['verify'],algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'}}};
 const authorize=createPublishedReleaseAuthorizer({publicKey,verifyCaller:actor,subtle:{verify:async()=>true},fetchImpl:async()=>{fetches++;throw Error('unexpected fetch')}});
 const result=authorize('Bearer '+'a'.repeat(64),{versionCode:19,sha256:'a'.repeat(64)},{signal:stop.signal});
 while(!resolveConnect)await new Promise(resolve=>setImmediate(resolve));stop.abort();
 assert.equal(await result,false);resolveConnect({query:async()=>{queries++;},release:value=>{destroyed=value;}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(destroyed,true);assert.equal(queries,0);assert.equal(fetches,0);
});
