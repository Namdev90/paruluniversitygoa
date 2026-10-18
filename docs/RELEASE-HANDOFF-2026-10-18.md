# Navrang coordinated release — original signing environment

Prepared 18 October 2026 for Namdev Shirodkar. Read this entire handoff before changing any remote branch, database, site or APK. The user authorized the combined feature work and release, but the original signing identity and the explicit publication/coordination safeguards remain mandatory.

## Source locations

Repository: https://github.com/Namdev90/paruluniversitygoa

- Main must retain merged installer lifecycle PR #3, commit `8f145f4916bc2d6eed0a226bca774ae7ffe31bf6`.
- Teacher Reports PR #2: https://github.com/Namdev90/paruluniversitygoa/pull/2 . Its inspected source head was `3fb78ea46451a25033cddcdc4fd625dd89e41492` on `feature/navrang-teacher-reports-v0.7.7`. Its publication hold is not permission to discard its source.
- Responsive/reporting/packaging/docs integration: `feature/navrang-responsive-handoff`. Read its current PR and final CI checks; fetch its actual head rather than assuming the old branch snapshot.
- The integration includes both the inspected teacher source and installer lifecycle main, plus the refinements listed in the Changelog. Preserve newer authorized changes and coordinate with any active owner before merge/deployment.

Do not cherry-pick only the pretty screens and lose the native installer fixes, permissions, report definitions or packaging repair. Do not rebase/force-push over somebody else's concurrent work.

## Signing gate — check this first

Use **only the established original key in this original environment**. The existing tool expects `signing/prototype-debug.p12` within the project checkout. Search only plausible local Navrang workspaces/private backups when the file is not there. Do not request, print, email, upload, commit or transmit a key, and do not generate a replacement. Do not run `git clean -xfd` against an old workspace: it could delete ignored signing material.

Expected signer certificate SHA-256:

```text
0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce
```

The environment that prepared this integration had no original key. If it is still unavailable, **stop signing and publication**. Preserve source and explain the precise local blocker; do not relabel a source archive, unsigned APK or existing release as a new installable update.

## Coordinate an unused release version

The last checked public release was **0.7.6 / code 14**:

- Package: `in.navrang.gate`
- Bytes: `1940814`
- SHA-256: `a3502d76c94655c3b47daf79aeab220d19d692818eb12e6a06d366ff2b5c80f2`
- Public manifest: https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/main/updates/latest.json

Re-read `release.json`, `updates/latest.json`, `downloads/`, remote main, active PRs and release work. Use **0.7.7 / code 15 only if still unused and coordinated**. Otherwise select the next unused version with a strictly higher code. Never overwrite changed bytes under an existing published version. Source is deliberately not advertised as a signed 0.7.7 APK.

## Features the combined source must retain

Official Parul University Goa and brochure-derived Navrang marks, including the opening and native branding; fluid skippable dancer motion with reduced-motion support; peer Checker/Help Desk/Faculty entrances and a separate highlighted Administrator; full administrator report access; approved read-only faculty reports; twelve dataset definitions; local CSV/XLSX downloads and truthful PDF summary; source-based missing-registration corrections; mobile/tablet/desktop and short-height layouts; all 0.7.6 performance/privacy features; and PR #3's installer recovery after process recreation/reboot.

The source also repairs missing web report assets, generated web branding, fresh-bootstrap reporting SQL, report downloads during member-management outages, headless original-art preparation and misleading PDF provenance.

## Attendance and backend coordination — do not replay blindly

A read-only inspection during this work found **18 organizer-confirmed missing-registration admissions already present**, making **793 total admissions**. All 18 had the requested note `Admitted — registration data missing`, unknown exact admission time, unsupplied-name status and unknown payment verification. They were not added again by this integration.

Reconcile this against the current database before any write. Do not add 18 to a total again, change original attempt outcomes, invent names/payment, or replace actual evidence timestamps with an assumed physical entry time. A future unknown or blocked scan must not bypass authorization. Other failure classes are not silently included in this historical instruction.

The reporting RPC was already present in production, with anonymous/authenticated direct execution denied and service execution allowed. Its text fingerprint did not match the repository migration during this inspection. This is a **coordination warning**, not a determination that one version is semantically wrong. Read actual deployed SQL/Edge source and compare with newer authorized work before any replacement. The release handoff is not approval to overwrite a newer backend blindly.

- Fresh environments: `server/schema.sql` now contains the exact report definition as well as the gate schema; the regression test detects drift.
- Existing production: **do not rerun the fresh schema**. Apply only reviewed additive changes through the appropriate migration workflow and deploy their matching Edge files.
- Historical correction script: `server/reconcile-missing-registration-v077.sql` is retired and raises an unconditional exception before any database access. The 18 corrections are already applied and must never be replayed. Future corrections require a new, separately approved identity-bound workflow.
- Back up/review current definitions privately, retain grants/RLS/session rules, and validate authorized admin/faculty and denied/revoked accounts with dedicated synthetic fixtures. Do not use real attendees as test admissions or grant every Google account faculty access.

## Test the actual final release head

```sh
npm ci --ignore-scripts
npm test
npm run test:native
python3 tests/sqlite-check.py
python3 tests/release-check.py
python3 tools/package-web.py .build/web-portal
```

Run applicable JavaScript/Python syntax and whitespace checks, native QR/platform/policy checks, and full Android-35 Java compilation using the established SDK/JDK. Run hosted DOM suites only with their dedicated synthetic credentials/state and isolated fixtures; otherwise mark them skipped. Private-workbook tests need the actual private workbooks and must never put them in a public artifact.

The integration checkpoint had 154 Node passes (3 skips), 308 native checks and 104 source-render role/view checks at 320×640, 360×800, 390×844, 640×360, 768×1024, 1024×768, 1366×768 and 1920×1080. Re-run on the actual release head; old results do not validate new changes. See `docs/VERIFICATION-2026-10-18.md` for the in-memory render wrapper's limitations.

## Build, inspect and publish only with the original key

1. Safely reconcile/review the integration and active PRs; retain PR #3. Complete backend coordination separately from the client release.
2. Set the coordinated unused `versionName`/`versionCode` consistently, including user-visible version strings and package metadata where required by the established release process.
3. For this native release, run `python3 tools/build-native.py` with `NAVRANG_SIGNING_KEY` pointing to the original local key and the established SDK/JDK. `tools/build.py` defaults to the same native path. The separate legacy path (`python3 tools/build.py --legacy-approved-hotfix`) requires its own explicit hotfix approval and is not this release. Do not bypass `require_signing_key`, signer checks, anti-rollback or publication checks. Original brand assets are prepared from the verified brochure before packaging.
4. Verify actual APK package/version, installed/public signing certificate fingerprint, byte size and SHA-256. Verify generated `updates/latest.json`, checksum and release metadata describe those exact bytes.
5. Stage only reviewed source/documentation and intended release files. Scan the staged paths/diff for key files, passwords, service credentials, private workbooks, roster data or real QR records. None may be staged.
6. Re-read remote main immediately before pushing; preserve concurrent work and use normal fast-forward/merge protections, never force.
7. Publish the signed APK and matching manifest/checksum. Update the README's primary download/status and Changelog only after the public artifact exists. Keep every historical APK unchanged. Use GitHub Releases/tags where supported without inventing an old publication date.

## Web portal deployment

Export with `python3 tools/package-web.py .build/web-portal`; it needs Java for deterministic official-art preparation. Deploy the complete output (including both report scripts and `art/`) back to the **existing** `navrang-gate-admin` project/site:

https://navrang-gate-admin.namubhai.chatgpt.site

Keep the same domain, custom access/audience, OAuth redirects, Supabase project, CSP, permissions and server behaviour. A code push or local package is not a website deployment. Use the actual original site tool/workspace, not an unapproved replacement provider. Do not ship the synthetic screenshot wrapper, test storage or fake transport.

Inspect hosted login, all four roles, tables, Help Desk, faculty downloads and admin controls at the documented viewports plus real keyboard/zoom conditions. Verify no real PII appears in public screenshots, no stale bundle omits the reporting scripts, and no mobile/page overflow hides an essential action.

## Phone and public-download validation

On intended Android devices, test ordinary in-place upgrade/cancellation. While Android confirmation is open, terminate/reopen the app and verify new scans stay blocked while installation is unresolved. Repeat reboot, delayed cancellation, lost confirmation, missing cached APK and supported older/current Android versions. Scans resume only when Android confirms completion/removal. Test document-picker save/cancel, faculty access revocation during export, camera permissions and the new branding/motion.

Fetch the published manifest and APK independently after the push. Re-verify actual signature, package/version, size/hash and one real in-place upgrade. An automated harness is not equivalent to phone testing.

Return the final release commit, exact APK URL, manifest URL, version/code, signer fingerprint, byte size, SHA-256, deployed portal status and actual phone-test outcome. Distinguish **published**, **verified** and **not yet tested**. Do not call the complete release finished while required verification is missing.
