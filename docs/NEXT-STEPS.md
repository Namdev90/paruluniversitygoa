# Current upgrade and acceptance checklist

Baseline: **0.7.8 / code 16**, published 18 October 2026. Preserve this APK, every earlier archive, the original signing identity and the existing updater channel. The next version number is coordinated with the implementation/release owner; it is not a release until the exact signed bytes are verified and published.

## Requested next interface

- Preserve the original identity and familiar workflows. Add more 3D depth; do not introduce a Material UI restyle. Colours may be refined without inventing institutional branding.
- Remove unwanted logo backgrounds using the owner-selected original artwork. Preserve the design and record each reviewed derivative hash; distinguish owner-approved generated/edited app artwork, organizer-supplied imagery and officially sourced university/Google marks. Keep proportions and readable brand treatments. Prevent dancers, logos, text and controls from overlapping in the opening animation, including small and short viewports.
- Enable screenshots as requested without placing private attendee data in public previews. Public documentation and automated visual fixtures use synthetic records only.
- Replace list page-arrow controls with scrolling and search. Fetch authorized data progressively without treating a truncated cache as the complete ledger; preserve all authorization, total-count and race protections.
- Keep exact ticket-ID search inside the active camera screen. Do not close the camera to enter an ID, and keep the same admission/deduplication safeguards.
- Arrange every available, permission-appropriate receipt detail clearly: prior attempts/receipts, scanner attribution, scan/entry times, and known payment time/method. Hide missing/empty fields and empty sections entirely; do not show “Not recorded” or “Unavailable” placeholders or infer values. Keep real zero/false values when they convey a meaningful status. Do not turn a lookup into an admission or broaden staff access.
- Deepen Android integration where measured lifecycle/interaction improvements justify it. Preserve session compatibility, native sign-in, scanning, import/export, sound, haptics, readiness and update recovery.
- Refresh the hosted portal, README, feature catalogue and synthetic screenshots together, while distinguishing source changes from actual portal deployment.

## Implemented in the candidate source

Screenshots and screen capture are no longer blocked by the application's window flags in either shipping host. This supersedes the historical native checkpoint's `FLAG_SECURE` description; an older installed APK still needs the new signed update. Android/device policy can independently restrict capture. Synthetic tests check both shipping windows; physical recording remains a device acceptance item.

The candidate also includes the reviewed transparent in-app wordmark, scroll/search lists, in-camera exact-ID entry, available receipt details, automatic camera assistance and repaired report generators. Final combined rendered evidence, device acceptance and signed publication remain separate gates.

## Evidence before the next update

1. Run relevant regression, security/data-integrity and release-policy checks against the final source, then render/test each affected page, modal and result state at phone/tablet/laptop widths and short heights.
2. Cover interruptions, rapid input, repeated taps, empty/loading/error states, long names and large text. Verify scrolling, search, camera manual entry, role isolation, fresh export authorization and non-overlapping intro.
3. Obtain four or five independent reviews and resolve findings before release approval/push. Record test results as passed, failed, skipped or never run; do not infer independent approval from a request for review.
4. Prepare a fresh source/version-scoped release decision. Earlier 0.7.7/0.7.8 waivers do not authorize the next version. Preserve the original key privately; never upload or replace it.
5. After authorized publication, independently download the APK and manifest, verify package/version/size/hash/signature, and ensure every older APK is unchanged. Verify any hosted portal deployment separately.

## Reporting deployment prerequisite

Confirm service compatibility and authenticated hosted acceptance before advertising production reporting or publishing a dependent portal. Coordinate any required backend change separately, preserve existing access/data, and use authorized isolated fixtures rather than real admissions. See [the portal publication checklist](PORTAL-DEPLOYMENT.md).

## Remaining acceptance from 0.7.8

Real-device sign-in/camera, installed upgrade/reboot, accessibility/performance and hosted-service acceptance were skipped under the owner's explicit 0.7.8 waiver. They remain unverified, not passed. Google sign-in branding work remains deferred. Existing release gates, production-data restrictions and paid-service approval requirements continue to apply.

The earlier [0.7.3 phone-trial notes](https://github.com/Namdev90/paruluniversitygoa/blob/6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc/docs/NEXT-STEPS.md) are preserved as a historical record, not current installation guidance. Never replay the retired historical attendance-correction SQL.
