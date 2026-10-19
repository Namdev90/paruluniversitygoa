# Navrang Gate 0.8.0 · Android code 18

Approved source: `59938aa8d30653b4a28665cfc4922806965d23cd`. Immutable approval checkout: `c3ef38196b0830383456708afd4a73fa07553772`. Runtime changes are exactly the approved branding/Reports/auth/motion candidate. Messaging, voice messages and broadcasts remain deferred. Backend runtime/schema and permissions are unchanged; the website was not redeployed for this APK release.

## Signed artifact

- Package: `in.navrang.gate`; minSdk24; targetSdk37.
- File: `downloads/Navrang-Gate-0.8.0.apk`.
- Bytes: 23634731.
- APK SHA-256: `8dd7423a67b69fa882a9115f5f1313fe930dfe6ec12c26ca62ff8b1215243fe4`.
- Original certificate SHA-256: `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`.
- Cryptographic v2/v3 signatures and alignment verified independently.
- All54 packaged asset files and actual manifest-resolved launcher match the approval checkout. Android permissions match0.7.9. All17 historical APK sizes/hashes are unchanged.

## Verification and limits

The guarded `tools/build.py` build passed clean release assembly,102Android tests and release lint with0errors/37warnings. Local Node suite:280passes/3existing skips. Native Java/camera/update checks:560. Publication/generator/artwork/SQLite and19history-release tests passed. Actual source CI runs39199515167/39199515161/39199515271 passed, including704browser cases and102Android tests. Public artifact verification must be performed after PR15 merges; local verification alone is not publication.

Restored tools: official checksum-verified OpenJDK17.0.2, Gradle9.6.0, Android37.0 revision2 and build-tools36.0.0. The prior builder/tool cache was pruned. No source build scripts or gates were changed to restore tools. The fresh unsigned APK embeds approval checkout c3ef381 in version-control metadata and is not asserted byte-identical to the earlier CI assembly at59938aa. The signed artifact above is the sole candidate being prepared for publication.

The owner already approved publication and deferred physical-device sign-in/camera/keyboard/upgrade/reboot/accessibility/performance checks for this source/version. Those checks remain SKIPPED_BY_OWNER, not passed. Hosted fixture checks remain skipped when their dedicated isolated fixture is unavailable. All signing material stays private and local.

The normal `tools/prepare-release.py` prepared the APK, manifest and cumulative checksums only after signed inspection. Publication is through PR15 with an expected-head lease. Re-download the canonical public manifest/APK/checksum and compare exact bytes, package, version, signature and historical hashes before announcing success. See [machine-readable local inspection](release-0.8.0-verified.json) and [release procedure](RELEASE-PROCEDURE.md).


## Publication receipt — 19 October 2026

The preparatory status and instructions above are retained as the original build record. Publication is complete: [PR #15](https://github.com/Namdev90/paruluniversitygoa/pull/15) merged the signed APK into public main as `f5c8614b0aea64d5e6bc4d6b50acf94bf8596ff3` at 06:58:44 UTC, and its publication record documents public APK, manifest and checksum verification at 06:59:33 UTC.

The [GitHub Release v0.8.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.8.0) was published at 15:56:59 UTC with the same original-key-signed APK and its checksum. Post-publication downloads of the [APK](https://github.com/Namdev90/paruluniversitygoa/releases/download/v0.8.0/Navrang-Gate-0.8.0.apk) and [checksum](https://github.com/Namdev90/paruluniversitygoa/releases/download/v0.8.0/Navrang-Gate-0.8.0.apk.sha256) were independently verified at 15:58:21 UTC:

- APK size: **23,634,731 bytes**; SHA-256: `8dd7423a67b69fa882a9115f5f1313fe930dfe6ec12c26ca62ff8b1215243fe4`. Downloaded bytes match the commit-pinned original, GitHub asset digest and checksum file.
- Embedded package/version: `in.navrang.gate` / **0.8.0 / Android code 18**.
- Original signer SHA-256: `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`; cryptographic APK v2 RSA signature and signed full-content digest checks passed.
- All 17 earlier GitHub Releases remain intact. This publication did not rebuild or re-sign the APK, change the updater channel, deploy the backend or redeploy the website. GitHub's Release publication time is distinct from the earlier public-main APK publication.

Physical-device acceptance remains **SKIPPED_BY_OWNER**. The public-download verification does not claim new device testing or change the earlier acceptance limits.
