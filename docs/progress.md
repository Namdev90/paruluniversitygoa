> Historical 0.1.0 document. The current shared-system specification is docs/LIVE-V02-DESIGN.md.

# Prototype implementation record

User's file-only prototype instruction supersedes the previous server proposal and explicitly requests implementation now. Implemented inline with one independent final review.

Task 1: complete — validation and admission tests observed failing before implementation; core tests then green.
Task 2: complete — local UI, import preview, atomic snapshot replacement, immutable admission history, native/browser storage and exports. Actual export verifies 997/926/71. Offline browser integration green.
Task 3: complete — Java native QR codec observed failing against a stub, then 9/9 green; APK compiled and signed. No physical Android device is attached.

Final review by a fresh reviewer identified four important issues. Regression checks were observed failing, then fixed:
- Boolean/object numeric coercion: strict numeric types/decimal strings now required; Node suite 22/22 green.
- Startup write blocked access to readable history: read-before-initialize, and export remains usable in read-only storage; native-bridge browser regression green.
- AtomicFile can hide a commit failure: explicit file-descriptor sync and byte-for-byte readback before success; platform checks 11/11 green.
- Older WebView could not parse the interface: native Chrome/WebView 86+ check before scripts; compatibility checks green.

Review severity ruling: the real-file test's silent pass without its private fixture was upgraded from minor to important because it could misrepresent verification. Changed to an explicit skipped test when the fixture is unavailable. The actual verification run supplies the fixture and skips zero tests.

Deferred minor: Android activity destruction during an open export picker can require the user to retry export. Existing entry data remains saved. Documented in README.

Ruling: replace the active registration snapshot rather than retain rows absent from a new file — the user's latest file-only instruction makes the imported file authoritative; admission history is always retained. Cost if the organizer uploads an incomplete export: absent unadmitted tickets require a complete re-import.

Ruling: keep each phone independent, as requested. Cost: the same ticket may be admitted on more than one phone. This limitation is visible in the app and documentation.
