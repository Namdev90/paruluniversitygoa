#!/usr/bin/env python3
"""Stage externally signed release artifacts for local review. Never signs or publishes."""
import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import abi_release_metadata as metadata
from release_policy import check_publication


def stage(certificate, channel_file, apk_paths, output_name, *, root=ROOT, verify=None, build_tools=None):
    root = Path(root).resolve()
    if (not isinstance(output_name, str) or output_name in ('', '.', '..')
            or Path(output_name).name != output_name or '/' in output_name or '\\' in output_name):
        raise ValueError('Output name must be a single new directory name.')
    certificate, channel_file = Path(certificate), Path(channel_file)
    if certificate.suffix.lower() not in ('.der', '.cer') or not certificate.is_file():
        raise ValueError('Provide the original public DER certificate as a .der or .cer file.')
    channel_source = channel_file.open('rb')
    try:
        raw_channel = channel_source.read(metadata.MAX_METADATA + 1)
    finally:
        channel_source.close()
    if len(raw_channel) > metadata.MAX_METADATA:
        raise ValueError('Signed channel metadata exceeds the installed limit.')
    channel = json.loads(raw_channel.decode('utf-8'))
    staged_channel = metadata.encode(channel)
    pairs = list(metadata.entries(channel))
    expected = {abi for abi, _ in pairs}
    if None not in expected:
        raise ValueError('A universal legacy APK entry is mandatory.')
    supplied = set(apk_paths)
    labels = {'universal' if abi is None else abi for abi in expected}
    if supplied != labels:
        raise ValueError('APK paths must exactly match every signed metadata entry.')
    release = json.loads((root / 'release.json').read_text(encoding='utf-8'))
    if any(channel.get(k) != release.get(k) for k in ('versionName', 'versionCode')):
        raise ValueError('Signed channel version does not match current release.json.')
    latest_path = root / 'updates/latest.json'
    latest = json.loads(latest_path.read_text(encoding='utf-8')) if latest_path.is_file() else None
    if latest and channel['versionCode'] < latest.get('versionCode', 0):
        raise ValueError('Signed channel is older than the current update channel.')
    if latest and channel['versionCode'] == latest.get('versionCode') and channel != latest:
        raise ValueError('Current version code already has different channel metadata.')
    downloads = root / 'downloads'
    checked = []
    for abi, entry in pairs:
        label = 'universal' if abi is None else abi
        apk = Path(apk_paths[label]).resolve(strict=True)
        actual = metadata.inspect_apk(apk, abi, release, build_tools or root / 'build-tools')
        if any(actual[k] != entry[k] for k in ('packageName', 'versionCode', 'versionName', 'size', 'sha256', 'apkUrl')):
            raise ValueError(f'APK bytes do not match signed metadata entry: {label}.')
        filename = Path(entry['apkUrl']).name
        check_publication(release, apk, downloads / filename, latest if label == 'universal' else None)
        checked.append((label, apk, filename))
    (verify or metadata.verify_channel)(channel, certificate)
    staging_lexical = root / '.build/release-staging'
    staging_root = staging_lexical.resolve()
    protected = [(root / 'downloads').resolve(), (root / 'updates').resolve()]
    if (not staging_root.is_relative_to(root)
            or any(staging_root == path or staging_root.is_relative_to(path) for path in protected)):
        raise ValueError('Release staging path escapes the repository or aliases protected release paths.')
    output = staging_root / output_name
    if output.exists() or output.is_symlink():
        raise ValueError('Output must be a new directory name inside .build/release-staging.')
    if not output.resolve().is_relative_to(staging_root):
        raise ValueError('Output path escapes the release staging directory.')
    staging_root.mkdir(parents=True, exist_ok=True)
    # All proof and byte checks precede the first output mutation.
    output.mkdir()
    try:
        bundle = output / 'bundle'
        (bundle / 'downloads').mkdir(parents=True)
        (bundle / 'updates').mkdir()
        for label, apk, filename in checked:
            destination = bundle / 'downloads' / filename
            shutil.copyfile(apk, destination)
            entry = next(meta for abi, meta in pairs if ('universal' if abi is None else abi) == label)
            copied = destination.read_bytes()
            if len(copied) != entry['size'] or hashlib.sha256(copied).hexdigest() != entry['sha256']:
                raise ValueError(f'Copied APK bytes changed after verification: {label}.')
        (bundle / 'updates/latest.json').write_bytes(staged_channel)
        hashes = []
        for path in sorted(p for p in bundle.rglob('*') if p.is_file()):
            hashes.append(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.relative_to(bundle).as_posix()}')
        (output / 'NEW-SHA256SUMS.txt').write_text('\n'.join(hashes) + '\n', encoding='utf-8')
        (output / 'REVIEW-RECEIPT.txt').write_text(
            'Local public-only staging bundle. Not published.\n'
            'Source freeze and physical release gates are pending.\n', encoding='utf-8')
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--certificate', type=Path, required=True)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--apk', action='append', required=True, metavar='LABEL=PATH')
    parser.add_argument('--output-name', required=True)
    parser.add_argument('--build-tools', type=Path, required=True)
    args = parser.parse_args()
    apks = {}
    for spec in args.apk:
        label, path = spec.split('=', 1)
        if label in apks: raise ValueError('Duplicate APK label.')
        apks[label] = Path(path)
    print(stage(args.certificate, args.metadata, apks, args.output_name, build_tools=args.build_tools))


if __name__ == '__main__': main()
