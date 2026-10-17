"""Release failures must happen before public artifacts are overwritten."""
import hashlib
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'tools'))
from release_policy import SIGNER_SHA256, require_signing_key, verify_apk, check_publication


class ReleasePolicyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.apk = self.root / 'new.apk'
        self.apk.write_bytes(b'new signed build fixture')
        self.dest = self.root / 'published.apk'
        self.release = {'versionName': '0.7.3', 'versionCode': 11}
        self.signature = f'Signer #1 certificate SHA-256 digest: {SIGNER_SHA256}\n'
        self.manifest = "package: name='in.navrang.gate' versionCode='11' versionName='0.7.3' platformBuildVersionName='15'\n"

    def test_missing_original_key_is_not_regenerated(self):
        key = self.root / 'missing.p12'
        with self.assertRaises(SystemExit):
            require_signing_key(key)
        self.assertFalse(key.exists())

    def test_original_signature_and_manifest_are_verified(self):
        with patch('release_policy.subprocess.check_output', side_effect=[self.signature, self.manifest]) as run:
            self.assertEqual(verify_apk(self.apk, self.release, self.root), hashlib.sha256(self.apk.read_bytes()).hexdigest())
        self.assertEqual(run.call_count, 2)

    def test_substituted_signer_is_rejected(self):
        with patch('release_policy.subprocess.check_output', return_value=self.signature.replace(SIGNER_SHA256, 'a' * 64)):
            with self.assertRaises(SystemExit):
                verify_apk(self.apk, self.release, self.root)

    def test_signed_wrong_package_or_version_is_rejected(self):
        for manifest in [self.manifest.replace('in.navrang.gate', 'in.other.app'), self.manifest.replace("versionCode='11'", "versionCode='10'")]:
            with self.subTest(manifest=manifest), patch('release_policy.subprocess.check_output', side_effect=[self.signature, manifest]):
                with self.assertRaises(SystemExit):
                    verify_apk(self.apk, self.release, self.root)

    def test_existing_download_cannot_be_replaced(self):
        self.dest.write_bytes(b'published build')
        with self.assertRaises(SystemExit):
            check_publication(self.release, self.apk, self.dest, None)
        self.assertEqual(self.dest.read_bytes(), b'published build')

    def test_channel_cannot_regress_or_reuse_version(self):
        for latest in [{'versionCode': 12}, {'versionCode': 11, 'versionName': '0.7.3', 'sha256': 'bad'}]:
            with self.subTest(latest=latest), self.assertRaises(SystemExit):
                check_publication(self.release, self.apk, self.dest, latest)

    def test_identical_rerun_and_higher_release_are_allowed(self):
        self.dest.write_bytes(self.apk.read_bytes())
        digest = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        check_publication(self.release, self.apk, self.dest, {**self.release, 'sha256': digest})
        check_publication(self.release, self.apk, self.dest, {'versionCode': 10})


if __name__ == '__main__':
    unittest.main()
