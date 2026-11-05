#!/usr/bin/env python3
"""Check data-hint SQL only in an explicitly disposable loopback fixture."""
import importlib.util
import argparse
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('data_fixture', ROOT / 'tools/check-communications-db.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def install_fixture(db):
    # Install only the three changed private definitions. Reapplying the whole
    # historical notification script would overwrite newer public auth wrappers.
    wrapper = db.run("SELECT md5(pg_get_functiondef('public.navrang_communications(text,jsonb,text)'::regprocedure));")
    text = (ROOT / 'server/notifications-v080.sql').read_text()
    parts = []
    for name, tag in (('append_notification_event', 'append'), ('notification_dataset_changed', 'dataset'), ('check_notification_delivery', 'check')):
        start = text.index('create or replace function navrang_private.' + name + '(')
        end = text.index('$' + tag + '$;', start) + len('$' + tag + '$;')
        parts.append(text[start:end])
    parts.append('REVOKE ALL ON FUNCTION navrang_private.notification_dataset_changed() FROM public,anon,authenticated;')
    parts.append('GRANT EXECUTE ON FUNCTION navrang_private.notification_dataset_changed() TO service_role;')
    parts.append('DROP TRIGGER IF EXISTS navrang_notification_dataset ON navrang_private.event;')
    parts.append('CREATE TRIGGER navrang_notification_dataset AFTER UPDATE OF data_revision ON navrang_private.event FOR EACH ROW EXECUTE FUNCTION navrang_private.notification_dataset_changed();')
    parts.append("DO $guard$ BEGIN IF md5(pg_get_functiondef('public.navrang_communications(text,jsonb,text)'::regprocedure)) <> " + fixture.literal(wrapper) + " THEN RAISE EXCEPTION 'Fixture changed the newer auth wrapper';END IF;END;$guard$;")
    db.transaction('\n'.join(parts), commit=True, service_role=False)
    print('PASS: private fixture code installed; newer public auth wrapper unchanged')

if __name__ == '__main__':
    try:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--apply-fixture', action='store_true', help='Install changed private code in the guarded disposable fixture only')
        args = parser.parse_args()
        db = fixture.Database(fixture.connection_environment(os.environ.get('NAVRANG_TEST_DATABASE_URL', '')))
        if args.apply_fixture:
            install_fixture(db)
        db.transaction((ROOT / 'server/tests/data-invalidation-db.sql').read_text())
        print('PASS: rollback-only private data hints, burst coalescing, recipient scope, revocation and unchanged public access')
    except (OSError, ValueError, RuntimeError) as error:
        print('Data invalidation fixture failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
