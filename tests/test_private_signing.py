"""Signing configuration tests use a fake source archive and never create a key."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

ROOT=Path(__file__).resolve().parents[1]
(ROOT/'.build').mkdir(exist_ok=True)
spec=importlib.util.spec_from_file_location('navrang_private_signing',ROOT/'tools/private_signing.py')
signing=importlib.util.module_from_spec(spec);spec.loader.exec_module(signing)

class RecoveryConfigTest(unittest.TestCase):
    def fixture(self,folder,source):
        archive=folder/'original-private-source.zip'
        with zipfile.ZipFile(archive,'w') as out:out.writestr('original/tools/build.py',source)
        note=folder/'RECOVERY-PROVENANCE.json'
        note.write_text(json.dumps({'certificate_sha256':signing.EXPECTED_CERTIFICATE,
            'private_key_usable':True,'original_key_bytes_preserved':True,'local_original_archive':str(archive)}))
        return note
    def test_password_is_loaded_only_in_memory_and_redacted(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.build') as temp:
            folder=Path(temp);note=self.fixture(folder,"P='synthetic-fixture-only'\nrun('keytool','-storepass',P,'-alias','fixture')\nrun('sign','--ks-pass','pass:'+P)\n")
            captured=io.StringIO()
            with contextlib.redirect_stdout(captured):
                with signing.recovery_config(note) as secret:
                    self.assertEqual(secret.stdin(),'synthetic-fixture-only\n'.encode())
                    self.assertNotIn('synthetic-fixture-only',repr(secret))
                self.assertEqual(secret.stdin(),b'')
            self.assertEqual(captured.getvalue(),'')
            self.assertEqual(sorted(p.name for p in folder.iterdir()),['RECOVERY-PROVENANCE.json','original-private-source.zip'])
    def test_ambiguous_config_does_not_guess_or_execute_archive(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.build') as temp:
            folder=Path(temp);note=self.fixture(folder,"raise RuntimeError('must not execute')\nrun('a','-storepass','one')\nrun('b','--ks-pass','pass:two')\n")
            with self.assertRaises(signing.SigningUnavailable):signing.recovery_config(note)
    def test_wrong_provenance_fingerprint_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.build') as temp:
            folder=Path(temp);note=self.fixture(folder,"run('a','-storepass','fixture')\n")
            value=json.loads(note.read_text());value['certificate_sha256']='0'*64;note.write_text(json.dumps(value))
            with self.assertRaises(signing.SigningUnavailable):signing.recovery_config(note)
    def test_reassigned_password_constant_is_not_guessed(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.build') as temp:
            folder=Path(temp);note=self.fixture(folder,"P='one'\nP='two'\nrun('a','-storepass',P)\n")
            with self.assertRaises(signing.SigningUnavailable):signing.recovery_config(note)
    def test_original_archive_bytes_are_unchanged(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'.build') as temp:
            folder=Path(temp);note=self.fixture(folder,"run('a','--ks-pass','pass:fixture')\n")
            archive=folder/'original-private-source.zip';before=hashlib.sha256(archive.read_bytes()).digest()
            with signing.recovery_config(note) as secret:self.assertEqual(secret.stdin(2),b'fixture\nfixture\n')
            self.assertEqual(hashlib.sha256(archive.read_bytes()).digest(),before)

if __name__=='__main__':unittest.main()
