# APK size audit and follow-up candidate

Measured from the original-key-signed, publicly downloaded Navrang Gate **0.8.0 / code 18** on 19 October 2026. Size: **23,634,731 bytes (23.63 MB / 22.54 MiB)**. SHA-256: `8dd7423a67b69fa882a9115f5f1313fe930dfe6ec12c26ca62ff8b1215243fe4`. The public download, version, signing certificate, signatures, alignment, manifest and cumulative checksum entry were independently verified after PR #15 merged as `f5c8614b0aea64d5e6bc4d6b50acf94bf8596ff3`. All 17 earlier APKs are preserved.

The machine-readable inventory is [apk-size-0.8.0.json](apk-size-0.8.0.json). Reproduce it without signing material:

```sh
python3 tools/apk-size-audit.py downloads/Navrang-Gate-0.8.0.apk
```

| Contents | Compressed bytes | Approximate share |
| --- | ---: | ---: |
| App and dependency DEX code | 16,567,870 | 70.1% |
| Artwork | 3,792,599 | 16.0% |
| Android resources | 2,271,458 | 9.6% |
| Interface, scripts and public config | 444,344 | 1.9% |
| Native libraries, all supported architectures | 202,140 | 0.9% |
| Audio | 77,708 | 0.3% |
| Metadata | 84,913 | 0.4% |
| ZIP headers, signature and alignment | 193,699 | 0.8% |

## Findings

- Release code/resource optimization was disabled. Unreachable previous native UI code and unused dependency code could consequently enter the APK. Code, rather than student data or audio, accounts for most of the download.
- Exact duplicate copies of the app icon, dancers, Google mark and two sounds account for 1,078,018 compressed bytes. Some are used by both native and web presentation; deleting them indiscriminately would break a path. R8 can remove resources that are only referenced by unreachable UI.
- The current screen never loads the archived offline app, IndexedDB store or workbook importer. Nevertheless, their code, SheetJS, pako, schema, and an unused poster were copied into the APK. Current native import uses its bounded parser, and current Excel export uses report-export.js; neither needs the archived SheetJS bundle.
- No attendee roster, Excel/CSV file, SQLite database, historical APK, node_modules tree or signing keystore was packaged. gate-config.json is public endpoint/event configuration; audio/SOURCES.json records sound attribution.
- The architecture libraries are only 202 KB combined. Dropping Android architectures would save little and reduce compatibility. Legal notices must remain.

## Follow-up changes, not part of published 0.8.0

The isolated **0.8.1 / code 19 candidate** enables R8 code and resource optimization, retains JavaScript bridge method names and dynamically resolved scan sounds, and excludes the unused offline prototype/library files and poster from Android packaging. Source history and original artwork remain in git.

The combined intro/login image and both dancer images are requested on demand from immutable public repository revisions. The app ships only their SHA-256, size, MIME type and revision. A strict allowlist, HTTPS-only fixed host, no redirects, response size bounds, timeouts and exact SHA-256 validation protect delivery. No authentication token or attendee information is sent. A bounded temporary cache holds these public images and is verified on every read; stale artwork hashes are retired. Failed downloads render a local fallback and do not block login or scanning. No executable JavaScript, CSS or app update is silently downloaded by this mechanism.

Student records, payment state, check-in outcomes and exports remain server-authoritative and fetched through the existing role-checked API, with temporary in-memory copies. The scanner, interface code, launcher/essential branding and scan sounds remain local to preserve operation during interrupted connections. Therefore **not every byte in the APK is fetched remotely**: that would conflict with an installed app's launcher and the requested unreliable-network behavior. The large optional decorative images are the content moved out of the APK.

All app-owned HTML dropdowns share a branded accessible picker, including dynamic selectors. Android-owned permission, Google account, document-location and package-install surfaces retain Android UI. App-owned native confirmation dialogs use the Navrang palette and raised buttons.

This is a separate unsigned candidate. The 0.8.0 source-scoped approval/device deferral is not reused for these changes. No backend configuration/data/role changes or newer public APK publication are part of this candidate. Performance improvements are not claimed as physical-phone benchmarks.
