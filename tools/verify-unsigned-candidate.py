#!/usr/bin/env python3
"""Inspect a CI release APK without possessing or requesting signing material."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

from release_policy import PACKAGE, SIGNER_SHA256
from restoration_release_gate import ORIGINAL_LOGO_SHA256, TRANSPARENT_WORDMARK_SHA256

ROOT = Path(__file__).resolve().parents[1]
COMBINED_MARK_SHA256 = '8744a792295a49aad9c6ff65fae4f3bf1f6fbb66c766c59acfa4616f179e3397'


def require(value, message):
    if not value:
        raise SystemExit(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--build-tools', required=True, type=Path)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    require(re.fullmatch(r'[0-9a-f]{40}', args.expected_source), 'An immutable source SHA is required.')
    git = lambda *items: subprocess.check_output(['git', *items], cwd=ROOT, text=True).strip()
    source_tree = git('rev-parse', args.expected_source + '^{tree}')
    require(git('rev-parse', 'HEAD^{tree}') == source_tree, 'CI source tree differs from the frozen candidate.')
    release = json.loads((ROOT / 'release.json').read_text())
    latest = json.loads((ROOT / 'updates/latest.json').read_text())
    require(release['versionCode'] > latest['versionCode'], 'Candidate must have a new Android version code.')
    require(args.apk.is_file() and 0 < args.apk.stat().st_size <= 25 * 1024 * 1024, 'Missing or oversized candidate.')
    badging = subprocess.check_output([str(args.build_tools / 'aapt2'), 'dump', 'badging', str(args.apk)], text=True)
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    require(package and package.groups() == (PACKAGE, str(release['versionCode']), release['versionName']), 'Unexpected candidate package/version.')
    require(re.search(r"^(?:minSdkVersion|sdkVersion):'24'$", badging, re.M), 'Minimum API must remain 24.')
    require(re.search(r"^targetSdkVersion:'37'$", badging, re.M), 'Unexpected target API.')
    signature = subprocess.run([str(args.build_tools / 'apksigner'), 'verify', str(args.apk)], capture_output=True)
    require(signature.returncode != 0, 'This CI artifact must be unsigned; signing belongs to the original-key custodian.')
    with zipfile.ZipFile(args.apk) as archive:
        require(archive.testzip() is None, 'Candidate archive checksum failed.')
        names = set(archive.namelist())
        require(not any(name.lower().endswith(('.p12', '.pfx', '.jks', '.keystore', '.pem')) for name in names), 'Signing material must never enter the APK.')
        require(not any(re.match(r'META-INF/[^/]+\.(RSA|DSA|EC|SF)$', name, re.I) for name in names), 'Unexpected JAR signature in the unsigned artifact.')
        with args.apk.open('rb') as apk_stream:
            apk_stream.seek(max(0, archive.start_dir - 16))
            require(apk_stream.read(16) != b'APK Sig Block 42', 'Unexpected APK signing block in the unsigned artifact.')
        require(not {'assets/notifications.js', 'assets/notifications.css'} & names, 'Deferred communications assets are packaged.')
        markup = archive.read('assets/index.html').decode('utf-8')
        for asset in re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', markup):
            require('assets/' + asset in names, 'A referenced client asset is missing: ' + asset)
        if 'assets/remote-artwork.json' in names:
            remote = json.loads(archive.read('assets/remote-artwork.json'))
            expected_images = {'art/navrang-parul-combined.png', 'art/dancer-male.webp', 'art/dancer-female.webp'}
            require(remote.get('schema') == 1 and set(remote.get('images', {})) == expected_images, 'Unexpected remote-artwork scope.')
            for path, item in remote['images'].items():
                revision = item.get('revision', '')
                require(re.fullmatch(r'[0-9a-f]{40}', revision), 'Artwork revision must be immutable.')
                original = (ROOT / 'app/assets' / path).read_bytes()
                pinned = subprocess.check_output(['git', 'show', revision + ':app/assets/' + path], cwd=ROOT)
                require(pinned == original and hashlib.sha256(original).hexdigest() == item.get('sha256')
                        and item.get('size') == len(original) <= 2 * 1024 * 1024,
                        'Remote artwork differs from its pinned source bytes: ' + path)
                require('assets/' + path not in names, 'Optional artwork was unexpectedly bundled: ' + path)
            for obsolete in ['vendor/xlsx.full.min.js', 'vendor/pako_inflate.min.js', 'legacy.html', 'app.js', 'store.js', 'workbook.js', 'local-schema.sql', 'art/event-poster.jpg']:
                require('assets/' + obsolete not in names, 'Unused offline prototype file entered the APK: ' + obsolete)
        hashes = {
            'assets/art/app-icon.png': ORIGINAL_LOGO_SHA256,
            'assets/art/navrang-transparent.png': TRANSPARENT_WORDMARK_SHA256,
            'assets/art/navrang-parul-combined.png': COMBINED_MARK_SHA256,
        }
        launchers = re.findall(r"^application-icon-\d+:'([^']+)'$", badging, re.M)
        require(launchers, 'Cannot resolve the manifest launcher artwork.')
        hashes.update({name: ORIGINAL_LOGO_SHA256 for name in launchers})
        for name, expected in hashes.items():
            if name == 'assets/art/navrang-parul-combined.png' and name not in names:
                remote = json.loads(archive.read('assets/remote-artwork.json'))
                item = remote['images'].get(name.removeprefix('assets/'), {})
                require(remote.get('schema') == 1 and item.get('sha256') == expected
                        and re.fullmatch(r'[0-9a-f]{40}', item.get('revision', ''))
                        and item.get('size') == (ROOT / 'app/assets/art/navrang-parul-combined.png').stat().st_size,
                        'Remote approved artwork is not pinned to the original source bytes.')
            else:
                require(name in names and hashlib.sha256(archive.read(name)).hexdigest() == expected, 'Artwork bytes changed: ' + name)
    receipt = {
        'sourceCommit': args.expected_source, 'sourceTree': source_tree,
        'workflowCheckout': git('rev-parse', 'HEAD'),
        'packageName': PACKAGE, 'versionName': release['versionName'], 'versionCode': release['versionCode'],
        'minSdk': 24, 'targetSdk': 37, 'size': args.apk.stat().st_size,
        'sha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
        'signed': False, 'publishable': False, 'requiredSignerSha256': SIGNER_SHA256,
        'pendingGate': 'ORIGINAL_KEY_SIGNING_AND_PUBLIC_DOWNLOAD_VERIFICATION',
        'communications': 'DEFERRED_BY_OWNER', 'physicalDeviceChecks': 'SKIPPED_BY_OWNER',
        'assetIntegrity': 'PASS',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print('Unsigned release candidate inspected. Not installable as the production update and not published.')


if __name__ == '__main__':
    main()
