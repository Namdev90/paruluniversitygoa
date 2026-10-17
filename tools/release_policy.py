"""Fail-closed checks for the established Navrang Android release channel."""
import hashlib
import re
import subprocess

PACKAGE = 'in.navrang.gate'
SIGNER_SHA256 = '0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce'


def require_signing_key(key):
    if not key.is_file():
        raise SystemExit('Original release signing key is missing. Restore it privately; never generate a replacement for this app.')


def verify_apk(apk, release, build_tools):
    """Verify actual signature and manifest, not metadata supplied by the build."""
    if not re.fullmatch(r'\d+\.\d+\.\d+', str(release.get('versionName', ''))):
        raise SystemExit('Release versionName must be major.minor.patch.')
    if type(release.get('versionCode')) is not int or release['versionCode'] <= 0:
        raise SystemExit('Release versionCode must be a positive integer.')
    output = subprocess.check_output([str(build_tools / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)], text=True)
    signers = re.findall(r'^Signer #\d+ certificate SHA-256 digest: ([0-9a-fA-F]+)$', output, re.M)
    if signers != [SIGNER_SHA256]:
        raise SystemExit('APK signer does not match the original installed app. Release refused.')
    manifest = subprocess.check_output([str(build_tools / 'aapt2'), 'dump', 'badging', str(apk)], text=True)
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", manifest, re.M)
    expected = (PACKAGE, str(release['versionCode']), release['versionName'])
    if not package or package.groups() != expected:
        raise SystemExit('APK package/version does not match release.json. Release refused.')
    return hashlib.sha256(apk.read_bytes()).hexdigest()


def check_publication(release, source, destination, latest):
    """Never replace a published version with different bytes or move backwards."""
    if destination.exists() and destination.read_bytes() != source.read_bytes():
        raise SystemExit('This APK version already exists with different bytes. Increment release.json before publishing.')
    if latest:
        previous = latest.get('versionCode', 0)
        if release['versionCode'] < previous:
            raise SystemExit('Cannot publish an older version code to the update channel.')
        if release['versionCode'] == previous:
            if release['versionName'] != latest.get('versionName') or hashlib.sha256(source.read_bytes()).hexdigest() != latest.get('sha256'):
                raise SystemExit('Version code is already published. Increment release.json before publishing.')
