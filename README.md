<div align="center">

# Navrang Gate
### Parul University Goa · Event entry and administration

**Scan confidently. Resolve exceptions. Report with evidence.**

[Download the current APK](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-0.7.8.apk) · [Complete feature catalogue](docs/FEATURES.md) · [Version history](CHANGELOG.md) · [GitHub Releases](https://github.com/Namdev90/paruluniversitygoa/releases) · [Release procedure](docs/RELEASE-PROCEDURE.md)

</div>

> **Release status:** **0.7.8 · Android code 16** restores the original burgundy/gold interface and gold Navrang logo. It keeps the original signing identity, existing update channel, current native sign-in/scanning and data/security protections. Google branding remains deferred. Device, upgrade/reboot, performance and hosted acceptance checks were skipped under the owner's explicit 0.7.8 release approval and remain unverified. See [the signed release record](docs/RESTORATION-RELEASE-0.7.8.md).

## Original Navrang interface

The original screens use the existing local interface host with native Credential Manager/PKCE sign-in and CameraX scanning. Students and Entry log scroll independently while search and pagination stay fixed. Bulk import, both staff permission flags, Help Desk, session security and installer recovery remain in the app. Twelve report datasets and exports are implemented in the released client/source, while production reporting readiness remains unverified. [Restoration details](docs/ORIGINAL-DESIGN-RESTORATION.md) · [Review disposition](docs/RESTORATION-REVIEW-2026-10-18.md).

The screenshots below render the shared interface with synthetic transport. They are not physical-device captures or live attendance records.

## A look at the work

<table><tr><td width="50%" align="center"><img src="docs/restoration/original-login-synthetic.png" width="310" alt="Synthetic restored original interface: old Navrang logo, staff entrances and separate Administration"><br><strong>One clear entrance for every responsibility</strong></td><td width="50%" align="center"><img src="docs/restoration/original-admin-synthetic.png" width="310" alt="Synthetic restored original interface: administrator dashboard and phone navigation"><br><strong>Gate control that remains readable on a phone</strong></td></tr></table>

[Historical Faculty Reports preview](docs/screenshots/faculty-desktop.webp).

**All preview records are synthetic.** These are rendered source screens with fixture data; they do not establish physical-device or hosted-service acceptance. Original university/event artwork is retained; no attendee information or credentials are embedded in these images.

## What Navrang Gate does

| At the gate | At the Help Desk | For faculty and administration |
|---|---|---|
| Continuous Android QR scanning, exact-ID fallback, focus/torch/zoom aids and distinct feedback. | Named, server-saved registration cases with duplicate safeguards and administrator review. | Searchable registration/entry views, staff permissions, and read-only attendance reports. |
| Server-confirmed, single-use admissions; duplicate and pending outcomes remain explicit. | Payment and identity approval are deliberate; a case alone never authorizes entry. | CSV/XLSX datasets and PDF summaries distinguish evidence, missing records and organizer corrections. |

**Four roles, one permission model:** Checker · Help Desk · Faculty · Administrator. Faculty reporting is an approved read-only role. The administrator retains access to all stations and reports. Choosing a role in the interface never grants permission.

## Built for real gate conditions

- **Accountable outcomes:** stable request IDs, immutable receipt attribution, queued problem notices and late-response recovery. Green means a committed admission—not just a decoded QR.
- **Private by design:** server-owned records; RAM-only student copies; restricted staff summaries; guarded sign-out/late exports; no live roster, workbook or service secret in this repository or APK.
- **Safe updates:** original signing identity, package/version/hash checks, scan priority and unresolved-installation guards. Merged PR #3 adds process/reboot recovery; physical-phone acceptance remains unverified under the owner’s release waiver.

The [feature catalogue](docs/FEATURES.md) documents major and small behaviours: camera cancellation, inverted QR handling, named codes, station locking, Help Desk races, report provenance, formula-safe exports, branding, reduced motion, readiness controls, installer recovery and more.

## Reports that do not hide the exceptions

The app provides twelve dataset views: complete master, admitted, eligible without verified entry, blocked, recorded issues, resolved issues, unresolved issues, duplicate attempts, gate activity, Help Desk cases, pending cases and **“Admitted — registration data missing.”**

An organizer-confirmed admission is not presented as a payment verification. Unknown names and exact physical entry times stay unknown. “No verified entry” is not proof of absence. Duplicate scans are not extra people. See [reporting definitions](docs/FEATURES.md#faculty-reports).

## Current installation and access

Install the current signed APK over the existing app; keep the same package and signing identity. Android may ask you to allow installation from the download source. Android 7+ and WebView/Chrome 86+ are required. Sign in with Google or an assigned staff code, save your real name and wait for the administrator's station approval.

The existing laptop portal is [Navrang Gate](https://navrang-gate-admin.namubhai.chatgpt.site). Its deployment is separate from a repository push; candidate screenshots do **not** establish that the hosted portal has been updated. The current hosting audience is public, while operational records require app/server authentication. The hosted interface has not yet been verified against the next reviewed candidate. Follow [the portal parity plan](docs/PORTAL-DEPLOYMENT.md) to deploy the final reviewed companion back to the same site without changing its audience, authentication or backend.

## Development and verification

```sh
npm ci --ignore-scripts
npm test
npm run test:native
python3 tests/sqlite-check.py
python3 tools/package-web.py .build/web-portal
```

The web package includes every referenced script, including Faculty Reports. `tests/responsive-browser-check.py` provides fixture-only layout checks with Python Playwright and local Chromium; see the [verification record](docs/VERIFICATION-2026-10-18.md) for exact viewports and limitations. Hosted suites require their dedicated synthetic credentials/state; do not run them against real attendee records.

**For signing:** follow [the current original-environment release procedure](docs/RELEASE-PROCEDURE.md). Do not create a new key or upload one here. No CI workflow in this repository signs releases or needs signing secrets.

## The development record

The project retains **16 published APK versions** from 0.1.0 through the 0.7.7 native rebuild and 0.7.8 original-design restoration. [CHANGELOG.md](CHANGELOG.md) links each version to its archive commit and explains what changed. The [archive inventory](docs/history/apk-inventory.json) records embedded package/version codes, byte sizes and hashes. Older architectures remain clearly labelled. [Historical Release migration](docs/history/GITHUB-RELEASES.md) describes the additive archive process: unchanged APKs, original commit/date provenance, current GitHub publication timestamps and no updater-channel changes.

## Project map

| Location | Contents |
|---|---|
| `native-app/` | AndroidX interface host, Kotlin/Compose scanner, CameraX, Credential Manager, native imports and synthetic UI tests |
| `app/java/in/navrang/gate/` | Native scanner, sessions, runtime, document saving, readiness and updater |
| `app/assets/` | Shared web interface, report generators and original/licensed artwork |
| `server/` | Private-schema gate/report APIs, additive reporting migration and narrowly scoped historical reconciliation |
| `tests/`, `server/tests/` | Regression harnesses, source rendering and data/security checks |
| `tools/` | Packaging, original-art preparation, verification and guarded release tooling |
| `downloads/`, `updates/` | Published APK archive and actual update manifest |
| `docs/` | Features, operations, original signing handoff, sources and verification |

Created by **Namdev Shirodkar** for Navrang gate operations at Parul University Goa. Institutional/event marks remain their owners' artwork. Audio and asset provenance are documented in [asset notes](app/assets/art/ASSET-NOTES.md). No broader institutional endorsement or certification is implied.

## License and artwork

The project code and documentation are provided under the existing [MIT License](LICENSE), copyright © 2026 Namdev90. This update preserves that license and copyright notice. Bundled libraries keep their own licenses; university/Google marks and organizer-supplied artwork retain their own rights. The historical Navrang Gate app mark is owner-approved generated/edited artwork, not independently authenticated institutional branding. See [third-party notices](THIRD-PARTY-NOTICES.md), [artwork provenance](app/assets/art/ASSET-NOTES.md) and the bundled audio notices.

## Next upgrade

The [current checklist](docs/NEXT-STEPS.md) covers the requested deeper original-style visuals, background-free logo treatments, non-overlapping intro, scroll-and-search lists, in-camera exact-ID search and permission-appropriate receipt details. Changes must be demonstrated in the candidate and pass independent review before a new signed release is advertised here. The download above remains the verified 0.7.8 release until then.
