# Current original-key release procedure

This is the current procedure after published **0.7.8 / code 16**. The primary operational UI uses the original-design shared interface in its AndroidX host, with native Credential Manager/PKCE, CameraX and platform services. The owner's original-style direction supersedes earlier Material-only presentation requirements. Preserve all working data/security behavior.

## Coordinate the exact source

Re-read remote main, the updater manifest, active PRs and concurrent work. Use the implementation lead's exact reviewed, pushed commit and a coordinated unused version with a strictly higher code. The next arithmetic version is not automatically approved or reserved. Do not overwrite 0.7.8 or any historical artifact.

Require final-source checks and the requested independent reviews. Keep `release.json`, current artwork expectations and the appropriate source/version-scoped approval evidence consistent. The 0.7.7 and 0.7.8 waivers are historical; they do not authorize a different candidate. Record unperformed device/auth/upgrade/performance/hosted checks as unverified or explicitly waived, never passed.

Verify the original signing key is available in the authorized build environment at signing time; never assume it is shared across environments. Never generate a replacement key, upload it to GitHub/CI, disclose its path/password, or delete ignored build/signing material.

Expected public signer SHA-256:

`0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`

## Build and verify the candidate

1. Fetch the exact final reviewed source into a clean, isolated checkout in the original build environment. Inspect its diff, dependencies, scripts, tests and public assets before executing it near signing material. Preserve unrelated work and actual repository protections.
2. Use the custodian's verified JDK 17/SDK setup and privately configured `NAVRANG_SIGNING_KEY`. Run relevant Node, Java, SQLite, Android assembly/unit/lint, generator, artwork and release-gate checks on this source; historical counts do not certify the next version.
3. Run `python3 tools/build.py`. Its current default delegates to `tools/build-native.py`, enforces the current source/version gate and original certificate, then builds/signs/verifies the candidate in `dist/`. It **does not run `prepare-release.py` by default**. The explicitly named legacy hotfix path is not the normal upgrade route and requires separate authority.
4. Independently inspect the signed candidate using `apksigner verify --verbose --print-certs` and `aapt2 dump badging` from the verified build-tools installation. Require the original signer, `in.navrang.gate`, exact version/code, minimum API 24, intended target API, byte length within the updater limit and SHA-256.
5. Check shipped operational assets and manifest-resolved launcher against the reviewed source/approved derivative. Do not assume a fixed resource filename survives AGP packaging. Verify no private records, credential, signing material or internal/debug-only interface is packaged.

## Prepare and publish separately

Only after the applicable source/artifact/publication gates are met:

1. Configure `NAVRANG_BUILD_TOOLS` to the verified SDK build-tools directory, or configure `NAVRANG_ANDROID_SDK` according to the preparation script. `ANDROID_HOME` alone is not `tools/prepare-release.py`'s build-tools override.
2. Run `python3 tools/prepare-release.py`. It rechecks signature/package/version and copies the exact signed candidate to `downloads/`, creates `updates/latest.json` and updates `SHA256SUMS.txt`. It rejects changed bytes under an existing version and channel rollback.
3. Inspect the prepared source/artifact/manifest/checksum diff and every historical APK hash. Stage only the intended reviewed files, then use the authorized normal commit/push/merge path. Never bypass real protections or send the private key to a binary-transfer workflow.
4. Independently fetch the canonical public APK, manifest and checksum. Require successful responses, exact URL/version/code/size/hash, original signature and source artwork. Record the actual main publication commit and device/upgrade verification outcome.
5. Update README, Changelog, inventory and release evidence with actual publication facts. Keep all previous archives unchanged. An unsigned CI assembly, signed local candidate or source-only push is not a published update.

## Website and historical archive are separate

- Deploy the browser companion only through the existing public Sites project and the [portal parity plan](PORTAL-DEPLOYMENT.md). Repository pushes and APK publication do not update the hosted portal.
- [Historical GitHub Releases](history/GITHUB-RELEASES.md) reuse exact already-published bytes and first-on-main archive commits. They do not call the build/sign/prepare-release path or modify the updater manifest.
- Never replay retired attendance-correction SQL, alter existing admissions/payment evidence or broaden server permissions as a publication shortcut. Paid domains/plans and new credential grants require their own authorization.

## If release verification fails

Hold the unpublished candidate and its evidence. Do not relabel an older APK as new, decrement the channel, reuse a code, overwrite historical bytes or recommend uninstalling to bypass a signing mismatch. A post-publication bug requires a reviewed forward fix with a new higher code. Backend and website rollback are separate coordinated decisions that must preserve current data and audience.

The [earlier integration handoff](RELEASE-HANDOFF-2026-10-18.md), [0.7.7 evidence](NATIVE-RELEASE-0.7.7.md) and [0.7.8 evidence](RESTORATION-RELEASE-0.7.8.md) remain preserved for provenance.
