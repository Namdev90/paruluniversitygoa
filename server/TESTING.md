# Server verification

Run `node --test server/tests/*.test.mjs` for local handler, security and hosted-runner safety checks. These tests do not contact Supabase or create event entries.

`npm run test:hosted` replaces registrations and creates synthetic admissions. Run it only against a separate, disposable Supabase project initialized with the current schema and Edge function. It refuses the known live project and stops before mutations unless an administrator snapshot proves the test project has zero registrations and admissions.

Required environment variables:

- `NAVRANG_TEST_API`: the isolated project's Edge function URL.
- `NAVRANG_TEST_CREDENTIALS`: an ignored, private JSON file containing the isolated project's `username` and `password`.
- `NAVRANG_TEST_ALLOW_MUTATIONS=isolated-project`: explicit acknowledgement that the target is disposable.

Do not reuse live credentials. Optional `NAVRANG_TEST_STATE` writes synthetic session credentials to a mode-0600 file; do not commit it. Recreate the isolated test project before running this suite again.

SQL suites (`roles-db.sql`, `helpdesk-db.sql`, `station-summary-db.sql`) contain temporary fixtures. Execute each within an explicit `BEGIN` / `ROLLBACK` transaction in an isolated project. They cover one saved station, administrator reassignment, revoked access, two-counter staff summaries, Help Desk privacy, versioned approval and entry uniqueness. The legacy Help Desk block intentionally checks compatibility with older installed clients, using current station permissions.
