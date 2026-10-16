# Navrang Offline Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution and one fresh whole-project review.

**Goal:** Deliver a file-only Android scanner prototype.

**Architecture:** Pure JavaScript validation/admission functions shared by the offline UI and tests. An Android shell supplies file picking, native QR scanning and atomic persistence. No network component.

**Tech Stack:** Java/Android API 35, ZXing core 3.5.3, SheetJS CE 0.20.3, browser IndexedDB, Node test runner.

**Spec:** docs/spec.md

## Global Constraints
- Android 7.0+; no INTERNET permission or runtime dependencies downloaded at the venue.
- Event O9KL3, one entry per ticket on each device, no re-entry.
- Preserve admission history when replacing the active Excel snapshot.
- Show the independent-phone duplicate limitation.
- Never include the user's spreadsheet or personal data in the distributable.

## Review Focus
- A transaction succeeds but payout says Not Paid: allow the payment match.
- A replaced file changes status or removes an admitted ticket: never reset its history.
- Invalid imports or failed persistence: preserve old state and never show green.
- User content contains HTML or spreadsheet formulas: render as text and protect CSV export.
- Android process death, permission denial, cancelled picker and camera unavailable: retain data and allow manual entry.

### Task 1: Validation and admission core
**Files:** app/assets/core.js, tests/core.test.cjs
**Interfaces:** normalizeRows(rows) -> batch; newState(deviceId) -> state; applyImport(state,batch,source,time) -> state; inspectTicket(state,id) -> result; admit(state,id,checker,time) -> {state,result}; csv(state) -> string.
- [ ] Write and run failing behavioral tests for validation, payment statuses, IDs, duplicates, missing data, refunds, replacement and CSV protection.
- [ ] Implement the named pure functions and run node --test tests/core.test.cjs until green.
- [ ] Commit the completed core.

### Task 2: Storage and offline interface
**Files:** app/assets/index.html, app/assets/style.css, app/assets/store.js, app/assets/app.js, tests/browser.cjs
**Interfaces:** Store.read() -> Promise<state|null>; Store.mutate(callback) -> Promise<result>; Native.scan(), Native.saveText(name,mime,text), native scan callbacks.
- [ ] Write an integration check for import/confirm/duplicate/reload/reimport using real browser storage.
- [ ] Implement import preview, named operator, scan/manual lookup, admission, durable storage and CSV/backup exports.
- [ ] Run browser checks against the supplied XLSX with network disabled after initial page load; verify 997/926/71 and persistence.
- [ ] Commit the interface.

### Task 3: Android package and delivery
**Files:** app/AndroidManifest.xml, app/java/in/navrang/gate/MainActivity.java, app/java/in/navrang/gate/ScanActivity.java, tools/build.py, tests/qr/QrCheck.java, README.md.
- [ ] Add QR decode round-trip checks for normal, rotated and unknown payloads.
- [ ] Implement native file picker, atomic state bridge, camera permission, bundled QR decoder and export picker.
- [ ] Compile/sign/verify the APK; verify no INTERNET permission and no student data in its assets.
- [ ] Review the complete project with a fresh reviewer, fix important findings with regression checks, save the APK and source/test bundle, and state untested physical-device behavior.
