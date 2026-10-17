const {test}=require('node:test');
const {execFileSync}=require('node:child_process');
test('release channel rejects missing/replaced signers, wrong APKs and overwritten versions',()=>{
  execFileSync('python3',['tests/release-check.py'],{cwd:require('node:path').join(__dirname,'..'),stdio:'pipe',timeout:10000});
});
