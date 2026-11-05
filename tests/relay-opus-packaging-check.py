"""Synthetic packaging regressions. These do not claim an Android cross-build."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import platform
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from relay_opus_artifact import ABIS, JNI_EXPORTS, inspect_elf


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


builder = module('relay_builder', 'build-relay-opus.py')
inspector = module('relay_inspector', 'inspect-relay-unsigned.py')


def elf(abi, exports=None, dependencies=('libc.so', 'libm.so'), alignment=16384, textrel=False):
    """Hand-built ELF tables only; no machine code or Android execution."""
    kind, machine = ABIS[abi][2:]
    wide = kind == 2
    symbols = sorted(JNI_EXPORTS if exports is None else exports)
    strings = b'\0'
    indices = {}
    for value in [*symbols, *dependencies]:
        indices[value] = len(strings)
        strings += value.encode() + b'\0'
    data = bytearray(2048)
    data[:16] = b'\x7fELF' + bytes([kind, 1, 1]) + b'\0' * 9
    header_size, phsize, shsize, symsize, dynsize = (64, 56, 64, 24, 16) if wide else (52, 32, 40, 16, 8)
    struct.pack_into('<HHIQQQIHHHHHH' if wide else '<HHIIIIIHHHHHH', data, 16,
                     3, machine, 1, 0, header_size, 1024, 0, header_size, phsize, 1, shsize, 4, 0)
    struct.pack_into('<IIQQQQQQ' if wide else '<IIIIIIII', data, header_size,
                     *([1, 5, 0, 0, 0, len(data), len(data), alignment] if wide else
                       [1, 0, 0, 0, len(data), len(data), 5, alignment]))
    data[256:256 + len(strings)] = strings
    for index, name in enumerate(symbols, 1):
        struct.pack_into('<IBBHQQ' if wide else '<IIIBBH', data, 512 + index * symsize,
                         *([indices[name], 0x12, 0, 1, 0, 0] if wide else
                           [indices[name], 0, 0, 0x12, 0, 1]))
    dynamic = [(1, indices[name]) for name in dependencies]
    if textrel:
        dynamic.append((22, 0))
    dynamic.append((0, 0))
    for index, entry in enumerate(dynamic):
        struct.pack_into('<qQ' if wide else '<iI', data, 768 + index * dynsize, *entry)
    for index, (section_kind, offset, size, link, stride) in enumerate([
            (3, 256, len(strings), 0, 0),
            (11, 512, (len(symbols) + 1) * symsize, 1, symsize),
            (6, 768, len(dynamic) * dynsize, 1, dynsize)], 1):
        struct.pack_into('<IIQQQQIIQQ' if wide else '<IIIIIIIIII', data, 1024 + index * shsize,
                         0, section_kind, 0, 0, offset, size, link, 0, 1, stride)
    return bytes(data)


@contextlib.contextmanager
def apk(libraries, notice=True):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        for name, data in libraries.items():
            archive.writestr('lib/' + name, data)
        if notice:
            archive.writestr('assets/third-party-notices/opus-1.6.1-COPYING.txt', 'Synthetic notice fixture')
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive:
        yield archive


class EncoderElfTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('cc') and platform.system() == 'Linux'
                         and platform.machine() == 'x86_64', 'requires a Linux x86_64 host C compiler')
    def test_real_host_linker_tables(self):
        # The three empty methods are ELF fixtures, not the encoder or a JNI runtime test.
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source, library = root / 'fixture.c', root / 'fixture.so'
            source.write_text('\n'.join(f'void {name}(void) {{}}' for name in sorted(JNI_EXPORTS)))
            subprocess.run(['cc', '-shared', '-fPIC', '-nostdlib', str(source), '-o', str(library),
                            '-Wl,-z,max-page-size=16384', '-Wl,-z,common-page-size=16384'], check=True)
            receipt = inspect_elf(library.read_bytes(), 'x86_64')
            self.assertEqual(receipt['elfBits'], 64)
            self.assertEqual(receipt['minimumLoadAlignment'], 16384)

    def test_all_four_architectures(self):
        for abi in ABIS:
            with self.subTest(abi=abi):
                receipt = inspect_elf(elf(abi), abi)
                self.assertEqual(receipt['elfMachine'], ABIS[abi][3])
                self.assertEqual(receipt['minimumLoadAlignment'], 16384)
                self.assertEqual(set(receipt['jniExports']), JNI_EXPORTS)

    def test_wrong_architecture_rejected(self):
        for abi in ABIS:
            for other in ABIS:
                if abi != other:
                    with self.subTest(abi=abi, other=other), self.assertRaises(ValueError):
                        inspect_elf(elf(other), abi)

    def test_4k_or_invalid_alignment_rejected(self):
        for abi in ABIS:
            for alignment in (0, 4096, 16385):
                with self.subTest(abi=abi, alignment=alignment), self.assertRaises(ValueError):
                    inspect_elf(elf(abi, alignment=alignment), abi)

    def test_missing_or_extra_jni_export_rejected(self):
        for symbols in (set(), JNI_EXPORTS - {next(iter(JNI_EXPORTS))}, JNI_EXPORTS | {'opus_encode'}):
            with self.subTest(symbols=symbols), self.assertRaises(ValueError):
                inspect_elf(elf('arm64-v8a', exports=symbols), 'arm64-v8a')

    def test_unbundled_dependency_rejected(self):
        with self.assertRaisesRegex(ValueError, 'dependency'):
            inspect_elf(elf('x86', dependencies=('libc.so', 'libopus.so')), 'x86')

    def test_text_relocations_rejected(self):
        with self.assertRaisesRegex(ValueError, 'text relocations'):
            inspect_elf(elf('armeabi-v7a', textrel=True), 'armeabi-v7a')

    def test_truncated_headers_rejected(self):
        for size in (0, 15, 16, 32, 64, 1024, 1100):
            with self.subTest(size=size), self.assertRaises(ValueError):
                inspect_elf(elf('arm64-v8a')[:size], 'arm64-v8a')


class PackageTests(unittest.TestCase):
    def libraries(self):
        return {f'{abi}/libnavrang_opus.so': elf(abi) for abi in ABIS}

    def test_universal_requires_all_four_encoders(self):
        with apk(self.libraries()) as archive:
            libraries, receipts = inspector.inspect_encoders(archive, 'universal', True)
            self.assertEqual(len(libraries), 4)
            self.assertEqual(set(receipts), set(ABIS))

    def test_each_split_contains_exact_abi(self):
        for abi in ABIS:
            with self.subTest(abi=abi), apk({f'{abi}/libnavrang_opus.so': elf(abi)}) as archive:
                self.assertEqual(set(inspector.inspect_encoders(archive, abi, True)[1]), {abi})

    def test_missing_universal_abi_rejected(self):
        libraries = self.libraries()
        del libraries['x86/libnavrang_opus.so']
        with apk(libraries) as archive, self.assertRaises(SystemExit):
            inspector.inspect_encoders(archive, 'universal', True)

    def test_unrelated_library_does_not_fill_missing_encoder(self):
        libraries = self.libraries()
        del libraries['x86/libnavrang_opus.so']
        libraries['x86/libother.so'] = b'synthetic'
        with apk(libraries) as archive, self.assertRaisesRegex(SystemExit, 'missing for x86'):
            inspector.inspect_encoders(archive, 'universal', True)

    def test_wrong_encoder_in_abi_folder_rejected(self):
        with apk({'x86/libnavrang_opus.so': elf('arm64-v8a')}) as archive, self.assertRaises(SystemExit):
            inspector.inspect_encoders(archive, 'x86', True)

    def test_notice_required(self):
        with apk(self.libraries(), notice=False) as archive, self.assertRaisesRegex(SystemExit, 'notice'):
            inspector.inspect_encoders(archive, 'universal', True)

    def test_universal_cannot_pass_as_split(self):
        with apk(self.libraries()) as archive, self.assertRaises(SystemExit):
            inspector.inspect_encoders(archive, 'arm64-v8a', True)


class BuildWiringTests(unittest.TestCase):
    def test_gradle_source_and_builder_have_same_four_abis(self):
        provenance = json.loads((ROOT / 'third_party/opus/SOURCE.json').read_text())
        self.assertEqual(provenance['default_android_abis'], list(ABIS))
        gradle = (ROOT / 'native-app/build.gradle.kts').read_text()
        self.assertIn('val relayAbis = listOf(' + ', '.join(json.dumps(abi) for abi in ABIS) + ')', gradle)
        self.assertIn('include(*relayAbis.toTypedArray())', gradle)
        self.assertIn('"--abis", relayAbis.joinToString(",")', gradle)

    def test_invalid_or_duplicate_selection_fails_before_build(self):
        for selected in ('mips', '', 'x86,x86', 'arm64-v8a,'):
            with self.subTest(selected=selected), patch.object(sys, 'argv', [
                    'build-relay-opus.py', '--ndk', '/not-present', '--output', '/not-present', '--abis', selected]), \
                    contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                builder.main()

    def test_default_build_emits_all_four_api24_targets_and_receipts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / 'third_party/opus'
            source.mkdir(parents=True)
            archive = source / 'opus-1.6.1.tar.gz'
            archive.write_bytes(b'Synthetic archive; extraction is mocked')
            (source / 'SOURCE.json').write_text(json.dumps({
                'ndk': '30.0.16248370', 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
            ndk = root / 'ndk'
            tools = ndk / 'toolchains/llvm/prebuilt/linux-x86_64/bin'
            tools.mkdir(parents=True)
            (ndk / 'source.properties').write_text('Pkg.Revision = 30.0.16248370\n')
            for name in ['llvm-ar', 'llvm-ranlib', 'llvm-strip', 'llvm-readelf',
                         *[values[0] + '24-clang' for values in ABIS.values()]]:
                (tools / name).touch()
            commands = []

            def run(command, cwd, log, env=None):
                commands.append([str(item) for item in command])
                if '-o' in command:
                    output = Path(command[command.index('-o') + 1])
                    output.write_bytes(elf(output.parent.name))

            with patch.object(builder, 'ROOT', root), patch.object(builder, 'run', run), \
                    patch.object(builder.tarfile, 'open'), \
                    patch.object(builder.subprocess, 'check_output', return_value='Synthetic readelf output'), \
                    patch.object(sys, 'argv', ['build-relay-opus.py', '--ndk', str(ndk),
                                             '--output', str(root / 'generated/relayJni')]):
                builder.main()
            receipt = json.loads((root / 'generated/relay-opus-build/receipt.json').read_text())
            self.assertEqual([item['abi'] for item in receipt['outputs']], list(ABIS))
            self.assertTrue(all(item['api'] == 24 for item in receipt['outputs']))
            for compiler, host, _, _ in ABIS.values():
                self.assertTrue(any(command[0].endswith('/' + compiler + '24-clang') for command in commands))
                self.assertTrue(any('--host=' + host in command for command in commands))


if __name__ == '__main__':
    unittest.main()
