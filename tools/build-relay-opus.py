#!/usr/bin/env python3
"""Build the pinned encoder with an already authorized NDK. Never install or accept terms."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
from relay_opus_artifact import ABIS, inspect_elf

ROOT=Path(__file__).resolve().parents[1]
CPP=ROOT/'native-app/src/main/cpp'

def run(command,cwd,log,env=None):
    log.write(json.dumps([str(x) for x in command])+'\n');log.flush()
    subprocess.run([str(x) for x in command],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ndk',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--abis',default=','.join(ABIS))
    args=parser.parse_args()
    args.ndk=args.ndk.resolve()
    selected=args.abis.split(',')
    if not selected or len(set(selected))!=len(selected) or any(x not in ABIS for x in selected):
        parser.error('Choose distinct supported Android ABIs: '+','.join(ABIS))
    provenance=json.loads((ROOT/'third_party/opus/SOURCE.json').read_text())
    properties=args.ndk/'source.properties'
    if not properties.is_file() or not any(line.strip()=='Pkg.Revision = '+provenance['ndk'] for line in properties.read_text().splitlines()):
        parser.error('Preinstalled, authorized official NDK '+provenance['ndk']+' is required. This script does not install it or accept licenses.')
    tools=args.ndk/'toolchains/llvm/prebuilt/linux-x86_64/bin'
    for executable in ['llvm-ar','llvm-ranlib','llvm-strip','llvm-readelf',*[ABIS[x][0]+'24-clang' for x in selected]]:
        if not (tools/executable).is_file():parser.error('Missing NDK tool: '+executable)
    archive=ROOT/'third_party/opus/opus-1.6.1.tar.gz'
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=provenance['sha256']:parser.error('Pinned libopus source checksum mismatch.')
    output=args.output.resolve();output.mkdir(parents=True,exist_ok=True)
    work=output.parent/'relay-opus-build'
    if work.exists():shutil.rmtree(work)
    work.mkdir()
    source=work/'opus-1.6.1'
    with tarfile.open(archive) as bundle:bundle.extractall(work,filter='data')
    receipts=[]
    for abi in selected:
        target,host=ABIS[abi][:2];build=work/abi;build.mkdir(exist_ok=True)
        dest=output/abi;dest.mkdir(exist_ok=True)
        compiler=tools/(target+'24-clang')
        env=dict(os.environ,CC=str(compiler),AR=str(tools/'llvm-ar'),RANLIB=str(tools/'llvm-ranlib'),
                 CFLAGS='-Os -fPIC -ffunction-sections -fdata-sections -fvisibility=hidden')
        with (build/'build.log').open('w') as log:
            run([source/'configure','--host='+host,'--disable-shared','--enable-static','--with-pic',
                 '--disable-doc','--disable-extra-programs','--disable-intrinsics','--disable-asm',
                 '--disable-dred','--disable-deep-plc','--disable-osce'],build,log,env)
            run(['make','-j2'],build,log,env)
            library=dest/'libnavrang_opus.so'
            run([compiler,'-Os','-fPIC','-fvisibility=hidden','-ffunction-sections','-fdata-sections',
                 '-I'+str(source/'include'),'-I'+str(CPP),CPP/'encoder_core.c',CPP/'relay_opus_jni.c',
                 build/'.libs/libopus.a','-shared','-Wl,--gc-sections','-Wl,--exclude-libs,ALL',
                 '-Wl,--version-script='+str(CPP/'relay_opus.exports'),'-Wl,-z,max-page-size=16384',
                 '-Wl,-z,common-page-size=16384','-lm','-o',library],build,log,env)
            run([tools/'llvm-strip','--strip-unneeded',library],build,log,env)
        inspection=subprocess.check_output([str(tools/'llvm-readelf'),'-h','-d','-l',str(library)],text=True)
        (build/'elf-inspection.txt').write_text(inspection)
        verified=inspect_elf(library.read_bytes(),abi)
        receipts.append({'abi':abi,'api':24,'bytes':library.stat().st_size,'sha256':hashlib.sha256(library.read_bytes()).hexdigest(),
                         'compiler':str(compiler),'inspection':str(build/'elf-inspection.txt'),**verified})
    (work/'receipt.json').write_text(json.dumps({'opus':provenance,'ndk':str(args.ndk),'outputs':receipts},indent=2)+'\n')

if __name__=='__main__':main()
