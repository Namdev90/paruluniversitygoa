# Navrang Live 0.2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with one fresh whole-branch review.

**Goal:** Deliver shared single-entry admission, named authenticated checkers, live administration and a themed continuous Android scanner.
**Architecture:** A private Postgres schema and authenticated Edge API are authoritative. SQLite caches registrations, server receipts and a durable outbox on Android; a static web admin uses the same protected API.
**Tech Stack:** Java/Android 24+, bundled ZXing/SheetJS, JavaScript, Postgres PL/pgSQL, Deno Edge Functions, static Sites hosting.
**Spec:** docs/LIVE-V02-DESIGN.md

## Global Constraints
- Event O9KL3, exact 8-character IDs, one entry globally, no re-entry.
- Green only after server receipt plus local commit; disconnected operation is pending, never universal approval.
- The supplied admin password, service keys, signing key and real student records never enter public source or assets.
- Preserve legacy admissions and current payment eligibility rules; no payout-status shortcut.
- Google login is real external-browser OAuth with PKCE; unconfigured provider is clearly shown and admin-issued checker codes provide a distinct fallback.
- Visual motion must not block decoding; respect reduced motion.

## Review Focus
- An admission commits but its network response is lost: same UUID retry must recover the original receipt.
- A revoked or unapproved checker attempts an operation with an older session: server rejects it immediately.
- Registration replacement races a check-in or removes an already admitted ticket: one transaction order, preserved history.
- Process death/network failure leaves pending requests; no silent success, no discarded request.
- Malicious spreadsheets, oversized JSON and untrusted names must not change eligibility, execute HTML or produce spreadsheet formulas.

### Task 1: Shared protocol and hosted admission service
**Files:** server/schema.sql, server/functions/navrang-gate/index.ts and handler.mjs, app/assets/package.js, server/tests/*.mjs.
**Produces:** authenticated POST {action,payload}; login/config/sync/checkin/import/upsert/staff/export actions. Every reply has {ok,...} or {ok:false,error}. Sync returns {dataRevision,records?,entries,cursor,hasMore,stats,checkers?}.
- [ ] Write and run failing package/crypto/API behavioral tests, including malformed input and request replay binding.
- [ ] Implement canonical package validation, private schema, revocable session/auth checks, unique admissions and bounded delta sync.
- [ ] Deploy to the new dedicated project, seed only private hashed credentials, and run real concurrent synthetic-ticket checks including all Review Focus cases owned by the server.
- [ ] Run original rule tests plus server tests and commit.

### Task 2: Native SQLite, outbox and continuous camera
**Files:** app/java/in/navrang/gate/{GateDb,GateApi,GateSession,ScanLatch,MainActivity,ScanActivity}.java; app/AndroidManifest.xml; tools/build.py; tests/qr/*.java.
**Consumes:** Task 1 API; native calls exposed as local(action,json), api(action,json,requestId), scan(), googleLogin(), export.
**Produces:** permanent camera with asynchronous results; indexed local reads; outbox pending-before-send and finish-after-server; encrypted session persistence and external PKCE callback.
- [ ] Write and run failing latch, PKCE and durable queue/retry behavior checks.
- [ ] Implement SQLite migration from v1 JSON, transaction-safe outbox, HTTPS transport/timeouts/retries, continuous scan latch and native result card. Keep scanning through overlays; stop camera in background.
- [ ] Run native tests and compile/sign APK; confirm no bundled data, proper permissions and unchanged signing certificate. Physical phone tests remain explicitly unverified.
- [ ] Commit.

### Task 3: Scanner shell, branding and live admin dashboard
**Files:** app/assets/{index.html,style.css,gate.js,client.js,config.js,art/*}; web packaging tools; docs/GOOGLE-SIGNIN-SETUP.md; tests/live-browser.cjs.
**Consumes:** Task 1 responses, Task 2 native bridge and generated icon/poster assets.
**Produces:** checker login/home, swipe scan, Excel/package imports, account status, skippable branded intro, admin login/stats/registrations/entries/checker management/CSV export; live polling every 2s.
- [ ] Write and run browser flow checks against the real API with synthetic records and denied roles; include reduced motion, keyboard, 390px and desktop layouts.
- [ ] Implement responsive themed surfaces and animations, native/browser adapters, canonical import conversion, dashboard filters and safe DOM/CSV rendering.
- [ ] Verify original import rules, admin updates visible to checker, pending/suspended handling, network-loss labels, no duplicate auto-submit and responsive screenshots. Document exact Google provider/client/redirect setup.
- [ ] Commit.

### Task 4: Integration, review, publication and push
**Files:** README.md, docs/live-progress.md, downloads APK, SHA256SUMS.txt; private Site manifest in its own checkout.
- [ ] Run all rule, native, server and browser checks; test concurrent remote admission and retry recovery.
- [ ] Request one independent whole-project review; fix important findings with failing regression tests, then run all appropriate checks.
- [ ] Seed the real Excel file through the authenticated admin API only after synthetic fixtures are removed; verify counts without admitting real tickets.
- [ ] Publish the private owner dashboard, verify APK download/signature, update docs and push source/APK to GitHub main. No force push and no secrets or attendee data.
- [ ] Report implemented behavior, concrete links, tests and remaining Google/physical-device setup limits.
