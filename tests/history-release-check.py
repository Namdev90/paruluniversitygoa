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
        self.assertIn('does not claim new historical-signature', text)
        self.assertIn(history.marker(self.item), text)

    def test_manifest_reads_actual_latest_archive(self):
        expected = {'package': 'in.navrang.gate', 'versionName': '0.7.8', 'versionCode': 16}
        self.assertEqual(history.apk_identity(ROOT / 'downloads/Navrang-Gate-0.7.8.apk'), expected)

    def test_full_archive_verification(self):
        with patch.object(history, 'ROOT', ROOT):
            self.assertEqual(len(history.verify_inventory()), 16)

    def test_archive_preserves_artifact_and_main_provenance(self):
        inventory = json.loads((ROOT / 'docs/history/apk-inventory.json').read_text())
        by_version = {item['version']: item for item in inventory['artifacts']}
        self.assertEqual(by_version['0.7.7']['commit'], '987632021acc1924a48c873d82cb214de9eeac75')
        self.assertEqual(by_version['0.7.7']['artifactCommit'], '921fd3bfb20d1b12edc1607dc88ada39dd22fae1')
        self.assertEqual(by_version['0.7.8']['commit'], history.BASELINE)
        self.assertEqual(by_version['0.7.8']['artifactCommit'], 'c82598ed8a3e5c81c9bb743187ee23f78c7607f2')
        self.assertNotEqual(by_version['0.7.8']['date'], by_version['0.7.8']['artifactDate'])

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


if __name__ == '__main__':
    unittest.main()
