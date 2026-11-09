import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublishedReleaseAuthorizer,ecdsaDerToRaw,PUBLISHED_MANIFEST} from '../cloudflare-platform/release-manifest-authorizer.mjs';
const hash='a'.repeat(64),candidate={versionCode:19,sha256:hash},context={verified:'server'};
const rsa={type:'public',usages:['verify'],algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'}}};
const ec={type:'public',usages:['verify'],algorithm:{name:'ECDSA',namedCurve:'P-256'}};
const base={packageName:'in.navrang.gate',versionCode:19,versionName:'0.9.0',apkUrl:'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/Navrang-Gate-0.9.0.apk',size:100000,sha256:hash,signature:Buffer.alloc(256,1).toString('base64')};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(opts={}){
 const calls=[];let value={...base},permitted=true,verified=true;
 const authorizer=createPublishedReleaseAuthorizer({publicKey:rsa,verifyCaller:async(c)=>{calls.push('actor');return permitted&&c===context;},
  fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(value);},subtle:{verify:async(alg,key,sig,data)=>{calls.push({alg,key,sig:[...sig],data:new TextDecoder().decode(data)});return verified;}},...opts});
 return {authorizer,calls,setManifest:m=>{value=m;},setAllowed:b=>{permitted=b;},setVerified:b=>{verified=b;}};
}
test('requires trusted caller, valid original signer public key, signed published metadata',async()=>{
 const f=fixture();assert.equal(await f.authorizer(context,candidate),true);
 assert.equal(f.calls[1].url,PUBLISHED_MANIFEST);assert.equal(f.calls[1].options.redirect,'error');assert.equal(f.calls[1].options.cache,'no-store');
 assert.equal(f.calls[2].data,`navrang-release-v1\nin.navrang.gate\n19\n0.9.0\n${base.apkUrl}\n100000\n${hash}\n`);
 assert.deepEqual(f.calls[2].alg,{name:'RSASSA-PKCS1-v1_5'});assert.equal(f.calls.at(-1),'actor');
 f.setVerified(false);assert.equal(await f.authorizer(context,candidate),false);f.setAllowed(false);assert.equal(await f.authorizer(context,candidate),false);
 assert.equal(await fixture({publicKey:null}).authorizer(context,candidate),false);
});
test('rejects unsigned, wrong digest/version/package/URL, oversize, extra payload data is never trusted',async()=>{
 for(const change of [{signature:undefined},{sha256:'b'.repeat(64)},{versionCode:20},{packageName:'other'},
  {apkUrl:base.apkUrl+'?x=1'},{versionName:'0.9.0\n'},{size:26214401},{size:99999},{signature:'bad!!'}]){
  const f=fixture();f.setManifest({...base,...change});assert.equal(await f.authorizer(context,candidate),false);
 }
 const f=fixture();f.setManifest({...base,notes:'public freeform',extra:'ignored'});assert.equal(await f.authorizer(context,candidate),true);
});
test('never fetches for an unauthorized caller or invalid signer',async()=>{
 const f=fixture();assert.equal(await f.authorizer({},candidate),false);assert.deepEqual(f.calls,['actor']);
 const bad=fixture({publicKey:{...rsa,type:'private'}});assert.equal(await bad.authorizer(context,candidate),false);assert.equal(bad.calls.length,0);
});
test('rejects redirects, malformed/oversized response and noncooperative caller cancellation',async()=>{
 for(const fetchImpl of [async()=>({ok:true,redirected:true,body:new ReadableStream()}),async()=>new Response('x'.repeat(32769)),async()=>new Response('{')]){
  const f=fixture({fetchImpl});assert.equal(await f.authorizer(context,candidate),false);
 }
 const gate=deferred();let fetched=false;
 const f=fixture({timeoutMs:20,verifyCaller:async()=>{await gate.promise;return true;},fetchImpl:async()=>{fetched=true;return Response.json(base);}});
 assert.equal(await f.authorizer(context,candidate),false);gate.resolve();await turn();assert.equal(fetched,false);
});
test('ECDSA DER conversion preserves fixed width and rejects malformed or nonminimal integers',async()=>{
 const r=Uint8Array.from([0,...Array(32).fill(0x80)]),s=Uint8Array.from([1,...Array(31).fill(0)]);
 const der=Uint8Array.from([0x30,69,0x02,33,...r,0x02,32,...s]);
 const raw=ecdsaDerToRaw(der,32);assert.equal(raw.length,64);assert.deepEqual([...raw.slice(0,32)],Array(32).fill(0x80));
 for(const invalid of [der.slice(0,-1),Uint8Array.from([0x30,6,2,1,0x80,2,1,1]),Uint8Array.from([0x30,7,2,2,0,1,2,1,1])])assert.throws(()=>ecdsaDerToRaw(invalid,32));
 const f=fixture({publicKey:ec});f.setManifest({...base,signature:Buffer.from(der).toString('base64')});
 assert.equal(await f.authorizer(context,candidate),true);assert.equal(f.calls[2].sig.length,64);assert.deepEqual(f.calls[2].alg,{name:'ECDSA',hash:'SHA-256'});
});
test('revocation after signed manifest verification fences result',async()=>{
 let calls=0;const f=fixture({verifyCaller:async()=>++calls===1});assert.equal(await f.authorizer(context,candidate),false);assert.equal(calls,2);
});

test('actor verifier receives deadline signal in third argument',async()=>{
 const observed=[];const f=fixture({verifyCaller:async(context,release,options)=>{observed.push({context,release,signal:options.signal});return true;}});
 assert.equal(await f.authorizer(context,candidate),true);assert.equal(observed.length,2);
 for(const item of observed){assert.equal(item.context,context);assert.equal(item.release,candidate);assert.ok(item.signal instanceof AbortSignal);}
});

test('actual RSA and ECDSA WebCrypto verify valid synthetic signatures and reject tampering',async()=>{
 const {webcrypto}=await import('node:crypto'),subtle=webcrypto.subtle;
 const payload=new TextEncoder().encode(`navrang-release-v1\nin.navrang.gate\n19\n0.9.0\n${base.apkUrl}\n100000\n${hash}\n`);
 for(const mode of ['RSA','EC']){
  // Ephemeral, test-only keys: never persisted, exported or used operationally.
  const algorithm=mode==='RSA'?{name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'}:{name:'ECDSA',namedCurve:'P-256'};
  const keys=await subtle.generateKey(algorithm,false,['sign','verify']);
  let signature=new Uint8Array(await subtle.sign(mode==='RSA'?'RSASSA-PKCS1-v1_5':{name:'ECDSA',hash:'SHA-256'},keys.privateKey,payload));
  if(mode==='EC'){
   const integer=bytes=>{let i=0;while(i<bytes.length-1&&bytes[i]===0)i++;let v=[...bytes.slice(i)];if(v[0]&128)v=[0,...v];return [2,v.length,...v];};
   const r=integer(signature.slice(0,32)),s=integer(signature.slice(32));signature=Uint8Array.from([0x30,r.length+s.length,...r,...s]);
  }
  const f=fixture({publicKey:keys.publicKey,subtle});f.setManifest({...base,signature:Buffer.from(signature).toString('base64')});
  assert.equal(await f.authorizer(context,candidate),true,mode);
  signature[signature.length-1]^=1;f.setManifest({...base,signature:Buffer.from(signature).toString('base64')});
  assert.equal(await f.authorizer(context,candidate),false,mode);
 }
});
test('rejects an ABI-only top-level channel because installed updater requires universal',async()=>{
 const {webcrypto}=await import('node:crypto');
 const key=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},false,['sign','verify']);
 const candidate={versionCode:19,sha256:'a'.repeat(64)};
 const manifest={packageName:'in.navrang.gate',versionCode:19,versionName:'0.9.0',apkUrl:'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/Navrang-Gate-0.9.0-arm64-v8a.apk',size:200000,sha256:candidate.sha256,signature:'A'.repeat(44)};
 const auth=createPublishedReleaseAuthorizer({publicKey:key.publicKey,verifyCaller:async()=>true,subtle:webcrypto.subtle,fetchImpl:async()=>Response.json(manifest)});
 assert.equal(await auth('fixture',candidate),false);
});
