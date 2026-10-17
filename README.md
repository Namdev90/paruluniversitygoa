# Navrang Gate · Parul University Goa

Android QR entry and embedded administration for Navrang 2026.

[Download Android 0.7.2](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-0.7.2.apk)

Install over the existing signed app. Student records remain on the server; the current app keeps temporary copies in memory only. The private original signing key is retained outside this repository. Android 7+ and WebView/Chrome86+ are required. Version 0.4 introduces the update client; older APKs need this one manual installation.

## Current app

- Official horizontal **Parul University Goa** wordmark throughout, including the horizontal branding in the Navrang icon. The separate wordmark is the original vector from the university website, not a recreated text label.
- Dark interface with a longer, skippable 6.2-second opening: isolated garba dancer artwork arrives from opposite sides over a custom stage. The poster is not the opening background. Kenney CC0 music/interface samples follow the reveal and stop when skipped. Sound is always enabled in the app; device policy still applies. Reduced motion is respected.
- Refined controls and composited scan-line motion. Admin rows are retained when a two-second poll returns unchanged data, avoiding unnecessary list/button replacement.
- Separate Google / assigned-code login and administrator login. Google sign-in is retained. Users save a real name such as Raju and choose their station once: Checker or Help Desk. The choice is saved server-side; later sign-ins open the assigned station directly. Only admin can change it. New Google accounts request access; only admin grants it. Existing approved checker access is preserved. Repeated sign-in reuses the account. Display names can coincide; immutable internal account keys preserve unique attribution. Google email remains private from other checkers.
- Admin username **namdev** with the privately supplied password. Admin-only registration edits, entry/stats pages, named staff-code creation, real-name editing, Checker / Help Desk assignments, and access enable/suspend controls. Re-login does not undo suspension.
- Simulation has been removed. Sample QR assets and the rehearsal module are excluded from the app. Organizer files are supplied privately in the working chat and applied to the server. Help Desk has an explicitly requested admin-only college CSV export; ordinary checkers have no import, export or backup tools.

Version 0.6 removes the mute button and blue WebView tap/selection wash, adds warm beveled controls and a branded close dialog that warns about RAM-only pending work, and replaces the clipped shared dancer image with separate complete figures. Ten distinct bundled CC0 cues cover reads, outcomes and controls. A QR read sounds immediately; confirmed admission, duplicate, invalid code, payment issue and delayed connection warning have different cues. Sound loading and playback do not block scanning.

Version 0.7 adds the station picker and server-enforced separation: Help Desk-only staff cannot check in or download the checker roster, while Checker-only staff cannot read Help Desk contacts. Choosing a role requests access without granting it. Admin can create named codes for either station or both, and name/permission changes reach existing sessions. The Android scanner closes after access is revoked. Temporary test-code sessions expire server-side; production staff codes remain random and named. Student data is still RAM-only on devices.

Version 0.7.1 makes sign-out immediate, clears hidden forms, dialogs and temporary data when sessions expire or Help Desk access changes, and prevents delayed exports or old-session responses from resurfacing private details.

Version 0.7.2 locks the first station choice to the account and lets only admin reassign it. Ordinary staff receive only **My scans** (their own server-confirmed admissions) and **Total entries** (all confirmed admissions). Their sync response contains no roster, entry history, staff list, registration total, remaining count or payment statistics. The Android and browser clients discard previous bulk copies. Admin retains the full dashboard. Help Desk staff keep their own paged cases for the existing registration workflow.

## Gate operation

Tap Start scanning or swipe down on its panel. Google/code checkers can enter the continuous scanner after successful sign-in and name setup. Each new QR is submitted automatically. A held QR is suppressed until it leaves view. Green means the server committed the admission receipt. One ticket grants one entry; no re-entry.

A failed payment, unknown/invalid ticket or duplicate presents a manually acknowledged help-desk alert and pauses new submissions. An unresolved request gets a grace period before the same alert. Acknowledgment never authorizes entry. Repeated pending retries do not repeatedly interrupt an already acknowledged ticket; the final server result still appears.

The camera supports continuous/tap focus, inverted QR decoding, low-light torch assistance, bounded small-QR zoom, manual torch/zoom/reset, heuristic soft-image guidance, distinct local audio and scan vibration. These depend on the phone and are not a measured zero-failure guarantee. Use exact Transaction ID entry as fallback. O and 0 differ; staff compare the university ID separately.

Lists use pages rather than an endless/sideways table. Physical layout, larger fonts and the keyboard still need review on the intended phones. Chota Namu appears as a labeled CN admin guide medallion, without an invented personal portrait.

## Current organizer dataset

The latest authorized workbook, dated **17 October 2026**, is applied privately and verified: **1,124 registrations, 1,041 eligible, 83 blocked**. It adds 127 records; all 997 prior canonical registrations are unchanged. No real attendee was admitted to test this update.

Eligibility requires event O9KL3, successful transaction Description, amount at least INR100, quantity1 and no refund. Merchant PayOutStatus is not used for student eligibility. Only canonical ticket/name/payment fields are sent to the event server; workbook contact/card details are excluded. No real dataset, ticket QR or entry ledger is in the public repository/APK.

Dataset changes sync to connected apps without reinstalling. Scans validate directly against the indexed server ticket table. Staff fetch only the two counters; admin keeps an indexed in-memory view. No workbook parser runs during scanning. The shared Mumbai Supabase service serializes imports and admissions and preserves immutable receipts. Event tables are private/RLS-enabled; only the authenticated Edge API's internal service role can run their RPC. Google identities are verified with Supabase Auth. Admin access is separate from Google checker access.

Foreground updates poll every two seconds; check-in validates directly at the server. Unconfirmed requests are held in memory and retry with the same UUID while the process stays open. They do not survive force-close or process death. Re-scanning still cannot create a second admission because the server enforces one entry. Amber does not allow entry. Internet is needed for confirmation and Help Desk saves. Old persistent roster/receipt caches are retired when the new app starts; pending v0.4 requests are carried into temporary memory before the old cache is removed. Authentication tokens and non-student preferences remain encrypted/private as appropriate; student data and Help Desk drafts are never written to a local database or browser storage.

## Help Desk on Android and laptop

Sign in with Google or an assigned staff code, save your name, then choose Help Desk from the station picker. The administrator can use the same admin login. Namdev assigns **Help Desk** to named staff in **Admin → Staff → Manage access**; Google sign-in alone does not grant either station permission. Requests appear first in the Admin staff list.

The form captures only name, email, mobile number and quantity, matching the organizer’s reference. Email is required and prevents duplicate pending/approved Help Desk cases. The fee preview is ₹100 per person. Saving uses a UUID for safe same-request retries. The server records the staff identity, timestamps and a generated eight-character ticket ID when needed. Staff can read only their own saved cases. They cannot edit records, approve payment, authorize tickets or export contact details.

Admin can view all cases, edit pending details, review or reject cases and download **Help Desk → Saved list → College CSV** for the college. The export includes all Help Desk records and attribution and protects spreadsheet formulas. Exporting is an explicit local download chosen by the admin; no file is sent to anyone automatically.

A pending case does not authorize entry. Admin explicitly confirms the person and ₹100 payment before approval publishes an eligible single-entry ticket and updates other stations. Quantity must be one for admission; register other people separately rather than sharing one entry ticket. For an existing ticket, original payment/entry data is preserved; any payment issue must first be corrected in Admin → Students and the same-person link explicitly confirmed. Later organizer file imports preserve approved Help Desk tickets. Each create/edit/review has a private server audit record and optimistic edit version.

Laptop portal: https://navrang-gate-admin.namubhai.chatgpt.site/#desk

## Station readiness

Android starts with maximum app/media volume, enabled app sound and strong scan vibration. Ambient light drives activity-only brightness when the phone has a light sensor; otherwise normal system brightness is used. These controls do not change global brightness mode or bypass Do Not Disturb, fixed-volume policies or hardware limits. Account displays current readiness.

After the opening, Android requests camera and, on Android13+, notifications once. The phone owner must approve them; the app cannot auto-grant permissions or turn on blocked system channels. Account offers retry/settings buttons. No storage permission is required for Help Desk: exports use Android’s document picker, and registration saves require the server.

## Automatic app updates

From 0.4 onward, the app checks a repository release manifest, downloads signed updates in the background when allowed, and shows an in-app banner and optional notification. It waits/yields while the scanner is active. Account contains status, manual Check, notification permission and automatic-download controls.

APK size/hash, package name, higher version code and the installed signing certificate are checked before installation. Android may ask to allow installs from Navrang Gate and requires its install confirmation in this workflow. No silent forced replacement or live downloaded JavaScript is used. Entry data remains in the same app package.

See [app update publishing](docs/APP-UPDATES.md). Increase `release.json`, build with the original key, then push the APK and generated `updates/latest.json`. `tools/build.py` prepares these release artifacts automatically. A source-only Git push does not create a signed release; no GitHub signing-secret workflow has been configured.

## Checks and limits

Run `npm ci --ignore-scripts`, then `npm test`. Set `NAVRANG_TEST_XLSX` and `NAVRANG_LATEST_XLSX` to the private organizer files for real-file regressions. `python tests/sqlite-check.py` checks the in-memory schema, transaction failure and request deduplication. Native QR, camera-hint, latch/PKCE/platform and update-channel policy checks are in `tests/qr`.

This iteration passed 76 unit/DOM/data checks including Help Desk retries, role controls, session cleanup, CSV formula protection and the actual workbook comparison. A rollback-only database suite verifies authorization, contact isolation, versioned edits, approval, duplicate prevention, import preservation and auditing; it leaves no attendee fixtures. Ten native OAuth callback cases cover query/fragment errors, state checks, duplicate parameters and credential-safe messages. Ten previously passed native update-policy cases cover the existing update channel. Previously established QR decoding coverage includes exact, rotated, inverted, low-contrast, landscape and blank frames. The signed APK and public manifest/hash are checked before handoff. No mutating hosted admission test is run against real attendees.

The supported rendered preview could not start due to an environment mount-permission failure. No physical Android was attached; the new opening, install/notification flow, camera and frame smoothness still need phone verification. Unit/DOM tests do not establish visual frame-rate or end-to-end Android update behavior.

The full admin console is inside the APK and connects directly to Supabase. The existing public login Site is now the laptop companion for the same authenticated Help Desk and admin API. Its audience is preserved; personal data is behind app sign-in and server authorization. Historical v0.1–v0.3 docs/APKs are retained as history. Current next steps are in [the phone trial](docs/NEXT-STEPS.md); Google setup is in [provider setup](docs/GOOGLE-SIGNIN-SETUP.md).
