"""Owner-scoped original-design restoration; signing/publication policy stays separate."""
import hashlib
import json
import subprocess

ORIGINAL_LOGO_SHA256 = 'b3c9bec6b50d466c244e5b127b87cace038a16d3a236303f4b141e5ea285de9a'


def require_restoration_ready(root):
    release = json.loads((root / 'release.json').read_text())
    approval = json.loads((root / 'docs/restoration-release-approval.json').read_text())
    if (release.get('interface') != 'original'
            or approval.get('approvedBy') != 'owner'
            or not approval.get('instruction') or not approval.get('approvedAt')
            or approval.get('versionName') != release.get('versionName')
            or approval.get('versionCode') != release.get('versionCode')):
        raise SystemExit('Restoration held: the owner instruction must match this original-design release.')
    source = approval.get('verifiedSourceCommit', '')
    if (not source or subprocess.run(['git', 'merge-base', '--is-ancestor', source, 'HEAD'], cwd=root, capture_output=True).returncode):
        raise SystemExit('Restoration held: a verified source ancestor is required.')
    paths = ['.', ':(exclude)docs/**', ':(exclude)README.md', ':(exclude)CHANGELOG.md']
    if subprocess.run(['git', 'diff', '--quiet', source, 'HEAD', '--', *paths], cwd=root).returncode:
        raise SystemExit('Restoration held: code changed after verification.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
        raise SystemExit('Restoration held: commit and verify the working tree first.')
    if hashlib.sha256((root / 'app/assets/art/app-icon.png').read_bytes()).hexdigest() != ORIGINAL_LOGO_SHA256:
        raise SystemExit('Restoration held: the original Navrang logo bytes changed.')
