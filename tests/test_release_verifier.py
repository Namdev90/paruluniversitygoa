"""Portable, public-only tests for the APK release verifier."""
import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_policy', ROOT/'tools/release_policy.py')
release_policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_policy)


class ReleaseVerifierTest(unittest.TestCase):
    def setUp(self):
        (ROOT/'.build').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT/'.build')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.apk = self.root/'candidate.apk'
        self.apk.write_bytes(b'public synthetic APK bytes')
        self.tools = self.root/'build-tools'
        self.tools.mkdir()
        self.release = {'versionName': '0.9.0', 'versionCode': 19}
        self.signer_output = f'Signer #1 certificate SHA-256 digest: {release_policy.SIGNER_SHA256}\n'
        self.badging_output = "package: name='in.navrang.gate' versionCode='19' versionName='0.9.0'\n"

    def verify_with_outputs(self, outputs):
        with patch.object(release_policy.subprocess, 'check_output', side_effect=outputs) as command:
            digest = release_policy.verify_apk(self.apk, self.release, self.tools)
        return digest, command

    def test_prefers_portable_apksigner_jar_and_checks_identity(self):
        jar = self.tools/'lib'/'apksigner.jar'
        jar.parent.mkdir()
        jar.write_bytes(b'placeholder; command is mocked')
        digest, command = self.verify_with_outputs([self.signer_output, self.badging_output])
        self.assertEqual(len(digest), 64)
        self.assertEqual(command.call_args_list[0].args[0], [
            'java', '-jar', str(jar), 'verify', '--verbose', '--print-certs', str(self.apk)
        ])
        self.assertEqual(command.call_args_list[1].args[0], [
            str(self.tools/'aapt2'), 'dump', 'badging', str(self.apk)
        ])

    def test_uses_existing_launcher_when_portable_jar_is_absent(self):
        _, command = self.verify_with_outputs([self.signer_output, self.badging_output])
        self.assertEqual(command.call_args_list[0].args[0], [
            str(self.tools/'apksigner'), 'verify', '--verbose', '--print-certs', str(self.apk)
        ])

    def test_wrong_original_certificate_fails_before_manifest_inspection(self):
        with patch.object(release_policy.subprocess, 'check_output', return_value='Signer #1 certificate SHA-256 digest: ' + '0'*64) as command:
            with self.assertRaisesRegex(SystemExit, 'original installed app'):
                release_policy.verify_apk(self.apk, self.release, self.tools)
        command.assert_called_once()

    def test_package_or_version_mismatch_remains_fatal(self):
        with patch.object(release_policy.subprocess, 'check_output', side_effect=[
                self.signer_output, "package: name='in.navrang.gate' versionCode='18' versionName='0.9.0'\n"]):
            with self.assertRaisesRegex(SystemExit, 'package/version'):
                release_policy.verify_apk(self.apk, self.release, self.tools)


if __name__ == '__main__':
    unittest.main()
