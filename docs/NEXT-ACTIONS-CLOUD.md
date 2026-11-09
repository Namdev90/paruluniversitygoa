# Exact next actions: Cloudflare platform candidate

The intended host is the existing Cloudflare account 086fa0481ec044a8a2d474f83e22f88e on Workers Free. No alternate paid host is selected. Voice and push remain disabled. Final source commit, test counts, artifact hashes and archive receipt are recorded in the accompanying handoff RESULTS.json.

## Completed offline scope

The private SQL lease/operation adapter, staged prepare/commit/activate, exact controller receipt recovery, native per-room authenticated clocks, prepared-handle handoff, bundled API24 Opus and Cloudflare platform adapters are source implementations. Platform package includes a voice-only Worker, SQLite controller owner, Cloudflare WebSocket connector, uncached private PostgreSQL adapter and strict Edge forwarding from the existing app endpoint. Tests and dry-run evidence are required; none is live-provider acceptance.

The hard 64-room lifetime stop is replaced by 64 exact floors plus an append-only 8 MiB native-memory filter. Retired rooms are never forgotten. Evicted rooms reject all epochs; collisions only deny admission. There is no time pruning or automatic restart. Million-room and turnover tests address normal-use lifespan; increasing saturation can still reduce availability. See RELAY-REPLAY-RETENTION.md. The 8 MiB is runtime array payload, not APK size or measured whole-app RSS.

## Executable deployment sequence, subject to scoped approval

1. Read-only: confirm this account remains Workers Free and supports SQLite Durable Objects and Hyperdrive. Verify the current existing Supabase project mzesveurjzxjybkejqmx / navrang-gate deployment version. Do not read attendance, roster data or secrets for this preflight. Confirm original Android package remains in.navrang.gate.

2. Review the exact platform configuration proposal in server/cloudflare-platform/DEPLOYMENT-PROPOSAL.md. Proposed resources are navrang-voice-control with CONTROLLERS/NavrangController SQLite namespace, and the existing source relay proposal navrang-relay-local-feasibility with ROOMS/NavrangRoom. Initial settings keep workers_dev and preview URLs false, no route, no issuer secrets, no database binding and VOICE_ENABLED=false. This unbound deployment creates persistent resources but cannot activate voice. No paid plan/card/upgrade is permitted.

3. Identify an existing authorized PostgreSQL connection, explicit controller identity and existing owner-managed Ed25519 issuer key/custodian. The issuer key is separate from Android signing and FCM identity. Do not generate or recover credentials from placeholders. If suitable existing material is absent, present a specific creation/custody/rotation proposal separately. Bind the existing database through Hyperdrive only after approval; disable query caching in the actual Hyperdrive resource and verify it read-only before setting AUTH_DB_CACHE_DISABLED=true. That flag alone is not proof. Preserve current SQL grants/RLS and private function checks.

4. Approve exact HTTPS controller and relay origins/routes, issuer identifier/public JWK trust, existing private-key secret import, and the Edge forwarding environment setting. Forward only validated public voice actions to the pinned controller /voice endpoint, with the raw bearer revalidated/hashed there; never expose a hash-trusting public RPC. Present the exact configuration diff and secret names, not secret values. Until these values/resources are identified, no operational credential is minted and no activation is attempted.

5. Run synthetic live qualification only after that scope is approved: prepare/commit ordering, expired/revoked credentials, socket interruption, DO eviction/reconstruction, lost receipts, durable cleanup, same-room clocks, quota exhaustion and cutoff. Controller private DB use is capped at 80,000 queries per UTC day with persisted accounting. This does not budget all incoming HTTP/WebSocket requests or SQLite operations; other Free quotas can reject service earlier. No guaranteed uninterrupted capacity or paid fallback is promised. Fail closed on exhausted budgets, unavailable bindings or missing qualification.

6. Device tests must use the ORIGINAL package and ORIGINAL signing identity. Identify device/serial, installed version, certificate fingerprint, proposed higher compatible version/code and APK hash before scoped signing/install approval. The original private key remains with its custodian on the laptop and must not be uploaded. No separate app, replacement signer, data clearing or historical-APK overwrite is assumed. Start with generated PCM codec checks, then explicitly scoped API24/28/35 microphone, route-change, background, cancellation, CPU/memory, battery and last-audible-cutoff tests.

7. Publish only after live and physical gates, final version/metadata/updater checks and original-key signing approval. Keep API24 and the 25 MiB updater integrity limit. Existing unsigned 0.8.0/code18 artifacts remain diagnostics and are not a new release.

## Push / FCM

Sender, outbox, retries and token invalidation exist. Workspace still lacks original-app Firebase configuration; live Firebase project existence/state is not established. Compute-only metadata identity remains the existing executable sender path. The non-Compute Cloudflare identity proposal is docs/CLOUDFLARE-NOTIFICATION-IDENTITY.md: use only explicitly approved existing service-account material for short-lived OAuth, or a separately specified real federation configuration. No key, project, IAM grant, paid service or secret is created by this plan.

Offline push code now includes the bounded Cloudflare scheduled outbox dispatcher, persistent SQLite quotas, OAuth provider, and administrator-authorized release-hint trigger. Its checked-in Worker has no cron or public route, flags remain false, and it requires a pinned original public signing certificate plus a signed published universal-channel manifest. Live migration/center/delivery flags and real device delivery remain unverified. Preserve registration-token targeting, audience checks, unlink/logout, account switching, stale/reordered message handling and lock-screen privacy. Push is retained, not dropped.

## Approval and evidence boundaries

The earlier NDK approval covered Google's current Android SDK License Agreement and official NDK r30 installation only: https://developer.android.com/ndk/downloads . Recorded agreement dated 28 April 2026, SHA256 2b9af2ef8fdf9f1d1d1419c19ac18f9d7b97a31a0dacdcd07827290c1ebcb21a. No additional agreement acceptance, live configuration, key generation, signing, phone installation or publication occurred in this platform work.
