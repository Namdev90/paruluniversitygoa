# Historical GitHub Releases

## Status and fixed scope

At the initial 19 October 2026 audit, before this migration, the authenticated Releases listing and tag-ref listing were empty. The repository contains **17 archived APKs**, versions 0.1.0–0.7.9 / Android codes 1–17. They were distributed through repository downloads; this is not evidence of seventeen pre-existing GitHub Releases. The refreshed [inventory](apk-inventory.json) checks all seventeen against their original artifact commits, first-on-main archive commits and immutable main checkpoint `6f450eb5b03183d5cd2a15de48a33ab820e94f93`. The original sixteen inventory entries and their bytes remain identical to the earlier `6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc` checkpoint.

All seventeen exact APKs passed Android `apksigner verify --verbose --print-certs` with the original signer on 19 October. The [hash-bound verification receipt](signature-verification-0.7.9.json) includes every result, APK checksum, tool version and official tool-download checksum. This is cryptographic verification, not physical-device acceptance.

**Published and independently verified on 19 October 2026.** The [manual workflow run](https://github.com/Namdev90/paruluniversitygoa/actions/runs/39212213363) succeeded from reviewed main `e1176bf7c1ebecca1f1e2de08cb0a3d8934bb9bf`. It created all **17 GitHub Releases and 17 first-on-main tags**, from [v0.1.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.1.0) through [v0.7.9](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.9), with the unchanged APK and canonical `.sha256` file on each Release.

The [public-download verification receipt](publication-receipt-2026-10-19.json) records every Release URL, actual GitHub publication timestamp, tag target, asset ID, size, checksum and Android signature result. All **34 public assets** were downloaded and verified independently after the run; all seventeen APKs retained the original signer and embedded package/version identity. Release titles, notes and tag targets matched the inventory, with no remaining drafts or extra uploaded assets. GitHub also provides its automatic source archives; these are distinct from the 34 uploaded assets.

At verification, GitHub's latest Release resolved to **v0.7.9**, and `updates/latest.json`, `release.json`, `SHA256SUMS.txt` and `LICENSE` remained byte-identical to the pre-publication checkpoint. Original archive commit dates are preserved separately from the actual 19 October GitHub publication times. The live [Releases page](https://github.com/Namdev90/paruluniversitygoa/releases) remains the source for subsequent publication status.

## Main publication versus artifact provenance

Most versions entered main directly. Three versions first appeared on release branches and were then merged normally:

| Version | First artifact commit / date (IST) | First-on-main tag target / date (IST) |
|---|---|---|
| 0.7.7 | `921fd3bfb20d1b12edc1607dc88ada39dd22fae1` · 18 October 2026 18:42:10 | `987632021acc1924a48c873d82cb214de9eeac75` · 18 October 2026 18:47:58 |
| 0.7.8 | `c82598ed8a3e5c81c9bb743187ee23f78c7607f2` · 18 October 2026 22:16:33 | `6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc` · 18 October 2026 22:21:50 |
| 0.7.9 | `899d295cae93f75cf61fd863cfa4eaa29b48197b` · 19 October 2026 03:59:06 | `6f450eb5b03183d5cd2a15de48a33ab820e94f93` · 19 October 2026 04:05:12 |

The inventory preserves both. New backfill tags target the first-on-main commits. Existing differing tags are never rewritten. Android signature-scheme verification against the original certificate is required before publication. The migration now runs that live signature check on every exact APK before any publication mutation. It does not certify physical-device behavior.

## What the migration does

- Creates one `v<version>` tag at the exact first-on-main archive commit for each existing APK, followed by a draft Release containing that unchanged APK and its `.sha256` file.
- Downloads uploaded assets and compares their bytes before publishing; downloads/verifies again after publication.
- Preserves the original version, embedded package/code, byte size, SHA-256, signature bytes, commit and archive date. It does not rebuild, re-sign or rewrite a historical artifact.
- States both the first-on-main archive date and the original artifact-commit date in release notes. GitHub assigns the **actual publication time** when the archive Release is published. This migration does not backdate a Release or claim a historical GitHub release existed.
- Leaves `downloads/`, `SHA256SUMS.txt`, `release.json` and `updates/latest.json` unchanged. All new archive Releases use `make_latest: false`; the installed-app updater remains governed by the existing manifest.
- Keeps historical architectures and skipped device/acceptance checks clearly labelled. Old APKs are archival evidence, not a recommendation to downgrade or uninstall the current app.

## Safety and idempotency

Run local validation with:

```sh
python3 tests/history-release-check.py
python3 tools/publish-history.py --apksigner /path/to/android-sdk/build-tools/37.0.0/apksigner
```

Validation requires a complete Git history (`fetch-depth: 0` in CI). It confirms the exact baseline artifact set, version-code sequence, embedded Android manifest identity, SHA-256, byte length, canonical checksum, first-on-main publication lineage both archive/artifact dates, and successful Android signature verification with exactly the original signer for every APK **before any mutation**. Missing verification tooling, a failed verifier, a changed APK or an unexpected signer aborts. The prior receipt cannot bypass this live check.

An existing tag pointing elsewhere aborts the migration. Matching published releases are downloaded/verified and left alone. A published release missing an expected asset, or any mismatched existing asset, also aborts; nothing is deleted or overwritten. Matching drafts created by this migration can be resumed only when their complete title, body, target commit and prerelease state match the canonical archive exactly. Extra or duplicate assets abort the run, including for existing published releases. These checks repeat before uploads and immediately before publication; a retained marker alone never authorizes an edited draft. Unrecognized or modified human drafts are never published. The script never uses `--clobber`, force-push, release deletion or tag rewriting. A failed/uncertain mutation stops the run; a later deliberate rerun reads current state before continuing.

## Signature evidence before publication

The manual workflow downloads Android SDK Build Tools 37.0.0 from Google's official repository, checks its pinned SHA-256, and extracts only `apksigner`, its JAR and its notice. The verify job and publish job each run Android signature verification on all seventeen exact APKs. Each job writes a hash-bound JSON receipt to its runner's temporary directory and prints it in the run log. The successful local [audit receipt](signature-verification-0.7.9.json) is retained separately.

Require the original signer `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`. An embedded certificate, Java JAR check or GitHub attestation is not a replacement for Android signature-scheme verification. No private key is needed, accessed or transferred. APK v2/v3 verification passed for this archive; a false v1/v4/SourceStamp output does not mean the apksigner command failed.

For local use, provide `--apksigner` or set `APKSIGNER` to a trusted Android SDK verifier. `--signature-receipt /path/to/receipt.json` retains that run's results in a new file outside the repository; existing files are never overwritten. Verification does not install or execute any historical APK.

## Manual verification or deliberate rerun after review

The workflow [Archive existing Navrang releases](../../.github/workflows/navrang-history-releases.yml) remains `workflow_dispatch` only. The bounded archive above is already published; ordinary pushes do not run this workflow. These instructions are for read-only verification or an explicitly authorized, deliberate rerun of the same archive. Matching existing Releases are verified and preserved, not recreated.

1. Open Actions → Archive existing Navrang releases → Run workflow, selecting `main`.
2. Leave confirmation empty for read-only/local verification.
3. After reviewing those results and confirming publication authority, dispatch on `main` with `PUBLISH_VERIFIED_HISTORY` to publish the bounded archive.
4. Inspect all seventeen resulting tags, release URLs and uploaded hashes. Record the run URL and actual GitHub publication timestamps; do not infer success solely from a workflow dispatch.

Equivalent local use requires an existing authorized GitHub CLI session with access to this exact repository:

```sh
python3 tools/publish-history.py --apksigner /path/to/android-sdk/build-tools/37.0.0/apksigner --publish --confirm PUBLISH_VERIFIED_HISTORY
```

Do not create/share a new credential just for this task. Do not print, commit or upload tokens, passwords or signing keys.

## Permissions and security implications

The verify job has `contents: read`. Only the explicit publish job receives the repository's existing, short-lived `GITHUB_TOKEN` with `contents: write`, needed to create tags, Releases and their assets. Checkout credentials are not persisted, the checkout action is pinned, publication is constrained to a manual run of trusted `main` in `Namdev90/paruluniversitygoa`, and concurrent migrations are serialized. The token is available only to the publish command, never in arguments or logs.

`contents: write` is broader than “create Release only” at the GitHub permission level, so the reviewed script and trusted-main restriction matter. This workflow adds no PAT, OAuth grant, signing secret, persistent external credential or third-party publishing action. It never executes historical APKs or historical source. Its fixed baseline prevents accidentally publishing a future unsigned candidate. The workflow does not build/sign the next app, deploy the portal or change production data.

## Official API references

- [Android apksigner verification](https://developer.android.com/tools/apksigner)
- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)
- [GitHub release assets API](https://docs.github.com/en/rest/releases/assets)
- [GitHub CLI asset upload](https://cli.github.com/manual/gh_release_upload)
- [Manual workflow runs](https://docs.github.com/en/actions/managing-workflow-runs/manually-running-a-workflow)
