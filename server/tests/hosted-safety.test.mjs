import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateHostedTarget,assertEmptyHostedProject} from './hosted-safety.mjs';

test('destructive hosted tests refuse production and require an explicit isolated target',()=>{
 assert.throws(()=>validateHostedTarget('https://mzesveurjzxjybkejqmx.supabase.co/functions/v1/navrang-gate','isolated-project'),/live Navrang/);
 assert.throws(()=>validateHostedTarget('https://example.invalid/functions/v1/navrang-gate'),/ALLOW_MUTATIONS/);
 assert.throws(()=>validateHostedTarget('https://example.invalid/api?secret=x','isolated-project'),/plain test API/);
 assert.throws(()=>validateHostedTarget('http://example.invalid/api','isolated-project'),/HTTPS/);
 assert.doesNotThrow(()=>validateHostedTarget('https://example.invalid/api','isolated-project'));
 assert.doesNotThrow(()=>validateHostedTarget('http://localhost:54321/functions/v1/navrang-gate','isolated-project'));
});

test('hosted preflight fails closed unless the complete admin snapshot proves an empty project',()=>{
 const empty=()=>({status:200,body:{ok:true,stats:{total:0,admitted:0},records:[],entries:[],hasMore:false}});
 assert.doesNotThrow(()=>assertEmptyHostedProject(empty()));
 const cases=[null,{status:401,body:{}},empty(),empty(),empty(),empty(),empty(),empty()];
 cases[2].body.stats.total=1;cases[3].body.stats.admitted=1;
 cases[4].body.records=null;cases[5].body.records=[{id:'DEMO0001'}];
 cases[6].body.entries=[{ticketId:'DEMO0001'}];cases[7].body.hasMore=true;
 for(const value of cases)assert.throws(()=>assertEmptyHostedProject(value),/Refusing hosted mutations/);
});

test('the real hosted runner stops before imports or admissions when preflight fails',async()=>{
 const actions=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const {action}=JSON.parse(raw);actions.push(action);
  res.setHeader('Content-Type','application/json');
  if(action==='login')res.end(JSON.stringify({ok:true,token:'synthetic-only',profile:{role:'admin'}}));
  else if(action==='sync')res.end(JSON.stringify({ok:true,stats:{total:1,admitted:0},records:[{id:'DEMO0001'}],entries:[],hasMore:false}));
  else {res.statusCode=500;res.end(JSON.stringify({ok:false,error:'No mutation should reach this server.'}));}
 });
 const dir=await mkdtemp(path.join(tmpdir(),'navrang-hosted-guard-'));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const credentials=path.join(dir,'synthetic.json');
  await writeFile(credentials,JSON.stringify({username:'synthetic',password:'synthetic-test-only'}),{mode:0o600});
  const env={...process.env,NAVRANG_TEST_API:`http://127.0.0.1:${server.address().port}/api`,NAVRANG_TEST_CREDENTIALS:credentials,NAVRANG_TEST_ALLOW_MUTATIONS:'isolated-project'};
  delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--test',fileURLToPath(new URL('./hosted.mjs',import.meta.url))],{
   env,stdio:['ignore','pipe','pipe']
  });
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
  assert.notEqual(code,0,'runner falsely passed');assert.match(output,/Refusing hosted mutations/);
  assert.deepEqual(actions,['login','sync'],'runner continued to mutation subtests after its preflight failed');
 }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});
