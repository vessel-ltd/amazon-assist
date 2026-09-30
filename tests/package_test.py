"""Distribution failures must stop before a broken ZIP is published."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('packager', ROOT / 'scripts/package.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.target = pathlib.Path(self.temp.name) / 'test.zip'
        self.assets = {str(p.relative_to(ROOT / 'extension')): p.read_bytes()
                       for p in (ROOT / 'extension').rglob('*') if p.is_file()}
        self.assets['LICENSE'] = (ROOT / 'LICENSE').read_bytes()

    def verify(self, tag=None):
        with zipfile.ZipFile(self.target, 'w') as archive:
            for name, data in self.assets.items():
                archive.writestr(name, data)
        return packager.verify(self.target, tag)

    def test_complete_bundle(self):
        version = json.loads(self.assets['manifest.json'])['version']
        self.assertEqual(self.verify(f'v{version}'), version)

    def test_missing_nested_module(self):
        del self.assets['worker.js']
        with self.assertRaisesRegex(ValueError, 'Missing asset: worker.js'):
            self.verify()

    def test_missing_generated_reader(self):
        del self.assets['reader-content.js']
        with self.assertRaisesRegex(ValueError, 'Missing asset: reader-content.js'):
            self.verify()

    def test_private_data_and_unsafe_paths(self):
        for name in ['receipt.pdf', 'Amazon診断_test.json', '../app.js', 'tmp/page.html']:
            with self.subTest(name=name):
                self.assets[name] = b'private'
                with self.assertRaises(ValueError):
                    self.verify()
                del self.assets[name]

    def test_remote_script(self):
        self.assets['app.html'] += b'<script src="https://example.test/app.js"></script>'
        with self.assertRaisesRegex(ValueError, 'Non-local app asset'):
            self.verify()

    def test_wrong_release_tag(self):
        with self.assertRaisesRegex(ValueError, 'does not match manifest'):
            self.verify('v99.0.0')


if __name__ == '__main__':
    unittest.main()
