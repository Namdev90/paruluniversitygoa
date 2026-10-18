import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateRequest} from '../functions/navrang-gate/security.mjs';
import {createHandler} from '../functions/navrang-gate/handler.mjs';

test('report SQL keeps every single-quoted literal on a balanced source line',()=>{
 const sql=fs.readFileSync(new URL('../teacher-reports-v077.sql',import.meta.url),'utf8');
 for(const [index,line] of sql.split('\n').entries()){
  if(line.trimStart().startsWith('--'))continue;
  assert.equal((line.match(/'/g)||[]).length%2,0,'Unbalanced SQL literal at line '+(index+1)+': '+line);
 }
});
test('faculty request accepts no self-granted roles or target identifiers',()=>{
 assert.doesNotThrow(()=>validateRequest({action:'reports-request',payload:{}}));
 for(const payload of [{enabled:true},{checkerId:'someone-else'},{role:'admin'}])assert.throws(()=>validateRequest({action:'reports-request',payload}));
 assert.doesNotThrow(()=>validateRequest({action:'reports-export',payload:{kind:'corrections'}}));
});
test('a reporting outage fails closed without breaking the existing account refresh',async()=>{
 const handler=createHandler({rpc:async(action)=>{if(action==='me')return {role:'checker',active:true};throw Error('Reporting unavailable');},googleUser:async()=>null,googleEnabled:async()=>false});
 const response=await handler(new Request('https://example.invalid/',{method:'POST',headers:{Authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({action:'me',payload:{}})}));
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.reports,false);assert.equal(data.reportsRequested,false);assert.equal(data.active,true);
});
