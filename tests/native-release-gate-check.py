"""A partial native rebuild must never reach signing/publication."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_release_gate', ROOT/'tools/native_release_gate.py')
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
class NativeGateTest(unittest.TestCase):
    def complete_evidence(self):
        return {
            'screens': {key: {'status': 'RELEASE-READY', 'evidence': 'synthetic'} for key in gate.REQUIRED},
            'gates': {**{key: {'status': 'VERIFIED', 'evidence': 'synthetic'} for key in gate.EXTERNAL},
                      'google_branding': {'status': 'DEFERRED_BY_USER', 'evidence': 'owner instruction'}},
            'verifiedSourceCommit': 'a' * 40,
            'releaseApproved': False,
        }

    def test_current_checkpoint_is_held_before_any_process(self):
        with patch.object(gate.subprocess, 'check_output') as process:
            with self.assertRaisesRegex(SystemExit, 'Native release held'):
                gate.require_native_ready(ROOT)
            process.assert_not_called()
    def test_missing_external_verification_cannot_sign(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);(root/'docs').mkdir()
            evidence={'screens':{key:{'status':'RELEASE-READY','evidence':'synthetic'} for key in gate.REQUIRED},'gates':{}}
            (root/'docs/native-release-evidence.json').write_text(json.dumps(evidence))
            with self.assertRaisesRegex(SystemExit,'external/device'):
                gate.require_native_ready(root)

    def test_branding_deferral_does_not_waive_device_or_signing_verification(self):
        for required in ('credential_manager_device', 'original_key_upgrade'):
            with self.subTest(required=required), tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder); (root/'docs').mkdir()
                evidence = self.complete_evidence()
                evidence['gates'][required]['status'] = 'PENDING'
                (root/'docs/native-release-evidence.json').write_text(json.dumps(evidence))
                with patch.object(gate.subprocess, 'check_output') as process:
                    with self.assertRaisesRegex(SystemExit, 'external/device'):
                        gate.require_native_ready(root)
                    process.assert_not_called()

    def test_branding_deferral_still_requires_explicit_release_approval(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder); (root/'docs').mkdir()
            (root/'docs/native-release-evidence.json').write_text(json.dumps(self.complete_evidence()))
            with patch.object(gate.subprocess, 'check_output', side_effect=['a' * 40, '']), \
                 patch.object(gate.subprocess, 'run') as process:
                process.return_value.returncode = 0
                with self.assertRaisesRegex(SystemExit, 'explicit release approval'):
                    gate.require_native_ready(root)
if __name__=='__main__':unittest.main()
