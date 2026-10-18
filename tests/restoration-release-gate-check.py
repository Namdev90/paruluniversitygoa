import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from restoration_release_gate import require_restoration_ready


class RestorationGate(unittest.TestCase):
    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True, stderr=subprocess.DEVNULL).strip()

    def commit(self):
        self.git('add', '.')
        self.git('-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid',
                 'commit', '-qm', 'synthetic fixture')
        return self.git('rev-parse', 'HEAD')

    def save(self):
        (self.root / 'docs/restoration-release-approval.json').write_text(json.dumps(self.approval))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'docs').mkdir()
        (self.root / 'app/assets/art').mkdir(parents=True)
        shutil.copyfile(ROOT / 'app/assets/art/app-icon.png', self.root / 'app/assets/art/app-icon.png')
        (self.root / 'release.json').write_text(json.dumps({'interface':'original','versionName':'0.7.8','versionCode':16}))
        (self.root / 'runtime.txt').write_text('verified fixture')
        self.git('init', '-q')
        source = self.commit()
        self.approval = {'releaseApproved':True,'approvedBy':'owner','approvedAt':'2026-10-18T18:57:30+05:30',
                         'instruction':'restore original design and logo; retain features',
                         'versionName':'0.7.8','versionCode':16,'verifiedSourceCommit':source,
                         'approvedSourceCommit':source,'deviceAcceptance':'VERIFIED','deviceEvidence':'Synthetic fixture evidence'}
        self.save(); self.commit()

    def test_current_owner_scoped_clean_release(self):
        require_restoration_ready(self.root)

    def test_native_release_approval_cannot_be_reused(self):
        self.approval.update(versionName='0.7.7', versionCode=15)
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'owner instruction'):
            require_restoration_ready(self.root)

    def test_implementation_request_is_not_publication_approval(self):
        self.approval['releaseApproved'] = False
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'publication approval'):
            require_restoration_ready(self.root)

    def test_missing_owner_instruction(self):
        self.approval['instruction'] = ''
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'owner instruction'):
            require_restoration_ready(self.root)

    def test_changed_source_needs_new_verification(self):
        (self.root / 'runtime.txt').write_text('changed source')
        self.commit()
        with self.assertRaisesRegex(SystemExit, 'code changed'):
            require_restoration_ready(self.root)

    def test_unverified_device_acceptance_is_held(self):
        self.approval.update(deviceAcceptance='UNVERIFIED', deviceEvidence='')
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'device acceptance'):
            require_restoration_ready(self.root)

    def test_old_version_device_waiver_is_held(self):
        self.approval.update(deviceAcceptance='SKIPPED_BY_OWNER', deviceEvidence='', verificationWaiver={
            'approvedBy':'owner','instruction':'synthetic approval','approvedAt':'synthetic time',
            'versionName':'0.7.7','versionCode':15,'sourceCommit':self.approval['verifiedSourceCommit']})
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'fresh owner waiver'):
            require_restoration_ready(self.root)

    def test_current_source_version_device_waiver_is_accepted(self):
        self.approval.update(deviceAcceptance='SKIPPED_BY_OWNER', deviceEvidence='', verificationWaiver={
            'approvedBy':'owner','instruction':'synthetic approval','approvedAt':'synthetic time',
            'versionName':'0.7.8','versionCode':16,'sourceCommit':self.approval['verifiedSourceCommit']})
        self.save(); self.commit()
        require_restoration_ready(self.root)

    def test_publication_approval_must_name_the_source(self):
        self.approval['approvedSourceCommit'] = '1' * 40
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'publication approval must name'):
            require_restoration_ready(self.root)

    def test_dirty_tree_is_held(self):
        (self.root / 'notes.txt').write_text('uncommitted')
        with self.assertRaisesRegex(SystemExit, 'working tree'):
            require_restoration_ready(self.root)

    def test_nonancestor_source_is_held(self):
        self.approval['verifiedSourceCommit'] = '0' * 40
        self.approval['approvedSourceCommit'] = '0' * 40
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'source ancestor'):
            require_restoration_ready(self.root)

    def test_substituted_logo_is_held_after_other_checks_pass(self):
        (self.root / 'app/assets/art/app-icon.png').write_bytes(b'not the original logo')
        self.approval['verifiedSourceCommit'] = self.commit()
        self.approval['approvedSourceCommit'] = self.approval['verifiedSourceCommit']
        self.save(); self.commit()
        with self.assertRaisesRegex(SystemExit, 'logo bytes changed'):
            require_restoration_ready(self.root)


if __name__ == '__main__':
    unittest.main()
