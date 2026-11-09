#!/usr/bin/env python3
"""Synthetic checks for source QA versus guarded release-candidate inspection."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('candidate', ROOT / 'tools/verify-unsigned-candidate.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidatePolicyTests(unittest.TestCase):
    def test_strict_candidate_still_requires_new_version(self):
        current = {'versionCode': 19, 'versionName': '0.9.0'}
        with self.assertRaises(SystemExit):
            candidate.validate_version(current, current)
        candidate.validate_version({'versionCode': 20, 'versionName': '0.9.1'}, current)

    def test_source_qa_accepts_published_version_not_rollback_or_rename(self):
        current = {'versionCode': 19, 'versionName': '0.9.0'}
        candidate.validate_version(current, current, True)
        for changed in ({'versionCode': 18, 'versionName': '0.8.0'},
                        {'versionCode': 19, 'versionName': '0.9.1'}):
            with self.assertRaises(SystemExit):
                candidate.validate_version(changed, current, True)

    def test_reduced_feature_package_and_required_assets(self):
        names = {'assets/' + name for name in ('index.html', 'core.js', 'client.js', 'gate.js', 'desk.js', 'reports.js')}
        candidate.validate_assets(names)
        for asset in candidate.DEFERRED_ASSETS:
            with self.assertRaises(SystemExit):
                candidate.validate_assets(names | {'assets/' + asset})
        for asset in names:
            with self.assertRaises(SystemExit):
                candidate.validate_assets(names - {asset})

    def test_deferred_manifest_boundaries(self):
        manifest = '''E: manifest
  E: application
    E: service
      A: android:name(0x01010003)="in.navrang.gate.VoiceSessionService"
      A: android:enabled(0x0101000e)=(type 0x12)0x0
'''
        candidate.validate_manifest('', manifest)
        for permission in ('RECORD_AUDIO', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'):
            with self.assertRaises(SystemExit):
                candidate.validate_manifest("uses-permission: name='android.permission." + permission + "'", manifest)
        for component in ('NavrangMessagingService', 'PushReconcileJob', 'PushOpenActivity'):
            with self.assertRaises(SystemExit):
                candidate.validate_manifest('', manifest + component)
        for changed in (manifest.replace('0x0\n', '0xffffffff\n'), '',
                        manifest.replace('android:enabled', 'android:exported')):
            with self.assertRaises(SystemExit):
                candidate.validate_manifest('', changed)

    def test_workflow_checks_exact_head_without_version_skip(self):
        workflow = (ROOT / '.github/workflows/navrang-native.yml').read_text()
        self.assertIn('ref: ${{ github.event.pull_request.head.sha || github.sha }}', workflow)
        self.assertIn(':native-app:assembleRelease :native-app:lintRelease', workflow)
        self.assertIn('--source-check', workflow)
        self.assertNotIn('steps.candidate.outputs.enabled', workflow)
        self.assertNotIn('Detect an unpublished', workflow)


if __name__ == '__main__':
    unittest.main()
