#!/usr/bin/env python3
"""Offline ABI metadata drafts and public-proof verification. No signing/publication."""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path

from release_policy import PACKAGE, SIGNER_SHA256, verify_apk

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/'
ABIS = ('arm64-v8a', 'armeabi-v7a', 'x86_64', 'x86')
MAX_APK = 25 * 1024 * 1024  # Old installed updaters enforce this too.
MAX_METADATA = 32768


def validate_core(meta, abi=None):
    name, code, size = meta.get('versionName'), meta.get('versionCode'), meta.get('size')
    if (meta.get('packageName') != PACKAGE or type(code) is not int or not 1 <= code <= 2147483647
            or not isinstance(name, str) or not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', name)
            or type(size) is not int or not 100000 <= size <= MAX_APK
            or not isinstance(meta.get('sha256'), str) or not re.fullmatch(r'[a-f0-9]{64}', meta['sha256'])
            or (abi is not None and abi not in ABIS)):
        raise ValueError('Invalid update core metadata.')
    expected = BASE + f'Navrang-Gate-{name}' + (f'-{abi}' if abi else '') + '.apk'
    if meta.get('apkUrl') != expected:
        raise ValueError('Artifact URL does not match its ABI/release.')
    return meta


def entries(channel):
    validate_core(channel)
    yield None, channel
    artifacts = channel.get('artifacts', {})
    if not isinstance(artifacts, dict) or any(abi not in ABIS for abi in artifacts):
        raise ValueError('Unsupported artifact map.')
    for abi, meta in artifacts.items():
        if not isinstance(meta, dict):
            raise ValueError('Invalid artifact metadata.')
        validate_core(meta, abi)
        if any(meta[key] != channel[key] for key in ('packageName', 'versionCode', 'versionName')):
            raise ValueError('Artifacts must share the channel release.')
        yield abi, meta


def manifest_bytes(meta):
    """Existing v1 payload; its signed URL binds the ABI, keeping old proofs compatible."""
    return ('navrang-release-v1\n' + '\n'.join(str(meta[key]) for key in
            ('packageName', 'versionCode', 'versionName', 'apkUrl', 'size', 'sha256')) + '\n').encode('utf-8')


def inspect_apk(apk, abi, release, build_tools):
    digest = verify_apk(apk, release, build_tools)
    badging = subprocess.check_output([str(build_tools / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
    if not re.search(r"^(?:minSdkVersion|sdkVersion):'24'$", badging, re.M):
        raise ValueError('Every artifact must preserve minimum API 24.')
    # Reject Android config splits: each offered APK must install by itself.
    if re.search(r"^package:.*\bsplit='[^']+'", badging, re.M):
        raise ValueError('Config splits cannot be offered as self-contained APKs.')
    with zipfile.ZipFile(apk) as archive:
        libraries = {}
        for name in archive.namelist():
            if re.fullmatch(r'lib/[^/]+/[^/]+\.so', name):
                _, packaged_abi, library = name.split('/')
                libraries.setdefault(library, set()).add(packaged_abi)
        native = set().union(*libraries.values()) if libraries else set()
        if 'AndroidManifest.xml' not in archive.namelist():
            raise ValueError('Expected a self-contained APK.')
    expected = set(ABIS) if abi is None else {abi}
    # Pure Java APKs are ABI-neutral; native APKs must cover exactly their label.
    if native and native != expected:
        raise ValueError(f'Packaged ABIs {sorted(native)} do not match {abi or "universal"}.')
    if any(coverage != expected for coverage in libraries.values()):
        raise ValueError('Every native library must cover every advertised ABI.')
    meta = dict(packageName=PACKAGE, versionCode=release['versionCode'], versionName=release['versionName'],
                apkUrl=BASE + f'Navrang-Gate-{release["versionName"]}' + (f'-{abi}' if abi else '') + '.apk',
                size=apk.stat().st_size, sha256=digest)
    return validate_core(meta, abi)


def draft(release, apks, build_tools):
    """Generate explicitly UNSIGNED local review data from already signed APKs."""
    if 'universal' not in apks or any(label not in ('universal', *ABIS) for label in apks):
        raise ValueError('A compatible universal APK and known ABI labels are required.')
    inspected = {label: inspect_apk(apk, None if label == 'universal' else label, release, build_tools)
                 for label, apk in apks.items()}
    channel = dict(inspected.pop('universal'), notes=release.get('notes', ''))
    if inspected:
        channel['artifacts'] = inspected
    list(entries(channel))
    if len(encode(channel)) > MAX_METADATA:
        raise ValueError('Channel exceeds the installed updater metadata limit.')
    return channel


def encode(channel):
    return (json.dumps(channel, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def verify_channel(channel, certificate, java='java', javac='javac'):
    """Verify externally provided proofs against the original PUBLIC DER certificate."""
    if hashlib.sha256(certificate.read_bytes()).hexdigest() != SIGNER_SHA256:
        raise ValueError('Public certificate is not the original app certificate.')
    values = list(entries(channel))
    if len(encode(channel)) > MAX_METADATA:
        raise ValueError('Channel exceeds the installed updater metadata limit.')
    work = ROOT / '.build'
    work.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='navrang-public-metadata-', dir=work) as temp:
        subprocess.run([javac, '--release', '17', '-d', temp,
                        str(ROOT / 'app/java/in/navrang/gate/UpdatePolicy.java'),
                        str(ROOT / 'tools/VerifyUpdateMetadata.java')], check=True)
        for abi, meta in values:
            subprocess.run([java, '-cp', temp, 'in.navrang.gate.VerifyUpdateMetadata', str(certificate),
                            str(meta['versionCode']), meta['versionName'], meta['apkUrl'], str(meta['size']),
                            meta['sha256'], meta.get('signature', ''), abi or 'universal'], check=True)
    return len(values)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check = commands.add_parser('verify', help='Offline public-certificate verification; no key access')
    check.add_argument('--manifest', type=Path, required=True)
    check.add_argument('--certificate', type=Path, required=True, help='Original public certificate in DER format')
    prepare = commands.add_parser('draft', help='Prepare unsigned review data in a NEW local directory')
    prepare.add_argument('--release', type=Path, required=True)
    prepare.add_argument('--apk', action='append', required=True, metavar='ABI=PATH')
    prepare.add_argument('--build-tools', type=Path, required=True)
    prepare.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'verify':
        raw = args.manifest.read_bytes()
        if len(raw) > MAX_METADATA:
            raise ValueError('Metadata too large.')
        print(f'Verified {verify_channel(json.loads(raw), args.certificate)} signed APK metadata entries.')
        return
    output = args.output_dir.resolve()
    for protected in (ROOT / 'updates', ROOT / 'downloads'):
        if output == protected.resolve() or output.is_relative_to(protected.resolve()):
            raise ValueError('Draft outside updates/downloads; publication is a separate reviewed step.')
    if output.exists():
        raise ValueError('Output directory already exists; never overwrite review/history data.')
    apks = {}
    for spec in args.apk:
        label, filename = spec.split('=', 1)
        if label in apks:
            raise ValueError('Duplicate APK ABI label.')
        apks[label] = Path(filename)
    channel = draft(json.loads(args.release.read_text(encoding='utf-8')), apks, args.build_tools)
    output.mkdir(parents=True)
    (output / 'UNSIGNED-review.json').write_bytes(encode(channel))
    for abi, meta in entries(channel):
        (output / f'{abi or "universal"}.payload').write_bytes(manifest_bytes(meta))
    print('Unsigned review data prepared. Original-key proofs and publication remain pending.')


if __name__ == '__main__':
    main()
