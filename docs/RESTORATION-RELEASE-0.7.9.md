# Navrang Gate 0.7.9 — verified source and scoped device-check deferral

This is an **unpublished candidate**, version **0.7.9 / code 17**. It is not a signed-artifact receipt or a claim that production reports or physical devices have passed acceptance.

## Frozen source and approval relationship

- Verified runtime source: `12385318ca6e614e2306f325433396c7a075cea3`.
- Runtime source tree: `f439c90ee23a7f7fddd35ea1ae47efac66ad27a0`.
- CI merge checkout: `7cade42e8ea6290850175a8cb064236344d1a4e0`, independently verified to have the identical tree.
- [PR #12](https://github.com/Namdev90/paruluniversitygoa/pull/12) contains the source and documentation-only approval descendant.
- `verifiedSourceCommit`, `approvedSourceCommit` and `verificationWaiver.sourceCommit` in [the active approval record](restoration-release-approval.json) all name the frozen source above. The approval descendant changes documentation only; any runtime change requires fresh source verification.

The owner requested publication at 20:05 UTC on 18 October 2026. At 21:18:33 UTC the owner explicitly said: “Device checks will happen after you push the update.” This instruction is scoped to the discussed 0.7.9/code17 candidate and recorded as `SKIPPED_BY_OWNER`, never `VERIFIED`.

Only physical-device acceptance is deferred until after publication: actual sign-in/camera/keyboard behavior, screenshots/screen recording, installed upgrade/reboot, accessibility and hardware/performance. Backend/report acceptance, hosted portal acceptance, signing identity, artifact verification, normal repository protections and public-download verification are **not waived**. The previous [0.7.8 approval record](history/restoration-release-approval-0.7.8.json) is preserved separately as history and is not reused.

## Completed synthetic verification

- [General verification](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39166022333): passed.
- [Source, responsive UI and export verification](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39166022418): 251 source tests passed, two intentional data-fixture skips, zero failures; 224 responsive checks, zero page errors/unexpected fixture calls; 49 real Chromium downloads across 12 populated/empty datasets and summary PDF parsed successfully, plus three mocked Android bridge formats.
- [Android verification](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39166022346): debug assembly, 80 tests and lint passed. Zero test failures/errors/skips; lint retains 38 warnings and zero errors.
- Automatic-camera harness: 219 checks; updater: 142 checks; restoration gate: 12 tests; archive safety: 19 tests; artwork: five tests.

Four independent earlier layout/function reviews and focused final-change reviews informed the corrections. Rendered evidence uses synthetic Chromium or Compose layouts under Robolectric. Mocked native-bridge views are labelled. No real attendee records or physical-device screenshots are represented as test evidence.

Visual/export artifact: `12151190516`, ZIP SHA-256 `07a8c06f370ca0a120ffdb9dc2c6d67ba889e35e26a500e3b54443d3f6ea25d0`.
Native artifact: `12150667926`, ZIP SHA-256 `620c3f29f8246b00b9bf741e5f3c6ba4c65302da1862b08137d5d87ed37bfb74`.

## Remaining signing and publication checks

Use the [current release procedure](RELEASE-PROCEDURE.md) in the retained original build environment. The key is not present in this source repository and must never be regenerated, replaced or transferred. Require signer SHA-256 `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce` and package `in.navrang.gate`.

The normal `tools/build.py` creates a signed candidate only after its source/approval/artwork gates. `tools/prepare-release.py` is a separate publication-preparation step. Verify the exact signed APK, backend/report acceptance, and canonical public artifact/updater before announcing release. The published channel remains 0.7.8/code16 until that succeeds.

All sixteen historical APKs, their checksums and the MIT license remain unchanged. Historical GitHub Releases and the hosted portal are separate coordinated publication steps. After release, carry out and record the deferred physical-device checks without relabelling them as already passed.

## Phone report-download correction — 19 October 2026

The owner reported that report downloads were below the visible phone area and explicitly requested a fix and publication, confirming that CSV downloading works. Runtime source is now `275c0cfd64d13ab1e78523bcc02d91715adc328c`; it supersedes the earlier frozen source only for the reviewed report-layout correction and reachability tests. The original source and approval history above remain preserved.

Download data precedes Attendance overview on phones. Reports has an explicit remaining-height scroll container inside the fixed header/navigation. Desktop retains its overview/download columns. Report routing, export logic, account permissions and records are unchanged by this UI correction. An independent reviewer cleared the final bounded-height correction. Fresh CI must pass before publication.

The reviewed SQL repair and matching Edge deployment were successfully read back. The hosted portal's authenticated admin report summary returned 793 admitted, comprising 775 registration-master admissions and 18 organizer-confirmed admissions. The owner supplied the successful live CSV export screenshot and explicitly confirmed downloading works. This is administrator/user acceptance; it does not claim tests under a separately granted faculty identity, real Android document picker, or physical camera/upgrade tests.

The owner's physical-device checks remain deferred until after publication, marked `SKIPPED_BY_OWNER`. All signing, archive integrity, normal repository and public-download verification requirements remain. The prior signed local APK belongs to the earlier source and must not be published as this corrected candidate. Rebuild from this source plus documentation-only approval.

## Original-key APK publication receipt

Runtime source: `275c0cfd64d13ab1e78523bcc02d91715adc328c`. Approval checkout: `1a1a5551dc941f8fda84b95baf550455785d62e5`. All three final workflows passed: [general](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39170015319), [responsive/control/export](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39170015288), [Android](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39170015284). Local native build, 80 Android tests, lint, original-key signing, signature and packaged source checks passed.

- Package `in.navrang.gate`; version `0.7.9`; versionCode `17`; minSdk `24`; targetSdk `37`.
- Signed APK: `Navrang-Gate-0.7.9.apk`, 22,630,853 bytes.
- SHA-256: `f52a215fc326d4d824b6868859c9d8b05d8102fd01f6f04747848a94c1cf2729`.
- Original signer: `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`.
- Packaged HTML/report CSS matches the reviewed runtime source exactly. All sixteen earlier APKs and license remain byte-identical.
- The hosted phone download-layout correction is published separately as Site version 11. No account grants or attendance/payment records were changed for this release.

The APK and manifest become public only when this publication commit is merged. Independent public byte/signature/manifest verification follows merge; this preparation receipt does not itself claim that final check. Physical-device acceptance remains SKIPPED_BY_OWNER, not passed.
