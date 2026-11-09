"""Compile/test the pinned Opus encoder core on the host; no install or network."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
for tool in ('cc', 'make'):
    if not shutil.which(tool):
        raise SystemExit('Existing host tool required: ' + tool + '. No tools will be installed.')
provenance = json.loads((ROOT / 'third_party/opus/SOURCE.json').read_text())
archive = ROOT / 'third_party/opus/opus-1.6.1.tar.gz'
if hashlib.sha256(archive.read_bytes()).hexdigest() != provenance['sha256']:
    raise SystemExit('Pinned libopus source checksum mismatch.')
(ROOT / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='relay-opus-core-', dir=ROOT / '.build') as folder:
    work = Path(folder)
    with tarfile.open(archive) as bundle:
        bundle.extractall(work, filter='data')
    source = work / 'opus-1.6.1'
    build = work / 'build'
    build.mkdir()
    with (build / 'build.log').open('w+') as log:
        try:
            subprocess.run([source / 'configure', '--disable-shared', '--enable-static', '--with-pic',
                            '--disable-doc', '--disable-extra-programs', '--disable-intrinsics',
                            '--disable-asm', '--disable-dred', '--disable-deep-plc', '--disable-osce',
                            'CFLAGS=-Os -fPIC'], cwd=build, stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run(['make', '-j2'], cwd=build, stdout=log, stderr=subprocess.STDOUT, check=True)
            executable = build / 'encoder-core-test'
            subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Os',
                            '-I' + str(ROOT / 'native-app/src/main/cpp'), '-I' + str(source / 'include'),
                            ROOT / 'tests/relay-opus/encoder_core_host_test.c',
                            ROOT / 'native-app/src/main/cpp/encoder_core.c', build / '.libs/libopus.a',
                            '-lm', '-o', executable], stdout=log, stderr=subprocess.STDOUT, check=True)
            subprocess.run([executable], check=True)
        except subprocess.CalledProcessError:
            log.flush()
            log.seek(0)
            print(log.read())
            raise
print('PASS host core only. JNI, Android ABI builds, APK assembly and physical-device acceptance are separate gates.')
