#!/usr/bin/env python3
"""Build the established Android app with its original signing identity."""
import os,pathlib,shutil,subprocess,zipfile,json,runpy
from release_policy import require_signing_key
ROOT=pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
RELEASE=json.loads((ROOT/'release.json').read_text())
key=ROOT/'signing'/'prototype-debug.p12'
require_signing_key(key)
BUILD=ROOT/'.build'
SDK=pathlib.Path(os.environ.get('NAVRANG_ANDROID_SDK',str(BUILD/'tools')))
TOOLS=pathlib.Path(os.environ.get('NAVRANG_BUILD_TOOLS',str(SDK/'android-15')))
PLATFORM=pathlib.Path(os.environ.get('NAVRANG_ANDROID_JAR',str(SDK/'android-35'/'android.jar')))
ZXING=pathlib.Path(os.environ.get('NAVRANG_ZXING_JAR',str(SDK/'core-3.5.3.jar')))
def run(*args):
 subprocess.run([str(a) for a in args],check=True)
for d in ['classes','dex']:
 p=BUILD/d
 if p.exists():shutil.rmtree(p)
 p.mkdir(parents=True)
(ROOT/'dist').mkdir(exist_ok=True)
run('java','--module','jdk.compiler/com.sun.tools.javac.Main','-source','8','-target','8','-bootclasspath',str(PLATFORM)+os.pathsep+str(TOOLS/'core-lambda-stubs.jar'),'-classpath',ZXING,'-d',BUILD/'classes',*sorted((ROOT/'app/java').rglob('*.java')))
with zipfile.ZipFile(BUILD/'classes.jar','w',zipfile.ZIP_DEFLATED) as z:
 for p in (BUILD/'classes').rglob('*.class'):z.write(p,p.relative_to(BUILD/'classes'))
run(TOOLS/'d8','--release','--lib',PLATFORM,'--min-api','24','--output',BUILD/'dex',BUILD/'classes.jar',ZXING)
run(TOOLS/'aapt2','compile','--dir',ROOT/'app/res','-o',BUILD/'resources.zip')
assets=BUILD/'assets'
if assets.exists():shutil.rmtree(assets)
assets.mkdir()
for name in ['index.html','style.css','core.js','live-core.js','config.js','gate-config.json','client.js','desk-core.js','desk.js','gate.js','local-schema.sql']:
 shutil.copy2(ROOT/'app/assets'/name,assets/name)
shutil.copytree(ROOT/'app/assets/art',assets/'art')
shutil.copytree(ROOT/'app/assets/audio',assets/'audio')
run(TOOLS/'aapt2','link','-o',BUILD/'unsigned.apk','--manifest',ROOT/'app/AndroidManifest.xml','-I',PLATFORM,'-A',assets,'--min-sdk-version','24','--target-sdk-version','35','--version-code',RELEASE['versionCode'],'--version-name',RELEASE['versionName'],BUILD/'resources.zip')
with zipfile.ZipFile(BUILD/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
 for p in (BUILD/'dex').glob('*.dex'):z.write(p,p.name)
run(TOOLS/'zipalign','-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
apk=ROOT/'dist'/('Navrang-Gate-'+RELEASE['versionName']+'.apk')
run(TOOLS/'apksigner','sign','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','androiddebugkey','--v4-signing-enabled','false','--out',apk,BUILD/'aligned.apk')
run(TOOLS/'apksigner','verify','--verbose','--print-certs',apk)
run(TOOLS/'aapt2','dump','badging',apk)
print('APK:',apk,'bytes:',apk.stat().st_size)

runpy.run_path(str(ROOT/'tools/prepare-release.py'),run_name='__main__')
