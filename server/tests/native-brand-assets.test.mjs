import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));

test('native branding is generated from the verified official brochure at build time',()=>{
 const generator=path.join(root,'tools/PrepareBrands.java');assert.ok(fs.existsSync(generator));
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'navrang-brand-'));
 try{
  execFileSync('java',[generator,root,out],{stdio:'pipe',timeout:30000});
  for(const relative of ['app/assets/art/app-icon.png','app/res/drawable/app_icon.png']){
   const png=fs.readFileSync(path.join(out,relative));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),512);assert.equal(png.readUInt32BE(20),512);
  }
  const mark=fs.readFileSync(path.join(out,'app/res/drawable/navrang_wordmark.png'));assert.equal(mark.readUInt32BE(16),699);assert.equal(mark.readUInt32BE(20),320);
  assert.ok(fs.readFileSync(path.join(root,'tools/build.py'),'utf8').includes('PrepareBrands.java'));
  assert.ok(fs.readFileSync(path.join(root,'app/AndroidManifest.xml'),'utf8').includes('android:name=".GateBrandingApplication"'));
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('native branding compiles against an installed Android platform when available',t=>{
 const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT;
 const source=path.join(root,'app/java/in/navrang/gate/GateBrandingApplication.java');assert.ok(fs.existsSync(source));
 if(!sdk||!fs.existsSync(path.join(sdk,'platforms'))){t.skip('No Android SDK in this runner; not a signed APK build');return;}
 const platforms=fs.readdirSync(path.join(sdk,'platforms')).filter(p=>fs.existsSync(path.join(sdk,'platforms',p,'android.jar'))).sort();
 const platform=platforms.includes('android-35')?'android-35':platforms.at(-1);if(!platform){t.skip('No installed Android platform');return;}
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'navrang-native-brand-'));
 try{execFileSync('javac',['-source','8','-target','8','-classpath',path.join(sdk,'platforms',platform,'android.jar'),'-d',out,source],{stdio:'pipe',timeout:30000});assert.ok(fs.existsSync(path.join(out,'in/navrang/gate/GateBrandingApplication.class')));}finally{fs.rmSync(out,{recursive:true,force:true});}
});
