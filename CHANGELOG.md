# Changelog

All retained APK versions, reconstructed from the repository history and their embedded Android manifests. The release date below is the archive commit date in IST. An archived version is not a recommendation to install it.

## Unreleased — coordinated 0.7.7 candidate

**Not an APK release.** Keep version 0.7.7 / code 15 only while unused; the original signing environment must recheck the public channel before assigning it.

- Installer lifecycle recovery from merged [PR #3](https://github.com/Namdev90/paruluniversitygoa/pull/3), including process recreation, reboot, interrupted confirmation and scan guarding.
- Faculty report permissions, administrator approval/revocation, twelve data views, CSV/XLSX downloads and a PDF summary.
- Organizer-confirmed missing-registration admissions retain their source, unknown actual entry time, missing-name status and note; no future scan bypass.
- Official brochure-derived Navrang marks, institutional wordmarks, separate peer login choices and highlighted Administration.
- Responsive mobile/tablet/desktop layouts, subtler dancer motion, reduced-motion support, and readable original white institutional lettering.
- Web-packaging dependency repair; fresh-bootstrap report RPC; report downloads remain available during teacher-management outages; truthful PDF attendance sources.
- Visual README, full feature catalogue, archive inventory and original-signing release handoff.

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

The [machine-readable archive inventory](docs/history/apk-inventory.json) records the exact package name, embedded version, byte size, SHA-256 and first archive commit for all fourteen retained APKs. It does not claim that every historical signature or phone upgrade has been retested.

The public updater uses [`updates/latest.json`](updates/latest.json), not this document. A source commit, passing CI, merged PR, or proposed version name does not publish an installable update. Never overwrite an existing APK version or reset its version code. Keep earlier artifacts intact for history; distribute the current verified release through the main download link.
