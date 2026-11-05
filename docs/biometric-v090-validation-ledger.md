# Biometric and deferred-document validation checkpoint

25 October 2026, local work only. No signed candidate or phone installation.

- Original six failing host assertions were traced to synthetic process/application fixture reuse. Isolating owned test statics produced eight passing API24/35 host checks without weakening policy.
- Deferred reports hold destination/content in memory while locked, resume once, and drop on identity/access loss. A real host test plus ReportSaveCoordinator fixtures produced22 passing cases. GateSession logical-family tests pass within144 real encryption/cache checks; old bearer tokens remain invalid for HTTP.
- Expanded PIN/result/lifecycle group produced27 passes and two exact-boundary failures. Timestamp diagnostics showed duplicate starts in the test sequence. Inspection of installed Robolectric4.16.1 ActivityController bytecode confirmed restart() invokes performRestart(start=true). Calling start() again was an invalid simulation. Both exact-boundary cases pass with restart().resume(); combined and full Android aggregates still need rerunning.
- The native UI now exposes device-credential fallback and defers a successful current OS result delivered before onResume. It accepts the result only on a visible, device-unlocked host within the monotonic thirty-second window, and rejects replaced operations. The actual physical biometric/PIN boundary is mocked in these tests.
- Full source aggregate after these source changes:526 total,523 pass,3 skip,0 fail. Full native JVM suite passes, including144 vault,21 renewal/HTTP,21 app-lock policy,37 runtime and existing scanner/updater/push/voice safety checks. Earlier Android172/lint38-warning results predate this integration and are not final acceptance.

Next security/lifecycle work before claiming this feature complete:

1. Bind external credential launch/result IDs to a per-process random nonce as well as their operation ID. Restore only matching-process metadata. Numeric counters can repeat after process death; a restored old result must never authenticate a new operation with the same number. No successful proof or unlocked flag may be persisted.
2. Audit locked back/deep-link/notification routes, long external pickers, rotation during an active prompt and Activity destruction. Preserve drafts/queued records; do not exempt scanner or voice from lock expiry.
3. Remove automatic startup permission bundling and keep contextual purpose/settings links, including notification settings fallback on API24.
4. Rerun the complete Android suite/lint and final responsive/reduced-motion/large-text checks, then independently authorized physical-device tests. No device acceptance is implied by JVM or Robolectric results.

No pending source approval or execution hang existed at this checkpoint. Live FCM/controller/voice configuration, budget/capacity/retention decisions, final signing and full v0.9 feature acceptance remain separate gates. The original recovered signing material remains private and was not opened or transferred by this implementation task.

17:35 UTC update: the process nonce/operation-bound credential callback fence is implemented. Focused host/permissions/report group39/39 passes. The complete Android run found a real scanner updater-block ordering bug: unlock foregrounded before scanner navigation; navigate now recomputes scanActive from the actual foreground/destination. The failing scanner assertions then passed in the full202/202 Android run. Release lint succeeds with0 errors/42 warnings; new lock warnings are text localization. Startup no longer bundles camera/notification permission requests; readiness opens system settings and uses a supported API24 notification fallback. Locked Back/clipboard routes are gated. Physical biometric/device-credential acceptance remains NOT_RUN.

Source aggregate after locator contracts:534 total,532 pass,2 private-input skips,0 fail. Full native JVM check aggregate passes. These are code/fixture results, not a signed candidate or live-provider/device acceptance.
