"""A changed Java host must fail generation rather than silently lose back navigation."""
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class ClassicGenerationTest(unittest.TestCase):
    def generate(self, change=lambda source: source):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = pathlib.Path(temporary.name)
        tool = root / 'tools/prepare-classic-host.py'
        tool.parent.mkdir()
        tool.write_text((ROOT / 'tools/prepare-classic-host.py').read_text())
        source = root / 'app/java/in/navrang/gate/MainActivity.java'
        source.parent.mkdir(parents=True)
        source.write_text(change((ROOT / 'app/java/in/navrang/gate/MainActivity.java').read_text()))
        result = subprocess.run(['python3', str(tool), str(root / 'output')], capture_output=True, text=True)
        return result, root / 'output/in/navrang/gate/ClassicActivity.java'

    def test_current_host_registers_dispatcher_and_native_scanner(self):
        result, output = self.generate()
        self.assertEqual(result.returncode, 0, result.stderr)
        source = output.read_text()
        self.assertIn('getOnBackPressedDispatcher().addCallback', source)
        self.assertIn('protected void classicBack()', source)
        self.assertIn('return ClassicScannerActivity.class;', source)
        self.assertNotIn('MainActivity.this', source)

    def test_missing_lifecycle_hook_fails_before_writing_host(self):
        result, output = self.generate(lambda source: source.replace('setContentView(frame);frame.requestApplyInsets();', 'setContentView(frame);'))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('expected source pattern', result.stderr)
        self.assertFalse(output.exists())

    def test_ambiguous_back_signature_fails_before_writing_host(self):
        result, output = self.generate(lambda source: source + '\n@Override public void onBackPressed() {}\n')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('found 2 matches', result.stderr)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
