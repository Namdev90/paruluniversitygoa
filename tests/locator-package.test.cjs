const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('browser export excludes deferred location, voice, and event notifications',()=>{
 const base=fs.realpathSync(os.tmpdir()),target=fs.mkdtempSync(path.join(base,'navrang-locator-export-'));
 try{
  execFileSync('python3',['tools/package-web.py',target],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  const page=fs.readFileSync(path.join(target,'index.html'),'utf8');
  for(const name of ['locator.js','locator.css','voice.js','notifications.js','notifications.css']){
   assert.equal(page.includes('"'+name+'"'),false,name+' must not be referenced');
   assert.equal(fs.existsSync(path.join(target,name)),false,name+' must not be shipped');
  }
  assert.match(page,/<script defer src="client\.js"><\/script>/);
 }finally{
  const absolute=path.resolve(target);assert.ok(absolute.startsWith(base+path.sep));
  fs.rmSync(absolute,{recursive:true,force:true});
 }
});
