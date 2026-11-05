# Isolated server voice boundary patch

26 October 2026. Source-only handoff for release integrator
`01a17125-ef68-704d-b8ee-504240b680d3`. The original checkout was read, never
modified. No credentials, signing material, environment files, private records,
dependencies or build outputs were copied. No provider/database service, live
audio session, Gradle task, deployment, billing action or device action ran.

## Files owned by this patch

| Path | Change |
| --- | --- |
| `server/functions/navrang-gate/index.ts` | Inject explicit disabled voice boundary; preserve the existing RPC routing and combine request cancellation with the existing RPC deadline. |
| `server/functions/navrang-gate/voice-service.mjs` | New bounded boundary for only the existing public duty/voice action names. With no accepted service, acquisition returns 503 before database/provider work; ending intent still uses existing authenticated RPC. |
| `server/workers/daily-voice.mjs` | Keep existing runtime factory; add opt-in executable cleanup runner, lazy loading of the existing pinned PostgreSQL driver, bounded startup/shutdown, signal handling and redacted status reporting. |
| `server/tests/voice-service-boundary.test.mjs` | New synthetic tests including execution of the actual TypeScript Edge composition under Node's type stripping with mocked Deno/fetch. |
| `server/tests/daily-worker.test.mjs` | New synthetic worker/CLI, lifecycle, cancellation and control-plane-only deletion tests. |
| `docs/voice-relay-isolated-patch-2026-10-26.md` | This handoff and acceptance/configuration record. |

No ownership of Android/native code, packaging, SQL/ACLs, existing relay adapters,
the handler, stores, or provider acceptance flags is claimed. Supporting files
in the isolated tree are unchanged fixtures/dependencies; integrate only the
six paths listed above. Original and resulting file hashes accompany the patch.

## What is implemented and deliberately still unavailable

The Edge entrypoint now explicitly injects a voice service boundary. It does
**not** inject an accepted Daily transport or load provider credentials. There
is no activation environment flag in this Edge composition. Acquisition stays
unavailable even if SQL configuration is accidentally marked ready. Existing
request validation and bearer hashing precede dispatch. Only cleanup intent
(`duty-leave`, `voice-release`, `voice-broadcast-end`) reaches the existing public
communications RPC while no accepted service exists. The boundary propagates
an abort signal and returns a fixed 503 on timeout/error; no private RPC action
becomes public.

The Daily worker can now be executed as a persistent cleanup process in a
separately authorized deployment. Importing it neither reads credentials nor
loads `pg`, connects to PostgreSQL, or contacts Daily. Missing opt-in causes a
redacted error and exit 78 before driver loading. A late pool after cancelled
startup is closed without starting work. Cleanup records contain fixed states
and counts only; none means voice is ready. Pool acquisition and shutdown are
bounded to 1500 ms by default (maximum 2000 ms); the existing controller/store
enforce their own request/cycle bounds.

`daily-relay.mjs` and `livekit-relay.mjs` are unchanged. Daily grant, renew and
revoke remain unavailable. Daily still reports `mediaTerminationVerified:false`;
both candidates retain false `leaseEnforced`, `workerDeathVerified` and
revocation acceptance flags. The controller refuses to ACK a Daily DELETE200
plus GET404 when the independent termination receipt is absent. This can leave
cleanup quarantined/DEGRADED; it is intentional and must not be bypassed.

## Strict zero-spend finding

Only the requested providers were reviewed. As checked on 26 October 2026,
[Daily Video pricing](https://www.daily.co/pricing/video-sdk/) includes 10,000
participant minutes per month, then usage charges, and its FAQ says there is
no hard cap stopping calls. It is unsuitable for this task's strict zero-spend
activation constraint. No Daily account or payment-method state was inspected.

[LiveKit Build quotas](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
document hard caps, 5,000 WebRTC participant minutes/month, 50 GB downstream
data/month and 100 connected participants. A quota exhaustion makes new
operations fail. These caps address spending eligibility, not the media fence.
[LiveKit token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/)
explicitly separates token expiry from connected-media disconnection; it also
documents refreshes, cutoff-based revocation and the Cloud revocation window.
Stock short-lived tokens cannot supply the required independent deadline.

Conclusion from those sources and the existing code: no complete, deployable
zero-cost voice path satisfying all current expiry/controller-death requirements
has been established. Local source tests are zero-cost and feasible. Keep live
voice unavailable pending a product decision or an accepted enforcement design.
Do not silently weaken expiry, preemption, replay protection, or availability
requirements to fit a free allowance. A quota cap is not a per-lease media cutoff.

## Remaining acceptance gate

An owner-approved relay must enforce the exact lease ID, generation and absolute
deadline **inside the media authority**, independently of the controller and
its network. Delayed grants must be rejected after expiry/revocation. Before
any subsequent publisher receives a credential, strict preemption must prove
that the previous publisher cannot still send/forward media. Provider room
absence, a successful permission/removal API response, token TTL, a heartbeat,
or synthetic fixture receipts are insufficient evidence by themselves.

Required isolated live acceptance still includes active audio at expiry while
killing the worker or its network; delayed provider grant/response races;
immediate preemption without publisher overlap; current/refreshed credential
replay and reconnect rejection; logout/role revocation; process crash/restart
and durable cleanup. Daily's room-per-lease approach also needs demonstrated
listener redistribution on every rotation and documented/measured SFU cutoff
behavior. A test on one phone alone cannot establish two-party media acceptance.
No acceptance flags may be changed by this patch or by running its local tests.

## Owner configuration requirements (reference only; do not activate now)

Under the current zero-spend/no-service-activation instruction, keep
`NAVRANG_DAILY_VOICE_CONTROLLER` unset and keep the Edge composition disabled.
No Firebase project, provider account, payment method or credentials should be
created to integrate these source files.

If a separately authorized cleanup deployment is considered later, the runner
expects `NAVRANG_DAILY_VOICE_CONTROLLER=enabled`, an existing
`NAVRANG_WORKER_DATABASE_URL`, an owned HTTPS `DAILY_URL` ending in `.daily.co`
without a path/query, and an existing server-only `DAILY_API_KEY`. It uses the
worker package's existing exact `pg` pin (8.23.1), an existing authorized private
database identity, and the existing `navrang_private.voice_rpc` functions and
permissions. It adds no grants, role switching, database schema, public listener
or public controller endpoint. Supply secrets outside source control. Use a
persistent supervised Node process and graceful SIGINT/SIGTERM handling; an Edge
invocation or cron callback is not a persistent controller.

Enabling real Edge media later additionally requires an accepted service plus
an authorized private RPC adapter. No direct private-schema PostgREST endpoint
is provided by this patch. Wiring that future adapter and provider remains an
explicit integration gate, subject to the zero-spend constraint and live
acceptance above. A candidate object or configured credentials cannot satisfy it.

## Verification and limits

Node v24.19.0: 144 focused tests passed, zero failed/skipped. The tests cover the
seven existing relay/service/controller/store suites, existing handler/security/
communications contracts, and the two added suites (12 new cases). All provider,
database and Deno/fetch interactions were synthetic. The safe unconfigured CLI
was also executed in a child process with an empty environment.

The handoff includes the exact command in `verification.json` and TAP output in
`focused-tests.tap`.
Patch application is checked against the retained original bytes. Native/Gradle,
aggregate `npm test`, a real Deno Edge typecheck/deployment, real PostgreSQL and
live provider/media acceptance are pending/not run. The Node Edge composition
test is a local behavioral check, not proof of hosted Deno compatibility.
