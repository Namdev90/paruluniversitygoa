import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
const root=path.resolve(import.meta.dirname,'../..');
test('web companion includes every referenced script and stylesheet',()=>{
 const dest=fs.mkdtempSync(path.join(os.tmpdir(),'navrang-web-'));
 try{
  execFileSync('python3',[path.join(root,'tools/package-web.py'),dest]);
  const document=new JSDOM(fs.readFileSync(path.join(dest,'index.html'),'utf8')).window.document;
  const refs=[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.getAttribute('src')||e.getAttribute('href'));
  for(const file of refs)assert.ok(fs.existsSync(path.join(dest,file)),`Missing packaged browser dependency: ${file}`);
  assert.ok(fs.existsSync(path.join(dest,'art/navrang-wordmark.png')),'web branding must include the verified official crop');
  for(const forbidden of ['signing','server','downloads','node_modules','app'])assert.ok(!fs.existsSync(path.join(dest,forbidden)));
 }finally{fs.rmSync(dest,{recursive:true,force:true});}
});
test('admin can download attendance when teacher management is temporarily unavailable',async()=>{
 const html=fs.readFileSync(path.join(root,'app/assets/index.html'),'utf8');
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://example.invalid/'});
 const w=dom.window;
 w.GateClient={profile:()=>({role:'admin',active:true,reports:true}),on:()=>{},api:async action=>{
  if(action==='reports-summary')return {stats:{registered:10,eligible:9,attended:8,registeredAttended:7,organizerConfirmed:1,generatedAt:'2026-10-18T00:00:00Z'}};
  if(action==='reports-members')throw Error('Teacher management unavailable.');
  throw Error('unexpected '+action);
 }};
 w.NavrangReportExport={};
 w.eval(fs.readFileSync(path.join(root,'app/assets/reports.js'),'utf8'));
 await w.NavrangReports.refresh();
 assert.equal(w.document.getElementById('report-csv').disabled,false,'valid summary must retain export access');
 assert.equal(w.document.getElementById('report-xlsx').disabled,false);
 assert.match(w.document.getElementById('report-manage').textContent,/unavailable/i);
 assert.match(w.document.getElementById('report-status').textContent,/ready/i);
 dom.window.close();
});
