# Navrang v0.9 acceptance matrix

Checked 2026-10-26T03:04:47+00:00. Local implementation/evidence only; NOT a signed release certificate. No production migration, provider activation, billing or phone installation occurred. Original signing identity is recovered and independently verified privately; no replacement key or separate test app exists.

| Requirement | Implementation/evidence | Remaining acceptance |
| --- | --- | --- |
| Paging/floating controls removed; all authorized records reachable; real workflow Back/Next preserved | gate.js/report-layout.js/CSS; source tests; native501-record delta projection test | Final screenshots and installed-build keyboard/large-text checks |
| Header/logo scroll; overflow traps removed; burgundy/gold retained | Existing source/responsive fixes preserved | Current responsive matrix and final device acceptance |
| Deterministic nearest-side/corner motion; cancellation; reduced motion | presentation-motion.js and source tests | Optimized installed-build acceptance |
| Scanner, reports, export, temporary offline queue and existing role scopes | Current600-test source suite:597pass/3skip/0fail; native JVM/scanner/updater regressions pass | Final signed APK/device checks; private workbook fixtures remain skipped |
| Five role-filtered communications items and separate live card | Local center/SQL/worker/native code; delivery mock/SQL fixtures pass | FCM project does not exist; configuration/live delivery unverified |
| Half-duplex voice, admin preemption, leases/revocation and worker-death cutoff | Native Daily binding and isolated Edge/cleanup patch integrated fail-closed; acquisition stays503 | Strict INR0 transport/controller/native acceptance unresolved; parent owns isolated Cloudflare prototypes |
| Transparent post-login consent; selected-person locator/find-me; Stop/expiry | Local UI/native/strict SQL with assignment, separate opt-ins, one target, cooldown/replay; rollback/race tests pass | No actual GPS/push/sound/DND/brightness or deployment acceptance |
| Core registration without unrelated permissions; contextual settings | Native/readiness implementation and host tests retained | Physical permissions/settings acceptance |
| Persistent login without transient-error logout | Native encrypted vault/HTTP + browser HttpOnly gateway;15min access,7dayidle/30dayabsolute refresh policy | Reviewed production activation and browser HTTPS hosting; no policy waiver |
| All-user biometric lock; cold start; monotonic30sec grace | Native host and process-bound callbacks, scanner/picker/privacy gates;250Android tests pass | Physical biometric/PIN/screen-lock/process/update checks |
| Push-first data/update hints; quota control | Private authorized domain hints and administrator-only dataset burst trigger pass rollback tests;54UI quota checks;30min APK fallback/5min active-admin; no automatic APK download | Live FCM/controller configuration and resource-budget acceptance |
| ABI size and compatible delivery | Verified17-file patch integration;173updater/29signature/31cadence/10metadata tests. Optimized unsigned:arm64 18.77MiB,ARMv7 17.16MiB,x86-64 20.07MiB,universal38.55MiB | Universal exceeds legacy25MiB. x86 output lacks Daily native library and is NOT equivalent voice support. Release scripts/compatible migration and final transport packaging remain |
| Original signer, package/version, saved data/history | Original key usable; public-only Windows verifier4tests plus actual preservedv0.8APK verify expected original certificate/package/version; historical APKs untouched | Current version remainsv0.8/code18 diagnostic; finalversion, original-key metadata proofs/signing/upgrade and physical acceptance pending |
| Final optimized build and publication | Isolated all-SDK optimized assembly succeeds;250Android tests,0lint errors/33warnings | No signedv0.9 candidate; JNI/callback/media/device acceptance and independent public download checks required |

Source and native JVM checks pass after both isolated patches. Additional public-verifier change has its own scoped tests and historical public-APK verification. Generated APKs are unsigned diagnostics with live flags false; they must not be presented as installable updates or feature acceptance. No account/credential creation or deployment is authorized by the INR0 requirement. No denied signing helper or public controller grant was revived.

Current responsive evidence:183cases pass at320x640,390x844,1024x768 with synthetic accounts and blocked real networking. Mobile list/readiness pixels inspected. No Android OS prompts, GPS/audio or device install tested.
