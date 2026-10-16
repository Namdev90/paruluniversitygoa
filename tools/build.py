#!/usr/bin/env python3
"""Build the offline prototype with a locally supplied Android SDK and JDK 17+."""
import os,pathlib,shutil,subprocess,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
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
run(TOOLS/'aapt2','link','-o',BUILD/'unsigned.apk','--manifest',ROOT/'app/AndroidManifest.xml','-I',PLATFORM,'-A',ROOT/'app/assets','--min-sdk-version','24','--target-sdk-version','35','--version-code','2','--version-name','0.2.0',BUILD/'resources.zip')
with zipfile.ZipFile(BUILD/'unsigned.apk','a',zipfile.ZIP_DEFLATED) as z:
 for p in (BUILD/'dex').glob('*.dex'):z.write(p,p.name)
run(TOOLS/'zipalign','-f','4',BUILD/'unsigned.apk',BUILD/'aligned.apk')
key=ROOT/'signing'/'prototype-debug.p12';key.parent.mkdir(exist_ok=True)
if not key.exists():
 run('keytool','-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass','android','-keypass','android','-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=Navrang Prototype, O=Prototype, C=IN')
apk=ROOT/'dist'/'Navrang-Gate-0.2.0.apk'
run(TOOLS/'apksigner','sign','--ks',key,'--ks-pass','pass:android','--key-pass','pass:android','--ks-key-alias','androiddebugkey','--v4-signing-enabled','false','--out',apk,BUILD/'aligned.apk')
run(TOOLS/'apksigner','verify','--verbose','--print-certs',apk)
run(TOOLS/'aapt2','dump','badging',apk)
print('APK:',apk,'bytes:',apk.stat().st_size)
