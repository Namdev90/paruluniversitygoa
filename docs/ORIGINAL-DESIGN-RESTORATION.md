# Original Navrang design restoration

On 18 October 2026 at 18:57:30 IST the owner rejected the Material redesign and requested the original interface and old logo, with working features retained. This supersedes the native-only presentation requirement. The restoration is an upgrade candidate, 0.7.8 / Android code 16; it must not replace the published 0.7.7 bytes or require uninstalling the app.

The original burgundy/gold interface is restored through the existing local interface host. The original gold Navrang logo is reused directly from the 0.7.6 source, including its original launcher image. No new artwork is generated. Brochure cropping no longer replaces the original logo during Android or web packaging.

| Area | Retained behavior |
|---|---|
| Sign-in | Credential Manager with nonce-bound token exchange; the original browser/PKCE fallback; existing encrypted session and key alias |
| Scanner | Current CameraX engine, QR decoding, focus/zoom/light aids, pending/held outcomes and server-confirmed admissions |
| Staff and administration | Existing server-owned roles, approvals, station assignments, registration/import and Help Desk flows |
| Reports | Twelve datasets, administrator/faculty authorization and CSV/XLSX/PDF saves |
| Lists | Independent bounded row scrolling; fixed search, navigation and pagination |
| Privacy | RAM-only private records, secure-window protection, generation/order fences and internal-build isolation |
| Sign-out | Durable clearing before completion; blocking retry screen and retained revocation token on storage failure |
| Document saves | Fresh server profile and permission checks after the picker, before opening its destination |
| Updates | Same package/signing identity; higher Android version code; pending-installation and anti-rollback checks |

The AndroidX host and shared runtime remain in place. Restoring the interface does not revert the database, attendance records, staff grants, reporting corrections or security fixes. Google branding is still deferred. Production backend/portal deployment, OAuth settings and paid domains are unchanged.

Verification includes the existing Node/Java/SQLite suites, new restoration and sign-out regressions, Android host tests, a clean build/lint, and synthetic browser rendering across the documented viewports. Device/account sign-in and installed-phone upgrade checks remain unperformed and must not be represented as passed. The 0.7.7-specific waiver is not reused for this version. The restoration release gate requires a fresh source/version-scoped owner record, clean verified ancestry and the original logo; the independent original-key/signature/package/version/hash/archive checks remain mandatory.

The owner has authorized implementation. Publication of the new 0.7.8/code 16 candidate remains held for a fresh release decision and either the remaining device acceptance evidence or an explicit source/version-scoped waiver. The previous 0.7.7 approval/waiver is not treated as approval for 0.7.8. No 0.7.8 production APK or channel metadata has been published.

Verified runtime source: `2a7a698b7bb07c8b52943994aec90a5a0695ae68`. PR #9: https://github.com/Namdev90/paruluniversitygoa/pull/9 . The publication record pins this source, keeps `releaseApproved:false` and `deviceAcceptance:UNVERIFIED`, and cannot borrow the previous release waiver.

Verification: 174 Node tests passed (3 environment skips), 313 Java harness checks, SQLite, seven signing/publication-policy tests, eleven native-gate tests and twelve restoration-gate tests. The restored source passed 53 Android host tests and release lint with zero errors/36 warnings. The rebuilt unsigned candidate was inspected to confirm its shipped HTML, behavior scripts, original style and logo exactly match this source. This is not an installable production release or physical-device result.

Functional regression checks cover native-import dispatch and post-import refresh, existing dual-station staff grants, new dual-station codes, numeric validation, name-only edits with unknown payment values preserved, durable sign-out/retry, fresh export authorization and expiry-driven private-view clearing without a network reply. The importer reuses the bounded CSV/XLSX parser, confirms row count and history preservation, and checks current administrator identity before reading, confirming and submitting. Sign-out cancels pending import work and its dialog.

Codex review on the initial restoration found three gaps: the visual workflow path filter, unreachable native imports and missing dual-station assignments. All three are addressed in the verified runtime source with functional regressions. Initial Codex security review reported no findings; it is not presented as a review of later changes. CodeRabbit is processing the updated branch, so no approval is inferred.

Final synthetic visual review passed 128 cases across eight viewports, including the native-import control, with no overflow, fixed-control movement, browser errors or unexpected fixture requests. Receipt: GitHub workflow 39134870543, artifact 12139532300 (`classic-synthetic-visual-review`), ZIP SHA-256 `9f2781a481fb347b075531b4071103943d65c016c2fd4bb78aafe32e0102369b`. All preview records are synthetic. The committed login/admin previews show the restored original logo and interface.
