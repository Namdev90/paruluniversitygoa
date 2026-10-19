# Navrang 0.8.0 / Android code 18 release candidate

The owner requested immediate release of the completed changes on 19 October 2026 and explicitly deferred the new communications features. This candidate is not yet signed or published. The current public download remains 0.7.9 / code 17.

Included changes:

- Approved combined Navrang/Parul University artwork from PR #13, unchanged, on the approved maroon gradient.
- Staged role selection and sign-in, confirmation before sign-out, current-permission checks and reduced-motion-aware transitions.
- Consolidated Reports with Overview, Downloads and administrator-only Teacher access pages. Downloads remain reachable without normal page scrolling; measured pagination and explicit accessibility dialogs preserve large-text and short-height access.
- Guarded native report saves that distinguish saved, cancelled and failed; browser downloads report initiation only. A local operation ID correlates picker callbacks and is never sent to the reporting backend.
- Existing scanning, Help Desk, authorization, reporting integrity and automatic APK-update notifications remain supported.

Deferred: the combined Communications page, administrator live broadcast, message announcements, audio messages to the administrator, and name-selected person-to-person voice messages. Their unfinished work is preserved in draft PR #14; their UI, provider dependencies, new RPCs, SQL state and worker are excluded from this release candidate.

The candidate uses the existing production v7 reporting contract: CSV/Excel call `reports-export` with only `kind`, PDF calls `reports-summary`, and both recheck `me`. No database, Edge Function, Firebase or voice-service deployment is required for this release. The only server-tree difference from released main is the browser branding assertion updated for PR #13.

Physical-device checks remain `SKIPPED_BY_OWNER`. Fresh source CI, browser report-file parsing, Android unit tests/build/lint and unsigned APK inspection are required. An unsigned CI artifact is a preparation artifact, not an installable update or proof of signing acceptance.

## Original-key signing gate

The earlier private signing-key workspace is unavailable in this session; no local signing-key file or configured override was found. Do not generate a replacement, upload the key to CI, request secret material in chat, or change the public manifest to an unsigned candidate.

The custodian must use the original key privately in its retained environment. Required certificate SHA-256: `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`.

After exact-source verification, record the owner's existing release instruction and device waiver against the verified source/version, then run the normal `tools/build.py` original-key release procedure in that environment. Independently inspect the signed package, version, certificate, schemes, assets, size and checksum. Append `downloads/Navrang-Gate-0.8.0.apk`, preserve every historical APK, and update the manifest/checksums only after signed verification. Merge with an expected-head lease, then independently download and verify public main bytes before reporting publication.
