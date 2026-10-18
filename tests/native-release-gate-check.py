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
if __name__=='__main__':unittest.main()
