# Navrang Gate · Parul University Goa

Android QR check-in and event administration for Navrang 2026. **Version 0.3.0 is a temporary rehearsal prototype.**

[Download Android 0.3.0](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-0.3.0.apk)

## Install and sign in

1. Install the new APK over the previous signed version. Keep app data; do not uninstall during event operations. Android 7+ and WebView/Chrome 86+ are required.
2. The opening shows the supplied event art, the official Parul University Goa wordmark and the approved Navrang icon. A separate login page follows.
3. Checkers use Google or an assigned code. Verified Google accounts activate automatically. They must save a real name, for example **Raju**, before scanning. Repeated sign-in reuses the account. Emails are private and never shown in the checker interface. Different people can share a real name; the immutable internal account ID distinguishes them.
4. Admin: choose **Administrator sign-in**, username **namdev**, and the privately supplied password. The complete admin console is inside the APK. Admin → Checkers has one-tap Activate / Suspend controls. A suspended account stays suspended after another Google sign-in.
5. Google must also allow the intended audience. If the OAuth application is still in Testing, only its Google Test users can sign in. See [provider setup](docs/GOOGLE-SIGNIN-SETUP.md).

## Live gate operation

Tap **Start scanning**, or swipe down on its panel. The camera stays open; a different student QR is read without reopening it. Green appears only after a server admission and local receipt save. A held code is suppressed until it leaves view. One ticket permits one entry, with no re-entry.

Payment, duplicate, invalid and unknown-ticket issues display a **manual-acknowledgment help-desk alert**, pausing new QR submissions. An unresolved network request also raises that alert after a short grace period. Acknowledgment never grants entry. Pending requests remain durable and retry using their original UUID. If a pending request later succeeds, its updated receipt is shown.

The scanner adds automatic torch assistance in low light, capped automatic zoom when small finder patterns are present, manual zoom/reset, tap-to-focus, focus guidance and inverted-QR decoding. These depend on device capabilities. Soft-image messages are heuristic guidance, not a calibrated blur diagnosis. Sound cues are original, local synthesized bells; the sound toggle also applies in the native scanner. Success and issues have different vibration patterns.

Use the exact eight-character Transaction ID manually if the camera cannot decode a ticket. O and 0 remain distinct. Compare the student's university ID separately: the organizer export has no enrolment-number field.

**No upload, document download, CSV export or backup tools are exposed in the current app.** Send a new organizer workbook privately in the working chat; the authorized operator applies it to the server. Only the admin can edit individual shared registrations inside the app. Importing a newer list preserves confirmed admissions. Scans use indexed SQLite, not a repeatedly opened workbook.

## Admin rehearsal

Sign in as admin → **Simulate** → **Start auto scan**. A persistent amber strip identifies simulation. Its sample QR stream covers paid, duplicate, unpaid and unknown tickets. Toggle the sample network offline and online to try pending recovery. Alerts pause the stream until acknowledged. Sample registration edits, checker activation/suspension, code creation and statistics use a separate in-memory ledger. Sample password changes are disabled. **No simulation operation calls the live check-in/import/upsert endpoints.** Return to live mode using the amber strip; reset discards samples only.

The home/admin layout fits the available viewport. Student, checker and entry lists use pages rather than sideways tables or an endless page. Small screens, large accessibility fonts, the keyboard and long text still need physical-phone review; rendered layout has not been verified in this workspace.

Chota Namu appears as the admin guide with a CN medallion. A separate mascot portrait has not been invented.

## Data and server

The approved private workbook initially loaded **997 registrations: 926 eligible, 71 blocked**. Real tickets, contacts and receipts are not bundled in the APK or public repository. Eligibility requires event O9KL3, successful transaction Description, amount at least INR 100, quantity 1 and zero refunds. PayOutStatus does not decide student payment.

The Mumbai Supabase service serializes admissions and organizer updates. Event data is in a private RLS-enabled schema; the Edge Function authenticates opaque sessions and uses its service key internally. Google identity is verified by Supabase Auth, never by client-supplied names. Admin access remains separate from Google checker access.

Foreground updates poll every two seconds; check-in validates directly at the server. Strict universal no-re-entry requires server confirmation. Offline requests are retained on the phone but do not authorize entry. Previous-version local admissions remain separate from universal receipts. APK updates preserve the SQLite database and encrypted session storage.

The APK uses its embedded interface and connects directly to Supabase; it does not load the hosted ChatGPT Site. The previous owner-private Site remains a configured OAuth fallback/home URL. It has not been deleted: the Sites connector has no delete/unpublish operation. Remove or replace its OAuth references before retiring it manually. No new Site is required for this app.

## Build and verification

`python tools/build.py` uses JDK17+, Android API35/build-tools and ZXing3.5.3. The original private signing key is required for an in-place release update; newly generated test keys cannot update the distributed APK. Only current assets are packaged; legacy import/export pages and spreadsheet libraries are excluded.

`npm ci --ignore-scripts` then `npm test` runs unit and DOM regressions. Set `NAVRANG_TEST_XLSX` to the private export for the real-file converter test. `python tests/sqlite-check.py` checks transactional durability. Native QR, camera-assistance and latch/PKCE/platform logic checks are in `tests/qr`.

The v0.3 checks cover simulation isolation, manual issue acknowledgment, role gating, name-preserving edits, real-name validation, server role enforcement, exact/rotated/inverted/low-contrast/landscape QR decoding, SQLite recovery, and signed APK permissions/certificate. Server profile tests use a transaction that rolls all fixtures back. Never run mutating hosted tests against the live event.

Supported rendered preview failed with a mount-permission error. Physical Android camera, torch/zoom/focus, haptics/audio, keyboard/layout, process recovery and Google OAuth still need an actual phone trial. Provider-enabled status is not proof of a successful login. Earlier hosted admission/idempotency checks are recorded in `docs/live-progress.md`; no real attendee was admitted for this update. This prototype has no measured near-zero camera failure rate and is not a venue performance certification.

Older v0.1/v0.2 design files are historical. Current follow-up work is in [next steps](docs/NEXT-STEPS.md). Asset sources and licenses are in [asset notes](app/assets/art/ASSET-NOTES.md) and [third-party notices](THIRD-PARTY-NOTICES.md).
