# Navrang Gate 0.2 design

> **Historical 0.2 design.** Preserve the dated architecture, instructions and evidence below as history. For the published 0.7.9 behavior and acceptance scope, use [Features](FEATURES.md), [the current release record](RESTORATION-RELEASE-0.7.9.md) and the [documentation index](README.md). Earlier approvals and deployment statements do not authorize or describe a later release.

Approved scope: the user's 16 October instruction authorizes the shared system previously recommended, updated APK, repository push, and the new scanner/admin/visual requirements. Implement in this session; no additional publication gate is needed. Google OAuth provider configuration may require the account owner's Google Cloud credentials; finish all independent work and identify that dependency precisely.

## Gate contract

Android 7+ checkers scan exact eight-character transaction IDs continuously. A valid QR automatically submits one check-in request; no confirmation tap or re-entry. Camera remains active behind a result card. Repeated frames of the same QR are suppressed until it leaves view; a different QR can submit immediately. Bounded processing keeps requests ordered. Swipe down on the home screen starts the scanner. Manual lookup remains available.

Green means the server accepted one admission and the phone saved its receipt. Network timeouts produce an amber pending result. Persist the request UUID before sending; retries reuse it, including after process death. Never change the winning checker or time on retries. A server database transaction validates the current registration and inserts a unique event/ticket admission. Offline phones retain records and queued requests but cannot confirm universal entry. Local legacy admissions are preserved and exported, never silently converted to server admissions.

## Data and transport

Use an isolated Supabase Postgres project in Mumbai. Keep all event tables in a private schema with RLS; only the server Edge Function can execute its RPC. Client apps never receive service keys. Events serialize imports and admissions so updates cannot race eligibility. Separate registration revisions from the append-only admission sequence. Sync transfers changed registration snapshots and entry deltas, using 2-second foreground polling; missed deltas are fetched on reconnect. Describe this cadence accurately in the UI.

Excel converts once to validated canonical records. Accept versioned preconverted JSON packages with the same validation. SQLite on Android stores indexed registrations, immutable server receipts, a durable outbox and legacy admissions; each operation is transactional. Native Android Keystore protects saved sessions. Keep browser storage and testing as companions. Imports replace the active registration list without deleting admission history.

## Identity and administration

Admin username is namdev. Seed only a salted password hash outside source; the supplied password never enters the APK, public Git history or static web assets. Use expiring, revocable opaque sessions and throttled login attempts. Admin can import Excel/package data, add or update a ticket, search all registrations, inspect live entries, see counts/payment statuses/checker throughput/recent rates, export CSV and activate or suspend checkers.

Google checker login uses Supabase OAuth in the external system browser with PKCE and a dedicated Android callback. Verified Google identity creates a pending checker record; only admin approval enables scanning. Also provide admin-issued checker codes for venue use while Google provider setup is incomplete. The code is generated randomly, shown once to the admin and stored only hashed server-side. Display the actual authentication method. No simulated Google identity and no arbitrary typed-name access to the shared database.

## Visuals

Use the supplied Parul University Goa/Navrang poster unchanged for the short, skippable opening, with actual university/event art. Burgundy, warm cream and gold, enamel-like raised controls, layered cards and restrained depth. Generate a distinct Navrang Gate app icon; do not invent an official university mark. Fast transform/opacity transitions, reduced-motion support, large touch targets, high contrast states, no decorative delay before the next scan. Camera-screen result overlay shows attendee, ticket, amount/payment status and original checker/time where applicable. No card, address or unnecessary payment data is retained.

## Verification and release

Prove unauthenticated denial, admin/checker separation, pending/suspended checker rejection, concurrent same-ticket single winner, idempotent retry, record update semantics, refused/unknown tickets, offline outbox recovery, old ledger preservation and storage-failure behavior. Run the original rule tests. Build/sign with the private original key, bump to 0.2.0/versionCode 2 and verify permissions/assets. Review the whole change once with a fresh reviewer, fix important findings, deploy the private owner admin Site, seed the supplied export through the protected import API, and push source plus APK to main without student records or secrets. Report actual physical Android/Google tests separately from workstation and hosted API checks.
