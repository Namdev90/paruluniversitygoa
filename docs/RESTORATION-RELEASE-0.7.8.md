# Navrang Gate 0.7.8 — signed restoration release

The owner requested the original interface and old logo, then explicitly approved publication and bypass of the remaining handoff hold at 21:37:24 IST on 18 October 2026: “approved bypass handoff”. The new waiver is scoped to 0.7.8/code16 and verified runtime source `3549c1983f24eaaa95efbcc74cd51e81e2862212`. It does not reuse the 0.7.7 waiver or mark unperformed acceptance checks passed.

| Artifact field | Verified value |
|---|---|
| APK | [Navrang-Gate-0.7.8.apk](https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/downloads/Navrang-Gate-0.7.8.apk) |
| Package | `in.navrang.gate` |
| Version | `0.7.8` / code `16` |
| Minimum / target API | `24` / `37` |
| Byte length | `21176693` |
| APK SHA-256 | `b72cd7bdc99883cd9052f3873885073a153f8cb8c83293ffe7191040e415fc60` |
| Original signer SHA-256 | `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce` |
| Signed APK Git blob | `7ecb35efef2cb6e63c78891615412bd10bef51b8` |
| Source | `3549c1983f24eaaa95efbcc74cd51e81e2862212` |
| Approval record | `08303404514689ebd94e1cc532669fe716b275a9` |
| Update channel | [updates/latest.json](../updates/latest.json) |
| Checksum | [SHA256SUMS.txt](../SHA256SUMS.txt) |

The standard build entry point enforced the fresh approval/source/waiver gate, original-key certificate, actual signed package/version/minimum API, exact logo and launcher hashes, updater size limit and anti-rollback/publication checks. No replacement key was generated or transmitted to GitHub/CI. The signed candidate passed a clean release assembly, 55 Android host tests and lint with zero errors/36 warnings. Node: 179 passes/3 environment skips; Java: 313 checks; SQLite passed; publication-policy: 7 tests; native-gate: 11; restoration-gate: 12; generated-host: 3; packaged-artwork: 4.

Final source visual review passed 136 synthetic cases across eight viewports, without overflow, fixed-control movement, browser errors or unexpected fixture calls. Receipt: workflow 39145745103, artifact 12143297564, ZIP SHA-256 `e4b9fc8d194decfeb57afc800a08a3c519440389250054d74b416c939e6e80fb`. No real attendee records or physical-device screenshots are used.

The original interface keeps native Credential Manager/PKCE and CameraX, encrypted-session compatibility, RAM-only private records, bounded row scrolling, registration import, staff grants, Help Desk, twelve reports/exports and update recovery. Review fixes and the intentionally preserved server station restriction are documented in [the review disposition](RESTORATION-REVIEW-2026-10-18.md). The original asset and actual launcher resource both have SHA-256 `b3c9bec6b50d466c244e5b127b87cace038a16d3a236303f4b141e5ea285de9a`.

All fifteen previously published APK hashes remain unchanged. Production data, historical corrections, deployed SQL, staff grants, backend/portal deployment, OAuth audience/scopes and paid services are unchanged. Google branding remains deferred. Real-device authentication/camera, installed upgrade/reboot, accessibility/performance and hosted acceptance checks are skipped by owner instruction and remain unverified. Public HTTP verification is performed after the normal PR #9 merge and reported in the master handoff and final release response.

The final APK includes the explicit browser sign-in route restored after the subsequent Codex review. The earlier signed candidate was retired before channel publication; only the byte identity in this record is the release.

Local build checkpoint: `6490a2ea98d3a5b5df97256c5214b9140ca60a08`, tree `0c1a0eca3ccb092b6fc149ed29a67370d8c065f9`. That tree is identical to public approval checkpoint `08303404514689ebd94e1cc532669fe716b275a9`; runtime code is unchanged from the verified source.
