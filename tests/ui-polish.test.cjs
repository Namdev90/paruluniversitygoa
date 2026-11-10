const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const assets=path.join(__dirname,'../app/assets');
const html=fs.readFileSync(path.join(assets,'index.html'),'utf8');

function page(){
 const dom=new JSDOM(html,{url:'https://fixture.invalid',runScripts:'outside-only'});
 const {document}=dom.window;
 for(const link of document.querySelectorAll('link[rel=stylesheet]')){
  const style=document.createElement('style');
  style.textContent=fs.readFileSync(path.join(assets,link.getAttribute('href')),'utf8');
  link.replaceWith(style);
 }
 return dom;
}

test('Account target keeps a non-shrinking 44px minimum after all shared styles',()=>{
 const dom=page();try{
  const {document,getComputedStyle}=dom.window;
  const account=document.getElementById('account'),style=getComputedStyle(account);
  assert.equal(account.getAttribute('aria-label'),'Your account');
  assert.equal(style.minWidth,'44px');assert.equal(style.minHeight,'44px');
  assert.equal(style.width,'44px');assert.equal(style.height,'44px');
  assert.equal(style.flexShrink,'0');
  assert.equal(style.fontSize,'12px');
  // jsdom does not lay out viewports. Also check every size-specific avatar
  // rule is followed by the unconditional target rule in stylesheet order.
  const rules=[...document.styleSheets].flatMap(sheet=>[...sheet.cssRules]);
  const target=rules.findLastIndex(rule=>rule.selectorText==='.top-actions .avatar');
  assert.ok(target>=0);
  for(let i=0;i<rules.length;i++){
   if(rules[i].media && /\.avatar\b/.test(rules[i].cssText))assert.ok(i<target);
  }
 }finally{dom.window.close()}
});

test('checkbox rows enlarge the label hit area without changing the checkbox or submit behavior',()=>{
 const dom=page();try{
  const w=dom.window;
  let submissions=0;w.document.addEventListener('submit',event=>{event.preventDefault();submissions++});
  for(const id of ['staff-active','desk-confirm-existing']){
   const input=w.document.getElementById(id),label=input.closest('label'),style=w.getComputedStyle(label);
   assert.equal(label.control,input);assert.equal(style.minHeight,'44px');
   assert.equal(style.paddingBlock,'10px');
   assert.equal(w.getComputedStyle(input).width,'20px');
   assert.equal(input.checked,false);
   label.click();assert.equal(input.checked,true);
   label.click();assert.equal(input.checked,false);
   input.disabled=true;label.click();assert.equal(input.checked,false);
  }
  assert.equal(submissions,0);
 }finally{dom.window.close()}
});

test('changing operational digits retain tabular styling alongside existing dashboard metrics',()=>{
 const dom=page();try{
  const w=dom.window;
  for(const id of ['cache-count','pending-count','desk-quantity','desk-bill','home-total','stat-total']){
   const element=w.document.getElementById(id);
   for(const value of ['1','8','10','1000']){
    if(element.tagName==='INPUT')element.value=value;else element.textContent=value;
    assert.equal(w.getComputedStyle(element).fontVariantNumeric,'tabular-nums',id);
   }
  }
 }finally{dom.window.close()}
});
