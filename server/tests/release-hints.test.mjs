import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReleaseHintTransport} from '../functions/navrang-gate/release-hints.mjs';

test('release announcement sends only public version/hash to a fixed public topic',async()=>{
 let sent;const transport=createReleaseHintTransport({projectId:'synthetic-project',accessToken:async()=>'synthetic-token',
  fetchImpl:async(url,options)=>{sent={url,...options};return Response.json({name:'projects/synthetic/messages/1'});}});
 assert.deepEqual(await transport.publish({versionCode:19,sha256:'a'.repeat(64)}),{accepted:true});
 assert.equal(sent.url,'https://fcm.googleapis.com/v1/projects/synthetic-project/messages:send');
 const message=JSON.parse(sent.body).message;
 assert.deepEqual(message.data,{kind:'app-release',versionCode:'19',sha256:'a'.repeat(64)});
 assert.equal(message.topic,'navrang-public-releases-v1');
 assert.equal(message.android.collapse_key,'navrang-release');
 assert.equal(message.android.priority,'normal');
 assert.equal(message.notification,undefined);assert.equal(message.token,undefined);
});
test('malformed, private or user-routed announcements never request a credential or network',async()=>{
 let calls=0;const transport=createReleaseHintTransport({projectId:'synthetic-project',accessToken:async()=>{calls++;return 'fixture';},fetchImpl:async()=>{throw Error('not expected');}});
 for(const value of [{versionCode:0,sha256:'a'.repeat(64)},{versionCode:'19',sha256:'a'.repeat(64)},
  {versionCode:2147483648,sha256:'a'.repeat(64)},{versionCode:19,sha256:'not-a-hash'},
  {versionCode:19,sha256:'a'.repeat(64),topic:'someone-else'},
  {versionCode:19,sha256:'a'.repeat(64),coordinates:[1,2]}])await assert.rejects(()=>transport.publish(value));
 assert.equal(calls,0);
});
test('provider acceptance is distinguished from delivery and errors are bounded',async()=>{
 const transport=createReleaseHintTransport({projectId:'synthetic-project',accessToken:async()=>'fixture',fetchImpl:async()=>Response.json({error:{}},{status:429})});
 assert.deepEqual(await transport.publish({versionCode:19,sha256:'a'.repeat(64)}),{accepted:false});
});
