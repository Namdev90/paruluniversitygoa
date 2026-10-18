# Historical GitHub Releases

## Status and fixed scope

At the 18 October 2026 audit, the visible public GitHub Releases and tags were empty; that read alone did not rule out unpublished drafts. The repository already contained **16 published APKs**, versions 0.1.0–0.7.8 / Android codes 1–16. The refreshed [inventory](apk-inventory.json) checks all sixteen against their original artifact commits and first-on-main archive commits and immutable main checkpoint `6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc`.

The migration tooling below is **prepared, not dispatched** by this documentation change. Its existence is not evidence that any GitHub Release has been published. The live [Releases page](https://github.com/Namdev90/paruluniversitygoa/releases) is the source for actual GitHub publication status.

## Main publication versus artifact provenance

Most versions entered main directly. Two versions first appeared on release branches and were then merged normally:

| Version | First artifact commit / date (IST) | First-on-main tag target / date (IST) |
|---|---|---|
| 0.7.7 | `921fd3bfb20d1b12edc1607dc88ada39dd22fae1` · 18 October 2026 18:42:10 | `987632021acc1924a48c873d82cb214de9eeac75` · 18 October 2026 18:47:58 |
| 0.7.8 | `c82598ed8a3e5c81c9bb743187ee23f78c7607f2` · 18 October 2026 22:16:33 | `6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc` · 18 October 2026 22:21:50 |

The inventory preserves both. New backfill tags target the first-on-main commits. Existing differing tags are never rewritten. Android signature-scheme verification against the original certificate is required before publication. This migration's independent byte/manifest/history verification does not itself run that check or certify physical-device behavior.

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
python3 tools/publish-history.py
```

Validation requires a complete Git history (`fetch-depth: 0` in CI). It confirms the exact baseline artifact set, version-code sequence, embedded Android manifest identity, SHA-256, byte length, canonical checksum, first-on-main publication lineage and both archive/artifact dates for every APK **before any mutation**.

An existing tag pointing elsewhere aborts the migration. Matching published releases are downloaded/verified and left alone. A published release missing an expected asset, or any mismatched existing asset, also aborts; nothing is deleted or overwritten. Matching drafts created by this migration can be resumed only when their complete title, body, target commit and prerelease state match the canonical archive exactly. Extra or duplicate assets abort the run, including for existing published releases. These checks repeat before uploads and immediately before publication; a retained marker alone never authorizes an edited draft. Unrecognized or modified human drafts are never published. The script never uses `--clobber`, force-push, release deletion or tag rewriting. A failed/uncertain mutation stops the run; a later deliberate rerun reads current state before continuing.

## Signature evidence before publication

Run Android `apksigner` verification on all sixteen exact APKs in the existing verified Android toolchain before the publication decision, and retain the receipt bound to their hashes. Require the original signer `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`. An embedded certificate, Java JAR check or GitHub attestation is not a replacement for Android signature-scheme verification. The migration verifies full uploaded/downloaded bytes against that immutable archive; it does not itself execute `apksigner`. If the required signature evidence is missing or mismatched, stop publication rather than infer it from the dry-run result. No private key is needed for these checks.

## Manual execution after review

The workflow [Archive existing Navrang releases](../../.github/workflows/navrang-history-releases.yml) is `workflow_dispatch` only. It must first exist on reviewed `main`.

1. Open Actions → Archive existing Navrang releases → Run workflow, selecting `main`.
2. Leave confirmation empty for read-only/local verification.
3. After reviewing those results and confirming publication authority, dispatch on `main` with `PUBLISH_VERIFIED_HISTORY` to publish the bounded archive.
4. Inspect all sixteen resulting tags, release URLs and uploaded hashes. Record the run URL and actual GitHub publication timestamps; do not infer success solely from a workflow dispatch.

Equivalent local use requires an existing authorized GitHub CLI session with access to this exact repository:

```sh
python3 tools/publish-history.py --publish --confirm PUBLISH_VERIFIED_HISTORY
```

Do not create/share a new credential just for this task. Do not print, commit or upload tokens, passwords or signing keys.

## Permissions and security implications

The verify job has `contents: read`. Only the explicit publish job receives the repository's existing, short-lived `GITHUB_TOKEN` with `contents: write`, needed to create tags, Releases and their assets. Checkout credentials are not persisted, the checkout action is pinned, publication is constrained to a manual run of trusted `main` in `Namdev90/paruluniversitygoa`, and concurrent migrations are serialized. The token is available only to the publish command, never in arguments or logs.

`contents: write` is broader than “create Release only” at the GitHub permission level, so the reviewed script and trusted-main restriction matter. This workflow adds no PAT, OAuth grant, signing secret, persistent external credential or third-party publishing action. It never executes historical APKs or historical source. Its fixed baseline prevents accidentally publishing a future unsigned candidate. The workflow does not build/sign the next app, deploy the portal or change production data.

## Official API references

- [GitHub Releases API](https://docs.github.com/en/rest/releases/releases)
- [GitHub release assets API](https://docs.github.com/en/rest/releases/assets)
- [GitHub CLI asset upload](https://cli.github.com/manual/gh_release_upload)
- [Manual workflow runs](https://docs.github.com/en/actions/managing-workflow-runs/manually-running-a-workflow)
