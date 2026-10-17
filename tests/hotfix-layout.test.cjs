const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const assets=path.join(__dirname,'..','app','assets');
const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');
const css=fs.readFileSync(path.join(assets,'style.css'),'utf8');
function page(legacy=false){
 const dom=new JSDOM(html),style=dom.window.document.createElement('style');
 // Chrome/WebView 86 discards unsupported inset and dynamic viewport declarations.
 // Remove those before parsing to exercise the preceding declarations in the cascade.
 style.textContent=legacy?css.replace(/\b(?:inset|aspect-ratio):[^;{}]*(?:;|(?=\}))/g,'').replace(/\b(?:height|max-height|min-height):[^;{}]*dvh[^;{}]*(?:;|(?=\}))/g,''):css;
 dom.window.document.head.append(style);return dom;
}
test('intro entry button remains centered after shared button styles',()=>{
 const dom=page();try{const w=dom.window,s=w.getComputedStyle(w.document.getElementById('skip-intro'));assert.equal(s.right,'50%');assert.equal(s.transform,'translateX(50%)');}finally{dom.window.close();}
});
test('legacy WebView dialogs keep viewport bounds without inset or dynamic viewport units',()=>{
 const dom=page(true);try{const w=dom.window,d=w.document.getElementById('edit-dialog'),s=w.getComputedStyle(d);assert.equal(s.position,'fixed');assert.equal(s.top,'0px');assert.equal(s.left,'0px');assert.equal(s.bottom,'0px');assert.match(s.maxHeight,/100vh/);assert.equal(s.overflowY,'auto');}finally{dom.window.close();}
});
test('legacy WebView scan receipt stays anchored and bounded without modern viewport units',()=>{
 const dom=page(true);try{const w=dom.window,d=w.document.getElementById('result-popup'),s=w.getComputedStyle(d);assert.equal(s.top,'auto');assert.equal(s.left,'16px');assert.match(s.bottom,/86px/);assert.equal(s.maxHeight,'calc(100vh - 118px)');d.dataset.modal='true';const modal=w.getComputedStyle(d);assert.equal(modal.top,'0px');assert.equal(modal.bottom,'0px');}finally{dom.window.close();}
});
