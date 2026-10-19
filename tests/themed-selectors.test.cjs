const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = () => fs.readFileSync('app/assets/themed-selectors.js', 'utf8');
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
async function setup(markup = '<form><label for="kind">Choose dataset</label><select id="kind"><option value="all">Complete master</option><option value="attended">All attendees</option><option value="blocked" disabled>Blocked</option></select></form>') {
 const dom = new JSDOM(markup, {runScripts:'outside-only', pretendToBeVisual:true});
 const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
 w.HTMLElement.prototype.scrollIntoView=function(){};
 w.eval(source()); await turn();
 return {dom,w,d:w.document,select:w.document.querySelector('select'),trigger:w.document.querySelector('.navrang-select-trigger')};
}
test('single selector uses a branded modal while preserving its canonical form value', async()=>{
 const {dom,w,d,select,trigger}=await setup();try {
 assert.equal(trigger.textContent.includes('Complete master'),true);
 let changes=0;select.addEventListener('change',()=>changes++);
 trigger.click();assert.equal(d.querySelector('#navrang-select-dialog').open,true);
 assert.equal(d.querySelector('#navrang-select-title').textContent,'Choose dataset');
 d.querySelector('[data-option-index="1"]').click();
 assert.equal(select.value,'attended');assert.equal(changes,1);
 assert.equal(new w.FormData(d.querySelector('form')).get('unused'),null);
 assert.equal(d.querySelector('#navrang-select-dialog').open,false);
 assert.ok(trigger.textContent.includes('All attendees'));assert.equal(d.activeElement,trigger);
 }finally{dom.window.close()}
});
test('cancel and disabled choices cannot change selection; programmatic writes refresh the trigger',async()=>{
 const {dom,d,select,trigger}=await setup();try {
 select.value='attended';assert.ok(trigger.textContent.includes('All attendees'));
 trigger.click();assert.equal(d.querySelector('[data-option-index="2"]').disabled,true);
 d.querySelector('[data-option-index="2"]').click();assert.equal(select.value,'attended');
 d.querySelector('#navrang-select-cancel').click();assert.equal(select.value,'attended');
 select.selectedIndex=0;assert.ok(trigger.textContent.includes('Complete master'));
 select.disabled=true;await turn();assert.equal(trigger.disabled,true);
 }finally{dom.window.close()}
});
test('dynamically inserted selectors are upgraded once and follow option changes',async()=>{
 const {dom,w,d}=await setup();try {
 d.body.insertAdjacentHTML('beforeend','<select id="later" aria-label="Export format"><option>CSV</option></select>');await turn();
 const s=d.querySelector('#later');assert.ok(s.nextElementSibling.classList.contains('navrang-select-trigger'));
 const option=d.createElement('option');option.value='xlsx';option.textContent='Excel';s.append(option);s.value='xlsx';await turn();
 assert.ok(s.nextElementSibling.textContent.includes('Excel'));
 assert.equal(d.querySelectorAll('.navrang-select-trigger').length,2);
 s.dispatchEvent(new w.Event('change',{bubbles:true}));await turn();assert.equal(d.querySelectorAll('.navrang-select-trigger').length,2);
 }finally{dom.window.close()}
});
test('keyboard navigation skips disabled choices and commits only on explicit activation',async()=>{
 const {dom,w,d,select,trigger}=await setup();try {
 trigger.click();const first=d.querySelector('[data-option-index="0"]');first.focus();
 first.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));
 assert.equal(d.activeElement.dataset.optionIndex,'1');assert.equal(select.value,'all');
 d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 assert.equal(select.value,'attended');assert.equal(d.querySelector('#navrang-select-dialog').open,false);
 }finally{dom.window.close()}
});
test('closing an owning dialog or hiding its view clears the selector overlay',async()=>{
 const {dom,d,trigger}=await setup('<section><select aria-label="Staff role"><option>Checker</option><option>Help Desk</option></select></section>');try {
 trigger.click();d.querySelector('section').hidden=true;await turn();assert.equal(d.querySelector('#navrang-select-dialog').open,false);
 assert.equal(trigger.getAttribute('aria-expanded'),'false');assert.equal(d.querySelectorAll('[data-option-index]').length,0);
 }finally{dom.window.close()}
});
test('all original dropdowns have a browser-exported shared skin and topmost back handling',()=>{
 const html=fs.readFileSync('app/assets/index.html','utf8');
 assert.match(html,/src="themed-selectors\.js"/);assert.match(html,/href="art\/themed-selectors\.css"/);
 assert.match(fs.readFileSync('tools/package-web.py','utf8'),/'themed-selectors.js'/);
 assert.match(fs.readFileSync('app/assets/gate.js','utf8'),/NavrangMenus\?\.closeTop/);
});
test('option changes close an open picker instead of committing a stale choice',async()=>{
 const {dom,d,select,trigger}=await setup();try {
 trigger.click();const old=d.querySelector('[data-option-index="1"]');
 select.options[1].remove();await turn();
 assert.equal(d.querySelector('#navrang-select-dialog').open,false);
 old.click();assert.equal(select.value,'all');
 }finally{dom.window.close()}
});
test('hiding the original select also hides its trigger',async()=>{
 const {dom,select,trigger}=await setup();try {
 select.hidden=true;await turn();assert.equal(trigger.hidden,true);
 select.hidden=false;await turn();assert.equal(trigger.hidden,false);
 }finally{dom.window.close()}
});
