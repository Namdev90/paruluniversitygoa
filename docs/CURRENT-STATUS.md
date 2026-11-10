# Current project status

## Operational update · 10 November 2026

**Navrang Gate 0.9.2, Android code 21** includes the touch-target and numeric display improvements from PR #28, blends the Android screen edges and removes four unused legacy interface assets. The [updater manifest](../updates/latest.json) identifies the APK, SHA-256 and signature. [Merged interface polish](https://github.com/Namdev90/paruluniversitygoa/pull/28) · [0.9.2 release changes](https://github.com/Namdev90/paruluniversitygoa/pull/29)

The final original-key APK passed the in-place upgrade from published 0.9.1 on the dedicated Android API 37 emulator. The app ID, data directory and original installation time carried over, and both versions launched. This release replaces Google sign-in in the clients with a staff PIN and on-screen keypad. [Portal](https://navrang-gate-admin.namubhai.chatgpt.site/)

The legacy raw-Java build opens the external Google flow directly. The client now accepts its matching browser acknowledgement and the historical packager includes the scripts referenced by the login shell. The raw-Java APK was outside this verification. The AndroidX APK remains the supported release path.

The 0.9.2 source adds a four-digit staff PIN keypad and a tactile burgundy-and-brass theme. For first use, an administrator issues a single-use setup code under Account → Admin console → Staff access. Staff paste it under Verify a new device and choose their PIN. The code expires after 15 minutes. Subsequent sign-ins use the PIN and a credential saved by that app installation or browser. Clearing site data, reinstalling Android or changing devices requires a new setup code. Ten incorrect PIN attempts require a new setup code. Administrator sign-in is separate.

Device setup keeps the existing staff account ID, station permissions and Reports grants. For an existing faculty account, issue its setup code from its Staff access row. Browser storage keeps the credential for the current HTTPS origin. Only use a trusted browser profile. Android stores its credential through Android Keystore. Apply `server/staff-device-v092.sql` and deploy the matching Edge Function before rolling out the 0.9.2 clients. The backend retains compatibility with previously published clients during rollout.

## Historical 0.9.0 snapshot

This is a source-and-publication snapshot checked on **9 November 2026 (UTC)** against `main` commit [`b21798702fe2a99e1d419e15b8d31011f2fc7fa6`](https://github.com/Namdev90/paruluniversitygoa/commit/b21798702fe2a99e1d419e15b8d31011f2fc7fa6). Recheck the manifest and Releases before using this as a future release decision.

## Published Android version

**Navrang Gate 0.9.0, Android code 19**, package `in.navrang.gate`, is the published release. The [GitHub Release](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.9.0), [release configuration](../release.json), [updater manifest](../updates/latest.json), [checksum list](../SHA256SUMS.txt) and [download archive](../downloads/) identify the current artifacts. The private Node test package's `0.7.6` version is not the Android release version.

- Publication on `main`: [PR #21](https://github.com/Namdev90/paruluniversitygoa/pull/21), merged 9 November 2026 at 19:22:44 UTC.
- GitHub Release publication: 9 November 2026 at 19:24:12 UTC.
- Reviewed runtime source: [`885cf33d587a78ba5040109a8e0d7e3a665046b1`](https://github.com/Namdev90/paruluniversitygoa/commit/885cf33d587a78ba5040109a8e0d7e3a665046b1).
- Published APK: `Navrang-Gate-0.9.0.apk`, **24,673,136 bytes**.
- SHA-256: `548686ed0c0c02e0066f41beab1356169e331431218600e2d05fed10e34b652a`.

The [release record](RESTORATION-RELEASE-0.9.0.md) distinguishes these final bytes from an earlier 0.9.0 candidate. The source commit, packaging commit, merge commit and GitHub publication time serve different purposes; they are not interchangeable.

## Included and excluded scope

The published release refines ticket checking, Help Desk, Account, Admin and Reports, groups Admin and Reports under Account, adds swipe navigation and app lock, and includes a collapsible desktop menu in the shared web source. Existing Android app-update alerts remain.

**Location sharing, voice and event alerts are excluded from the released app/browser package.** Their source, tests and design documents remain for development history. Presence in the tree does not mean a feature is shipped, enabled or deployed. The release manifest removes microphone/location permissions and event-push components and disables the dormant voice service; Android/browser packaging excludes the deferred web assets. See [architecture and boundaries](ARCHITECTURE.md).

## What the evidence establishes

| Evidence | Scope | What it does not establish |
|---|---|---|
| Final [approval/verification record](restoration-release-approval.json) | Original-key-signed final APK upgraded from 0.8.0 on an isolated Android API 37 emulator; app identity, original install time and data directory retained; both versions launched | Physical-phone camera, OAuth, real-event admission, radio conditions, accessibility or performance acceptance |
| Published manifest, checksum list and GitHub asset metadata | Published version, byte length and expected digest | A fresh signature verification or a new device test by the reader |
| Earlier browser/render and diagnostic test records | Their named source, fixture and environment only | A pass for a later source commit, final APK, live backend or public portal |
| Dated hosted/backend receipts | Only the recorded inspection or authorized deployment at that time | Current service health or blanket permission to repeat a migration |

The owner excluded their physical phone from the 0.9.0 release check. Do not summarize the JSON label `deviceAcceptance: VERIFIED` as physical-device acceptance. A waived or skipped check is not a pass.

## Repository, portal and backend are separate

An Android release or Git merge does not deploy the public [laptop portal](https://navrang-gate-admin.namubhai.chatgpt.site), apply SQL, activate Workers, create credentials or change staff access. This documentation review did not inspect or mutate live operational services. Follow [portal deployment](PORTAL-DEPLOYMENT.md), [release procedure](RELEASE-PROCEDURE.md), and the service-specific dated records before proposing changes.

The checked-in Edge entry point hard-disables new renewable-family issuance (`renewalEnabled: false`). Browser persistent-session support depends on a separately configured same-origin gateway; the ordinary packaged configuration does not enable it. Neither the presence of renewal/relay code nor old activation plans proves those capabilities are live.

## Concurrent work and remaining decisions

At this snapshot, [PR #20](https://github.com/Namdev90/paruluniversitygoa/pull/20) was still open from `navrang-0.9.0-phone-verified`, while PR #21 had already published the final 0.9.0. Treat #20 as separate unmerged work, not another published release. Recheck its live status before review; this documentation update does not merge, close or rewrite it.

For future changes: coordinate a fresh source/version scope; retain all prior APKs; qualify affected physical-device and hosted behavior; use isolated fixtures; obtain any required deployment/signing approval. Do not reactivate deferred communications, replay retired correction SQL or reuse an old acceptance waiver through documentation alone.

[Documentation index](README.md) · [Development setup](GETTING-STARTED.md) · [Project history](history/PROJECT-HISTORY.md)
