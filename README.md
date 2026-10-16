# Navrang Gate — Parul University Goa

Android QR check-in and live event administration for Navrang 2026.

[Download Android 0.2.0](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-0.2.0.apk) · [Admin console](https://navrang-gate-admin.namubhai.chatgpt.site/#admin)

## Start at the gate

1. Install the APK on Android 7.0 or newer. Update Android System WebView / Chrome to version 86 or newer if requested.
2. Install over version 0.1.0 to preserve its data. **Do not uninstall or clear app data during live entry.** The private original signing key is retained outside this repository.
3. Admin: sign in with username **namdev** and the password supplied privately by the organizer. It is stored as a salted hash on the server and is not in the app or this repository.
4. Import the organizer workbook in **Data & files → Update shared database**. No student records have been uploaded to the hosted project; that transfer awaits explicit owner approval.
5. Open Admin → Checkers, enter each volunteer's name and create a checker code. The code is shown once. Share it privately with that checker.
6. Checkers sign in with the assigned code. Google sign-in is implemented but needs the owner's provider setup described below. Each accepted entry records the authenticated checker, device and server time.
7. Tap **Start scanning**, or swipe down on the scanner panel. The native camera stays active behind the result card. Each new QR submits automatically; no confirmation button. A held QR is suppressed until it leaves view.
8. **Allow entry after green.** The server validates the current organizer record and saves one admission, then the phone saves its receipt. Another scanner receives “Already admitted” with the original checker and time.
9. The exact eight-character Transaction ID can also be entered manually. O and 0 are different. Staff still compare the student's university ID; the payment export has no university enrolment-number field.

The owner dashboard is hosted privately. Open it with the owning ChatGPT account, then use the event admin login. The same admin console is included in the APK and browser companion, so the gate does not depend on dashboard hosting.

## Updates, stats and files

- Admin → Data & files accepts the original Easebuzz XLSX export or a versioned Navrang JSON registration package. Preview the counts and apply the shared update.
- Excel converts once. Android scans use an indexed internal SQLite database; they do not reopen Excel.
- **Download converted JSON** creates a file another device can import without parsing Excel. The current APK supports both formats.
- Admin → Update data also adds or edits an individual registration. Existing admissions remain immutable across full imports, payment changes and removal of a registration.
- Connected checkers and the dashboard receive registration updates and entry deltas by foreground polling every **2 seconds**. Check-in itself validates immediately at the server; it does not wait for the next poll.
- Statistics include current registrations, payment-eligible/blocked records, admitted/remaining students, last-minute throughput, entry history, checker counts and refused/duplicate attempts.
- Search registrations or entries; inspect a student's payment and entry details; approve or suspend Google checkers or assigned-code checkers. Suspension blocks existing sessions at the server.
- Admin CSV exports all fetched event entries. Device CSV distinguishes server receipts from previous-version local entries.
- Device backup contains cached records, receipts, legacy entries and pending requests, without sign-in credentials. It is an export for recovery tools; this version has no in-app device-backup restore.
- **Save offline reference** stores the file locally. Shared-server records refresh it after reconnection.

Payment eligibility uses successful transaction Description, event O9KL3, quantity 1, amount at least INR 100 and zero refunds. Merchant PayOutStatus is not used to decide student payment.

## Interrupted internet

Every scan is saved to a durable local outbox before transmission. Retries reuse its request UUID, including after reopening the app. A lost response cannot create another admission or change the original checker/time.

**Amber means pending, not permission to enter.** Disconnected devices can retain reference data and queued requests, but cannot guarantee universal no-re-entry. Requests resume under the same checker account; changing accounts does not submit someone else's pending scans.

Previous-version local admissions are preserved separately. They are not silently uploaded as universal admissions. Export the legacy ledger for organizer review if it contains real entries.

Set up and sign in each phone while connected before the event. Confirm actual camera, torch/autofocus, file picker, persistence after force-close and venue latency on the intended phones.

## Google sign-in

Real external-browser Google OAuth with PKCE and server-verified identity is implemented. The dedicated project's Google provider is **not enabled yet** because no Google Cloud OAuth client credentials have been supplied. The UI reports this accurately; assigned checker codes provide a working alternative.

Follow [Google provider setup](docs/GOOGLE-SIGNIN-SETUP.md). New Google users remain pending until Namdev approves them. Client secrets and server service keys are never bundled.

## Security and storage

The dedicated Supabase Postgres project is in Mumbai. Event tables have RLS in a private schema; only the Edge Function's service role can execute the admission RPC. Clients use revocable opaque sessions, restricted roles and throttled sign-in. The server serializes registration changes and admissions and enforces one event/ticket row.

Android stores sessions using Android Keystore AES-GCM and uses SQLite WAL with full synchronization. The app requests CAMERA, VIBRATE, INTERNET and ACCESS_NETWORK_STATE; camera runs only in the foreground.

No student database, entry log, real ticket QR, admin password, service key or signing key is in this public repository. University/event artwork was supplied by the organizer; see [asset notes](app/assets/art/ASSET-NOTES.md) and [third-party notices](THIRD-PARTY-NOTICES.md).

## Development and checks

- app/assets: shared business rules, canonical converter, scanner shell and browser/admin companion.
- app/java/in/navrang/gate: SQLite/legacy migration, encrypted sessions, native HTTPS/outbox and continuous QR camera.
- server/schema.sql: service-only Postgres schema/RPC.
- server/functions/navrang-gate: authenticated Edge API. Its body verifies sessions, so gateway verify_jwt is false; direct anonymous database access is still denied.
- tools/build.py: Linux Android API 35/build-tools 35.0.0, JDK 17+. Supply NAVRANG_ANDROID_JAR, NAVRANG_BUILD_TOOLS and NAVRANG_ZXING_JAR. A new local test key is generated if the private original key is absent; such an APK cannot replace the original installation in place.
- tools/sync-server-core.py regenerates the server ESM rules from app/assets/core.js.
- tools/package-web.py exports the browser companion into a chosen static directory.
- test-codes/index.html contains synthetic QR codes, not attendees.
- app/assets/legacy.html preserves the separate 0.1 offline browser companion for reference testing. The current gate uses index.html.

Run npm ci --ignore-scripts, then npm test. Set NAVRANG_TEST_XLSX to a private local export for the real-file integration; otherwise that test is explicitly skipped. Run python tests/sqlite-check.py for local database-schema failure/persistence checks. Java logic checks are in tests/qr.

The hosted integration suite and DOM/API integration are separate commands (npm run test:hosted and npm run test:dom). They require private test credentials, a dedicated synthetic dataset and the documented environment variables. Never run mutating integration checks against a live event. No credentials or attendee fixture is committed.

## Verification limits

The rule/protocol unit suite, real-file import, hosted concurrency/idempotency/authorization tests, DOM/IndexedDB offline recovery, Java QR/latch/PKCE/platform logic, SQLite-schema fault tests and APK signature/permissions were checked in this workspace. The dedicated hosted service was tested with synthetic registrations. Their audit rows are retained with reversible test flags and excluded from live entry counts; test checker accounts are suspended. Real student records have not been uploaded.

Rendered browser QA was blocked by the supported preview environment's mount-permission failure. DOM tests verify behavior, not visual layout. Physical Android camera/Keystore/lifecycle and an actual Google OAuth login have not been executed here. Google sign-in needs owner configuration and all event phones need a trial before live use.

Version 0.1 documentation in docs/spec.md and docs/plan.md is historical. The current design and implementation record are docs/LIVE-V02-DESIGN.md and docs/live-progress.md.
