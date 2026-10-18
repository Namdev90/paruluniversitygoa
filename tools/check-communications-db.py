#!/usr/bin/env python3
"""PostgreSQL 17 fixtures and real two-connection retention checks; loopback only."""
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit
import uuid

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = (
    'schema.sql', 'communications-v080.sql', 'report-operations-v080.sql',
    'notifications-v080.sql', 'voice-v080.sql',
)
FIXTURES = (
    'roles-db.sql', 'helpdesk-db.sql', 'station-summary-db.sql', 'communications-db.sql',
    'report-operations-db.sql', 'notification-db.sql', 'voice-db.sql',
)


def connection_environment(raw):
    if not raw:
        raise ValueError('NAVRANG_TEST_DATABASE_URL is required; no database checks ran.')
    try:
        parsed = urlsplit(raw)
        host = parsed.hostname
        port = 5432 if parsed.port is None else parsed.port
    except ValueError:
        raise ValueError('Invalid fixture database URL.') from None
    if parsed.scheme not in ('postgres', 'postgresql') or parsed.query or parsed.fragment:
        raise ValueError('Use a PostgreSQL URL without query parameters or fragments.')
    if host == 'localhost':
        address = '127.0.0.1'
    else:
        try:
            address = str(ipaddress.ip_address(host or ''))
            if not ipaddress.ip_address(address).is_loopback:
                raise ValueError()
        except ValueError:
            raise ValueError('Refusing a non-loopback fixture database target.') from None
    database = unquote(parsed.path.removeprefix('/'))
    user = unquote(parsed.username or 'postgres')
    if not re.fullmatch(r'navrang_fixture[A-Za-z0-9_]*', database):
        raise ValueError('Database name must start with navrang_fixture and contain safe identifiers.')
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', user) or not 1 <= port <= 65535:
        raise ValueError('Invalid fixture connection identity or port.')
    # Discard inherited libpq overrides, especially service/hostaddr/options/passfile.
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('PG') and key != 'NAVRANG_TEST_DATABASE_URL'}
    env.update(PGHOST=host, PGHOSTADDR=address, PGPORT=str(port), PGDATABASE=database,
               PGUSER=user, PGPASSWORD=unquote(parsed.password or ''), PGCONNECT_TIMEOUT='10',
               PGAPPNAME='navrang-fixture-observer', PGSSLMODE='disable')
    return env


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


class Database:
    def __init__(self, env):
        self.env = env
        self.command = ['psql', '-X', '--no-password', '--quiet', '--tuples-only', '--no-align',
                        '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=terse']

    def safe_error(self, text):
        text = re.sub(r'postgres(?:ql)?://\S+', '[redacted database URL]', text or '')
        password = self.env.get('PGPASSWORD', '')
        return text.replace(password, '[redacted]')[:3000].strip() if password else text[:3000].strip()

    def run(self, sql, label='SQL fixture', timeout=40):
        try:
            result = subprocess.run(self.command, input=sql, text=True, capture_output=True,
                                    env=self.env, timeout=timeout, check=False)
        except subprocess.TimeoutExpired:
            raise RuntimeError(label + ' timed out.') from None
        if result.returncode:
            raise RuntimeError(label + ' failed: ' + self.safe_error(result.stderr))
        return result.stdout.strip()

    def transaction(self, body, *, commit=False, service_role=True):
        role = 'SET LOCAL ROLE service_role;\n' if service_role else ''
        return self.run("BEGIN;\n" + role + "SET LOCAL statement_timeout='20s';\n"
                        + body + ('\nCOMMIT;\n' if commit else '\nROLLBACK;\n'))

    def start(self, body, application, *, commit):
        env = dict(self.env, PGAPPNAME=application)
        process = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env)
        sql = ("BEGIN;\nSET LOCAL ROLE service_role;\nSET LOCAL statement_timeout='20s';\n"
               "SET LOCAL lock_timeout='15s';\nSET LOCAL idle_in_transaction_session_timeout='30s';\n" + body)
        process.stdin.write(sql + ('\nCOMMIT;\n' if commit else '\n'))
        process.stdin.flush()
        if commit:
            process.stdin.close()
            process.stdin = None
        return process

    def wait_for(self, query, process, label):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            result = self.run(query, label, timeout=12)
            if result:
                return int(result)
            if process.poll() is not None:
                _, error = process.communicate()
                raise RuntimeError(label + ' exited before the expected lock: ' + self.safe_error(error))
            time.sleep(.05)
        raise RuntimeError(label + ' did not reach the expected database lock state.')

    def finish(self, process, *, commit=False):
        if commit:
            process.stdin.write('COMMIT;\n')
            process.stdin.close()
            process.stdin = None
        try:
            output, error = process.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            raise RuntimeError('Concurrent fixture connection timed out.') from None
        if process.returncode:
            raise RuntimeError('Concurrent fixture connection failed: ' + self.safe_error(error))
        return output.strip()


def concurrency_fixture(db):
    key = 'synthetic-concurrency-' + uuid.uuid4().hex
    principal = str(uuid.uuid4())
    applications = [key + '-six', key + '-seven']
    fixture = (ROOT / 'server/tests/notification-concurrency-db.sql').read_text()

    def phase(name):
        settings = '\n'.join('SELECT set_config(' + literal('navrang_fixture.' + setting) + ','
                             + literal(value) + ',true);'
                             for setting, value in [('phase', name), ('prefix', key), ('principal', principal)])
        # Cleanup uses the isolated bootstrap owner; production service ACLs stay unchanged.
        return db.transaction(settings + '\n' + fixture, commit=True, service_role=name != 'cleanup')

    def append(number):
        event = dict(key=key + ':' + str(number), kind='announcement', actor='admin',
                     title='Synthetic concurrency ' + str(number), body='Disposable database fixture only.',
                     destination='notifications', audience={'type': 'everyone'})
        return ('SELECT navrang_private.append_notification_event(' + literal(json.dumps(event))
                + '::jsonb,ARRAY[' + literal(principal) + ']);')

    workers = []
    try:
        phase('setup')
        first = db.start(append(6), applications[0], commit=False)
        workers.append(first)
        first_pid = db.wait_for(
            "SELECT pid FROM pg_stat_activity a WHERE application_name=" + literal(applications[0])
            + " AND state='idle in transaction' AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid"
              " AND l.locktype='advisory' AND l.granted);", first, 'Sixth item connection')
        second = db.start(append(7), applications[1], commit=True)
        workers.append(second)
        db.wait_for(
            "SELECT pid FROM pg_stat_activity a WHERE application_name=" + literal(applications[1])
            + " AND wait_event_type='Lock' AND " + str(first_pid)
            + "=ANY(pg_blocking_pids(a.pid)) AND EXISTS(SELECT 1 FROM pg_locks l WHERE l.pid=a.pid"
              " AND l.locktype='advisory' AND NOT l.granted);", second, 'Seventh item connection')
        outputs = [db.finish(first, commit=True), db.finish(second)]
        event_ids = [[line for line in output.splitlines() if re.fullmatch(r'[0-9a-f-]{36}', line)]
                     for output in outputs]
        if any(len(ids) != 1 for ids in event_ids) or event_ids[0] == event_ids[1]:
            raise RuntimeError('Concurrent appends did not create distinct event IDs.')
        phase('verify')
        print('PASS: two PostgreSQL connections blocked/serialized concurrent sixth and seventh items; five retained.')
    finally:
        for process in workers:
            if process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
        primary_failure = sys.exc_info()[0] is not None
        try:
            phase('cleanup')
        except (RuntimeError, OSError) as error:
            if not primary_failure:
                raise
            print('Fixture cleanup also failed: ' + str(error), file=sys.stderr)


def main():
    env = connection_environment(os.environ.get('NAVRANG_TEST_DATABASE_URL', ''))
    if not shutil.which('psql'):
        raise RuntimeError('psql is required; real PostgreSQL concurrency checks are NOT_RUN.')
    db = Database(env)
    version = db.run("SELECT current_setting('server_version_num');", 'Server version')
    if not 170000 <= int(version) < 180000:
        raise RuntimeError('This acceptance runner requires PostgreSQL 17.')
    if db.run('SELECT current_database();', 'Database identity') != env['PGDATABASE']:
        raise RuntimeError('Fixture database identity mismatch.')
    if db.run("SELECT to_regnamespace('navrang_private') IS NULL;", 'Fresh database guard') != 't':
        raise RuntimeError('Refusing a database with existing Navrang state; create a fresh fixture database.')
    if db.run("SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
              "WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' "
              "AND c.relkind IN ('r','p','f','m'));", 'Empty fixture guard') != 't':
        raise RuntimeError('Refusing a nonempty database; create a fresh isolated fixture database.')
    db.run("""CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
DO $roles$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $roles$;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA extensions TO service_role;
""", 'Isolated role/extension bootstrap')
    for name in MIGRATIONS:
        db.run((ROOT / 'server' / name).read_text(), 'Migration ' + name)
    for name in FIXTURES:
        db.transaction((ROOT / 'server/tests' / name).read_text())
        print('PASS: rollback-only ' + name)
    concurrency_fixture(db)
    print(json.dumps({'postgresMajor': 17, 'rollbackFixtures': len(FIXTURES),
                      'realConcurrentConnections': 2, 'databaseAcceptance': 'PASS',
                      'pushAndVoiceDelivery': 'NOT_RUN'}, sort_keys=True))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print('Communications database acceptance blocked: ' + str(error), file=sys.stderr)
        sys.exit(1)
