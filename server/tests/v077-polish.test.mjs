import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const shellPath=new URL('../../app/assets/art/brand-shell.js',import.meta.url);
function fixture(profile=null){
 const html=fs.readFileSync(new URL('../../app/assets/index.html',import.meta.url),'utf8');
 const dom=new JSDOM(html,{url:'https://example.invalid/',runScripts:'outside-only'});
 const w=dom.window,calls=[],listeners=[];
 w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
 w.GateClient={profile:()=>profile,api:async(action,payload)=>{calls.push({action,payload});return {ok:true,requested:true};},on:fn=>listeners.push(fn),native:false};
 const source=fs.existsSync(shellPath)?fs.readFileSync(shellPath,'utf8'):'';
 if(source)w.eval(source);
 return {dom,w,calls,listeners};
}
test('brand shell is shipped and loaded after the main app',()=>{
 assert.ok(fs.existsSync(shellPath),'The branded role shell is missing');
 const html=fs.readFileSync(new URL('../../app/assets/index.html',import.meta.url),'utf8');
 assert.ok(html.indexOf('art/brand-shell.js')>html.indexOf('src="gate.js"'));
 assert.ok(html.includes('art/brand-shell.css'));
});
test('login presents three staff routes and a separate admin route',()=>{
 const {dom,w}=fixture();
 assert.deepEqual([...w.document.querySelectorAll('[data-login-role]')].map(x=>x.dataset.loginRole),['checker','helpdesk','faculty']);
 assert.ok(w.document.getElementById('show-admin-login').closest('.administrator-entry'));
 assert.equal(w.document.getElementById('show-admin-login').textContent.includes('Administrator'),true);
 dom.window.close();
});
test('visual brand marks restore the original Navrang logo and retain the university asset',()=>{
 const {dom,w}=fixture();
 const event=w.document.querySelector('.intro-content .event-wordmark');
 assert.ok(event,'Intro needs the official Navrang artwork');
 assert.equal(event.getAttribute('aria-label'),'Navrang');
 assert.ok(event.querySelector('img').getAttribute('src').endsWith('navrang-transparent.png'));
 assert.ok(w.document.querySelector('.app-footer img[src="art/parul-goa.svg"]'));
 assert.equal(w.document.querySelector('.intro-content h1')?.textContent,'Navrang');
 dom.window.close();
});
test('faculty entry requests permission without granting access',async()=>{
 const {dom,w,calls}=fixture({role:'checker',checkerId:'00000000-0000-4000-8000-000000000001',method:'google',active:false,nameConfirmed:true,scanner:false,helpdesk:false,station:''});
 const b=w.document.getElementById('station-faculty');assert.ok(b,'Faculty request route missing');b.click();
 await new Promise(r=>setTimeout(r,0));
 assert.equal(calls[0]?.action,'reports-request');
 assert.equal(calls.some(x=>x.action==='reports-grant'),false);
 assert.equal(b.textContent.includes('requested'),true);
 dom.window.close();
});
test('admin always retains the report route and is not asked to self-approve',()=>{
 const {dom,w}=fixture({role:'admin',active:true});
 assert.equal(w.document.getElementById('reports-nav').hidden,false);
 assert.equal(w.document.getElementById('station-faculty').textContent.includes('Open reports'),true);
 dom.window.close();
});
test('motion has a reduced-motion override and no continuous filter animation',()=>{
 const p=new URL('../../app/assets/art/brand-shell.css',import.meta.url);
 assert.ok(fs.existsSync(p),'Branded styles are missing');const css=fs.readFileSync(p,'utf8');
 assert.match(css,/prefers-reduced-motion:\s*reduce/);
 assert.match(css,/@keyframes\s+garba-sway/);
 assert.match(css,/animation-play-state:\s*paused/);
});
test('reconciliation keeps scan outcome evidence and does not invent payment or names',()=>{
 const p=new URL('../reconcile-missing-registration-v077.sql',import.meta.url);
 assert.ok(fs.existsSync(p),'Documented reconciliation SQL is missing');const sql=fs.readFileSync(p,'utf8');
 assert.match(sql,/organizer_confirmed/);assert.match(sql,/registration data missing/);
 assert.match(sql,/not_found/);assert.match(sql,/2026-10-18T05:20:46Z/);
 assert.doesNotMatch(sql,/update\s+navrang_private\.attempts/i);
 assert.doesNotMatch(sql,/insert\s+into\s+navrang_private\.tickets/i);
});
