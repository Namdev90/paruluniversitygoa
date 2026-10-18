"""Fail closed before building/signing a production Compose APK."""
import json
import pathlib
import subprocess

REQUIRED = {f'N{i:02d}' for i in range(1, 19)}
# Google branding was explicitly deferred by the owner on 2026-10-18. This
# does not waive real Credential Manager/OAuth verification or release approval.
EXTERNAL = {'credential_manager_device', 'api24_device',
            'current_android_device', 'original_key_upgrade', 'installer_reboot',
            'performance_measurements', 'portal_hosted', 'backend_review'}

def require_native_ready(root: pathlib.Path):
    evidence = json.loads((root / 'docs/native-release-evidence.json').read_text())
    rows = evidence.get('screens', {})
    if set(rows) != REQUIRED or any(row.get('status') != 'RELEASE-READY' or not row.get('evidence') for row in rows.values()):
        raise SystemExit('Native release held: N01–N18 need reviewed parity and evidence.')
    gates = evidence.get('gates', {})
    if any(gates.get(key, {}).get('status') != 'VERIFIED' or not gates[key].get('evidence') for key in EXTERNAL):
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
