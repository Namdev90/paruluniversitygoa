# Release readiness, 5 November 2026

This is a preparation checkpoint, not a release approval or publication receipt.

## Approved backend work and rebuilt candidate, 15:42 UTC

The user explicitly approved the three named report, session-renewal and locator migrations plus the reviewed same-address Edge deployment. Report receipts (`20261105151406`) and renewal (`20261105152620`) are installed and independently verified. Both used exact source bytes with transaction-level collision, source, ACL and RLS guards. The legacy gate and notification hook are preserved, new tables are empty, and existing sessions have no family IDs. Renewal issuance remains off in the deployed old Edge version. Locator has not run: two platform confirmation windows expired and fresh catalog checks show no migration, tables or RPC. No further retry is underway. See `production-feature-evidence-2026-11-05.json`.

The ten-file reviewed Edge artifact is staged but not deployed. Its only changes are hard-disabled new renewal issuance and absent voice-forwarding origin, preventing unknown environment flags from enabling either. Eight synthetic integration cases passed twice. Existing refresh/revoke compatibility routing is retained; do not claim the refresh endpoint is removed or disabled.

The official build toolchain has now been restored and the earlier Java 17 metadata blocker is resolved. Current runtime `87d7a57` passes all 317 Android tests, the complete 19-entrypoint native chain and debug/release lint (zero errors, 32 warnings each). The fresh real four-ABI optimized universal APK is 10,002,238 bytes, SHA-256 `d2b45aef37bc3d54e07f4a968f598f2b46f9c1a4e8c45e22b1f521a5c574b611`. Its native libraries, 16 KiB alignment, exact guarded locator/public configs/login CSS and original artwork were verified. It remains unsigned, code18, voice/push disabled and is not a release candidate.

Read-only laptop preflight confirms the original signing-custody file is present and its separate public certificate matches the expected identity. Private bytes/password were not read and unlock/signability was not tested. Existing ADB works but lists zero devices, so physical-device acceptance cannot run yet. No signing, installation, version change, source push or publication occurred. Required later scope/activation, main-based integration, source/version approval and device gates remain in force.

## Latest preparation, 14:59 UTC

GitHub is now the primary repository and update channel. GitLab is a secondary source-history backup. The existing GitHub updater URLs, original signing identity and published 0.8.0/code18 artifacts remain unchanged.

The earlier cloud checkout and toolchains were no longer present. The saved version-2 recovery archive was restored with its exact SHA-256 and all 623 payload hashes verified. Its complete standalone recovery history is preserved. A read-only fetch confirms GitHub main remains `b8605c5e5e694bc741a3d36b26bf76c8ab7f4ac1`. This recovery history starts at imported root `0e8af76`, not public main, and intentionally omits all 18 historical APKs. Future integration must preserve public history and downloads on a main-based branch; never replace main wholesale with this recovery tree. `updates/latest.json` and `SHA256SUMS.txt` are unchanged relative to public main.

Two additional app defects were repaired locally. The native and browser public Auth configs had recovery placeholders; both now use the exact currently published, enabled public Supabase key. The native config is byte-identical to public main. No credential was created or permission changed. Public Auth settings and the existing application config endpoint both returned HTTP 200 with Google enabled; this is not a completed user OAuth sign-in. Locator actions now remain unavailable until a successful duty-status response, reset for a replacement identity, and close an open consent dialog on 401/403 so it cannot trap the user. A successful retry clears the old failure message. No feature was enabled or removed.

The complete updated Node suite passes 857 cases: 854 passed, three expected fixture/environment skips, zero failures. Six new regression cases cover public-config parity and locator loading/denial behavior. Independent focused UI review passed. The native chain progressed through push policy but stopped at voice policy because the installed JRE compiler module lacks the Java 17 release metadata required by `javac --release 17`. This is an incomplete toolchain, not a passing native check. No new Android APK was built. The prior 317 Android tests, lint, four-ABI artifact and 30 browser-render cases certify the earlier `e45f611` runtime only, not these later asset edits.

Fresh read-only hosted checks confirm Edge v7 is unchanged; report operations, renewal and locator migrations are absent. Both approved connector logins and Hyperdrive resources retain their restricted configuration, and no AUTH_DB Worker bindings exist. Notification center and delivery remain disabled. The three additional migrations, Edge replacement, bindings, issuer/FCM credentials and activation still require their applicable explicit approvals and live acceptance. No production mutation, signing, source push or publication occurred during this preparation.

A qualified all-feature release is possible only after those backend/service prerequisites and acceptance gates are complete. A narrower visual/reliability release is a separate scope choice, not the current app with native push/voice flags simply set false: its notification composer and locator panels are still present and expect the matching API. Any agreed narrower build needs explicit feature presentation/configuration and fresh testing. Neither option may reuse code18, an older source's device waiver or the unsigned diagnostic APK. Coordinate the next unused version only after source scope is settled, integrate onto GitHub main while retaining archives, rebuild and verify final bytes, sign in original local custody, qualify in-place upgrade/device behavior and verify canonical public downloads after authorized publication.

## Verified current state

- Remote main was rechecked at 08:48 UTC: `b8605c5e5e694bc741a3d36b26bf76c8ab7f4ac1`. The public updater remains 0.8.0/code18, original package `in.navrang.gate`, APK SHA-256 `8dd7423a67b69fa882a9115f5f1313fe930dfe6ec12c26ca62ff8b1215243fe4`. No open pull requests were returned by the connector.
- The recovery descends from verified archive commit `b70be8dc881a6b914ac3ceb7625a1784685ff144`. Missing historical commit `bedf9e3` was not recovered; later repairs and their verification are new source work, not a claim to reproduce that commit.
- Both approved boundary migrations are installed and verified. See `production-boundary-evidence-2026-11-05.json`. Notification center and delivery remain disabled, and no credentials or active Worker bindings have been created by this work.
- Fresh isolated PostgreSQL 17.11 tests passed 30 boundary validation groups. A separate deliberately public dummy-password fixture passed ten SCRAM/membership groups, including actual authentication and cross-capability denial. These are not production connection or credential-custody proofs.
- Real NDK r30 API24 builds passed for all four supported ABIs. See `opus-four-abi-evidence-2026-11-05.json`. Host JNI tests are not physical-device audio acceptance.
- Diagnostic Android source `8e45506` compiled and assembled an unsigned universal APK of 10,001,834 bytes, SHA-256 `e2c05cf014d6e98fa88f0f97ae038bfb57284249ee08023e067c4c2114a94164`. It was old version/code18 with voice and push disabled. All four Opus libraries and 16 KiB ELF/ZIP alignment were verified. The existing signing pipeline's alignment-only step also preserved alignment on a new diagnostic copy. No key was read and no signing occurred.
- At that checkpoint, 310 existing Android tests, seven additional retained-Compose login tests, and full debug/release lint passed. Each lint report had zero errors and 33 warnings. Production login CSS was changed afterward and requires a new source-bound build receipt.

## Actual production login

The manifest launches `MainActivity`, which extends `ClassicActivity` and loads `assets/index.html`. Retained Compose screens are not the shipped login. The restrained production visual change is scoped to `#view-login` in `app/assets/art/classic-restore.css`, preserving the existing dark shell and maroon brand surround. See `LOGIN-PRESENTATION-2026-11-05.md` for the precise test distinction and browser execution blocker. No classic browser screenshot is claimed yet.

## Backend deployment gaps, read-only inspection at 08:53 UTC

Supabase project `mzesveurjzxjybkejqmx` still runs `navrang-gate` Edge version7, bundle fingerprint `6ff31de8a6f4ea2b01f0d180ae0f854a21691f940f5fc22d0f8d46e941389fd2`. Its five deployed files contain the previous attendance/reporting handler, not the new communications, locator, session-renewal and voice-forwarding composition. An installed database wrapper does not deploy that API.

After normalizing CRLF, deployed core `navrang_gate`, `navrang_communications` and private `voice_rpc` bodies match the reviewed local baseline. Do not blindly replace these functions or replay the fresh schema. Read-only catalog inspection confirms the following separate features are absent:

- `navrang_private.report_operations` and `public.navrang_report_operations`.
- `navrang_private.session_families` and `navrang_private.session_refresh_tokens`; the core gate still matches the original pre-renewal body.
- `navrang_private.locator_consents`, `navrang_private.locator_requests` and `public.navrang_locator`.

The corresponding source migrations require separate review, exact transactional validation, preservation of existing data and scoped approval where they alter authentication or persistent access. They are not covered by the two boundary-migration approvals.

## Outstanding release gates

1. Verify and authorize exact dedicated database logins and Cloudflare connections. Current pending scope does not include Worker bindings. A precomputed SCRAM verifier is sensitive; putting one into a migration stores it in migration history. Do not describe that route as secret-blind or log-free.
2. Separately approve any Worker bindings, issuer custody, routes, Firebase credentials, deployment and activation. Confirm zero-cost limits and qualify actual clock, cleanup, revocation, relay and push behavior. Do not copy the Android signing identity into these services.
3. Review and deploy matching app API and missing backend feature migrations without resetting existing data. Do not substitute a disabled diagnostic APK for an all-feature release.
4. Freeze and coordinate an unused version/code with fresh source-specific release evidence. Code19/0.9.0 remains a proposal, not reserved or published. Prior device waivers do not carry over automatically.
5. Build with intended final configuration, verify the universal25MiB cap and four-ABI contents, sign only in original local key custody, verify in-place upgrade and physical feature acceptance, and publish exact APK/manifest/checksum only after all applicable gates pass. Independently verify public bytes afterward.

No paid plan, private-key transfer, phone installation, source push or new release publication was performed by this checkpoint.

## Final diagnostic build checkpoint

Frozen source `675cede7dfc050dd0d8d787bd2b9e9d0e350f3a6` passed the full 851-case offline suite (848 passed, three expected fixture/environment skips), all 19 native policy test entry points, 317 Android tests and full debug/release lint (zero errors, 33 warnings each). Its unsigned universal APK is 10,002,158 bytes, SHA-256 `60814bb742e24fbc4000bdfac411ce06b4f4f573e911f610a061f0ed9913b6ed`. All four real Opus libraries, 16 KiB alignment, original artwork and exact production-login CSS were verified from APK bytes. See `android-diagnostic-evidence-2026-11-05.json`. The release-candidate gate correctly refuses old code18. No release gate was bypassed.

The user has separately requested GitLab migration. Preserve the existing GitHub updater/download contract until an authorized replacement channel is verified. Source-host migration alone must not alter installed clients' update trust or URLs.

## Latest corrected build and approved connections, 09:22 UTC

Corrected source `e45f611bc50123a0293a2580167839bd35a60466` passes all 317 Android tests, debug/release lint (zero errors, 33 warnings), the complete native chain, and 851 offline cases (848 passed, three expected skips). All 30 actual production-DOM synthetic browser cases pass. The corrected unsigned universal APK is 10,002,186 bytes, SHA-256 `64bd21bd3efc507c8d5338a1f93387abf3b06b9b466641f817bf68aa73f13cf9`; exact corrected CSS, original artwork, four real Opus ABIs and 16 KiB alignment are verified. Old version 18, disabled voice/push and missing final release/device/signing gates still prevent publication.

The user specifically approved the two dedicated logins and two corresponding Hyperdrive connections after credential-custody disclosure. Both were created and independently read back with exact restricted privileges, TLS require, caching disabled and five-connection limits. No Worker binding or feature was enabled. See `production-connection-evidence-2026-11-05.json`. The earlier pending-connection statements above are historical, not current blockers. Migration-history statements containing real SCRAM verifiers must never be copied into public source or evidence bundles.

Fresh hosted-order PostgreSQL preparation for the three separate missing migrations passes 38 groups, including 19 SQL-suite runs across 11 unique suites, five real concurrency scenarios, 48 focused dependent-rebind assertions, individual forced rollback and identical-repeat checks. Nine new tables retain RLS; new RPCs remain service-only; legacy gate and existing boundary/hook behavior are preserved. Those production migrations remain unapproved and unexecuted. The focused rebind check passed for own-family refresh/retry, other-family/principal isolation, locator continuity, logout, revocation and legacy sessions. Live hosted/client/provider and scheduled retention acceptance remain separate.
