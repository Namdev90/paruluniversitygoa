#!/usr/bin/env python3
"""Rollback-only locator assertions against an explicitly disposable loopback DB."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('locator_fixture', ROOT / 'tools/check-communications-db.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def cleanup_race(db, data):
    q = fixture.literal
    people, tokens, operations = data['people'], data['tokens'], data['operations']
    ids = ','.join(q(x)+'::uuid' for x in people)
    cleanup = 'DELETE FROM navrang_private.locator_requests WHERE id IN (' + ','.join(q(x)+'::uuid' for x in operations[:2]) + ');\n'
    cleanup += 'DELETE FROM navrang_private.locator_audit WHERE operation_id IN (' + ','.join(q(x)+'::uuid' for x in operations) + ');\n'
    cleanup += 'DELETE FROM navrang_private.sessions WHERE hash IN (' + ','.join(q(x) for x in tokens) + ');\n'
    cleanup += 'DELETE FROM navrang_private.checkers WHERE id IN (' + ids + ');\n'
    cleanup += 'DELETE FROM navrang_private.communication_capability_revisions WHERE principal IN (' + ','.join(q(x) for x in people) + ');\n'
    if not data['hadAssignment']:
        cleanup += "DELETE FROM navrang_private.locator_event_admins WHERE event_id='O9KL3' AND principal='admin' AND display_name='Synthetic race administrator';\n"
    # Existing service-role permissions intentionally cannot delete capability
    # tombstones. The isolated bootstrap owner cleans its own synthetic fixtures;
    # no production grant or application permission is changed.
    db.transaction(cleanup, commit=True, service_role=False)

def concurrent_requests(db, same_target):
    scope = 'locator-race-' + uuid.uuid4().hex
    people = [str(uuid.uuid4()), str(uuid.uuid4())]
    tokens = [hashlib.sha256((scope + str(i)).encode()).hexdigest() for i in range(3)]
    operations = [str(uuid.uuid4()) for _ in range(6)]
    q = fixture.literal
    processes = []
    recovery_file = ROOT / '.build/locator-race-cleanup.json'
    if recovery_file.exists():
        raise RuntimeError('Reconcile the saved local locator-race fixture manifest before starting another race.')
    had_assignment = db.run("SELECT EXISTS(SELECT 1 FROM navrang_private.locator_event_admins WHERE event_id='O9KL3' AND principal='admin');") == 't'
    recovery_file.parent.mkdir(exist_ok=True)
    recovery_file.write_text(json.dumps(dict(scope=scope, people=people, tokens=tokens, operations=operations, hadAssignment=had_assignment)))
    def call(action, payload, token):
        return 'SELECT public.navrang_locator(' + q(action) + ',' + q(json.dumps(dict(eventId='O9KL3', **payload))) + '::jsonb,' + q(token) + ');'
    try:
        setup = "INSERT INTO navrang_private.locator_event_admins VALUES('O9KL3','admin','Synthetic race administrator') ON CONFLICT DO NOTHING;\n"
        setup += "INSERT INTO navrang_private.sessions(hash,role,expires_at) VALUES(" + q(tokens[0]) + ",'admin',clock_timestamp()+interval '1 hour');\n"
        for i, person in enumerate(people):
            setup += 'INSERT INTO navrang_private.checkers(id,name,method,active,name_confirmed,scanner_enabled,selected_station) VALUES(' + q(person) + "::uuid,'Synthetic race volunteer','code',true,true,true,'checker');\n"
            setup += 'INSERT INTO navrang_private.sessions(hash,role,checker_id,expires_at) VALUES(' + q(tokens[i + 1]) + ",'checker'," + q(person) + "::uuid,clock_timestamp()+interval '1 hour');\n"
            setup += call('locator-consent', dict(requestId=operations[2+i], disclosureVersion=1, location=False, findMe=True), tokens[i + 1]) + '\n'
            setup += call('locator-duty', dict(requestId=operations[4+i], durationMinutes=30), tokens[i + 1]) + '\n'
        db.transaction(setup, commit=True)
        first = db.start(call('locator-request', dict(requestId=operations[0], volunteerId=people[0]), tokens[0]), scope+'-a', commit=False)
        processes.append(first)
        first_pid = db.wait_for("SELECT pid FROM pg_stat_activity WHERE application_name=" + q(scope+'-a') + " AND state='idle in transaction';", first, 'First locator request holds owner lock')
        second = db.start(call('locator-request', dict(requestId=operations[1], volunteerId=people[0 if same_target else 1]), tokens[0]), scope+'-b', commit=True)
        processes.append(second)
        db.wait_for("SELECT pid FROM pg_stat_activity WHERE application_name=" + q(scope+'-b') + " AND wait_event_type='Lock' AND " + str(first_pid) + '=ANY(pg_blocking_pids(pid));', second, 'Second locator request waits for the same administrator')
        a = json.loads(db.finish(first, commit=True))
        b = json.loads(db.finish(second))
        if a.get('delivery') != 'queued' or (same_target and b.get('status') != 429) or (not same_target and b.get('delivery') != 'queued'):
            raise RuntimeError('Concurrent request failed cooldown/one-person delivery semantics.')
        active = db.run("SELECT count(*) FROM navrang_private.locator_requests WHERE id IN (" + ','.join(q(x)+'::uuid' for x in operations[:2]) + ") AND stopped_at IS NULL AND expires_at>clock_timestamp();")
        if active != '1':
            raise RuntimeError('Concurrent requests left more than one active target.')
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=5)
        cleanup_race(db, json.loads(recovery_file.read_text()))
        recovery_file.unlink()

def main():
    db = fixture.Database(fixture.connection_environment(os.environ.get('NAVRANG_TEST_DATABASE_URL', '')))
    if sys.argv[1:] == ['--cleanup-saved']:
        saved = ROOT / '.build/locator-race-cleanup.json'
        cleanup_race(db, json.loads(saved.read_text()))
        saved.unlink()
        print('PASS: reconciled the saved synthetic fixture manifest')
        return
    db.transaction((ROOT / 'server/tests/locator-db.sql').read_text())
    print('PASS: rollback-only locator assignment, consent, targeting, replay, expiry, revocation and retention assertions')
    db.transaction((ROOT / 'server/tests/locator-delivery-db.sql').read_text())
    print('PASS: rollback-only private find-me outbox and acknowledgement invalidations')
    concurrent_requests(db, True)
    print('PASS: two real connections enforce the same-target cooldown')
    concurrent_requests(db, False)
    print('PASS: two real connections leave only one selected active target')

if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError) as error:
        print('Locator fixture blocked: ' + str(error), file=sys.stderr)
        sys.exit(1)
