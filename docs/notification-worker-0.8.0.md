# Notification worker implementation

The local candidate includes FCM HTTP v1 transport, a parameterized PostgreSQL
adapter for the existing private outbox functions, and an executable persistent
worker (`server/workers/notifications.mjs`). No public database endpoint, role,
credential or security grant is created by the worker.

The worker uses an operator-provisioned database identity with the already
reviewed private-function permissions. It runs sequential batches of at most 20,
with a 45-second batch deadline and a minimum 15-second pause between batches.
This is a persistent Node process, not one Edge invocation per second. Queries
and connection attempts have deadlines. Abort destroys a checked-out connection;
SQL leases recover interrupted claims. Retries retain only fixed status codes.

The token provider supports an explicitly selected Google Compute workload
identity. It obtains short-lived OAuth tokens from the fixed metadata endpoint,
checks its response marker, disables redirects, and refreshes before expiry. It
does not read or create service-account key files. Other hosting providers need
an approved identity adapter; the code does not assume their credentials work.

Run prerequisites, all still unconfigured: approved hosting and budget, an
existing authorized database connection, owned Firebase project, attached
workload identity with FCM permission, reviewed migrations, private test device.
Only after those approvals and verification may an operator set
`NAVRANG_NOTIFICATION_WORKER=enabled`,
`NAVRANG_WORKLOAD_IDENTITY=google-compute`, `NAVRANG_WORKER_DATABASE_URL`, and
`NAVRANG_FCM_PROJECT_ID`, install the locked worker dependencies, and run the
entrypoint. Do not put connection values in source or reports.

Transport supports the legacy registration-token target used by the native
integration. FID targets remain explicitly unsupported. FCM acceptance is not
device receipt or read acknowledgement. Messages carry only opaque event,
binding and revision identifiers, with 30-second TTL. The client must recheck
current authenticated access before showing content; no payload auto-joins voice.

Isolated transport/store tests cover bounded batches, abort cleanup, metadata
validation/cache refresh, strict token-failure classification and scheduler
authentication. Real Google provider, database integration and physical device
acceptance are separate evidence gates and must not be inferred from mocks.

Primary references: [Compute workload authentication](https://docs.cloud.google.com/compute/docs/access/authenticate-workloads),
[node-postgres pool API](https://node-postgres.com/apis/pool).
