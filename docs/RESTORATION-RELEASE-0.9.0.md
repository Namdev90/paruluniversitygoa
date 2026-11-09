# Navrang 0.9.0 release record

## Published artifact

Android version **0.9.0**, code **19**, package `in.navrang.gate`.

- Reviewed source: [`885cf33d587a78ba5040109a8e0d7e3a665046b1`](https://github.com/Namdev90/paruluniversitygoa/commit/885cf33d587a78ba5040109a8e0d7e3a665046b1).
- Final signed-upgrade evidence: [`8e0d5fee32388a558e7c6f87f07869405a02e907`](https://github.com/Namdev90/paruluniversitygoa/commit/8e0d5fee32388a558e7c6f87f07869405a02e907), retained in [the approval record](restoration-release-approval.json).
- Artifact preparation: [`7546776d0f360709affbaaf31db91d90728637ff`](https://github.com/Namdev90/paruluniversitygoa/commit/7546776d0f360709affbaaf31db91d90728637ff).
- Published on `main` by [PR #21](https://github.com/Namdev90/paruluniversitygoa/pull/21), commit [`b21798702fe2a99e1d419e15b8d31011f2fc7fa6`](https://github.com/Namdev90/paruluniversitygoa/commit/b21798702fe2a99e1d419e15b8d31011f2fc7fa6), 9 November 2026 at 19:22:44 UTC.
- [GitHub Release v0.9.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.9.0) published at 19:24:12 UTC the same day.
- APK: `Navrang-Gate-0.9.0.apk`, **24,673,136 bytes**.
- SHA-256: `548686ed0c0c02e0066f41beab1356169e331431218600e2d05fed10e34b652a`.

The [updater manifest](../updates/latest.json), [checksum list](../SHA256SUMS.txt), archived APK and GitHub Release asset metadata agree on the final size/digest. The public original-certificate fingerprint remains documented in [the release procedure](RELEASE-PROCEDURE.md). This narrative correction does not change any APK, signature, manifest or approval record.

## Scope and acceptance

This release refines Account, Admin, Reports, Help Desk and scanning, with compact station layouts, swipe navigation, app lock and a collapsible desktop menu. Admin and Reports are grouped under Account. Location sharing, voice and event notifications are excluded from the app/browser package; Android update alerts retain the existing updater.

The final approval record reports an in-place upgrade from published 0.8.0/code 18 to the exact original-key-signed 0.9.0/code 19 APK on an isolated **Android API 37 emulator**. App ID, original installation time and app data directory were retained, and both versions launched. The owner excluded their physical phone. This is emulator upgrade evidence, not physical-device, camera, live-event, OAuth or performance acceptance.

Repository/API publication is separate from backend and hosted-portal deployment. No broader deployment claim follows from this release note. See [current status and remaining evidence limits](CURRENT-STATUS.md).

## Earlier candidate, retained for provenance

The original version of this note described reviewed source `9914009c24e81a22d031f7ff029277a0e1e7e2a9` and a candidate of **24,669,040 bytes**, SHA-256 `24f8705db9e8207af420ae5f56e57c34fcb0ad6ecc8f06006f749eb4853c7183`. That checkpoint recorded 388 browser checks across four screen sizes plus signing/artwork/package and deferred-asset checks. It is preserved in [commit a9dfe827](https://github.com/Namdev90/paruluniversitygoa/blob/a9dfe8271744af19d95dbcb9168f34caa898527d/docs/RESTORATION-RELEASE-0.9.0.md).

Those earlier bytes are **not the published final download**. Later manifest/layout changes and updated upgrade evidence precede final preparation/publication. The 388-check count belongs to that earlier record and is not silently reassigned to the final source. Consult source-bound CI and the final approval record for later evidence.
