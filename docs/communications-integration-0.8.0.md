# Navrang 0.8.0 source integration status

Checked 18 October 2026. This is a source integration checkpoint, not a signed release or production deployment. The public channel remains 0.7.9 / code 17.

## Integrated source

- Consolidated Reports pages put Downloads within reach without scrolling the normal Reports page. Size-aware metric and teacher pagination, search, and explicit accessibility dialogs keep content reachable at large text sizes and short landscape heights.
- Staged sign-in, confirmation before sign-out, current-permission checks, and cancellable 400 ms presentation transitions preserve authorization and scan acknowledgement behavior.
- Branding PR #13 at `88ee17bee51e29157b00f4a73e5e4c209df3c259` is included, with functional edits reconciled in `index.html`, `art/brand-shell.js`, and `art/classic-restore.css`. The combined artwork SHA-256 remains `8744a792295a49aad9c6ff65fae4f3bf1f6fbb66c766c59acfa4616f179e3397`.
- Additive, service-only communications state provides the five-item feed, separate pinned dashboard, administrator template preview/send, current-capability filtering, transactional activity hooks, device-binding proofs, and a leased delivery outbox. The center and delivery flags default to disabled.
- Report preparation and native save receipts distinguish initiated, saved, cancelled, and failed outcomes. A save is reported only after output flush/close and identity/access checks. Browser downloads report initiation only. The reviewed gate/report function bodies and execute grants are preserved.
- Voice state and coordinator preparation cover duty expiry, room membership, floor leases, acknowledged revocation before a new grant, and quarantine on ambiguous relay responses. Public voice actions remain unavailable until the actual transport and worker are configured and verified.

## Verification at this checkpoint

| Check | Result | Scope and limits |
| --- | --- | --- |
| `npm test` | 385 passed, 3 existing skips, 0 failed | 388 cases, including communications, save outcomes and UI regressions |
| Combined browser review | 531 cases, 0 failed/errors | Six sizes from 320×480 to 640×360, 200% text, Reports controls and synthetic notification preview; no production messages |
| Android unit tests, debug build and lint | 102 passed; build successful; lint 0 errors / 36 warnings | Local offline Gradle run; no physical-device claim |
| Native runtime checks | Passed | Synthetic scanner, camera and updater checks |
| SQL bootstrap and rollback fixtures | All seven passed | Disposable PGlite 0.5.10 / PostgreSQL 18.6; original gate/report bodies, security and ACLs unchanged; fixture data rolled back |
| Real PostgreSQL 17 concurrency | Pending CI | Dedicated loopback-only workflow exercises two actual connections and proves blocking/retention; PGlite does not establish this result |
| Hosted opt-in DOM integration | Skipped | Hosted fixture unavailable |
| Physical-device checks | SKIPPED_BY_OWNER | Explicitly deferred by owner |

The new PostgreSQL workflow uses only a disposable local database and synthetic identities. It does not deploy SQL, send provider messages, access production credentials, sign APKs or publish downloads.

## Release blockers

1. Owner-controlled Firebase configuration for `in.navrang.gate` and a privately configured HTTP v1 sender are not established. Native FCM delivery and real provider-to-device verification are pending.
2. An authenticated voice relay with TURN and strict rejection of revoked initial/reconnect credentials is not established. The relay adapter, native voice client and two-identity transport verification are pending.
3. An independently authenticated delivery and voice-expiry worker has not been deployed or verified. The voice service must reconcile at one-second intervals and fail closed when worker/relay health is stale.

These are service configuration and implementation gates, not a request for another approval. No 0.8 backend or website deployment, version bump, signed APK, download-manifest change or release publication is represented by this checkpoint. Historical APKs, current public APK/manifest and the retained original signing key remain unchanged. Complete transport integration and combined CI before deployment and original-key signing; verify the new APK and public bytes before announcing a release.
