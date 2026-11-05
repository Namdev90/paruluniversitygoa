# Cloudflare relay bridge: authorization, commit and clock design

The production choice is the free Cloudflare relay. Daily is retained only as historical/diagnostic source; it is excluded from the relay-only APK. Voice remains disabled until the implementation and acceptance gates below pass.

## Approval boundary correction

Offline source implementation and synthetic testing are already authorized. The missing adapter is implementation work, not a blanket permission blocker. These code changes do not select an account, deploy a Worker, change a database grant/RLS policy, configure a trusted issuer, mint a production credential or activate a provider.

Current targets in source are the existing `navrang-gate` authenticated Edge boundary, the recovered narrow `navrang_voice_worker_api` actor/controller wrappers over the unchanged private `navrang_private.voice_rpc` function, and the prototype Worker `navrang-relay-local-feasibility` with its `ROOMS` binding. Both exact voice and notification boundary migrations were explicitly approved, applied and independently verified on 5 November 2026. They created non-login capability roles and six restricted wrappers, not passwords or active connections. See `production-boundary-evidence-2026-11-05.json`. The separately approved dedicated logins and two Hyperdrive connections were subsequently created and independently verified; see `production-connection-evidence-2026-11-05.json`. No Worker AUTH_DB binding, issuer credential, route or activation was added. A future deployment/configuration proposal must name its actual account, URL, issuer/public-key values and exact persistent changes before requesting any additional approval. No such action is requested here.

The separately presented NDK r30/SDK-agreement installation was specifically approved by the user. It does not authorize provider deployment, credentials, payments or unrelated security changes.

## Existing contract that stays in force

The HTTP handler validates the app action/payload and hashes its bearer before service dispatch. The private SQL function resolves the actor and checks staff role, duty ownership, audience, membership, current floor/request/generation and expiry. Its locking, durable cleanup and failed-grant quarantine remain authoritative. Controller-only/private SQL actions never become public app actions. Existing RLS, grants and service identities stay unchanged.

The relay verifies the existing configured Ed25519 issuer, audience, room, subject, role, authorization version, expiry and one-use upgrade identifier. Devices receive only their room-bound speaker/listener credential; controller credentials stay server-side. There is no device-issued JWT or authority inferred from a client-provided subject.

`VoiceAuthority.floor()` must still report success only for a committed floor. No microphone may be authorized by a pending preparation, a boolean readiness flag, a locally muted client or a transport admission acknowledgement.

## Smallest safe flow

1. The private service invokes the existing actor-bound floor preparation under its existing checks. It obtains immutable session/duty/lease/identity/generation/expiry from SQL, never from arbitrary client claims.
2. Persist a provider-specific immutable lease plan. Use a separate room for every SQL floor lease, derived from its server-issued lease identifier. Old listener tokens must not admit a later lease. Keep Daily plan/receipt checks strict and separate. The existing private plan container can retain a provider-discriminated record; its legacy column name does not require changing access grants.
3. Return only a bounded provisional speaker admission descriptor to the native authority adapter. The adapter obtains a nonce-bound time sample from that exact room and opens the authenticated speaker socket. No live relay grant exists yet, so even a modified client cannot forward frames.
4. Through its server-only controller connection, the bridge uses `prepare` to reserve an exact grant/epoch/deadline. The relay sends the prepared receipt only to that controller, never a live grant to devices. Prior removals must have exact verified receipts.
5. Revalidate the same actor, duty, request, immutable plan and expiry in SQL, then commit its exact prepared receipt. This is a private provider adapter extension using the existing authorization checks, not a new role or bypass.
6. The controller activates the exact prepared operation/grant/epoch/deadline. Only now does the relay emit its existing v1 live `grant` and permit frames. The native adapter waits for both the backend commit and matching live grant/native readiness before returning a committed `Floor` to the coordinator. The coordinator claims the already prepared native handle; it does not reconnect using a consumed JWT.
7. Cancellation, identity change, timeout or any ambiguous failure fences native input synchronously, cancels preparation, revokes the exact relay operation and enqueues the existing SQL release/failure cleanup. An active SQL floor must not remain stranded after relay activation failure. No retry extends a fixed deadline or bypasses failed-grant quarantine.

The staged relay primitives are implemented in `server/relay-v1/src/core.mjs`: preparation cannot forward audio, requires connected authenticated peers, persists an epoch before issuing a receipt, and activation checks all immutable fields and current peer authority. Repeated exact receipts do not renew deadlines. Disconnect, revoke, expiry or reconstruction retires a pending epoch. Any uncertain storage save poisons the actor until reconstruction, so an unpersisted receipt or in-memory lease cannot be reused. Existing v1 native grant messages are unchanged. The new bridge must require the advertised `staged-grant-v1` capability and must never fall back to immediate legacy grant behavior.

The actor-bound provider adapter, private read-only operation lookup, two-phase native authority, per-room owner, prepared-handle handoff and default service factory are implemented. The persistent backend runtime is composed through injected existing database, issuer and connector dependencies. The deployed Edge function remains disabled until its private connection to a concrete persistent runtime is specified and approved. Component and aggregate test evidence must accompany the final commit; this source does not assert live acceptance.

## Clock source and isolation

The imported Worker now supports a read-only time probe at the same exact authenticated room socket path, using GET without Upgrade and a fresh 32-hex nonce header. JWT verification runs before routing/allocation and again inside the Durable Object. The response contains only version, echoed nonce and the same logical actor clock used to enforce its grant, with no-store headers. It creates or extends no role, floor, grant or SQLite record. Malformed, unauthenticated, stale/replayed or invalid-clock samples fail closed.

The native client must match the nonce, require the exact pinned HTTPS origin/room, prohibit redirects/cache reuse, bound body/RTT and pass request/response elapsed timestamps to `RelayClock`. No device wall time fallback is allowed. A timestamp from the SQL/issuer host is not substituted for relay time.

Clock state must be bound to a room's Durable Object. A sample from one room must not qualify another. Use a bounded native owner with separate per-room transport/clock slots and shared owner-scoped retired-epoch metadata. Production uses `NativeRelayOwnerRuntime` with `RelayMediaOwner`; the older single-clock `NativeRelayRuntime` is retained for diagnostics only. Renewal rotates to a fresh immutable lease/room, and replacement waits for acknowledged socket/audio teardown.

A same-actor sample removes the previous assumed issuer-to-relay skew requirement. Reference-clock advance versus elapsed time still needs an evidenced conservative bound, fresh samples and rollback/overflow handling. Route tests and arithmetic tests do not establish real cloud clock behavior or physical audio deadlines.

## Encoder and packaging

Official Xiph libopus 1.6.1 is checksum pinned with notices in `third_party/opus` and app assets. The app-owned synchronized JNI wrapper accepts exactly PCM16 mono 48 kHz/960 samples, enforces the 20 ms packet profile, wipes buffers/state and rejects closed/invalid inputs. The publisher prefers a supported platform encoder, then the bundled encoder; missing capability fails before requesting a floor.

`tools/build-relay-opus.py` uses only an already installed authorized Linux NDK r30 (30.0.16248370), targets API24 for arm64-v8a, armeabi-v7a, x86_64 and x86, exports only the three JNI methods, and retains 16 KiB ELF alignment. Gradle passes the same four-ABI list used by its splits. The builder and APK inspector verify ELF architecture, load alignment, exported JNI symbols and native dependencies. It performs no downloads, installation or license acceptance. Enable packaging with `-PnavrangBundledOpusIncluded=true -PnavrangNdkPath=<authorized NDK path>`; NDK/toolchain files never enter the APK.

The intended unsigned diagnostic profile is `-PnavrangOptimizedRelease=true -PnavrangAbiSplits=true -PnavrangDailySdkIncluded=false -PnavrangBundledOpusIncluded=true`, keeping voice/push false. Run the existing Gradle unit/lint/assembly tasks and inspect every actual split with `tools/inspect-relay-unsigned.py --abi <abi> --require-bundled-opus`, plus the universal artifact with `--abi universal --require-bundled-opus`. The universal inspection requires all four encoders. The unchanged 25 MiB cap, package identity, minSdk24 and original-key release gates remain enforced. The retained 0.8.0/code18 metadata is diagnostic, not a new release. See [the recovery checks](OPUS-FOUR-ABI-RECOVERY.md) for current evidence and remaining toolchain/device gates.

## External gates after code wiring

No live activation is performed. Required future evidence includes the actual approved issuer/controller configuration, authenticated end-to-end bridge and TLS admission, cloud clock assumptions, API24/28/35 device/emulator codec behavior and processing budget, cancellation/route changes, hardware drain/last-audible cutoff under scheduling stalls/Worker suspension, and final release/updater/original-key qualification. Any actual deployment, permissions or credential action must be presented concretely; offline adapter work may continue under existing authorization.

## Bounded replay metadata

The native owner retains exact epoch floors for 64 recent rooms and permanently rejects evicted rooms using an append-only 8 MiB Bloom filter. This removes the hard 64-room stop without deleting replay metadata or assuming expiry from an upper-bound clock. Hash collisions can only deny admission; saturation remains a conservative availability limit. See RELAY-REPLAY-RETENTION.md for the safety argument, memory cost, sizing estimates and million-room tests.
