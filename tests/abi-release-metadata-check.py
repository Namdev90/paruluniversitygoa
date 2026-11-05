"""Offline packaging/metadata regressions; synthetic ZIPs, no services or private keys."""
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import abi_release_metadata as metadata


def core(abi=None):
    return dict(packageName=metadata.PACKAGE, versionCode=19, versionName='0.9.0',
                apkUrl=metadata.BASE + 'Navrang-Gate-0.9.0' + (f'-{abi}' if abi else '') + '.apk',
                size=100000, sha256='a' * 64)


class MetadataTests(unittest.TestCase):
    def test_payload_is_legacy_v1_exact_bytes(self):
        meta = core()
        self.assertEqual(metadata.manifest_bytes(meta),
                         ('navrang-release-v1\nin.navrang.gate\n19\n0.9.0\n' + meta['apkUrl']
                          + '\n100000\n' + 'a' * 64 + '\n').encode())

    def test_legacy_and_all_abi_entries(self):
        channel = core()
        self.assertEqual(len(list(metadata.entries(channel))), 1)
        channel['artifacts'] = {abi: core(abi) for abi in metadata.ABIS}
        self.assertEqual(len(list(metadata.entries(channel))), 5)

    def test_reject_cross_release_relabel_and_invalid_types(self):
        for mutation in ('version', 'abi', 'url', 'unknown', 'type', 'map'):
            with self.subTest(mutation=mutation):
                channel = dict(core(), artifacts={'arm64-v8a': core('arm64-v8a')})
                if mutation == 'version': channel['artifacts']['arm64-v8a']['versionCode'] += 1
                if mutation == 'abi': channel['artifacts']['arm64-v8a'] = core('armeabi-v7a')
                if mutation == 'url': channel['artifacts']['arm64-v8a']['apkUrl'] += '?unsafe'
                if mutation == 'unknown': channel['artifacts']['riscv64'] = core()
                if mutation == 'type': channel['versionCode'] = True
                if mutation == 'map': channel['artifacts'] = []
                with self.assertRaises(ValueError): list(metadata.entries(channel))

    def test_preserve_size_limit_and_identity(self):
        for key, value in [('size', 26214401), ('size', 99999), ('size', True),
                           ('packageName', 'other.app'), ('sha256', 'A' * 64),
                           ('versionName', '../0.9.0'), ('versionCode', 2147483648)]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError): metadata.validate_core(dict(core(), **{key: value}))

    def test_public_certificate_is_pinned_before_compilation(self):
        with tempfile.TemporaryDirectory() as folder:
            cert = Path(folder) / 'public.der'; cert.write_bytes(b'wrong public certificate')
            with patch.object(subprocess, 'run') as run:
                with self.assertRaisesRegex(ValueError, 'original'): metadata.verify_channel(core(), cert)
                run.assert_not_called()

    def inspect(self, abis, label, badging="sdkVersion:'24'\n", partial_library=False):
        with tempfile.TemporaryDirectory() as folder:
            apk = Path(folder) / 'fixture.apk'
            with zipfile.ZipFile(apk, 'w') as archive:
                archive.writestr('AndroidManifest.xml', b'synthetic manifest')
                archive.writestr('assets/padding', b'0' * 100000)
                for abi in abis: archive.writestr(f'lib/{abi}/libfixture.so', b'synthetic library')
                if partial_library: archive.writestr('lib/arm64-v8a/libpartial.so', b'synthetic incomplete dependency')
            with patch.object(metadata, 'verify_apk', return_value='a' * 64), \
                    patch.object(subprocess, 'check_output', return_value=badging):
                return metadata.inspect_apk(apk, label, dict(versionName='0.9.0', versionCode=19), Path(folder))

    def test_actual_zip_abi_coverage(self):
        self.inspect(metadata.ABIS, None)
        self.inspect([], None)
        for abi in metadata.ABIS: self.inspect([abi], abi)
        for abis, label in [(['arm64-v8a'], None), (['x86'], 'arm64-v8a'),
                            (['arm64-v8a', 'armeabi-v7a'], 'arm64-v8a'), (['riscv64'], None)]:
            with self.subTest(abis=abis, label=label), self.assertRaises(ValueError): self.inspect(abis, label)

    def test_api_floor_and_self_contained_requirement(self):
        for badging in ["sdkVersion:'25'\n", "sdkVersion:'23'\n", "package: name='in.navrang.gate' split='config.arm64'\nsdkVersion:'24'\n"]:
            with self.subTest(badging=badging), self.assertRaises(ValueError): self.inspect([], None, badging)

    def test_one_incomplete_dependency_rejects_universal(self):
        with self.assertRaisesRegex(ValueError, 'Every native library'):
            self.inspect(metadata.ABIS, None, partial_library=True)

    def test_draft_has_no_proof_and_checks_inputs(self):
        with patch.object(metadata, 'inspect_apk', side_effect=lambda apk, abi, release, tools: core(abi)):
            value = metadata.draft({}, {'universal': Path('u.apk'), 'x86': Path('x.apk')}, Path('.'))
            self.assertNotIn('signature', value)
            self.assertNotIn('signature', value['artifacts']['x86'])
            for inputs in [{'arm64-v8a': Path('a.apk')}, {'universal': Path('u.apk'), 'other': Path('o.apk')}]:
                with self.assertRaises(ValueError): metadata.draft({}, inputs, Path('.'))

    def test_candidate_config_preserves_dynamic_boundaries(self):
        build = (ROOT / 'native-app/build.gradle.kts').read_text()
        rules = (ROOT / 'native-app/proguard-rules.pro').read_text()
        resources = (ROOT / 'native-app/src/main/res/raw/navrang_keep.xml').read_text()
        self.assertIn('minSdk = 24', build)
        self.assertIn('isUniversalApk = true', build)
        self.assertIn('isMinifyEnabled = optimizedRelease', build)
        self.assertIn('-keep class in.navrang.gate.** { *; }', rules)
        self.assertIn('native <methods>', rules)
        self.assertIn('@android.webkit.JavascriptInterface', rules)
        self.assertIn('@drawable/*,@raw/*', resources)


if __name__ == '__main__': unittest.main(verbosity=2)
