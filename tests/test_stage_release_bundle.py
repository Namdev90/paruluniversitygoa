import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('stage_bundle', ROOT / 'tools/stage_release_bundle.py')
stage_bundle = importlib.util.module_from_spec(spec); spec.loader.exec_module(stage_bundle)
import abi_release_metadata as metadata


class StageBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.build')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / '.build').mkdir(); (self.root / 'downloads').mkdir(); (self.root / 'updates').mkdir()
        (self.root / 'release.json').write_text(json.dumps({'versionCode': 19, 'versionName': '0.9.0'}))
        (self.root / 'updates/latest.json').write_text(json.dumps({'versionCode': 18, 'versionName': '0.8.0'}))
        self.cert = self.root / 'original.der'; self.cert.write_bytes(b'public DER fixture')
        self.entries = {}
        self.apks = {}
        for abi in (None, 'arm64-v8a'):
            label = abi or 'universal'; filename = 'Navrang-Gate-0.9.0' + (f'-{abi}' if abi else '') + '.apk'
            apk = self.root / f'{label}.apk'
            with zipfile.ZipFile(apk, 'w') as z:
                z.writestr('AndroidManifest.xml', b'manifest'); z.writestr('assets/pad', b'x' * 100000)
                if abi: z.writestr(f'lib/{abi}/libx.so', b'lib')
            self.apks[label] = apk
            self.entries[abi] = dict(packageName='in.navrang.gate', versionCode=19, versionName='0.9.0',
                apkUrl=metadata.BASE + filename, size=apk.stat().st_size, sha256=hashlib.sha256(apk.read_bytes()).hexdigest())
        self.channel = dict(self.entries[None], notes='fixture', artifacts={'arm64-v8a': self.entries['arm64-v8a']})
        self.meta = self.root / 'signed.json'; self.meta.write_text(json.dumps(self.channel))

    def perform(self, **kwargs):
        with patch.object(metadata, 'inspect_apk', side_effect=lambda apk, abi, release, tools: dict(
                packageName='in.navrang.gate', versionCode=19, versionName='0.9.0', apkUrl=metadata.BASE +
                ('Navrang-Gate-0.9.0' + (f'-{abi}' if abi else '') + '.apk'), size=apk.stat().st_size,
                sha256=hashlib.sha256(apk.read_bytes()).hexdigest())):
            options = {'root': self.root, 'verify': lambda channel, cert: 2}
            options.update(kwargs)
            return stage_bundle.stage(self.cert, self.meta, self.apks, 'review-1', **options)

    def test_stages_only_verified_bytes_and_new_manifest(self):
        out = self.perform()
        self.assertEqual(json.loads((out / 'bundle/updates/latest.json').read_text()), self.channel)
        self.assertEqual((out / 'bundle/downloads/Navrang-Gate-0.9.0.apk').read_bytes(), self.apks['universal'].read_bytes())
        self.assertIn('Not published', (out / 'REVIEW-RECEIPT.txt').read_text())
        self.assertTrue((out / 'NEW-SHA256SUMS.txt').is_file())

    def test_bad_public_proof_leaves_no_output(self):
        with self.assertRaisesRegex(ValueError, 'proof'):
            self.perform(verify=lambda c, cert: (_ for _ in ()).throw(ValueError('proof invalid')))
        self.assertFalse((self.root / '.build/release-staging').exists())

    def test_metadata_source_change_during_proof_uses_verified_parsed_channel(self):
        def mutate(channel, cert):
            self.meta.write_text('{"changed":true}')
        out = self.perform(verify=mutate)
        self.assertEqual(json.loads((out / 'bundle/updates/latest.json').read_text()), self.channel)

    def test_apk_source_change_after_inspection_is_detected_and_output_removed(self):
        def mutate(channel, cert):
            self.apks['universal'].write_bytes(b'changed after APK inspection')
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            self.perform(verify=mutate)
        self.assertFalse((self.root / '.build/release-staging/review-1').exists())
        self.assertEqual(self.apks['universal'].read_bytes(), b'changed after APK inspection')

    def test_bad_output_names_and_escaped_staging_roots_fail_before_mkdir(self):
        for name in ('', '.', '..', '../escape', 'sub/name', 'C:\\outside'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                stage_bundle.stage(self.cert, self.meta, self.apks, name, root=self.root, verify=lambda *_: 2)
        original_resolve = Path.resolve
        def redirected(path, *args, **kwargs):
            if path == self.root / '.build/release-staging':
                return (self.root / 'downloads').resolve()
            return original_resolve(path, *args, **kwargs)
        with patch.object(Path, 'resolve', redirected), self.assertRaisesRegex(ValueError, 'protected'):
            self.perform()
        self.assertFalse((self.root / 'downloads/review-1').exists())
        self.assertFalse((self.root / '.build/release-staging').exists())

    def test_signed_hash_mismatch_rejected(self):
        self.channel['sha256'] = '0' * 64
        self.meta.write_text(json.dumps(self.channel))
        with self.assertRaisesRegex(ValueError, 'do not match'):
            self.perform()
        self.assertFalse((self.root / '.build/release-staging').exists())

    def test_missing_and_mislabeled_artifacts_rejected(self):
        for paths in ({'universal': self.apks['universal']}, {'universal': self.apks['universal'], 'x86': self.apks['arm64-v8a']}):
            with self.subTest(paths=paths), self.assertRaises(ValueError):
                stage_bundle.stage(self.cert, self.meta, paths, 'review-1', root=self.root, verify=lambda *_: 2)
        self.assertFalse((self.root / '.build/release-staging').exists())

    def test_existing_target_and_history_overwrite_rejected(self):
        target = self.root / '.build/release-staging/review-1'; target.mkdir(parents=True)
        with self.assertRaises(ValueError): self.perform()
        target.rmdir(); target.parent.rmdir()
        old = self.root / 'downloads/Navrang-Gate-0.9.0-arm64-v8a.apk'; old.write_bytes(b'different history')
        with self.assertRaisesRegex(SystemExit, 'different bytes'): self.perform()
        self.assertFalse((self.root / '.build/release-staging').exists())


if __name__ == '__main__': unittest.main(verbosity=2)
