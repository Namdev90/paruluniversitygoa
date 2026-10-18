#!/usr/bin/env python3
"""Build/sign the complete native release only after its separate evidence gates.
Never generates a production key; never changes public download metadata.
Use the established prepare-release.py only after independent APK inspection.
"""
import hashlib
import json
import re
import zipfile
import os
from pathlib import Path
import subprocess
from native_release_gate import require_native_ready
from restoration_release_gate import require_restoration_ready, ORIGINAL_LOGO_SHA256, TRANSPARENT_WORDMARK_SHA256
from release_policy import require_signing_key, verify_apk, check_publication, SIGNER_SHA256

ROOT = Path(__file__).resolve().parents[1]


def verify_restored_artwork(archive, badging):
    # AGP may shorten resource filenames. Follow the manifest's actual icon
    # paths from aapt, rather than assuming the source resource path survives.
    launchers = set(re.findall(r"^application-icon-\d+:'([^']+)'$", badging, re.M))
    if not launchers:
        raise SystemExit('Could not resolve the packaged launcher artwork.')
    for logo in {'assets/art/app-icon.png', *launchers}:
        if logo not in archive.namelist() or hashlib.sha256(archive.read(logo)).hexdigest() != ORIGINAL_LOGO_SHA256:
            raise SystemExit('APK does not contain the original Navrang logo in ' + logo)
    mark = 'assets/art/navrang-transparent.png'
    if mark not in archive.namelist() or hashlib.sha256(archive.read(mark)).hexdigest() != TRANSPARENT_WORDMARK_SHA256:
        raise SystemExit('APK does not contain the approved transparent Navrang wordmark.')


def main():
    release = json.loads((ROOT / 'release.json').read_text())
    original = release.get('interface') == 'original'
    (require_restoration_ready if original else require_native_ready)(ROOT)
    latest = json.loads((ROOT / 'updates/latest.json').read_text())
    if release['versionCode'] <= latest['versionCode']:
        raise SystemExit('Select a coordinated unused version with a strictly higher versionCode before release.')
    key = Path(os.environ.get('NAVRANG_SIGNING_KEY', ROOT / 'signing/prototype-debug.p12'))
    require_signing_key(key)
    certificate = subprocess.check_output(['keytool', '-exportcert', '-alias', 'androiddebugkey', '-keystore', str(key), '-storepass', 'android'], stderr=subprocess.PIPE)
    if hashlib.sha256(certificate).hexdigest() != SIGNER_SHA256:
        raise SystemExit('The local key is not the original installed-app signing identity. Refusing to sign.')
    sdk = Path(os.environ['ANDROID_HOME'])
    tools = sdk / 'build-tools/36.0.0'
    run = lambda *args: subprocess.run([str(a) for a in args], cwd=ROOT, check=True)
    run(ROOT / 'gradlew', ':native-app:clean', ':native-app:assembleRelease', ':native-app:testDebugUnitTest', ':native-app:lintRelease')
    unsigned = ROOT / 'native-app/build/outputs/apk/release/native-app-release-unsigned.apk'
    aligned = ROOT / '.build/native-aligned.apk'
    aligned.parent.mkdir(exist_ok=True)
    run(tools / 'zipalign', '-f', '4', unsigned, aligned)
    candidate = ROOT / 'dist' / ('Navrang-Gate-' + release['versionName'] + '.apk')
    candidate.parent.mkdir(exist_ok=True)
    if candidate.exists():
        raise SystemExit('A candidate with this version already exists. Inspect it; do not overwrite.')
    run(tools / 'apksigner', 'sign', '--ks', key, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--v4-signing-enabled', 'false', '--out', candidate, aligned)
    verify_apk(candidate, release, tools)
    metadata = subprocess.check_output([str(tools / 'aapt2'), 'dump', 'badging', str(candidate)], text=True)
    if not re.search(r"^(?:minSdkVersion|sdkVersion):'24'$", metadata, re.M):
        raise SystemExit('The native APK must preserve minimum API 24.')
    with zipfile.ZipFile(candidate) as archive:
        if original:
            required = {'assets/index.html', 'assets/client.js', 'assets/reports.js', 'assets/report-export.js', 'assets/workbook.js', 'assets/art/classic-restore.css'}
            if not required.issubset(archive.namelist()):
                raise SystemExit('The restored interface is missing a required feature asset.')
            verify_restored_artwork(archive, metadata)
        elif any(name.startswith('assets/') and name.endswith(('.html', '.js')) for name in archive.namelist()):
            raise SystemExit('Operational web assets must not be packaged into the native APK.')
    if candidate.stat().st_size > 25 * 1024 * 1024:
        raise SystemExit('Candidate exceeds the existing updater size limit.')
    check_publication(release, candidate, ROOT / 'downloads' / candidate.name, latest)
    print('Signed candidate verified. Publication remains a separate reviewed operation.')

if __name__ == '__main__':
    main()
