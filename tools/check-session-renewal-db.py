#!/usr/bin/env python3
"""Test already-migrated disposable loopback PostgreSQL; never apply production SQL."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('communications_fixture', ROOT / 'tools/check-communications-db.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def race(db, same_request):
    scope = 'renewal-race-' + uuid.uuid4().hex
    values = [hashlib.sha256((scope + str(i)).encode()).hexdigest() for i in range(5)]
    request = str(uuid.uuid4())
    request_two = request if same_request else str(uuid.uuid4())
    processes = []
    family = None
    q = fixture.literal

    def action(name, payload):
        return 'SELECT public.navrang_gate(' + q(name) + ',' + q(json.dumps(payload)) + "::jsonb,'');"

    try:
        created = db.transaction(action('session-create', {
            'hash': values[0], 'role': 'admin', 'refreshHash': values[1], 'installationId': scope,
        }), commit=True)
        family = json.loads(created)['refreshFamilyId']
        payload = {'hash': values[2], 'refreshHash': values[1], 'nextRefreshHash': values[3],
                   'requestId': request, 'installationId': scope}
        a = db.start(action('session-refresh', payload), scope + '-a', commit=False)
        processes.append(a)
        db.wait_for("SELECT pid FROM pg_stat_activity WHERE application_name=" + q(scope + '-a')
                    + " AND state='idle in transaction';", a, 'First rotation holds its family lock')
        second = dict(payload, hash=values[4], requestId=request_two)
        b = db.start(action('session-refresh', second), scope + '-b', commit=True)
        processes.append(b)
        db.wait_for("SELECT pid FROM pg_stat_activity WHERE application_name=" + q(scope + '-b')
                    + " AND wait_event_type='Lock';", b, 'Second connection waits for the same family')
        first_reply = json.loads(db.finish(a, commit=True))
        second_reply = json.loads(db.finish(b))
        if first_reply.get('refreshFamilyId') != family:
            raise RuntimeError('First rotation did not create current access.')
        if same_request:
            if second_reply.get('refreshFamilyId') != family or first_reply.get('refreshExpiresAt') != second_reply.get('refreshExpiresAt'):
                raise RuntimeError('Concurrent exact retry changed family or extended inactivity.')
            valid = db.run("SELECT count(*)=1 AND min(hash)=" + q(values[4])
                           + " FROM navrang_private.sessions WHERE family_id=" + q(family) + '::uuid;')
            if valid != 't':
                raise RuntimeError('Concurrent exact retry left multiple active access sessions.')
        else:
            if second_reply.get('status') != 401:
                raise RuntimeError('Conflicting consumed-token reuse was accepted.')
            valid = db.run("SELECT revoked_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM navrang_private.sessions WHERE family_id=f.id) "
                           "FROM navrang_private.session_families f WHERE id=" + q(family) + '::uuid;')
            if valid != 't':
                raise RuntimeError('Conflicting reuse did not retire the entire family.')
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
        if family:
            db.transaction('DELETE FROM navrang_private.session_families WHERE id=' + q(family) + '::uuid;', commit=True)


def main():
    env = fixture.connection_environment(os.environ.get('NAVRANG_TEST_DATABASE_URL', ''))
    db = fixture.Database(env)
    if db.run("SELECT to_regprocedure('navrang_private.prune_session_families()') IS NOT NULL;") != 't':
        raise RuntimeError('Renewal migration is not applied to this disposable fixture.')
    for name in (*fixture.FIXTURES, 'session-renewal-db.sql'):
        db.transaction((ROOT / 'server/tests' / name).read_text())
        print('PASS: rollback-only ' + name)
    race(db, True)
    print('PASS: two concurrent connections, exact retry retains one access and does not extend inactivity')
    race(db, False)
    print('PASS: two concurrent connections, conflicting reuse revokes the complete family')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('Session renewal fixture blocked: ' + str(error), file=sys.stderr)
        sys.exit(1)
