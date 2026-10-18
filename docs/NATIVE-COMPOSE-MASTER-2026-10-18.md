# Native Android master implementation contract

Updated 18 October 2026 from the owner's native Material 3 Expressive instructions and Students/Entry Log scrolling clarification.

**Status: requirements and acceptance criteria only. This documentation change does not implement, compile, test or publish the native application.** The full consolidated execution/release handoff and original screenshots are in the owner's existing private Google Drive master supplied in the initiating conversation. Keep real screenshot data out of this public repository; use synthetic fixtures.

## 1. Outcome and precedence

Implement a complete native Kotlin/Jetpack Compose application, not a Material-styled WebView, CSS facelift, preview-only project or partial homepage. Preserve admission correctness, complete feature parity, security, existing upgrades and the separately hosted laptop portal. This latest native objective supersedes earlier CSS-only styling instructions; it does not relax any data, signing, review or release hold.

Proceed autonomously on routine engineering choices. Missing production signing material stops release, not safe implementation. Keep migration work isolated and do not advertise incomplete native work as finished. The execution priorities are correctness/security/data integrity, feature parity, native presentation, coherent Material 3 Expressive design, responsiveness, and evidence-backed verification.

## 2. Source coordination

Re-read remote source/releases before implementing. At this inspection:

- Main was `8f145f4916bc2d6eed0a226bca774ae7ffe31bf6`, preserving merged installer-lifecycle [PR #3](https://github.com/Namdev90/paruluniversitygoa/pull/3).
- Existing coordinated Java/WebView/portal candidate [PR #5](https://github.com/Namdev90/paruluniversitygoa/pull/5) was open/draft at `2e01326d3f0ec51e3dd48e8dd5c9bb6fd951460e`, branch `feature/navrang-responsive-handoff`.
- PR #5 includes previously inspected Teacher Reports PR #2 work. Do not merge overlapping branches blindly. Workbook hardening PR #4 is separate; inspect its actual tests/status before any inclusion.
- The public manifest still named `0.7.6`, Android code `14`. Proposed `0.7.7`/`15` is not reserved forever or automatically appropriate for an architectural rewrite.

Audit all source, activities/routes/dialogs, docs, assets, tests, server contracts, releases and build/publishing tools. Create an isolated native branch from a reconciled baseline. Preserve newer authorized changes and all existing review/publication boundaries. Do not force-push an owner's branch, automatically merge unrelated work or erase working code before parity.

## 3. Toolchain and design system

Choose a compatible pinned stable Kotlin/coroutines/Flow, Compose, Material 3/Adaptive, Lifecycle/ViewModel/Navigation, AGP/Gradle/JDK and SDK set. Preserve Android 7 / minSdk 24 unless an unavoidable technical constraint is demonstrated and resolved with the owner. Record the exact dependency/BOM/compiler/build compatibility evidence rather than combining the latest number from every library.

The [official Material 3 release page](https://developer.android.com/jetpack/androidx/releases/compose-material3) showed stable `1.4.0` and `1.5.0-beta01` on this inspection. [Android 17 setup](https://developer.android.com/about/versions/17/setup-sdk) identifies API 37. Re-verify at implementation time. Use stable APIs first; an Expressive component requiring a prerelease needs an explicit technical benefit/risk record, compatibility/regression evidence and stable fallback. Never call prerelease APIs stable.

Create shared typography, semantic colour, spacing, shapes, elevation, icons, motion and component-state tokens. Support system/light/dark modes, dynamic wallpaper colours on Android 12+, branded older-device fallbacks, and a dynamic-versus-event palette choice. Use native Material ripple, appropriate spring motion, haptics, navigation bars/rails, app bars, dialogs/sheets, menus, buttons, cards and loading/error states throughout. Keep operational screens clear and responsive; colour alone must never distinguish pending from confirmed.

Retain authentic Navrang and Parul University Goa artwork with original colours/proportions under dynamic themes. Prepare adaptive and legacy launcher/splash resources from verified source artwork; never generate/retype/recolour substitutes. Native launch and optional cinematic intro must be skippable, lightweight, reduced-motion-aware and avoid repeatedly delaying returning staff. Preserve authorized dancer artwork and licensed audio.

## 4. Mandatory Students and Entry Log scrolling contract

The owner's two private screenshots identify **Admin → Students** and **Entry Log**. They are references for functionality/control placement, not finished native designs or proof of scrolling behaviour. Reproduce the current behaviour first.

Both pages need a bounded, independently vertically scrollable row/content region. Keep app bar/title, relevant tabs, search/filter controls and bottom navigation in deliberate stable regions. Keep previous/next, page indicator and result count in a predictable reserved area outside the scrolling rows. Do not move buttons arbitrarily, scroll the whole shell away, add fixed spacers, or relocate controls as row counts/heights change. The row's Edit action remains attached to its row and scrolls with it.

A suitable Compose implementation uses Scaffold with fixed top/bottom control regions and a remaining-height LazyColumn, stable item keys, proper content padding and consumed system/IME insets. Do not put an unbounded lazy list inside another vertical scroller. Do not shrink fonts/touch targets or hard-code eight rows to avoid real scrolling. Retain contract-required paging and accurate total-versus-loaded/recent coverage.

Adaptive navigation rails/two-pane layouts may be used for wider windows, but the placement/order must remain predictable for a given window. Keyboard/window changes may cause deliberate inset-aware resizing; scrolling alone must not shift the pager/navigation. Apply equivalent behaviour to the separate web portal and verify it separately.

### Acceptance tests

- [ ] SCROLL-01: Long/many rows actually scroll; every loaded row and its action is reachable.
- [ ] SCROLL-02: With identical viewport/font/IME conditions, top-control, pager and navigation bounds stay stable across row scrolling within a documented rendering tolerance.
- [ ] SCROLL-03: Empty, one-row, many-row, long-row, loading, error and last-page states do not cause control-area jumps or obscure content.
- [ ] SCROLL-04: Long names/exception labels wrap readably; phone operation does not depend on accidental whole-page horizontal dragging.
- [ ] SCROLL-05: Rotation, large fonts, window/fold changes, IME and gesture/three-button insets do not clip controls; focused fields and back behaviour work.
- [ ] SCROLL-06: Rapid refresh/search/filter/paging does not yield stale/duplicate rows, wrong-ticket actions, overlapping navigation or requests from recomposition.
- [ ] SCROLL-07: TalkBack/keyboard focus order and disabled paging states are correct.
- [ ] SCROLL-08: Correction-recording time is labelled distinctly from unknown physical admission time; permission and receipt coverage remain unchanged.

Use the official [Scaffold](https://developer.android.com/develop/ui/compose/components/scaffold), [lazy list](https://developer.android.com/develop/ui/compose/lists) and [insets](https://developer.android.com/develop/ui/compose/system/insets) contracts when choosing implementation details.

## 5. Complete screen/state parity matrix

For each row, add baseline source/route and role, native code path, contract/state-machine mapping, automated test IDs, rendered/device evidence and truthful status. All native rows start **NOT STARTED** in this requirements PR; do not mark them done from a preview or compile alone.

| ID | Native area | Required parity |
|---|---|---|
| N01 | Launch | OS splash, authentic marks/icons, returning/resumed startup, native event intro, audio, Skip, reduced motion |
| N02 | Authentication | Google/OAuth, staff code, separate administrator, validation, cancellation, failures, expiry/reauthentication |
| N03 | Profile/access | Real names, immutable attribution, pending/denied/suspended/expired roles, station requests/locking, faculty approval/revocation |
| N04 | Stations/navigation | Checker/Help Desk/Faculty once each, prominent separate admin, adaptive navigation and safe back |
| N05 | Checker dashboard | Contract-limited own/total counters, connectivity/pending work, scan launch and manual-ID fallback |
| N06 | Camera/scanner | Native preview, lifecycle, focus/torch/zoom/reset, overlays, permissions, decode aids, held-code suppression/backpressure |
| N07 | Outcomes | Confirmed, duplicate, blocked/payment, unknown/invalid, pending/delayed, late final response, acknowledgement queue, revoked access |
| N08 | Entry history | Authorized receipts/My Scans, attribution/time meanings, accurate totals/paging/search and the scrolling contract |
| N09 | Admin Students | Search/filter/paging, eligibility/payment/admission states, details/add/edit, validations and scrolling contract |
| N10 | Admin entries/summary | Authorized ledger, aggregates, missing-data exceptions, evidence provenance and available audit details |
| N11 | Staff administration | Codes/Google accounts, names, approve/assign/suspend/revoke, expiry and first-station restrictions |
| N12 | Help Desk form | Existing fields, fee preview, validation, duplicate checks, UUID retries, unconfirmed save and draft clearing |
| N13 | Help Desk cases | Scoped list/detail/history, paging/filter, pending edits, optimistic versions, approve/reject, payment/same-person linking/audit |
| N14 | Faculty Reports | All twelve candidate categories/definitions, unmatched admissions, teacher grants, full admin report access and export visibility limits |
| N15 | Exports | Authorized College CSV, CSV/XLSX/PDF, native document picker, safe formula/text handling, progress/cancel/errors and revocation guards |
| N16 | Settings/account | Profile/station, sign-out, appearance/dynamic palette, notifications, permissions/readiness, audio/accessibility, about/licences/version |
| N17 | Update lifecycle | Check/download/progress/retry, scheduling/notification, original signer checks, install/cancel, restart/reboot, missing files and scan fence |
| N18 | Secondary states | Every app-owned dialog/sheet/search/filter/tooltip/snackbar/loading/skeleton/error/empty/validation/success/exit screen |

Retain permission-limited staff visibility even when richer UI would be easy. Platform-owned OAuth/permissions/installers and proven native preview views are allowed integrations; an app-owned WebView wrapped inside Compose is not completed native parity.

## 6. Architecture, security and native integration

Separate presentation/navigation, immutable ViewModel state, domain state machines, repositories/API contracts and platform services. Reuse reliable tested Java runtime/session/scanner/updater services behind Kotlin interfaces where appropriate. Compose renders state; it must not initiate requests solely on recomposition.

Preserve application ID `in.navrang.gate`, original signing and in-place upgrade identity, existing Keystore/encrypted sessions/preferences compatibility, Google/admin authentication, server-controlled roles/approvals/stations, one-entry/idempotency/immutable receipts, pending/acknowledgement/revocation guards, Help Desk reviews/audits and exact backend payment/eligibility rules. Do not mutate production student records during the UI rewrite or test live admissions using real attendees.

Student rows, receipts, names/tickets/search strings and Help Desk drafts remain RAM-only. Do not introduce them into Room/DataStore/preferences, SavedStateHandle/rememberSaveable/Bundle, WorkManager payloads, disk/network caches, logs, crash breadcrumbs or screenshots. Persist only approved non-student settings/session state and installer/download metadata. On sign-out/expiry/identity or access change, cancel stale work, clear private state/export buffers, stop unauthorized camera work and dismiss overlays. Process recreation must not fabricate recovered data or confirmed admissions.

Preserve documented missing-registration corrections and their unknown name/payment/exact physical time. Never replay them blindly, invent fields or interpret all failed scans as admissions. Clearly label correction recording and observed scan evidence, distinguishing them from actual entry time. Duplicate attempts are not extra people; no verified entry is not proven absence. Keep deployed contracts backward-compatible with the portal and existing clients; compare active SQL/Edge work before any separately reviewed migration.

Use real Android dynamic colour, edge-to-edge/insets, predictive back, adaptive resizing, permissions, native camera lifecycle, haptics/audio, channels/notifications, Storage Access Framework and secure scheduled update downloads. Avoid unnecessary permissions/services. Preserve PR #3's Android-owned installer-session recovery and scan fence after process recreation/reboot; a ViewModel-only flag is inadequate. Do not promise revocation can retract documents already saved outside the app.

## 7. Performance and QA

Preserve 0.7.6 session-snapshot reuse and off-UI-thread camera startup/cleanup. Keep network, encryption, camera configuration/release and large file work off the main thread. Use efficient lazy rendering/recomposition, bounded analysis queues, lifecycle-safe Flow/coroutines and cancellation. Deduplicate rapid taps and polling without sacrificing required server freshness. Give immediate feedback without implying premature success.

Record baseline and measured startup, tap feedback, jank/scrolling, scanner latency, memory/battery results with device/API/build/method details. No invented frame-rate, battery or zero-failure guarantees.

Add domain/unit/contract, Compose/navigation, screenshot/golden and equivalent legacy regression coverage. Test every result/auth/access/revocation state, camera permission/reopen/cancel, network latency/disconnection/retry, Help Desk concurrency, exports, and installer process/reboot/cancel/missing-file paths. Test API 24, Android 12+ dynamic colour, Android 16/17, tablets/foldables, both themes, font scaling, IME, accessibility/TalkBack/contrast and reduced motion. Use synthetic fixtures only.

Separate simulations, previews, source rendering, emulators, physical phones, live portal and profiling results. Previous candidate CI counts do not verify the rewrite. Record exact final source, commands, passes/fails/skips and unresolved gates. Retain each old safety test or document its equivalent native replacement.

## 8. Build/release and portal boundary

The legacy `tools/build.py` compiles Java and packages web assets; it does not automatically compile Compose. Adapt the validated build entry point/Gradle bridge while preserving signer, anti-rollback and metadata checks. Do not let an old one-line launcher build the wrong legacy artifact after migration.

Use only the original locally held production key; never generate/substitute/disclose/transmit/commit one. Expected certificate SHA-256:

`0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`

Missing original key blocks production signing/publication, not code review. Never publish unsigned/different-signature/partial native builds. Select an unused coordinated version/code and preserve original package/session/update compatibility. Recheck remote branches/holds, tests, staged privacy, actual APK signature/package/version/bytes/hash, matching manifest/checksum, real in-place upgrade and independent public download. Do not bypass safety-tool blocks or review requirements.

Keep the existing laptop portal operational with original domain/audience/OAuth/backend contracts. Retain its web assets and responsive packaging. The Android rewrite does not authorize removing its code or moving it to another hosting service. Deploy only via the original authorized site workflow; packaging/source pushes are not deployment.

## 9. Execution and deliverables

Audit/reconcile baseline → establish compatible native build/design system/state adapters → migrate complete functional flows with tests → satisfy all eighteen parity areas and eight scrolling criteria → render/refine/profile/accessibility/device verification → permitted original-key release and independently verified portal deployment.

Deliver working native code, shared system, all workflows, build/dependencies, tests, evidence-backed parity matrix, screenshots/recordings where available, measured results/skips, installation/technical/release docs, focused commits/PRs and the permitted signed artifact/metadata. Update GitHub's feature/version presentation accurately with synthetic screenshots; preserve archives. Save evolving long instructions into the owner's private master handoff and return one short launch line. Do not claim a documentation PR or partially migrated branch is the completed application.
