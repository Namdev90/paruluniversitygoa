# Navrang Gate Offline — prototype 0.1.0

[Download the Android APK](https://github.com/Namdev90/paruluniversitygoa/raw/refs/heads/main/downloads/Navrang-Gate-Offline-0.1.0.apk).

This is the file-only Android prototype requested on 16 October 2026. It imports the original Easebuzz Excel format and checks ticket transaction IDs entirely on the phone. There is no server, login service, online payment request, hotspot requirement or internet permission.

## Install and try it

1. Transfer **Navrang-Gate-Offline-0.1.0.apk** to an Android phone and tap it to install. If Android asks, permit the file app you are using to install this APK.
2. Open **Navrang Gate Offline**. Enter the checker's name and tap **Save**.
3. Save your Easebuzz `.xlsx` export to the phone. Tap **Import Excel**, choose it, review the counts and tap **Apply this file**.
4. Tap **Scan ticket QR** and allow camera permission. Scan the QR in the student's ticket email on their screen or on paper. Alternatively enter the exact eight-character Transaction ID.
5. For a successful payment, compare the university ID and tap **ID checked · confirm entry**. Green appears only after the entry is saved and verified. Scanning the same ID again shows **Already admitted**, with checker and time.
6. Import a newer Excel export whenever required. The new registration list replaces the old one, while all previous admissions remain on the phone. Each checker must import the new file separately.
7. Use **Export CSV** to save this phone's entry log. Collect the CSVs from every checker for consolidation. **Save backup** exports the current records and entry history as JSON for manual recovery or future tools; version 0.1.0 has no in-app JSON restore button.

The app needs Android 7.0 or newer and a WebView provider based on Chrome 86 or newer. An outdated provider produces a native instruction screen rather than a broken scanner. Update Android System WebView/Chrome before going offline if requested. No QR model or other asset is downloaded during operation.

## Important behavior for this test

- **Duplicate checks are local to each phone. The same ticket can be accepted by another independent phone.** Importing a new payment file does not share admission history. This prototype does not provide global single-use enforcement.
- No re-entry on a phone that already admitted the ticket. There is no clear-history button.
- A missing ticket means **Not in this file**, not necessarily unpaid. A payment made after an export was created will remain missing until a newer export is imported.
- Payment success comes from `Description`, not merchant `PayOutStatus`. Higher amounts caused by payment charges are not rejected merely for being above INR 100.
- University identity is checked by the human checker; payment data has no enrolment-number field.
- Phone clock and entered checker name are recorded. This offline prototype does not authenticate a volunteer's legal identity.
- **Use a test installation first.** Confirming a real ticket during testing records an admission. Before live use, export the test history, start with fresh app data and import the latest file. Never clear data or uninstall during live entry. In-place updates with the same package/signing key preserve data.
- If Android closes the app while an export picker is open, return to the app and retry export. Existing admissions remain in app storage.
- An APK installation, real camera, autofocus/torch, manufacturer file pickers and physical Android lifecycle have not been tested here. Verify them on your phone before event use.

## Files in the source/test bundle

- `downloads/Navrang-Gate-Offline-0.1.0.apk`: installable signed prototype.
- `app/assets/index.html`: offline browser companion. Open it from an extracted folder on Windows Chrome/Edge to test file import and manual checks. Camera scanning is provided by the Android APK.
- `test-codes/index.html`: synthetic QR test page to open on a laptop and scan with the phone. These synthetic IDs are not attendee tickets.
- `app/java/`: Android file picker, native QR camera, compatibility check and durable state bridge.
- `app/assets/`: shared eligibility/admission logic and offline interface.
- `tests/`: business rules, actual-file integration, browser persistence and native QR/storage checks.
- `tools/build.py`: Linux build script using Android API 35/build-tools 35.0.0 and Java 17+.
- The original prototype signing key is kept private and is not in this repository. Retain it privately for in-place upgrades. The build script creates a new local test key when no key is supplied; a differently signed APK cannot replace the original installation in place.

The repository contains no student database, admission logs, real ticket QR images, signing key or browser screenshots. Import the student export separately on each phone.

## Development checks

The provided student export is deliberately excluded. Set `NAVRANG_TEST_XLSX` to its local path when testing. Without it, the real-file Node integration test is explicitly skipped.

```sh
NAVRANG_TEST_XLSX=/path/to/export.xlsx node --test tests/*.test.cjs
java --module jdk.compiler/com.sun.tools.javac.Main -cp libs/core-3.5.3.jar -d .build/qr-classes app/java/in/navrang/gate/QrCodec.java tests/qr/QrCheck.java
java -cp .build/qr-classes:libs/core-3.5.3.jar QrCheck .build/test-codes
java --module jdk.compiler/com.sun.tools.javac.Main -d .build/qr-classes app/java/in/navrang/gate/AtomicCommit.java app/java/in/navrang/gate/WebViewSupport.java tests/qr/PlatformCheck.java
java -cp .build/qr-classes PlatformCheck
```

Browser checks use Playwright and `NAVRANG_CHROMIUM` to locate an installed Chromium executable. `CODEX_PRIMARY_RUNTIME_NODE_MODULES` locates Playwright in this workspace's runtime. No test framework is required by the installed APK.

To rebuild, supply `NAVRANG_ANDROID_JAR`, `NAVRANG_BUILD_TOOLS` and `NAVRANG_ZXING_JAR` to `python tools/build.py`. Google SDK build-tools need their adjacent `core-lambda-stubs.jar`. Android SDK components are not redistributed in this source bundle.

## Verification completed here

- 22 Node tests passed, including the actual supplied Excel export: 997 transactions, 926 eligible and 71 blocked, with zero skipped tests in that run.
- Nine native QR codec checks passed, including rotations and exact O/0 preservation.
- Eleven platform-logic checks passed for sync, silently failed commit/readback, truncated data and WebView compatibility.
- Desktop Chromium passed offline file import, named checker, entry, duplicate, reload persistence, re-import, invalid-file rollback, unknown ID, local-storage failure, export of read-only history and 390px layout checks.
- APK compiled and Android signature/permissions were verified. The manifest requests only CAMERA and VIBRATE, not INTERNET.

These checks do not establish physical Android camera or device-provider behavior. This is a test prototype, ready for your phone trial.
