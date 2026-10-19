# Changelog

## 0.8.0 — Android code 18 · 19 October 2026

- Approved combined Navrang/Parul University artwork and maroon styling, staged sign-in, confirmation before sign-out and reduced-motion-aware screen transitions.
- Consolidated Reports with reachable Downloads, measured metric/teacher pagination and explicit large-text accessibility dialogs.
- Guarded local report-save completion, cancellation and failure; browser downloads report initiation. Uses the existing repaired reporting backend without a new deployment.
- New messaging, voice messages and live broadcasts are deferred by the owner. Existing APK-update notifications are retained.
- Original-key-signed APK: 23,634,731 bytes; SHA-256 `8dd7423a67b69fa882a9115f5f1313fe930dfe6ec12c26ca62ff8b1215243fe4`. All seventeen previous APKs are preserved unchanged. Physical checks remain SKIPPED_BY_OWNER.
- Fresh local build: 102 Android tests passed; release lint 0 errors/37 warnings. Source CI passed 704 browser cases. [Signed artifact and source evidence](docs/RESTORATION-RELEASE-0.8.0.md).

## 0.7.9 — Android code 17 · 19 October 2026

- Faithful transparent owner-supplied wordmark, deeper burgundy/gold surfaces, tactile admin tabs and non-overlapping launch animation with an immediate skip action.
- Screenshot/screen-capture allowance, searchable scrolling lists without paging buttons, and usable compact Help Desk list/review controls.
- In-camera exact-ID verification; available registration, payment and receipt details with absent fields hidden and genuine zero/false values retained.
- Automatic local focus/light and conservative full-frame QR zoom assistance, including stale-frame rejection and rotated/off-centre bounds checks. Hardware acceptance remains pending.
- Safer report generation for populated and empty datasets, authorization/selection races and failed refreshes; exact UTF-8 import-size validation.
- Persistent release update checks/downloads, including upgrades with an old saved opt-out. Android still controls background scheduling and installation consent; internal/debug builds stay isolated.
- Download data leads on phones, and Reports scrolls inside the fixed app header/navigation. The reviewed reporting backend repair and hosted portal are live; authenticated administrator summary and owner-confirmed CSV export passed.
- Original-key signing, APK integrity, source CI and independent layout review passed. Physical-device checks remain SKIPPED_BY_OWNER for post-release testing.

## 0.7.8 — original design restored · Android code 16 · 18 October 2026

- Restored the original burgundy/gold screens and exact gold Navrang logo, including the launcher.
- Retained current Credential Manager/PKCE sign-in, CameraX, encrypted sessions, RAM-only private records, staff authorization, Help Desk, reports/exports and updater recovery.
- Kept bounded row scrolling with stable controls, native CSV/XLSX imports, both staff grants, durable sign-out/retry and fresh document-save authorization.
- Preserved an explicit native browser/PKCE sign-in fallback when Credential Manager cannot complete, with internal-build isolation.
- Fixed import refresh coalescing and scanner/update coordination across pause/resume. Verify the manifest-resolved launcher PNG as well as the web logo; generated back-navigation hooks fail closed if their source patterns change.
- Original-key-signed APK: 21,176,693 bytes; SHA-256 `b72cd7bdc99883cd9052f3873885073a153f8cb8c83293ffe7191040e415fc60`. All fifteen previous APK hashes are unchanged.
- Verified 179 Node passes (3 skips), 313 Java checks, 55 Android host tests, 136 synthetic visual cases, release assembly/lint (0 errors/36 warnings), publication and source/waiver gates.
- The owner explicitly approved 0.7.8 publication and bypassed remaining handoff acceptance holds at 21:37:24 IST. Unperformed device/upgrade/performance/hosted checks remain skipped, not passed. Production data, backend/portal deployment, OAuth configuration, saved-station authorization and paid services are unchanged.
- [Signed artifact, approval and verification record](docs/RESTORATION-RELEASE-0.7.8.md).

## 0.7.7 — native Compose release · Android code 15 · 18 October 2026

- Rebuilt N01–N18 workflows with native Compose/Material 3, CameraX scanning, Credential Manager and secure session exchange.
- Students and Entry log have bounded scrollable lists with fixed search/pagination controls; compact large-text and wide navigation regressions are covered.
- Preserved original signing identity, encrypted-session compatibility, RAM-only private data, role authority, updater and installer recovery.
- Added bounded native imports, twelve report datasets and CSV/XLSX/PDF exports; corrected lifecycle, sign-out, profile ordering, registration validation and export races identified in review.
- Original-key-signed APK: 19,823,096 bytes; SHA-256 `cfffe5cb2e83f22c47c9e41a86c56510516e3da014461ade771f3c315e275e5a`.
- Verified 49 native host tests, 165 Node passes (3 skips), 313 Java checks, SQLite, 7 publication-policy and 11 native-gate checks. Release assembly/lint and all three CI workflows passed.
- Google branding is deferred. The owner explicitly waived remaining device/sign-in, upgrade/reboot, performance and backend/portal acceptance evidence; those checks remain unverified. No production database, hosted portal, OAuth settings or paid domain was changed. All fourteen historical APKs are preserved.
- [Exact release, review and waiver record](docs/NATIVE-RELEASE-0.7.7.md).

## Published archive

| Version | Android code | Archive commit date (IST) | What changed |
|---|---:|---|---|
| [0.7.6](https://github.com/Namdev90/paruluniversitygoa/commit/0a5c8a2bd577ab5afddc96ef7ed22e28fa3cc19e) | 14 | 2026-10-18 09:33 | Removed repeated secure-session decryption from button/profile checks; moved camera startup/configuration/release off the UI thread with cancellation and lifecycle guards. |
| [0.7.5](https://github.com/Namdev90/paruluniversitygoa/commit/85fc4dd306d8c49c68a14af128ecb5de4657e489) | 13 | 2026-10-17 19:26 | Merged PR #1: pending scan warnings recover on final server response; installation waits for unresolved admission requests, with rechecks before Android confirmation. |
| [0.7.4](https://github.com/Namdev90/paruluniversitygoa/commit/aa14bbefb99838ab31c8fff87081807541387045) | 12 | 2026-10-17 17:02 | Fixed native profile-save acknowledgement races, admin station navigation, queued scanner issues and late receipts; restored opening-button centering and older-WebView popup fallbacks. |
| [0.7.3](https://github.com/Namdev90/paruluniversitygoa/commit/65f7cd0611fa25134bbc9946b929ba73d471eaf2) | 11 | 2026-10-17 16:46 | Production audit: scanner lifecycle/receipt handling, per-ticket pending deadlines, Help Desk search/save/review races, export safety, accessible UI and release-policy checks. |
| [0.7.2](https://github.com/Namdev90/paruluniversitygoa/commit/f762dae0fa8da76a4f8d1bf491a0d9465b11efc2) | 10 | 2026-10-17 14:02 | Remembered staff station and restricted ordinary staff sync to My scans / Total entries. Removed bulk roster/history/contact exposure from the staff summary path. |
| [0.7.1](https://github.com/Namdev90/paruluniversitygoa/commit/2dd3647240eeefb219c3e013a068267001a025a1) | 9 | 2026-10-17 13:36 | Immediate sign-out, expired-session cleanup and protection against late responses or exports resurfacing private details. |
| [0.7.0](https://github.com/Namdev90/paruluniversitygoa/commit/ee0249470e1e14276c1c83874614c19b68582464) | 8 | 2026-10-17 13:03 | Checker/Help Desk station picker, named staff access, server-enforced station permissions and retained Google sign-in. Station intent is not permission. |
| [0.6.1](https://github.com/Namdev90/paruluniversitygoa/commit/5dd88797598584e309f3b6561a7aa6ad9011c38b) | 7 | 2026-10-17 12:21 | Kept text fields editable while suppressing unwanted blue control highlights and selection wash. |
| [0.6.0](https://github.com/Namdev90/paruluniversitygoa/commit/fbc636da9a3823a5426d6c20a22442d6db9e0410) | 6 | 2026-10-17 12:17 | Four-field Help Desk form, licensed local scan/interface audio, tactile controls, complete separate dancer artwork and safer close/exit messaging. No persistent student database on devices. |
| [0.5.0](https://github.com/Namdev90/paruluniversitygoa/commit/c9c43bbc46c3a1e9a1e9c7349fc16cd55e28cb92) | 5 | 2026-10-17 11:26 | Server-backed Help Desk, laptop companion portal and Android station-readiness controls. Administrative review and privacy boundaries for registration work. |
| [0.4.0](https://github.com/Namdev90/paruluniversitygoa/commit/18278c9cd6c6f5fef479de8f0630fe6a2db0fa0f) | 4 | 2026-10-17 10:52 | Horizontal university branding, motion refinements and signed in-app update checks/download/installation workflow. Older installations need a manual bootstrap upgrade. |
| [0.3.0](https://github.com/Namdev90/paruluniversitygoa/commit/82b603ef46936c721c95fa90974e4b8d81dc6788) | 3 | 2026-10-17 09:51 | Dark event interface, administrator rehearsal, real-name checkers, scanner assistance, low-light/zoom/focus guidance and distinct outcome feedback. Rehearsal/simulation was subsequently removed. |
| [0.2.0](https://github.com/Namdev90/paruluniversitygoa/commit/a192e292fd9e90282dbd1d39660446008927c1b0) | 2 | 2026-10-16 23:23 | Shared server admission, named checkers, live admin view and continuous Android scanning. First shared gate operation baseline. |
| [0.1.0](https://github.com/Namdev90/paruluniversitygoa/commit/294dcf600e7c8ab3367d38a1de18b047bf4e6be7) | 1 | 2026-10-16 22:00 | Initial offline Android prototype; QR lookup, organizer workbook import, local admission state and CSV/backup experiments. Historical architecture, not the current server-confirmed gate workflow. |

## Evidence and release discipline

The [machine-readable archive inventory](docs/history/apk-inventory.json) records the exact package name, embedded version, byte size, SHA-256 and first archive commit for all sixteen retained APKs through 0.7.8. Original archive commit dates are provenance, not GitHub Release publication timestamps. The [historical-release migration](docs/history/GITHUB-RELEASES.md) preserves this distinction. It does not claim that every historical signature or phone upgrade has been retested.

The public updater uses [`updates/latest.json`](updates/latest.json), not this document. A source commit, passing CI, merged PR, or proposed version name does not publish an installable update. Never overwrite an existing APK version or reset its version code. Keep earlier artifacts intact for history; distribute the current verified release through the main download link.
