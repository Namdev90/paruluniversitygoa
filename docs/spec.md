> Historical 0.1.0 document. The current shared-system specification is docs/LIVE-V02-DESIGN.md.

# Navrang Offline prototype

The user's 16 October 2026 instruction replaces the earlier server design: build a temporary, fully offline Android app now. No server, hotspot, account service, online checks or decoration pass is required. Each checker installs the APK, enters a name, imports the supplied-format Excel export, scans or types a ticket transaction ID and confirms an entry. One entry per ticket per device; no re-entry. Independent phones cannot share duplicate detection, and the app must say so visibly.

Use the successful transaction Description, correct event LinkID O9KL3, Quantity 1, amount at least INR 100 and zero refunds. Never use PayOutStatus to decide student payment. Current export: 997 transactions, 926 successful, 71 unsuccessful. IDs are eight uppercase alphanumeric characters. Unknown, malformed, refunded, unsuccessful or inconsistent records cannot be admitted. Preserve exact O and 0.

Import XLSX entirely on-device. Validate before replacing the active registration snapshot and keep all admission history across imports. Records absent from a new snapshot are no longer available for a new admission, but their past admission remains. Reject conflicting duplicate transaction IDs, wrong-event exports, missing required fields and empty/oversized exports. Preview counts before applying. Do not silently deduplicate by name, email or phone.

Use a bundled native ZXing decoder and a local WebView interface with SheetJS 0.20.3. Android 7.0+ (API 24), target API 35. The manifest has camera and vibration permissions only, no INTERNET permission. Persist state with Android AtomicFile before showing green. A browser companion uses IndexedDB and is for file/import/manual-entry checks. Record checker name, device ID, ticket, customer, time and source import. Export CSV and a JSON backup. No clear-history function.

Deliver a signed prototype APK and a source/test bundle without student data or pre-populated admissions. Verify real-file import, duplicates, replacement and persistence, native QR decode and APK signature/permissions. Report actual Android installation/camera testing separately; no physical Android device is currently attached.
