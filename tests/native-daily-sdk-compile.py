#!/usr/bin/env python3
"""Compile optional source against an externally supplied, pinned Daily AAR; never run SDK."""
import argparse
import hashlib
from pathlib import Path
import os
import subprocess
import tempfile
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
for name in ('sdk-aar', 'android-jar', 'kotlin-jar', 'lifecycle-jar', 'annotation-jar', 'serialization-jar'):
    parser.add_argument('--' + name, type=Path, required=True)
args = parser.parse_args()
paths = vars(args)
for path in paths.values():
    if not path.is_file():
        parser.error(f'Required classpath artifact missing: {path.name}')
expected = 'bdf35d710bcdc567944904270fd718cf3de4489bee8e01a97fae108444345d1b'
if hashlib.sha256(args.sdk_aar.read_bytes()).hexdigest() != expected:
    parser.error('Daily SDK AAR does not match the verified co.daily:client:0.41.0 SHA-256.')
root = Path(__file__).resolve().parents[1]
(root / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='navrang-daily-sdk-compile-', dir=root / '.build') as temp:
    work = Path(temp)
    sdk_classes = work / 'classes.jar'
    with zipfile.ZipFile(args.sdk_aar) as aar:
        sdk_classes.write_bytes(aar.read('classes.jar'))
    classpath = os.pathsep.join(map(str, [sdk_classes, args.android_jar, args.kotlin_jar,
                                        args.lifecycle_jar, args.annotation_jar, args.serialization_jar]))
    main = root / 'native-app/src/main/java/in/navrang/gate'
    optional = root / 'native-app/src/daily/java/in/navrang/gate'
    source = [main / 'VoiceMediaTransport.java', main / 'VoiceAuthority.java', main / 'DailyNativeCredential.java',
              *sorted(optional.glob('*.java'))]
    subprocess.run(['javac', '--release', '17', '-Xlint:all', '-Werror', '-cp', classpath,
                    '-d', str(work / 'compiled'), *map(str, source)], check=True)
    print('Optional Daily SDK 0.41.0: pinned artifact compile passed with warnings treated as errors; SDK never invoked.')
