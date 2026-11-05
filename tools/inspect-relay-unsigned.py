#!/usr/bin/env python3
"""Verify a relay-only diagnostic APK; never signs, publishes or waives release policy."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile
from relay_opus_artifact import ABIS, inspect_elf

ROOT=Path(__file__).resolve().parents[1]
RELAY_CLASSES=['GateRelayAuthority','NativeRelayOwnerRuntime','NativeRelayClockProbe','RelayMediaOwner','NativeRelayRuntime','NativeRelaySocket','NativeRelayAudio','RelayV1Driver',
               'WebSocketAudioRelayTransport','RelayClock','BundledRelayEncoder']

def require(value,message):
    if not value:raise SystemExit(message)

def inspect_encoders(archive,abi,required):
    """Check packaged bytes, including all four encoders in a universal APK."""
    names=archive.namelist()
    expected=set(ABIS) if abi=='universal' else {abi}
    libraries=[name for name in names if name.startswith('lib/') and name.endswith('.so')]
    require(all(re.fullmatch(r'lib/[^/]+/[^/]+\.so',name) for name in libraries),
            'Unexpected native library path.')
    require(libraries and {name.split('/')[1] for name in libraries}==expected,
            'Packaged native ABIs differ from the selected split/universal profile.')
    require(len(names)==len(set(names)),'Duplicate ZIP entries are forbidden.')
    encoders={}
    for target in sorted(expected):
        path=f'lib/{target}/libnavrang_opus.so'
        require(not required or path in names,'Bundled encoder is required but missing for '+target+'.')
        if path not in names:continue
        require('assets/third-party-notices/opus-1.6.1-COPYING.txt' in names,'Bundled encoder license notice is missing.')
        data=archive.read(path);info=archive.getinfo(path)
        try:verified=inspect_elf(data,target)
        except (ValueError,UnicodeError) as error:raise SystemExit(str(error)) from error
        encoders[target]={'bytes':info.file_size,'zipBytes':info.compress_size,'compression':info.compress_type,
                          'sha256':hashlib.sha256(data).hexdigest(),**verified}
    return libraries,encoders

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk',type=Path)
    parser.add_argument('--build-tools',required=True,type=Path)
    parser.add_argument('--abi',default='arm64-v8a',choices=[*ABIS,'universal'])
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--require-bundled-opus',action='store_true')
    args=parser.parse_args()
    require(args.apk.is_file() and 0<args.apk.stat().st_size<=25*1024*1024,'APK exceeds unchanged updater limit or is missing.')
    release=json.loads((ROOT/'release.json').read_text())
    badging=subprocess.check_output([str(args.build_tools/'aapt2'),'dump','badging',str(args.apk)],text=True)
    package=re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'",badging,re.M)
    require(package and package.groups()==('in.navrang.gate',str(release['versionCode']),release['versionName']),'Package or retained diagnostic version differs.')
    require(re.search(r"^(?:minSdkVersion|sdkVersion):'24'$",badging,re.M),'Minimum API must remain24.')
    require(re.search(r"^targetSdkVersion:'37'$",badging,re.M),'Target API must remain37.')
    signature=subprocess.run([str(args.build_tools/'apksigner'),'verify',str(args.apk)],capture_output=True,text=True)
    require(signature.returncode!=0,'Diagnostic APK must be unsigned.')
    with zipfile.ZipFile(args.apk) as archive:
        require(archive.testzip() is None,'APK ZIP integrity failure.')
        names=archive.namelist()
        libs,encoders=inspect_encoders(archive,args.abi,args.require_bundled_opus)
        require(not any(re.search(r'META-INF/[^/]+\.(RSA|DSA|EC|SF)$',x,re.I) for x in names),'APK has JAR signing metadata.')
        with args.apk.open('rb') as stream:
            stream.seek(max(0,archive.start_dir-16));require(stream.read(16)!=b'APK Sig Block 42','APK has signing block.')
        require(not any(re.search(r'daily|webrtc',x,re.I) for x in libs),'Rejected Daily native SDK is packaged.')
        require(not any(re.search(r'(?:^|/)(?:android-ndk[^/]*|toolchains|clang|llvm-ar)(?:/|$)',x) for x in names),'Build toolchain must never enter the APK.')
        dex=[archive.read(x) for x in names if re.fullmatch(r'classes\d*\.dex',x)]
        require(dex and not any(b'Lco/daily/' in x for x in dex),'Rejected Daily classes are packaged.')
        for name in RELAY_CLASSES:
            require(any(('Lin/navrang/gate/'+name+';').encode() in x for x in dex),'Required relay class missing: '+name)
    result={'purpose':'RELAY_ONLY_UNSIGNED_DIAGNOSTIC','publishable':False,'signed':False,
        'package':'in.navrang.gate','versionName':release['versionName'],'versionCode':release['versionCode'],
        'minSdk':24,'targetSdk':37,'abi':args.abi,'bytes':args.apk.stat().st_size,
        'sha256':hashlib.sha256(args.apk.read_bytes()).hexdigest(),'updaterLimit':26214400,
        'dailySdkIncluded':False,'relayClassesVerified':RELAY_CLASSES,'nativeLibraries':libs,
        'bundledEncoder':encoders.get(args.abi),'bundledEncoders':encoders,
        'liveProviderAcceptance':'NOT_RUN','originalKeyRequired':True}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))

if __name__=='__main__':main()
