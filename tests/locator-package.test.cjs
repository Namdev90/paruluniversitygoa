const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
test('browser export includes the actual consent/locator scripts referenced by its page',()=>{
 const base=fs.realpathSync(os.tmpdir()),target=fs.mkdtempSync(path.join(base,'navrang-locator-export-'));
 try{
  execFileSync('python3',['tools/package-web.py',target],{cwd:path.resolve(__dirname,'..'),stdio:'pipe'});
  const page=fs.readFileSync(path.join(target,'index.html'),'utf8');
  for(const name of ['locator.js','locator.css']){
   assert.ok(page.includes('"'+name+'"'),'Page must reference '+name);
   assert.ok(fs.existsSync(path.join(target,name)),name+' must be shipped, not merely referenced');
  }
 }finally{
  const absolute=path.resolve(target);assert.ok(absolute.startsWith(base+path.sep));
  fs.rmSync(absolute,{recursive:true,force:true});
 }
});
