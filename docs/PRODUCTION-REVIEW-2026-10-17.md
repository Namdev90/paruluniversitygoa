# Navrang Gate — production review, 17 October 2026

Release: **0.7.3 / Android version code 11**. Scope: the organizer's full request history, supplied reference images/videos, both private Excel files, current Android/browser code, release channel and a read-only live service check. The review never admits real attendees for testing and makes no live student, payment, staff or schema changes.

## Current requirements and evidence

| Requirement | Current implementation / qualification |
| --- | --- |
| Working Google login | Preserved. Verified Google identity maps to one staff account; real name setup and admin approval remain. Delayed callbacks cannot replace a later login. |
| Code fallback / admin staff tools | Named station-specific codes; only admin grants/reassigns/suspends access. Original temporary test codes expired at 3 PM IST, 17 October. |
| One station choice | Saved server-side once; second different choice is rejected. Only admin can reassign. |
| Staff privacy and speed | Staff sync contains two counters, My scans and Total entries; no full roster, global history or payment statistics. Help Desk retains its own paged registrations. |
| One entry, no re-entry | Unique event/ticket constraint plus idempotent request IDs. A duplicate preserves the original checker and time. |
| Fast continuous scanner | QR-only background decoding, held-code suppression, next-ticket scanning, torch/focus/zoom assistance and exact Transaction ID fallback. No Excel parsing in the scan path. |
| Problem popup | Payment/unknown/duplicate issues require acknowledgement and Help Desk referral. Unconfirmed requests cannot authorize admission. Per-ticket deadlines now survive camera pauses and retries. |
| Server-owned student data | Permanent records on Supabase. Temporary device/browser copies only in RAM; explicit admin CSV export is the requested exception. Process death discards unconfirmed local requests; re-scan to get server status. |
| Dataset changes | Organizer files are applied privately from chat. No import, backup or simulation UI in the shipped app. Historical offline source is excluded from packages. |
| Help Desk | Four supplied fields: name, email, mobile and quantity. Authenticated, attributed server saves; admin-only edit/payment approval/college export. Pending is not an entry permit. |
| App and laptop website | Same authentication/API. The website is retained as the requested laptop Help Desk/admin companion. |
| Visual identity | Official horizontal Parul University Goa wordmark, Navrang icon, separate complete garba dancers, warm dark palette, beveled controls, distinct stock audio, haptics and Chota Namu guide. |
| Cinematic opening / usable controls | Skippable opening, composited transitions, reduced-motion support, larger controls and contained vertical overflow when keyboard, short viewport or enlarged text cannot fit safely. |
| Updates | Signed APK discovery/download and Android-confirmed installation. Source-only pushes do not magically produce signed APKs. Original signer, package, version, size and hash are verified. |
| Permissions / volume | Readiness controls are implemented; Android still requires user permission and can enforce device sound/brightness policies. |

Later requests supersede the original independent file-only app, Google-removal text, simulation request and blanket removal of exports. The retained admin college CSV and laptop companion were explicitly requested later.

## Bugs repaired in this review

- Pausing the camera could hide an in-flight admission receipt and discard the timer for an unresolved ticket. Results are retained in RAM and deadlines resume without being postponed by another ticket or retry.
- Retired camera callbacks could operate on a replacement camera; preview sizing also assumed a rear-camera rotation. Camera identity/rotation and release handling are corrected.
- Out-of-order account replies could restore old station access. Browser and Android now order profile responses and reject private results after account/access changes.
- A newer account's temporary data could be affected by a delayed old-account error. Session guards protect cleanup as well as successful responses.
- A delayed Android document-picker export could outlive admin login. Export generation/permission checks now guard opening and writing.
- Changing Help Desk search while a page loaded could drop the newer query. The latest query is queued and stale rows are discarded.
- Navigating to another Help Desk record could discard an uncertain save request. Navigation stays locked until the same-request retry is resolved or definitively rejected.
- An older review completion could close a newer record's dialog. Review generation guards preserve the current record.
- Hidden admin panes and generated codes could remain after downgrade or reappear following slow refresh. UI generation guards clear them immediately.
- Forced no-scroll styles could make controls inaccessible. Normal screens remain fitted; constrained screens can scroll within the app. Inputs and primary actions have practical touch targets.
- Release tooling could generate a new signing key silently or overwrite a published APK/version. It now fails closed and pins the original signer.
- A hosted-test safety check was a failing subtest, so subsequent imports could continue. The runner now blocks the live project and stops before mutations unless an explicitly isolated target is proven empty.

## Verification

- Full Node suite with both supplied Excel exports: **96 passed, zero failures/skips** at integration, including functional, privacy, race, release-policy and hosted-test safety checks.
- Seven Python release-policy cases verify missing/replaced signer, wrong package/version, immutable APK versions and monotonic updates.
- Native checks: **13 lifecycle cases plus 15 actual GateRuntime cases** pass, covering pending deadlines and delayed old-account 401/403/503 cleanup. Android 35 compilation and the pinned original APK signature pass. Final APK: 1,936,718 bytes; SHA256 `9e786d14eaf6b180bff0beedd27d999a7d20c9017d6ec7059e0d531a2abd5baa`. All 32 packaged assets match source.
- SQLite checks verify RAM-only state, rollback and duplicate protection.
- Current tracked source plus 323 historical source blobs were scanned for the supplied admin password, OAuth client secrets, provider tokens and private-key markers; no matches were found. This is a bounded pattern scan, not proof that every possible secret format is absent.
- Live read-only check at **16:09 IST**: 691 confirmed entries and continuing admissions. No attendee was admitted, edited or removed by the audit.
- Supabase security advice shows private RLS tables without policies by design: direct client access is denied and protected service RPC is used. Supabase Auth password breach protection is disabled; app staff use Google/custom codes rather than Supabase password signup.

## Limits before calling the app fully device-verified

No physical Android is attached. The connected-browser tool is unavailable, and managed rendered preview previously failed at the environment mount layer. Existing Site screenshot captures only the opening stage. Unit/DOM tests cannot certify frame rate, large-font layouts, real camera focus/torch behavior, sound loudness, haptics, installation or notification prompts. The uploaded videos show historical v0.4, so they are reference evidence, not a test of this release.

The app uses legacy Android Camera with bundled ZXing. CameraX/ML Kit is a candidate for a separately benchmarked upgrade; replacing the decoder during a live event without phone comparison is not justified. No zero-failure or offline cross-device duplicate guarantee is made. Universal admission needs the shared server.

Cloud backup availability and a restore drill were not verified. Before the next event, confirm the project's backup plan, privately back up the original signing key and run the physical-phone trial in NEXT-STEPS.md. Keep prototype test codes expired and use named staff credentials.

## Research informing the review

- [Chrome guidance on transform/opacity animations](https://web.dev/articles/animations-guide)
- [Android runtime permission requirements](https://developer.android.com/training/permissions/requesting)
- [Android application signing](https://developer.android.com/studio/publish/app-signing)
- [Android camera lifecycle](https://developer.android.com/reference/android/hardware/Camera)
- [Google sign-in branding](https://developers.google.com/identity/branding-guidelines)
- [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [Supabase backup options](https://supabase.com/docs/guides/platform/backups)
- [Supabase TLS change beginning no earlier than 10 November 2026](https://supabase.com/changelog/cbc-tls-ciphers-deprecated) — not an event-day breaking change.
