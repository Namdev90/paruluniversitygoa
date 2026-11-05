import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {webcrypto} from 'node:crypto';
import {NotificationOwner} from '../cloudflare-platform/notification-owner.mjs';import {ORIGINAL_CERTIFICATE_SHA256} from '../cloudflare-platform/release-certificate.mjs';
const tlv=(tag,...values)=>{const bytes=values.flat(),n=bytes.length;return [tag,...(n<128?[n]:n<256?[0x81,n]:[0x82,n>>8,n&255]),...bytes];};
const oid=[0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01],alg=tlv(0x30,tlv(0x06,oid),tlv(0x05)),spki=tlv(0x30,alg,tlv(0x03,0,1,2,3));
const cert=Uint8Array.from(tlv(0x30,tlv(0x30,tlv(0xa0,tlv(0x02,2)),tlv(0x02,1),alg,tlv(0x30),tlv(0x30),tlv(0x30),spki),alg,tlv(0x03,0,1,2)));
test('actual owner requires current admin, pinned published release and durable one-shot claim',async()=>{
 const db=new DatabaseSync(':memory:');const ctx={storage:{sql:{exec:(q,...p)=>{const rows=db.prepare(q).all(...p);return{toArray:()=>rows};}}}};
 const candidate={versionCode:19,sha256:'a'.repeat(64)},seen=[];let admin=true,ends=0;
 const env={RELEASE_HINT_ENABLED:'true',RELEASE_HINT_QUALIFIED:'true',RELEASE_SIGNER_VERIFIED:'true',AUTH_DB_CACHE_DISABLED:'true',NOTIFICATION_DB:{connectionString:'fixture'},FCM_SERVICE_ACCOUNT_KEY:'{}',FCM_PROJECT_ID:'fixture-project',FCM_SERVICE_ACCOUNT_EMAIL:'fixture@fixture-project.iam.gserviceaccount.com',FCM_KEY_ID:'fixture',RELEASE_SIGNER_CERTIFICATE_DER:Buffer.from(cert).toString('base64')};
 const subtle={digest:async(name,data)=>data.length===cert.length?Uint8Array.from(Buffer.from(ORIGINAL_CERTIFICATE_SHA256,'hex')):webcrypto.subtle.digest(name,data),
  importKey:async(format)=>format==='spki'?{type:'public',usages:['verify'],algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'}}}:{type:'private',extractable:false,usages:['sign'],algorithm:{name:'RSASSA-PKCS1-v1_5',hash:{name:'SHA-256'},modulusLength:2048}},verify:async()=>true,sign:async()=>new Uint8Array(256)};
 const poolFactory=()=>({connect:async()=>({query:async()=>({rows:[{result:admin}]}),release(){}}),end:async()=>ends++});
 const manifest={packageName:'in.navrang.gate',versionCode:19,versionName:'0.9.0',apkUrl:'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/Navrang-Gate-0.9.0.apk',size:200000,sha256:candidate.sha256,signature:'A'.repeat(44)};
 const fetchImpl=async(url)=>{seen.push(url);if(url.endsWith('/updates/latest.json'))return Response.json(manifest);if(url==='https://oauth2.googleapis.com/token')return Response.json({token_type:'Bearer',access_token:'a'.repeat(32),expires_in:3600});return Response.json({name:'projects/fixture/messages/1'});};
 let owner=new NotificationOwner(ctx,env,{subtle,poolFactory,fetchImpl,clock:()=>1000000});
 assert.deepEqual(await owner.releaseHint(candidate,'Bearer '+'a'.repeat(64)),{state:'ACCEPTED'});
 owner=new NotificationOwner(ctx,env,{subtle,poolFactory,fetchImpl,clock:()=>1000000});
 assert.deepEqual(await owner.releaseHint(candidate,'Bearer '+'a'.repeat(64)),{state:'ALREADY_CLAIMED'});
 assert.equal(seen.filter(x=>x.includes('messages:send')).length,1);assert.equal(ends,2);
 admin=false;assert.deepEqual(await owner.releaseHint({...candidate,versionCode:20},'Bearer '+'a'.repeat(64)),{state:'UNAVAILABLE'});
 assert.equal(seen.filter(x=>x.includes('messages:send')).length,1);db.close();
});
