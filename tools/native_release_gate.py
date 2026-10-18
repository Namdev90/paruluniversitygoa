"""Fail closed before building/signing a production Compose APK."""
import json
import pathlib
import subprocess

REQUIRED = {f'N{i:02d}' for i in range(1, 19)}
# Branding is deferred. Other incomplete verification needs a separate owner
# waiver pinned to one release and its tested source; signing policy is unchanged.
EXTERNAL = {'credential_manager_device', 'api24_device',
            'current_android_device', 'original_key_upgrade', 'installer_reboot',
            'performance_measurements', 'portal_hosted', 'backend_review'}

def require_native_ready(root: pathlib.Path):
    evidence = json.loads((root / 'docs/native-release-evidence.json').read_text())
    waiver = evidence.get('verificationWaiver', {})
    waived_screens, waived_gates = set(), set()
    if waiver:
        release = json.loads((root / 'release.json').read_text())
        if (evidence.get('releaseApproved') is not True
                or waiver.get('approvedBy') != 'owner'
                or not waiver.get('instruction') or not waiver.get('approvedAt')
                or not waiver.get('reason')
                or waiver.get('versionName') != release.get('versionName')
                or waiver.get('versionCode') != release.get('versionCode')
                or not waiver.get('sourceCommit')
                or waiver.get('sourceCommit') != evidence.get('verifiedSourceCommit')):
            raise SystemExit('Native release held: owner verification waiver is not scoped to this approved release/source.')
        waived_screens = set(waiver.get('screens', []))
        waived_gates = set(waiver.get('gates', []))
        if not waived_screens <= REQUIRED or not waived_gates <= EXTERNAL:
            raise SystemExit('Native release held: waiver contains an unknown verification gate.')
    rows = evidence.get('screens', {})
    if set(rows) != REQUIRED or any(
            not row.get('evidence') or not (
                row.get('status') == 'RELEASE-READY'
                or key in waived_screens and row.get('status') == 'IMPLEMENTED—UNVERIFIED')
            for key, row in rows.items()):
        raise SystemExit('Native release held: N01–N18 need reviewed parity and evidence.')
    gates = evidence.get('gates', {})
    if any(not gates.get(key, {}).get('evidence') or not (
            gates[key].get('status') == 'VERIFIED'
            or key in waived_gates and gates[key].get('status') == 'SKIPPED_BY_OWNER')
            for key in EXTERNAL):
        raise SystemExit('Native release held: external/device/deployment verification is incomplete.')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    verified = evidence.get('verifiedSourceCommit', '')
    if not verified or subprocess.run(['git', 'merge-base', '--is-ancestor', verified, commit], cwd=root, capture_output=True).returncode:
        raise SystemExit('Native release held: verified source commit is missing or is not an ancestor.')
    # Only narrative/evidence updates may follow the tested source commit.
    runtime_paths = ['.', ':(exclude)docs/**', ':(exclude)README.md', ':(exclude)CHANGELOG.md']
    if subprocess.run(['git', 'diff', '--quiet', verified, commit, '--', *runtime_paths], cwd=root).returncode:
        raise SystemExit('Native release held: runtime/build/test source changed after verification.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
        raise SystemExit('Native release held: commit and re-verify source changes first.')
    if evidence.get('releaseApproved') is not True:
        raise SystemExit('Native release held: explicit release approval is still required.')
    return evidence
