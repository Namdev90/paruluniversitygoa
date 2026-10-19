"""Offline regression checks for the additive historical Release migration."""
from pathlib import Path
import copy
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('history', ROOT / 'tools/publish-history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class HistoryChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'downloads').mkdir()
        self.apk = self.root / 'downloads/Navrang-Gate-0.7.8.apk'
        self.apk.write_bytes(b'unchanged signed artifact fixture')
        self.item = {'version': '0.7.8', 'versionCode': 16, 'package': 'in.navrang.gate',
                     'filename': self.apk.name, 'size': self.apk.stat().st_size,
                     'sha256': history.digest(self.apk.read_bytes()),
                     'commit': 'a' * 40, 'date': '2026-10-18T22:21:50+05:30',
                     'artifactCommit': 'c' * 40, 'artifactDate': '2026-10-18T22:16:33+05:30',
                     'message': 'Original design restored'}
        self.refs, self.releases, self.contents, self.mutations = {}, {}, {}, []
        self.root_patch = patch.object(history, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.env_patch = patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.signature_patch = patch.object(history, 'verify_signatures', return_value={'artifacts': [], 'apksignerVersion': 'test'})
        self.signature_mock = self.signature_patch.start()
        self.addCleanup(self.signature_patch.stop)

    def api(self, path, method='GET', payload=None, optional=False):
        if method != 'GET':
            self.mutations.append((path, method, payload))
        if path.startswith('git/ref/tags/'):
            return copy.deepcopy(self.refs.get(path.split('/')[-1]))
        if path == 'git/refs':
            tag = payload['ref'].split('/')[-1]
            self.assertNotIn(tag, self.refs)
            self.refs[tag] = {'object': {'type': 'commit', 'sha': payload['sha']}}
            return copy.deepcopy(self.refs[tag])
        if path.startswith('releases?'):
            return copy.deepcopy(list(self.releases.values()))
        if path == 'releases' and method == 'POST':
            self.assertNotIn(payload['tag_name'], self.releases)
            value = {**payload, 'id': 1, 'assets': [], 'html_url': 'https://github.com/example', 'published_at': None}
            self.releases[payload['tag_name']] = value
            return copy.deepcopy(value)
        if path == 'releases/1':
            value = self.releases['v0.7.8']
            if method == 'PATCH':
                value.update(payload)
                value['published_at'] = '2026-10-19T00:00:00Z'
            return copy.deepcopy(value)
        self.fail(f'Unexpected API call: {path}, {method}')

    def fake_run(self, *args, **kwargs):
        self.assertEqual(args[:2], ('gh', 'release'))
        self.assertNotIn('--clobber', args)
        self.assertEqual(args[args.index('--repo') + 1], history.REPO)
        if args[2] == 'upload':
            path = Path(args[4])
            self.assertNotIn(path.name, self.contents)
            self.contents[path.name] = path.read_bytes()
            self.releases['v0.7.8']['assets'].append({'name': path.name, 'size': path.stat().st_size, 'state': 'uploaded'})
            self.mutations.append(('upload', path.name))
        elif args[2] == 'download':
            name = args[args.index('--pattern') + 1]
            directory = Path(args[args.index('--dir') + 1])
            (directory / name).write_bytes(self.contents[name])
        else:
            self.fail(f'Unexpected command: {args}')
        return ''

    def publish(self):
        with patch.object(history, 'api', side_effect=self.api), patch.object(history, 'run', side_effect=self.fake_run):
            history.publish([self.item])

    def seed(self, *, draft=True, valid_marker=True):
        self.refs['v0.7.8'] = {'object': {'type': 'commit', 'sha': self.item['commit']}}
        self.releases['v0.7.8'] = {'id': 1, 'tag_name': 'v0.7.8', 'draft': draft,
            'body': history.notes(self.item) if valid_marker else 'Human draft', 'assets': [],
            'name': 'Navrang Gate 0.7.8 · archive', 'target_commitish': self.item['commit'], 'prerelease': False,
            'published_at': None if draft else '2026-10-18T00:00:00Z', 'html_url': 'https://github.com/example'}

    def test_complete_migration_and_identical_rerun(self):
        self.publish()
        self.assertFalse(self.releases['v0.7.8']['draft'])
        self.assertEqual(len(self.contents), 2)
        count = len(self.mutations)
        self.publish()
        self.assertEqual(len(self.mutations), count)
        self.assertEqual(self.contents[self.apk.name], self.apk.read_bytes())
        self.assertEqual(self.releases['v0.7.8']['make_latest'], 'false')

    def test_existing_wrong_tag_fails_before_mutation(self):
        self.refs['v0.7.8'] = {'object': {'type': 'commit', 'sha': 'b' * 40}}
        with self.assertRaisesRegex(ValueError, 'refusing rewrite'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_unrecognized_draft_is_not_published(self):
        self.seed(valid_marker=False)
        with self.assertRaisesRegex(ValueError, 'metadata differs'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_edited_draft_metadata_fails_even_with_original_marker(self):
        changes = {'name': 'Unapproved title',
                   'body': history.notes(self.item) + '\nUnapproved appended message',
                   'target_commitish': 'b' * 40, 'prerelease': True}
        for field, value in changes.items():
            with self.subTest(field=field):
                self.seed()
                self.releases['v0.7.8'][field] = value
                with self.assertRaisesRegex(ValueError, 'metadata differs'):
                    self.publish()
                self.assertEqual(self.mutations, [])

    def test_extra_assets_in_draft_or_published_release_are_rejected(self):
        for draft in (True, False):
            with self.subTest(draft=draft):
                self.seed(draft=draft)
                self.releases['v0.7.8']['assets'] = [{'name': 'unapproved.txt', 'size': 3, 'state': 'uploaded'}]
                with self.assertRaisesRegex(ValueError, 'Unexpected or duplicate'):
                    self.publish()
                self.assertEqual(self.mutations, [])

    def test_draft_drift_after_upload_is_not_published(self):
        changes = {
            'body': history.notes(self.item) + '\nUnapproved concurrent edit',
            'name': 'Edited title',
            'target_commitish': 'b' * 40,
            'tag_name': 'v9.9.9',
            'extra_asset': {'name': 'private-records.csv', 'size': 3, 'state': 'uploaded'},
            'tag_commit': 'b' * 40,
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                self.refs.clear()
                self.releases.clear()
                self.contents.clear()
                self.mutations.clear()
                original_run = self.fake_run
                def changed(*args, **kwargs):
                    result = original_run(*args, **kwargs)
                    if args[2] == 'upload':
                        if field == 'extra_asset':
                            self.releases['v0.7.8']['assets'].append(value)
                        elif field == 'tag_commit':
                            self.refs['v0.7.8']['object']['sha'] = value
                        else:
                            self.releases['v0.7.8'][field] = value
                    return result
                with patch.object(history, 'api', side_effect=self.api), patch.object(history, 'run', side_effect=changed), self.assertRaises(ValueError):
                    history.publish([self.item])
                self.assertTrue(self.releases['v0.7.8']['draft'])
                self.assertFalse(any(len(x) > 1 and x[1] == 'PATCH' for x in self.mutations))

    def test_matching_interrupted_draft_resumes(self):
        self.seed()
        self.publish()
        self.assertFalse(self.releases['v0.7.8']['draft'])
        self.assertNotIn('git/refs', [x[0] for x in self.mutations])

    def test_published_missing_assets_fails_without_modification(self):
        self.seed(draft=False)
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_existing_mismatched_asset_is_never_replaced(self):
        self.seed()
        self.releases['v0.7.8']['assets'] = [{'name': self.apk.name, 'size': self.apk.stat().st_size, 'state': 'uploaded'}]
        self.contents[self.apk.name] = b'x' * self.apk.stat().st_size
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_unfinished_upload_fails_without_deletion(self):
        self.seed()
        self.releases['v0.7.8']['assets'] = [{'name': self.apk.name, 'size': 0, 'state': 'starter'}]
        with self.assertRaisesRegex(ValueError, 'mismatch/incomplete'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_existing_release_without_tag_is_rejected(self):
        self.seed()
        self.refs.clear()
        with self.assertRaisesRegex(ValueError, 'no matching tag'):
            self.publish()
        self.assertEqual(self.mutations, [])

    def test_mutation_failure_is_not_blindly_retried(self):
        def failed(path, method='GET', payload=None, optional=False):
            if method == 'POST':
                self.mutations.append((path, method))
                raise RuntimeError('Uncertain network result')
            return self.api(path, method, payload, optional)
        with patch.object(history, 'api', side_effect=failed), self.assertRaisesRegex(RuntimeError, 'Uncertain'):
            history.publish([self.item])
        self.assertEqual(len(self.mutations), 1)

    def test_actions_rejects_other_ref_repository_event_or_checkout(self):
        base = {'GITHUB_ACTIONS': 'true', 'GITHUB_REPOSITORY': history.REPO,
                'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': 'a' * 40}
        for key, value in [('GITHUB_REPOSITORY', 'other/repo'), ('GITHUB_REF', 'refs/heads/test'),
                           ('GITHUB_EVENT_NAME', 'pull_request'), ('GITHUB_SHA', 'b' * 40)]:
            with self.subTest(key=key), patch.dict(os.environ, {**base, key: value}), patch.object(history, 'run', return_value='a' * 40), self.assertRaisesRegex(ValueError, 'trusted main'):
                history.publish([self.item])

    def test_notes_keep_dates_distinct_and_do_not_claim_new_signature_test(self):
        text = history.notes(self.item)
        self.assertIn(self.item['date'], text)
        self.assertIn(self.item['artifactDate'], text)
        self.assertIn('First-on-main archive commit', text)
        self.assertIn(self.item['artifactCommit'], text)
        self.assertIn('not backdated', text)
        self.assertIn('Android signatures against the original signing certificate', text)
        self.assertIn('does not claim physical-device acceptance', text)
        self.assertIn(history.marker(self.item), text)

    def test_manifest_reads_actual_latest_archive(self):
        expected = {'package': 'in.navrang.gate', 'versionName': '0.7.8', 'versionCode': 16}
        self.assertEqual(history.apk_identity(ROOT / 'downloads/Navrang-Gate-0.7.8.apk'), expected)

    def test_full_archive_verification(self):
        with patch.object(history, 'ROOT', ROOT):
            self.assertEqual(len(history.verify_inventory()), 17)

    def test_archive_preserves_artifact_and_main_provenance(self):
        inventory = json.loads((ROOT / 'docs/history/apk-inventory.json').read_text())
        by_version = {item['version']: item for item in inventory['artifacts']}
        self.assertEqual(by_version['0.7.7']['commit'], '987632021acc1924a48c873d82cb214de9eeac75')
        self.assertEqual(by_version['0.7.7']['artifactCommit'], '921fd3bfb20d1b12edc1607dc88ada39dd22fae1')
        self.assertEqual(by_version['0.7.8']['commit'], history.PREVIOUS_BASELINE)
        self.assertEqual(by_version['0.7.8']['artifactCommit'], 'c82598ed8a3e5c81c9bb743187ee23f78c7607f2')
        self.assertNotEqual(by_version['0.7.8']['date'], by_version['0.7.8']['artifactDate'])
        self.assertEqual(by_version['0.7.9']['commit'], history.BASELINE)
        self.assertEqual(by_version['0.7.9']['artifactCommit'], '899d295cae93f75cf61fd863cfa4eaa29b48197b')
        self.assertEqual(by_version['0.7.9']['versionCode'], 17)

    def test_artifact_branch_commit_cannot_replace_main_tag_target(self):
        inventory_path = ROOT / 'docs/history/apk-inventory.json'
        inventory = json.loads(inventory_path.read_text())
        entry = inventory['artifacts'][-1]
        entry['commit'], entry['date'] = entry['artifactCommit'], entry['artifactDate']
        original_read = Path.read_text
        def read(path, *args, **kwargs):
            return json.dumps(inventory) if path == inventory_path else original_read(path, *args, **kwargs)
        with patch.object(history, 'ROOT', ROOT), patch.object(Path, 'read_text', new=read), self.assertRaisesRegex(ValueError, 'main first-parent lineage'):
            history.verify_inventory()

    def test_recorded_signature_receipt_covers_the_exact_inventory(self):
        inventory = json.loads((ROOT / 'docs/history/apk-inventory.json').read_text())['artifacts']
        receipt = json.loads((ROOT / 'docs/history/signature-verification-0.7.9.json').read_text())
        self.assertEqual(receipt['baseline'], history.BASELINE)
        self.assertEqual(len(receipt['artifacts']), 17)
        by_name = {item['filename']: item for item in receipt['artifacts']}
        self.assertEqual(set(by_name), {item['filename'] for item in inventory})
        for item in inventory:
            result = by_name[item['filename']]
            self.assertEqual(result['sha256'], item['sha256'])
            self.assertEqual(result['size'], item['size'])
            self.assertEqual(result['exitCode'], 0)
            self.assertIn('Verifies', result['stdout'].splitlines())
            self.assertIn('certificate SHA-256 digest: ' + history.SIGNER_SHA256, result['stdout'])

    def test_receipt_cannot_overwrite_any_repository_input(self):
        before = self.apk.read_bytes()
        with patch.object(history, 'api') as api, self.assertRaisesRegex(ValueError, 'outside the repository'):
            history.publish([self.item], signature_receipt=str(self.apk))
        api.assert_not_called()
        self.assertEqual(self.apk.read_bytes(), before)

    def test_existing_receipt_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'receipt.json'
            path.write_text('original receipt')
            with self.assertRaises(FileExistsError):
                history.record_signatures({'artifacts': [], 'apksignerVersion': 'test'}, path)
            self.assertEqual(path.read_text(), 'original receipt')

    def test_changed_apk_after_signature_gate_is_rejected(self):
        def changed(*args):
            self.apk.write_bytes(b'x' * self.item['size'])
            return {'artifacts': [], 'apksignerVersion': 'test'}
        self.signature_mock.side_effect = changed
        with self.assertRaisesRegex(ValueError, 'immutable inventory'):
            self.publish()
        self.assertNotIn('upload', [mutation[0] for mutation in self.mutations])

    def test_remote_verification_uses_inventory_not_changed_local_file(self):
        self.seed()
        self.contents[self.apk.name] = b'x' * self.item['size']
        self.apk.write_bytes(self.contents[self.apk.name])
        self.releases['v0.7.8']['assets'] = [{'name': self.apk.name, 'size': self.item['size'], 'state': 'uploaded'}]
        with self.assertRaisesRegex(ValueError, 'immutable inventory'):
            history.verify_remote_assets(self.releases['v0.7.8'], [self.apk], self.item)

    def test_signature_failure_stops_before_any_api_call(self):
        self.signature_mock.side_effect = ValueError('signature rejected')
        with patch.object(history, 'api') as api, self.assertRaisesRegex(ValueError, 'signature rejected'):
            history.publish([self.item])
        api.assert_not_called()

    def test_workflow_scope_is_manual_only_and_no_signing_secret(self):
        workflow = (ROOT / '.github/workflows/navrang-history-releases.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('pull_request:', workflow)
        self.assertNotIn('push:', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn('GH_TOKEN: ${{ github.token }}', workflow)
        self.assertNotIn('secrets.', workflow)
        self.assertIn('cancel-in-progress: false', workflow)
        self.assertEqual(workflow.count('build-tools_r37_linux.zip'), 2)
        self.assertEqual(workflow.count('sha256sum --check --strict'), 2)
        self.assertEqual(workflow.count('--signature-receipt'), 2)
        self.assertNotIn('sdkmanager', workflow)


class SignatureChecks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'downloads').mkdir()
        self.path = self.root / 'downloads' / 'Navrang-Gate-0.7.9.apk'
        self.path.write_bytes(b'exact fixture')
        self.item = {'filename': self.path.name, 'sha256': history.digest(self.path.read_bytes()),
                     'size': self.path.stat().st_size}
        self.good = ('Verifies\nNumber of signers: 1\nV3.0 Signer: certificate SHA-256 digest: ' + history.SIGNER_SHA256 + '\n')

    def verify(self, output=None):
        output = self.good if output is None else output
        with patch.object(history, 'ROOT', self.root), patch.object(history, 'run', side_effect=['0.9\n', output]):
            return history.verify_signatures([self.item], '/sdk/apksigner')

    def test_signature_receipt_binds_verified_bytes_and_original_signer(self):
        receipt = self.verify()
        self.assertEqual(receipt['artifacts'][0]['sha256'], self.item['sha256'])
        self.assertEqual(receipt['expectedSignerSha256'], history.SIGNER_SHA256)
        self.assertTrue(receipt['artifacts'][0]['verified'])
        old_format = self.good.replace('V3.0 Signer:', 'Signer #1')
        self.assertTrue(self.verify(old_format)['artifacts'][0]['verified'])

    def test_missing_or_changed_signer_or_verification_rejected(self):
        for output in (self.good.replace(history.SIGNER_SHA256, 'a' * 64),
                       self.good.replace('Number of signers: 1', 'Number of signers: 2'),
                       self.good.replace('Verifies\n', ''),
                       self.good + 'Signer #2: certificate SHA-256 digest: ' + 'b' * 64 + '\n',
                       'Verifies\nNumber of signers: 1\n'):
            with self.subTest(output=output), self.assertRaisesRegex(ValueError, 'verification failed'):
                self.verify(output)

    def test_missing_tool_fails_closed(self):
        with patch.dict(os.environ, {'APKSIGNER': ''}), patch.object(history.shutil, 'which', return_value=None), self.assertRaisesRegex(ValueError, 'apksigner is required'):
            history.verify_signatures([self.item])

    def test_changed_apk_before_verification_rejected(self):
        self.path.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'changed before'):
            self.verify()

    def test_changed_apk_during_verification_rejected(self):
        def fake_run(*args):
            if args[1] == 'version':
                return '0.9'
            self.path.write_bytes(b'changed')
            return self.good
        with patch.object(history, 'ROOT', self.root), patch.object(history, 'run', side_effect=fake_run), self.assertRaisesRegex(ValueError, 'changed during'):
            history.verify_signatures([self.item], '/sdk/apksigner')

    def test_failed_android_verifier_propagates(self):
        import subprocess
        with patch.object(history, 'ROOT', self.root), patch.object(history, 'run', side_effect=['0.9', subprocess.CalledProcessError(1, 'apksigner')]), self.assertRaises(subprocess.CalledProcessError):
            history.verify_signatures([self.item], '/sdk/apksigner')


if __name__ == '__main__':
    unittest.main()
