# Candidate verification — 18 October 2026

> **Historical source-only verification checkpoint.** Preserve the dated architecture, instructions and evidence below as history. For the published 0.7.9 behavior and acceptance scope, use [Features](FEATURES.md), [the current release record](RESTORATION-RELEASE-0.7.9.md) and the [documentation index](README.md). Earlier approvals and deployment statements do not authorize or describe a later release.

## Tested source and release boundary

The responsive integration starts at Teacher Reports source `3fb78ea46451a25033cddcdc4fd625dd89e41492` and preserves main's installer lifecycle fix `8f145f4916bc2d6eed0a226bca774ae7ffe31bf6`. Work is isolated on `feature/navrang-responsive-handoff`. This record is **not** a signed-APK or live-portal release receipt.

The public baseline checked for this work remains 0.7.6 / Android code 14. No signing key was found in the mounted project/workspace locations. No replacement was generated, and no APK was built or signed in this environment.

## Results

| Check | Result and scope |
|---|---|
| Full Node suite | 154 passed, 0 failed, 3 skipped at the combined-source checkpoint; 157 tests total. Re-run on the final release head. |
| Native session | 118 checks passed using actual class and controlled platform substitutes. |
| Camera startup | 26 checks passed, including cancellation and duplicate-launch cases. |
| Runtime | 30 checks passed, including stale identity/access replies and pending recovery. |
| Pending result handler | 5 checks passed. |
| Scanner acknowledgement queue | 11 checks passed. |
| Installer lifecycle | 118 checks passed, including process/reboot recovery and uncertain installer state. |
| Native harness total | 308 checks passed. This is not phone validation. |
| SQLite | Rollback, duplicate protection and absence of persisted student roster/outbox after reopen passed. |
| Source-render layout matrix | 104 role/view cases across the eight viewport sizes below; no tested horizontal control overflow, low-contrast institutional chips, script errors or unexpected fixture API operations. |
| Web packaging | Every referenced script/stylesheet is included; generated official brand assets are included; native/server/signing directories are excluded. |
| PDF provenance | Separates total, registration-matched and organizer-confirmed attendance; preserves unknown exact admission time and non-attendance caveats. Synthetic PDF rendered and inspected. |
| APK archive | All fourteen retained APKs inspected for embedded package/version/code, byte size and SHA-256. Historical signatures were not all cryptographically re-verified. |

Skipped Node checks: two tests require private organizer workbooks; one requires an Android platform SDK for the separate native-branding compile test. Hosted DOM/production integration suites were not supplied isolated synthetic credentials/state and were not run against the live attendee database.

## Actual viewport sizes

320×640, 360×800, 390×844, 640×360 landscape, 768×1024, 1024×768, 1366×768 and 1920×1080 CSS pixels.

Each size covered login, checker, faculty reports, admin overview, reports, Help Desk, account, entries, stations and four administrator tabs. Images in the README are watermarked synthetic previews from this source, not real attendee records.

## What the render harness does and does not prove

The local Chromium environment restricts URL navigation. The harness therefore renders the real HTML/CSS/JavaScript source in an in-memory document, replacing only storage and transport with synthetic fixtures. The production CSP is omitted from that **test wrapper**, not from shipped files. The production client logic, view code and branding code run against the fixtures. No authenticated user data, real check-in or live server mutation is involved.

This validates the tested source layouts and fixture interactions. It does not validate deployed CSP/network behaviour, OAuth redirects, real Android document pickers/camera/permissions, iOS/Safari, large-font operating-system settings, browser zoom, all keyboard sizes, colour/accessibility certification or physical frame rate. Test those separately in the original release environment.

## Repaired defects found by this review

1. The browser package omitted the two report scripts referenced by its HTML.
2. The PDF did not yet implement the already-specified organizer-confirmed attendance split.
3. Original white institutional lettering was placed on a pale chip and became unreadable.
4. Older generic purple/glossy button rules remained on several navigation and table controls.
5. A temporary teacher-management failure disabled valid administrator report downloads.
6. Fresh bootstrap SQL omitted the separately deployable report RPC.
7. Historical reconciliation needed a guard against a subsequently supplied canonical registration before creating a missing-data receipt.
8. The brand-image build helper attempted an X display in a headless local runner.

Each code/data rule above has a regression check or observed before/after source-render evidence. The original signing identity, update version policy, checker permissions and current admission rules were not relaxed.

## Remaining release work

Follow [the original-environment handoff](RELEASE-HANDOFF-2026-10-18.md): reconcile any newer source/backend work, locate the original key locally, compile/sign with the established tools, validate the final APK and real phone upgrade paths, deploy the web package to the existing site, and verify public bytes. Do not equate passing source checks with publication.
