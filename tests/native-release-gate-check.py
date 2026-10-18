"""Owner verification waivers cannot waive source or signing integrity."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from subprocess import CompletedProcess

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_release_gate', ROOT/'tools/native_release_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class NativeGateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        (self.root/'docs').mkdir()
        self.release = {'versionName': '0.7.7', 'versionCode': 15}
        (self.root/'release.json').write_text(json.dumps(self.release))
        self.evidence = {
            'screens': {key: {'status': 'RELEASE-READY', 'evidence': 'synthetic'} for key in gate.REQUIRED},
            'gates': {**{key: {'status': 'VERIFIED', 'evidence': 'synthetic'} for key in gate.EXTERNAL},
                      'google_branding': {'status': 'DEFERRED_BY_USER', 'evidence': 'owner instruction'}},
            'verifiedSourceCommit': 'a' * 40,
            'releaseApproved': True,
        }

    def check(self):
        (self.root/'docs/native-release-evidence.json').write_text(json.dumps(self.evidence))
        return gate.require_native_ready(self.root)

    def waive(self):
        for row in self.evidence['screens'].values():
            row['status'] = 'IMPLEMENTED—UNVERIFIED'
        for key in gate.EXTERNAL:
            self.evidence['gates'][key] = {'status': 'SKIPPED_BY_OWNER', 'evidence': 'Owner waiver record'}
        self.evidence['verificationWaiver'] = {
            **self.release, 'sourceCommit': 'a' * 40, 'approvedBy': 'owner',
            'approvedAt': '2026-10-18T17:02:35+05:30',
            'instruction': 'skip that and release', 'reason': 'Owner skips remaining acceptance checks.',
            'screens': sorted(gate.REQUIRED), 'gates': sorted(gate.EXTERNAL),
        }

    def test_missing_screen_is_held_before_any_process(self):
        del self.evidence['screens']['N01']
        with patch.object(gate.subprocess, 'check_output') as process:
            with self.assertRaisesRegex(SystemExit, 'parity'):
                self.check()
            process.assert_not_called()

    def test_branding_deferral_does_not_waive_external_verification(self):
        for key in ('credential_manager_device', 'original_key_upgrade'):
            with self.subTest(key=key):
                self.evidence['gates'][key]['status'] = 'PENDING'
                with self.assertRaisesRegex(SystemExit, 'external/device'):
                    self.check()
                self.evidence['gates'][key]['status'] = 'VERIFIED'

    def test_explicit_release_approval_is_required(self):
        self.evidence['releaseApproved'] = False
        with patch.object(gate.subprocess, 'check_output', side_effect=['a' * 40, '']), \
                patch.object(gate.subprocess, 'run') as process:
            process.return_value.returncode = 0
            with self.assertRaisesRegex(SystemExit, 'explicit release approval'):
                self.check()

    def test_scoped_waiver_allows_release_without_falsifying_verification(self):
        self.waive()
        with patch.object(gate.subprocess, 'check_output', side_effect=['a' * 40, '']), \
                patch.object(gate.subprocess, 'run') as process:
            process.return_value.returncode = 0
            result = self.check()
            self.assertEqual(result['gates']['original_key_upgrade']['status'], 'SKIPPED_BY_OWNER')
            self.assertEqual(result['screens']['N02']['status'], 'IMPLEMENTED—UNVERIFIED')

    def test_waiver_cannot_be_reused_for_another_version_or_source(self):
        for field, value in [('versionCode', 16), ('versionName', '0.7.8'), ('sourceCommit', 'b' * 40), ('sourceCommit', '')]:
            with self.subTest(field=field, value=value):
                self.waive()
                self.evidence['verificationWaiver'][field] = value
                with self.assertRaisesRegex(SystemExit, 'scoped'):
                    self.check()

    def test_waiver_requires_owner_approval(self):
        self.waive()
        self.evidence['releaseApproved'] = False
        with self.assertRaisesRegex(SystemExit, 'scoped'):
            self.check()

    def test_waiver_cannot_add_signing_or_security_exceptions(self):
        self.waive()
        self.evidence['verificationWaiver']['gates'].append('original_signing_key')
        with self.assertRaisesRegex(SystemExit, 'unknown'):
            self.check()

    def test_unlisted_verification_stays_required(self):
        self.waive()
        self.evidence['verificationWaiver']['gates'].remove('credential_manager_device')
        with self.assertRaisesRegex(SystemExit, 'external/device'):
            self.check()

    def test_unimplemented_screens_cannot_be_waived(self):
        self.waive()
        self.evidence['screens']['N01']['status'] = 'NOT STARTED'
        with self.assertRaisesRegex(SystemExit, 'parity'):
            self.check()

    def test_waiver_does_not_allow_source_changes_or_dirty_checkout(self):
        for return_codes, status, message in [([1], '', 'ancestor'), ([0, 1], '', 'changed'), ([0, 0], ' M release.json', 're-verify')]:
            with self.subTest(message=message):
                self.waive()
                with patch.object(gate.subprocess, 'check_output', side_effect=['a' * 40, status]), \
                        patch.object(gate.subprocess, 'run') as process:
                    process.side_effect = [CompletedProcess([], code) for code in return_codes]
                    with self.assertRaisesRegex(SystemExit, message):
                        self.check()


if __name__ == '__main__':
    unittest.main()
