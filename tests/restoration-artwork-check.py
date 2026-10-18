"""Verify the actual launcher, including optimized Android resource filenames."""
import importlib.util
import io
import pathlib
import sys
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
spec = importlib.util.spec_from_file_location('native_builder', ROOT / 'tools/build-native.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
ORIGINAL = (ROOT / 'app/assets/art/app-icon.png').read_bytes()


class ArtworkTest(unittest.TestCase):
    def archive(self, launcher=ORIGINAL):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as z:
            z.writestr('assets/art/app-icon.png', ORIGINAL)
            z.writestr('res/optimized.png', launcher)
        return zipfile.ZipFile(buffer)

    def test_original_icon_with_optimized_resource_path(self):
        with self.archive() as z:
            builder.verify_restored_artwork(z, "application-icon-160:'res/optimized.png'\napplication-icon-320:'res/optimized.png'\n")

    def test_correct_web_logo_does_not_mask_wrong_launcher(self):
        with self.archive(b'wrong launcher') as z, self.assertRaises(SystemExit):
            builder.verify_restored_artwork(z, "application-icon-160:'res/optimized.png'\n")

    def test_missing_launcher_is_rejected(self):
        with self.archive() as z, self.assertRaises(SystemExit):
            builder.verify_restored_artwork(z, "application-icon-160:'res/missing.png'\n")

    def test_unresolved_manifest_icon_is_rejected(self):
        with self.archive() as z, self.assertRaises(SystemExit):
            builder.verify_restored_artwork(z, '')


if __name__ == '__main__':
    unittest.main()
