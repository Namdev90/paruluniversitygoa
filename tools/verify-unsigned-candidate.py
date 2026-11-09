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


DEFERRED_ASSETS = {'notifications.js', 'notifications.css', 'voice.js', 'locator.js', 'locator.css'}


def validate_version(release, latest, source_check=False):
    if source_check:
        require(release['versionCode'] >= latest['versionCode'], 'Source QA cannot roll back the Android version code.')
        if release['versionCode'] == latest['versionCode']:
            require(release['versionName'] == latest['versionName'], 'Published version code has a different version name.')
    else:
        require(release['versionCode'] > latest['versionCode'], 'Candidate must have a new Android version code.')


def validate_assets(names):
    require(not ({'assets/' + name for name in DEFERRED_ASSETS} & names),
            'Deferred communications assets must stay excluded from the release package.')
    require({'assets/index.html', 'assets/core.js', 'assets/client.js', 'assets/gate.js',
             'assets/desk.js', 'assets/reports.js'} <= names, 'Required shipping client assets are missing.')


def validate_manifest(badging, manifest):
    for permission in ('RECORD_AUDIO', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'):
        require('android.permission.' + permission not in badging,
                'Deferred permission is present: ' + permission)
    for component in ('NavrangMessagingService', 'PushReconcileJob', 'PushOpenActivity'):
        require(component not in manifest, 'Deferred component is present: ' + component)
    # aapt2 xmltree indents each element's attributes beneath its E: line.
    elements = re.split(r'(?m)^\s*E: ', manifest)
    voices = [element for element in elements if 'VoiceSessionService' in element]
    require(len(voices) == 1 and re.search(
        r'android:enabled\([^)]*\)=(?:false|\(type 0x12\)0x0)\s*$', voices[0], re.M),
        'Dormant voice service must be explicitly disabled.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--build-tools', required=True, type=Path)
    parser.add_argument('--expected-source', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--source-check', action='store_true',
                        help='Inspect source QA at the current version, never authorize a release.')
    args = parser.parse_args()
    require(re.fullmatch(r'[0-9a-f]{40}', args.expected_source), 'An immutable source SHA is required.')
    git = lambda *items: subprocess.check_output(['git', *items], cwd=ROOT, text=True).strip()
    source_tree = git('rev-parse', args.expected_source + '^{tree}')
    require(git('rev-parse', 'HEAD^{tree}') == source_tree, 'CI source tree differs from the frozen candidate.')
    require(not git('status', '--porcelain'), 'Commit and re-verify the source before issuing an immutable candidate receipt.')
    release = json.loads((ROOT / 'release.json').read_text())
    latest = json.loads((ROOT / 'updates/latest.json').read_text())
    validate_version(release, latest, args.source_check)
    require(args.apk.is_file() and 0 < args.apk.stat().st_size <= 25 * 1024 * 1024, 'Missing or oversized candidate.')
    badging = subprocess.check_output([str(args.build_tools / 'aapt2'), 'dump', 'badging', str(args.apk)], text=True)
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    require(package and package.groups() == (PACKAGE, str(release['versionCode']), release['versionName']), 'Unexpected candidate package/version.')
    require(re.search(r"^(?:minSdkVersion|sdkVersion):'24'$", badging, re.M), 'Minimum API must remain 24.')
    require(re.search(r"^targetSdkVersion:'37'$", badging, re.M), 'Unexpected target API.')
    manifest = subprocess.check_output([str(args.build_tools / 'aapt2'), 'dump', 'xmltree',
                                        str(args.apk), '--file', 'AndroidManifest.xml'], text=True)
    validate_manifest(badging, manifest)
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
        validate_assets(names)
        markup = archive.read('assets/index.html').decode('utf-8')
        for asset in re.findall(r'(?:src|href)="([^"]+\.(?:js|css))"', markup):
            require('assets/' + asset in names, 'A referenced client asset is missing: ' + asset)
        hashes = {
            'assets/art/app-icon.png': ORIGINAL_LOGO_SHA256,
            'assets/art/navrang-transparent.png': TRANSPARENT_WORDMARK_SHA256,
            'assets/art/navrang-parul-combined.png': COMBINED_MARK_SHA256,
        }
        launchers = re.findall(r"^application-icon-\d+:'([^']+)'$", badging, re.M)
        require(launchers, 'Cannot resolve the manifest launcher artwork.')
        hashes.update({name: ORIGINAL_LOGO_SHA256 for name in launchers})
        for name, expected in hashes.items():
            require(name in names and hashlib.sha256(archive.read(name)).hexdigest() == expected, 'Artwork bytes changed: ' + name)
    receipt = {
        'sourceCommit': args.expected_source, 'sourceTree': source_tree,
        'workflowCheckout': git('rev-parse', 'HEAD'),
        'packageName': PACKAGE, 'versionName': release['versionName'], 'versionCode': release['versionCode'],
        'minSdk': 24, 'targetSdk': 37, 'size': args.apk.stat().st_size,
        'sha256': hashlib.sha256(args.apk.read_bytes()).hexdigest(),
        'signed': False, 'publishable': False, 'requiredSignerSha256': SIGNER_SHA256,
        'purpose': 'SOURCE_QA_ONLY' if args.source_check else 'UNPUBLISHED_CANDIDATE',
        'pendingGate': 'FRESH_SOURCE_ACCEPTANCE_ORIGINAL_KEY_SIGNING_AND_PUBLIC_DOWNLOAD_VERIFICATION',
        'communications': 'EXCLUDED', 'physicalDeviceChecks': 'NOT_RUN',
        'assetIntegrity': 'PASS',
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(receipt, indent=2) + '\n')
    print('Unsigned release candidate inspected. Not installable as the production update and not published.')


if __name__ == '__main__':
    main()
