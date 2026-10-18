# Native Compose source checkpoint — 18 October 2026

This branch implements the master handoff as native Kotlin/Compose source. It is **not a production release or completed device certification**. Start with [the parity matrix](NATIVE-PARITY.md) and [the machine-readable release hold](native-release-evidence.json).

## Reconciled history

The baseline is PR #5 commit `2e01326d3f0ec51e3dd48e8dd5c9bb6fd951460e`, which already contains Teacher Reports PR #2 and the installer fixes merged by PR #3. The bounded workbook importer from PR #4 (`c0f09c36`) is integrated with a real local merge. The existing contributors' branches are preserved.

| PR | Inspected state | Disposition |
|---|---|---|
| [#1](https://github.com/Namdev90/paruluniversitygoa/pull/1) | Merged; post-merge installer process-recreation finding | PR #3 recovery and durable scan fence retained |
| [#2](https://github.com/Namdev90/paruluniversitygoa/pull/2) | Open; Teacher Reports and branding | Source retained through #5; remaining expiry/provenance/retained-registration findings repaired in source |
| [#3](https://github.com/Namdev90/paruluniversitygoa/pull/3) | Merged; installer lifecycle and follow-up fixes | Native app shares the tested updater/runtime/session Java implementation |
| [#4](https://github.com/Namdev90/paruluniversitygoa/pull/4) | Open; CodeRabbit-authored bounded ZIP import | Integrated; native importer independently bounds input, entries, inflation, XML and rows |
| [#5](https://github.com/Namdev90/paruluniversitygoa/pull/5) | Draft; responsive/reporting source checkpoint | Deliberate base; release remains held |
| [#6](https://github.com/Namdev90/paruluniversitygoa/pull/6) | Draft; native-master documentation | Requirements followed; no blind merge of overlapping documentation |

The audit read all available discussion, inline review and review-summary records for these six PRs (41 records), the repository history/branches/archive inventory, 48 Actions runs and failed-job logs for all 16 distinct failing source heads. There were no GitHub Release objects or tags; the 14 APKs in `downloads/` are the historical release archive. Public `main` was `8f145f4916bc2d6eed0a226bca774ae7ffe31bf6` at audit time. Re-read before any future merge/release.

A project-scoped search of both connected mailboxes found 49 relevant messages in one mailbox and none in the other, including two HTML-only automation alerts. All were read. No mail was sent or changed. Private mail bodies, private reference screenshots and security-console identifiers are deliberately absent here.

CodeRabbit draft-skip/autofix-waiting comments do not constitute a completed review. Its PR #4 self-author skip is also not an independent review. Private CodeRabbit scan details require authenticated console access and have **not** been inspected. Their disposition must not be inferred from public PR comments or assumed to be the ZIP issue.

Historical failures covered missing branding/motion assets, reconciliation SQL, generated native art, Python build syntax, report PDF provenance, fresh-bootstrap report SQL, missing portal report scripts and member-management outages disabling report downloads. The integrated baseline repairs those defects. This checkpoint additionally repairs:

- Expired faculty grants: reject approval until the established staff-access renewal path is used; never silently extend access.
- Registered attendance excludes organizer confirmations and includes retained admission evidence after roster replacement.
- Inactive but admitted registrations retain identity/payment fields in reports, with active-list membership stated separately.
- Throughput counts exclude correction-recording timestamps; UI/export labels keep physical entry/payment uncertainty explicit.
- Legacy branding runs after the scanner view tree is installed; its original implementation remains for regression comparison.
- Both verification workflows disable persisted checkout credentials.

SQL changes are **source proposals only**. The deployed reporting RPC differed from the repository and the deployed Edge source was inspected read-only. No RPC was replaced and no real admissions, registrations, approvals or corrections were changed. The 18 historical organizer confirmations must never be replayed.

## Native architecture and build

`native-app` contains all app-owned operational routes in Compose. The module excludes legacy `MainActivity`, `ScanActivity`, `GateBrandingApplication` and `WebViewSupport`; it shares the established domain/session/database/updater/readiness code behind `GateRepository` and `GateViewModel`. It does not package operational HTML or JavaScript. The separate browser portal remains in `app/assets`.

Private rows, searches, drafts, imports, pending outcomes and export buffers stay in RAM. No Room/DataStore/SavedStateHandle/rememberSaveable student storage was added. Existing encrypted `navrang-live-auth` preferences and `navrang-session-v2` Android Keystore alias remain compatible. Sign-out discards private UI state, fences old responses, clears PKCE and Credential Manager provider state, then attempts server revocation. Backup/device-transfer exclusions and `FLAG_SECURE` protect local state.

Credential Manager uses the existing provider's observed web client ID, a fresh hashed Google nonce and raw Supabase nonce. Only the exchanged Supabase access token reaches `google-login`; Google claims never grant roles locally. The secure PKCE Custom Tabs fallback remains. Cloud branding, verification/publication and package/certificate OAuth association are separate unverified gates. No audience, client secret, scope, paid plan, domain or DNS setting was changed.

Pinned stable dependencies were checked against official release documentation and Maven metadata, then actually resolved/compiled:

| Component | Pin |
|---|---|
| JDK / Gradle / Android Gradle Plugin | 17 / 9.6.0 / 9.4.1 |
| Built-in Kotlin / Compose compiler | AGP built-in Kotlin / 2.4.21 compiler plugin |
| Compose BOM / Material 3 / Adaptive | 2026.09.00 / 1.4.0 / 1.3.0 |
| Activity / Lifecycle / Navigation / Fragment | 1.13.0 / 2.11.0 / 2.10.2 / 1.9.1 |
| Coroutines / CameraX | 1.11.0 / 1.6.2 |
| Credential Manager / Google ID | 1.6.0 / 1.2.1 |
| Browser / splashscreen | 1.10.0 / 1.2.0 |
| SDK / minimum / build tools | compile/target 37.0 / API 24 / 36.0.0 |

Sources: [AGP](https://developer.android.com/build/releases), [built-in Kotlin](https://developer.android.com/build/migrate-to-built-in-kotlin), [AndroidX releases](https://developer.android.com/jetpack/androidx/versions), [Compose BOM](https://developer.android.com/develop/ui/compose/bom/bom-mapping), [Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg), [Supabase Google auth](https://supabase.com/docs/guides/auth/social-login/auth-google), and the artifacts' official Google/Maven Central metadata. The wrapper distribution has a SHA-256 pin. A stale incremental D8 resource archive was observed locally after resource changes; the verified acceptance command below deliberately starts from `:native-app:clean`. No incremental-build reliability claim is made.

With JDK 17 and an Android SDK installed:

```sh
sdkmanager 'platforms;android-37.0' 'build-tools;36.0.0'
./gradlew :native-app:clean :native-app:assembleDebug :native-app:testDebugUnitTest :native-app:lintDebug
npm ci --ignore-scripts
npm test
npm run test:native
python3 tests/sqlite-check.py
python3 tests/native-release-gate-check.py
```

The debug app is `in.navrang.gate.internal`, cannot replace the production install, and disables production OAuth callbacks/updating. Debug output is not an approved distributed APK. Release keeps `in.navrang.gate`; the original signing key is never generated, stored in git or uploaded to CI. The original certificate was found and verified locally in this session; that does not prove an in-place upgrade. `tools/build.py` now defaults to the native evidence-gated path. Release version selection, signing, release approval and publication remain held.

## Remaining acceptance work

The parity matrix identifies evidence precisely. Before release, obtain authorized Google Cloud branding/client access and the private CodeRabbit scan detail; finish dedicated synthetic backend integration; exercise API 24 and current Android devices, real account selection and callback continuity, camera permission/lifecycle and all outcome transitions, Help Desk races, export revocation, dynamic/fallback themes, TalkBack/keyboard/IME/resizing, and original-key installer upgrade/cancel/reboot/process-death/missing-file fences. Record measured startup/latency/jank/memory/battery outcomes on identified hardware. No physical device or accelerated emulator was attached in this workspace.

Review and coordinate the additive backend changes against the then-current deployed definitions. Deploy the separately tested portal only when its approval/release conditions are satisfied. Complete N01–N18 and the external gates with real evidence before marking any row RELEASE-READY. A paid authentication domain is optional and requires a separate cost/ownership/migration approval.
