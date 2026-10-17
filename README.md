# Navrang Gate · Parul University Goa

Android QR entry and embedded administration for Navrang 2026.

[Download Android 0.4.0](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-0.4.0.apk)

Install over the existing signed app to preserve data. The private original signing key is retained outside this repository. Android 7+ and WebView/Chrome86+ are required. Version 0.4 introduces the update client; older APKs need this one manual installation.

## Current app

- Official horizontal **Parul University Goa** wordmark throughout, including the horizontal branding in the Navrang icon. The separate wordmark is the original vector from the university website, not a recreated text label.
- Dark interface with a longer, skippable 6.2-second opening: isolated garba dancer artwork arrives from opposite sides over a custom stage. The poster is not the opening background. Original local bell audio follows the reveal and stops when skipped. Reduced motion is respected.
- Refined controls and composited scan-line motion. Admin rows are retained when a two-second poll returns unchanged data, avoiding unnecessary list/button replacement.
- Separate Google / assigned-code login and administrator login. Verified Google accounts activate automatically, then save a real name such as Raju. Repeated sign-in reuses the account. Display names can coincide; immutable internal account keys preserve unique attribution. Google email remains private from other checkers.
- Admin username **namdev** with the privately supplied password. Admin-only registration edits, entry/stats pages, named checker-code creation, and one-tap Activate / Suspend. Re-login does not undo suspension.
- Simulation has been removed. Sample QR assets and the rehearsal module are excluded from the app. No upload, document download, CSV export or backup controls are exposed; organizer files are supplied privately in the working chat and applied to the server.

## Gate operation

Tap Start scanning or swipe down on its panel. Google/code checkers can enter the continuous scanner after successful sign-in and name setup. Each new QR is submitted automatically. A held QR is suppressed until it leaves view. Green means both server admission and local receipt were saved. One ticket grants one entry; no re-entry.

A failed payment, unknown/invalid ticket or duplicate presents a manually acknowledged help-desk alert and pauses new submissions. An unresolved request gets a grace period before the same alert. Acknowledgment never authorizes entry. Repeated pending retries do not repeatedly interrupt an already acknowledged ticket; the final server result still appears.

The camera supports continuous/tap focus, inverted QR decoding, low-light torch assistance, bounded small-QR zoom, manual torch/zoom/reset, heuristic soft-image guidance, distinct local audio and scan vibration. These depend on the phone and are not a measured zero-failure guarantee. Use exact Transaction ID entry as fallback. O and 0 differ; staff compare the university ID separately.

Lists use pages rather than an endless/sideways table. Physical layout, larger fonts and the keyboard still need review on the intended phones. Chota Namu appears as a labeled CN admin guide medallion, without an invented personal portrait.

## Current organizer dataset

The latest authorized workbook, dated **17 October 2026**, is applied privately and verified: **1,124 registrations, 1,041 eligible, 83 blocked**. It adds 127 records; all 997 prior canonical registrations are unchanged. No real attendee was admitted to test this update.

Eligibility requires event O9KL3, successful transaction Description, amount at least INR100, quantity1 and no refund. Merchant PayOutStatus is not used for student eligibility. Only canonical ticket/name/payment fields are sent to the event server; workbook contact/card details are excluded. No real dataset, ticket QR or entry ledger is in the public repository/APK.

Dataset changes sync to connected apps without reinstalling. Scans use indexed SQLite, not a workbook parser. The shared Mumbai Supabase service serializes imports and admissions and preserves immutable receipts. Event tables are private/RLS-enabled; only the authenticated Edge API's internal service role can run their RPC. Google identities are verified with Supabase Auth. Admin access is separate from Google checker access.

Foreground updates poll every two seconds; check-in validates directly at the server. Offline requests are saved to a durable actor-specific outbox and retry with the same UUID, including after reopening. Amber does not allow entry. Independent disconnected phones cannot enforce universal no-re-entry. Previous-version local admissions remain separate from server receipts.

## Automatic app updates

From 0.4 onward, the app checks a repository release manifest, downloads signed updates in the background when allowed, and shows an in-app banner and optional notification. It waits/yields while the scanner is active. Account contains status, manual Check, notification permission and automatic-download controls.

APK size/hash, package name, higher version code and the installed signing certificate are checked before installation. Android may ask to allow installs from Navrang Gate and requires its install confirmation in this workflow. No silent forced replacement or live downloaded JavaScript is used. Entry data remains in the same app package.

See [app update publishing](docs/APP-UPDATES.md). Increase `release.json`, build with the original key, then push the APK and generated `updates/latest.json`. `tools/build.py` prepares these release artifacts automatically. A source-only Git push does not create a signed release; no GitHub signing-secret workflow has been configured.

## Checks and limits

Run `npm ci --ignore-scripts`, then `npm test`. Set `NAVRANG_TEST_XLSX` and `NAVRANG_LATEST_XLSX` to the private organizer files for real-file regressions. `python tests/sqlite-check.py` checks persistence/fault behavior. Native QR, camera-hint, latch/PKCE/platform and update-channel policy checks are in `tests/qr`.

This iteration passed 47 unit/DOM/data checks including the actual workbook comparison, plus ten native update-policy cases. Previously established QR decoding coverage includes exact, rotated, inverted, low-contrast, landscape and blank frames. The signed APK and public manifest/hash are checked before handoff. No mutating hosted admission test is run against real attendees.

The supported rendered preview could not start due to an environment mount-permission failure. No physical Android was attached; the new opening, install/notification flow, camera and frame smoothness still need phone verification. Unit/DOM tests do not establish visual frame-rate or end-to-end Android update behavior.

The full admin console is inside the APK and connects directly to Supabase. The previous owner-private Site remains a configured OAuth home/fallback; it has not been deleted because the Sites connector exposes no delete/unpublish method. Historical v0.1–v0.3 docs/APKs are retained as history. Current next steps are in [the phone trial](docs/NEXT-STEPS.md); Google setup is in [provider setup](docs/GOOGLE-SIGNIN-SETUP.md).
