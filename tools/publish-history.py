#!/usr/bin/env python3
"""Verify/publish the existing 0.1.0–0.7.8 archive; never build or replace APKs."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPO = 'Namdev90/paruluniversitygoa'
BASELINE = '6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc'
CONFIRMATION = 'PUBLISH_VERIFIED_HISTORY'


def run(*args, data=None, binary=False):
    return subprocess.check_output(args, cwd=ROOT, input=data,
                                   text=not binary, stderr=subprocess.PIPE)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def apk_identity(path):
    """Read only the bounded binary manifest; no SDK or APK execution required."""
    with zipfile.ZipFile(path) as apk:
        info = apk.getinfo('AndroidManifest.xml')
        if info.file_size > 1024 * 1024:
            raise ValueError('Oversized Android manifest')
        data = apk.read(info)
    strings = []
    pos = 8
    while pos < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, pos)
        if header < 8 or size < header or pos + size > len(data):
            raise ValueError('Invalid binary manifest chunk')
        if kind == 1:
            count, _, flags, start = struct.unpack_from('<IIII', data, pos + 8)
            if count > 100000 or pos + header + count * 4 > pos + size:
                raise ValueError('Invalid string pool')
            def length_at(offset, utf8):
                if utf8:
                    value = data[offset]
                    return (((value & 127) << 8) | data[offset + 1], offset + 2) if value & 128 else (value, offset + 1)
                value = struct.unpack_from('<H', data, offset)[0]
                return (((value & 32767) << 16) | struct.unpack_from('<H', data, offset + 2)[0], offset + 4) if value & 32768 else (value, offset + 2)
            for i in range(count):
                offset = pos + start + struct.unpack_from('<I', data, pos + header + 4 * i)[0]
                length, offset = length_at(offset, bool(flags & 256))
                if flags & 256:
                    length, offset = length_at(offset, True)
                    strings.append(data[offset:offset + length].decode('utf-8'))
                else:
                    strings.append(data[offset:offset + 2 * length].decode('utf-16-le'))
        elif kind == 0x102:
            name = struct.unpack_from('<I', data, pos + 20)[0]
            if strings[name] == 'manifest':
                start, width, count = struct.unpack_from('<HHH', data, pos + 24)
                if width < 20 or pos + 16 + start + width * count > pos + size:
                    raise ValueError('Invalid attributes')
                values = {}
                for i in range(count):
                    attr = pos + 16 + start + width * i
                    name, raw = struct.unpack_from('<II', data, attr + 4)
                    value = struct.unpack_from('<I', data, attr + 16)[0]
                    values[strings[name]] = strings[raw] if raw != 0xffffffff else (strings[value] if data[attr + 15] == 3 else value)
                return {k: values[k] for k in ('package', 'versionName', 'versionCode')}
        pos += size
    raise ValueError('Manifest element missing')


def verify_inventory():
    inventory = json.loads((ROOT / 'docs/history/apk-inventory.json').read_text())
    artifacts = inventory['artifacts']
    if inventory['verifiedAgainstMain'] != BASELINE or len(artifacts) != 16:
        raise ValueError('Historical migration is fixed to 16 artifacts through 0.7.8')
    if [a['versionCode'] for a in artifacts] != list(range(1, 17)):
        raise ValueError('Duplicate, missing or reordered Android version codes')
    archived = set(run('git', 'ls-tree', '--name-only', BASELINE, 'downloads/').splitlines())
    archived = {p for p in archived if p.endswith('.apk')}
    if archived != {'downloads/' + a['filename'] for a in artifacts}:
        raise ValueError('Inventory differs from the immutable baseline APK set')
    checksum_lines = (ROOT / 'SHA256SUMS.txt').read_text().splitlines()
    main_lineage = set(run('git', 'rev-list', '--first-parent', BASELINE).splitlines())
    for item in artifacts:
        filename, sha, commit = item['filename'], item['sha256'], item['commit']
        if not re.fullmatch(r'Navrang-Gate-(?:Offline-)?\d+\.\d+\.\d+\.apk', filename):
            raise ValueError('Unsafe filename')
        if not re.fullmatch(r'[0-9a-f]{64}', sha) or not re.fullmatch(r'[0-9a-f]{40}', commit):
            raise ValueError('Invalid artifact/commit digest')
        path = ROOT / 'downloads' / filename
        data = path.read_bytes()
        if len(data) != item['size'] or digest(data) != sha:
            raise ValueError(f'Archive bytes changed: {filename}')
        identity = apk_identity(path)
        if identity != {'package': 'in.navrang.gate', 'versionName': item['version'], 'versionCode': item['versionCode']}:
            raise ValueError(f'Embedded package/version mismatch: {filename}')
        if f'{sha}  downloads/{filename}' not in checksum_lines:
            raise ValueError(f'Missing canonical checksum: {filename}')
        if commit not in main_lineage:
            raise ValueError(f'Archive tag target is not in main first-parent lineage: {filename}')
        first_main = run('git', 'log', '--first-parent', '--diff-filter=A', '--format=%H', BASELINE, '--', f'downloads/{filename}').strip()
        if first_main != commit:
            raise ValueError(f'Archive tag target is not the first publication on main: {filename}')
        artifact_commit = item['artifactCommit']
        if not re.fullmatch(r'[0-9a-f]{40}', artifact_commit):
            raise ValueError('Invalid original artifact commit')
        run('git', 'merge-base', '--is-ancestor', artifact_commit, commit)
        if digest(run('git', 'show', f'{artifact_commit}:downloads/{filename}', binary=True)) != sha:
            raise ValueError(f'Original artifact bytes changed: {filename}')
        if run('git', 'show', '-s', '--format=%aI', artifact_commit).strip() != item['artifactDate']:
            raise ValueError(f'Original artifact date mismatch: {filename}')
        if digest(run('git', 'show', f'{BASELINE}:downloads/{filename}', binary=True)) != sha:
            raise ValueError(f'Baseline APK changed: {filename}')
        if digest(run('git', 'show', f'{commit}:downloads/{filename}', binary=True)) != sha:
            raise ValueError(f'Historical APK changed: {filename}')
        if run('git', 'show', '-s', '--format=%aI', commit).strip() != item['date']:
            raise ValueError(f'Historical archive date mismatch: {filename}')
    return artifacts


def api(path, method='GET', payload=None, optional=False):
    args = ['gh', 'api', f'repos/{REPO}/{path}', '--method', method,
            '-H', 'Accept: application/vnd.github+json']
    if payload is not None:
        args += ['--input', '-']
    try:
        output = run(*args, data=json.dumps(payload) if payload is not None else None)
        return json.loads(output) if output.strip() else None
    except subprocess.CalledProcessError as exc:
        if optional and 'HTTP 404' in exc.stderr:
            return None
        raise


def find_release(tag):
    # The by-tag endpoint is documented for published releases. List with the
    # authenticated session so an interrupted draft can be resumed safely.
    page = 1
    while True:
        releases = api(f'releases?per_page=100&page={page}')
        matching = [release for release in releases if release['tag_name'] == tag]
        if len(matching) > 1:
            raise ValueError(f'Ambiguous duplicate release drafts: {tag}')
        if matching:
            return matching[0]
        if len(releases) < 100:
            return None
        page += 1


def tag_commit(ref):
    obj = ref['object']
    for _ in range(8):
        if obj['type'] == 'commit':
            return obj['sha']
        if obj['type'] != 'tag':
            break
        obj = api('git/tags/' + obj['sha'])['object']
    raise ValueError('Tag does not resolve to a commit')


def marker(item):
    return f'<!-- navrang-history-migration:{item["version"]}:{item["sha256"]} -->'


def notes(item):
    return f'''# Navrang Gate {item['version']} · Android code {item['versionCode']}

{item['message']}

This is an additive archive of the APK already retained in this repository, not a rebuild or a newly signed app. Historical versions are provided for provenance; use the [current download](https://github.com/{REPO}#current-installation-and-access) for installation.

- First-on-main archive commit: [{item['commit']}](https://github.com/{REPO}/commit/{item['commit']})
- First-on-main archive date: {item['date']}
- Original artifact commit: [{item['artifactCommit']}](https://github.com/{REPO}/commit/{item['artifactCommit']})
- Original artifact commit date: {item['artifactDate']}
- Package: `in.navrang.gate`
- File: `{item['filename']}`
- Size: {item['size']} bytes
- SHA-256: `{item['sha256']}`

GitHub's publication timestamp records when this archive Release was created. It is not backdated to the original archive commit. APK bytes, original signatures, repository history and the installed-app update channel are unchanged. The migration rechecks bytes, embedded package/version and commit provenance; it does not claim new historical-signature or physical-device acceptance testing.

[Full version history](https://github.com/{REPO}/blob/main/CHANGELOG.md) · [Archive policy](https://github.com/{REPO}/blob/main/docs/history/GITHUB-RELEASES.md)

{marker(item)}
'''


def validate_release(release, item, canonical=False):
    """A marker alone is never authority to publish edited content or extra files."""
    tag = 'v' + item['version']
    if release.get('tag_name') != tag or type(release.get('draft')) is not bool:
        raise ValueError(f'Release identity mismatch: {tag}')
    allowed = {item['filename'], item['filename'] + '.sha256'}
    names = [asset['name'] for asset in release.get('assets', [])]
    if len(names) != len(set(names)) or not set(names) <= allowed:
        raise ValueError(f'Unexpected or duplicate release assets: {tag}; manual review required')
    if release['draft'] or canonical:
        expected = {'name': f'Navrang Gate {item["version"]} · archive',
                    'body': notes(item), 'target_commitish': item['commit'],
                    'prerelease': False}
        if any(release.get(key) != value for key, value in expected.items()):
            raise ValueError(f'Draft/release metadata differs from canonical archive: {tag}; manual review required')


def expected_assets(item, directory):
    checksum = directory / (item['filename'] + '.sha256')
    checksum.write_text(f'{item["sha256"]}  {item["filename"]}\n')
    return [ROOT / 'downloads' / item['filename'], checksum]


def verify_remote_assets(release, paths):
    """Download every existing matching asset and compare bytes, never overwrite."""
    assets = {a['name']: a for a in release.get('assets', [])}
    missing = []
    for path in paths:
        asset = assets.get(path.name)
        if asset is None:
            missing.append(path)
            continue
        if asset['size'] != path.stat().st_size or asset.get('state') != 'uploaded':
            raise ValueError(f'Existing asset mismatch/incomplete: {path.name}; manual review required')
        with tempfile.TemporaryDirectory() as tmp:
            run('gh', 'release', 'download', release['tag_name'], '--repo', REPO,
                '--pattern', path.name, '--dir', tmp)
            if digest((Path(tmp) / path.name).read_bytes()) != digest(path.read_bytes()):
                raise ValueError(f'Existing asset hash mismatch: {path.name}; refusing replacement')
    return missing


def publish(artifacts):
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        if (os.environ.get('GITHUB_REPOSITORY') != REPO or
                os.environ.get('GITHUB_REF') != 'refs/heads/main' or
                os.environ.get('GITHUB_EVENT_NAME') != 'workflow_dispatch' or
                os.environ.get('GITHUB_SHA') != run('git', 'rev-parse', 'HEAD').strip()):
            raise ValueError('Publication is restricted to a manual dispatch of trusted main')
    # Read/validate every existing tag and release before making any mutation.
    for item in artifacts:
        tag = 'v' + item['version']
        ref = api('git/ref/tags/' + tag, optional=True)
        if ref and tag_commit(ref) != item['commit']:
            raise ValueError(f'Existing tag points elsewhere: {tag}; refusing rewrite')
        release = find_release(tag)
        if release:
            if not ref:
                raise ValueError(f'Existing release has no matching tag: {tag}')
            validate_release(release, item)
            with tempfile.TemporaryDirectory() as tmp:
                missing = verify_remote_assets(release, expected_assets(item, Path(tmp)))
                if missing and not release['draft']:
                    raise ValueError(f'Published release is incomplete: {tag}; manual review required')
    for item in artifacts:
        tag = 'v' + item['version']
        ref = api('git/ref/tags/' + tag, optional=True)
        if ref is None:
            api('git/refs', 'POST', {'ref': 'refs/tags/' + tag, 'sha': item['commit']})
        elif tag_commit(ref) != item['commit']:
            raise ValueError(f'Tag changed during migration: {tag}')
        release = find_release(tag)
        if release is None:
            release = api('releases', 'POST', {'tag_name': tag, 'target_commitish': item['commit'],
                'name': f'Navrang Gate {item["version"]} · archive', 'body': notes(item),
                'draft': True, 'prerelease': False, 'make_latest': 'false'})
        validate_release(release, item)
        with tempfile.TemporaryDirectory() as tmp:
            paths = expected_assets(item, Path(tmp))
            missing = verify_remote_assets(release, paths)
            if missing and not release['draft']:
                raise ValueError(f'Published release is incomplete: {tag}')
            for path in missing:
                # No --clobber: a conflicting concurrent upload fails safely.
                release = api('releases/' + str(release['id']))
                validate_release(release, item)
                if not release['draft']:
                    raise ValueError(f'Draft published concurrently: {tag}; stopping uploads')
                run('gh', 'release', 'upload', tag, str(path), '--repo', REPO)
            release = api('releases/' + str(release['id']))
            validate_release(release, item)
            if verify_remote_assets(release, paths):
                raise ValueError(f'Incomplete upload: {tag}')
            if release['draft']:
                # Re-read immediately before the publication action, including
                # its exact body/title/target and the full asset allowlist.
                release = api('releases/' + str(release['id']))
                validate_release(release, item, canonical=True)
                if not release['draft'] or verify_remote_assets(release, paths):
                    raise ValueError(f'Draft changed before publication: {tag}')
                if tag_commit(api('git/ref/tags/' + tag)) != item['commit']:
                    raise ValueError(f'Tag changed before publication: {tag}')
                release = api('releases/' + str(release['id']), 'PATCH',
                              {'draft': False, 'make_latest': 'false'})
                validate_release(release, item, canonical=True)
            if release['draft'] or tag_commit(api('git/ref/tags/' + tag)) != item['commit']:
                raise ValueError(f'Publication verification failed: {tag}')
            if verify_remote_assets(release, paths):
                raise ValueError(f'Published assets missing: {tag}')
            print(json.dumps({'tag': tag, 'url': release['html_url'],
                              'publishedAt': release['published_at'], 'verified': True}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', action='store_true')
    parser.add_argument('--confirm', default='')
    args = parser.parse_args()
    if args.publish and args.confirm != CONFIRMATION:
        parser.error('Publication requires --confirm ' + CONFIRMATION)
    artifacts = verify_inventory()
    print(json.dumps({'verifiedArtifacts': len(artifacts), 'baseline': BASELINE, 'mode': 'publish' if args.publish else 'local-verification-only'}))
    if args.publish:
        publish(artifacts)


if __name__ == '__main__':
    main()
