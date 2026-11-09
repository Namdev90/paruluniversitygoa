# Architecture and boundaries

This map describes source at the [current documented baseline](CURRENT-STATUS.md). It separates the shipping 0.9.0 surface from retained experiments and deployment plans.

## Runtime map

| Layer | Source | Responsibility |
|---|---|---|
| Shared interface | `app/assets/index.html`, `gate.js`, `client.js`, `desk.js`, `reports.js`, `report-export.js`, artwork/styles | Login/stations, scanning controls, Help Desk, Account/Admin, reporting and local exports |
| Android host | `native-app/src/main/kotlin/in/navrang/gate/MainActivity.kt`, generated `ClassicActivity` | Hosts the original web interface with AndroidX authentication and platform integration |
| Native scanner | `ClassicScannerActivity.kt`, `ClassicScannerComponents.kt`, scanner Java policies | CameraX/ZXing scanning, manual-ID interactions and result presentation |
| Shared native services | `app/java/in/navrang/gate/` | Sessions, pending admissions, document saving, readiness, app lock policies and update safeguards |
| API entry point | `server/functions/navrang-gate/index.ts`, `handler.mjs` and contracts | Authenticated action routing and server-side boundaries |
| Database | `server/schema.sql` and versioned SQL files | Private event records, role checks, Help Desk, admissions and reporting contracts |
| Browser companion | `tools/package-web.py`, shared assets | Static web package; hosting, gateway configuration and backend deployment remain separate |
| Publication | `release.json`, `updates/latest.json`, `downloads/`, `SHA256SUMS.txt`, release tools | Version coordination, exact APK/update metadata, immutable archives and original-signature verification |

Paths in the table are relative to the repository root. [Project map](../README.md#project-map) and [development setup](GETTING-STARTED.md) provide entry points.

## Original interface and native code coexist

The launch activity extends the generated `ClassicActivity`, which is derived from [the shared Java host](../app/java/in/navrang/gate/MainActivity.java) by [prepare-classic-host.py](../tools/prepare-classic-host.py). It loads the shared HTML interface, while AndroidX Credential Manager/PKCE, native imports, platform document saving and CameraX scanning remain native integrations. Retained Compose screens and their tests are not proof that the published login uses the older all-Compose presentation.

[The Android build](../native-app/build.gradle.kts) generates host code and copies shared resources/Java/assets before building. Changes belong in the source inputs, not generated outputs. The debug package has a different application ID; release signing happens outside Gradle through the guarded original-key procedure.

## Admission and authority

A staff sign-in and chosen station are not permission grants. Server checks determine Checker, Help Desk, Faculty and Administrator access, including expiry, suspension and role loss. The [feature catalogue](FEATURES.md#four-clearly-separated-responsibilities) describes the role matrix.

1. A QR decode or exact-ID submission creates a request, not an admission.
2. The server checks the session, station and ticket, and commits the single-use admission with stable request/receipt attribution.
3. Only a confirmed committed response is presented as successful admission. Duplicate, invalid, blocked and unresolved results remain distinct.
4. Retrying uses stable request identity. Camera lifecycle guards and late-response ordering prevent stale callbacks from being applied to a replacement session.

Check [GateRuntime](../app/java/in/navrang/gate/GateRuntime.java), [GateSession](../app/java/in/navrang/gate/GateSession.java), [client transport](../app/assets/client.js), and [server handler](../server/functions/navrang-gate/handler.mjs) when changing this path. Acknowledging a warning never authorizes entry.

## Data and export boundaries

Student copies, drafts and unresolved admissions are temporary client state; a pending queue is not guaranteed to survive process death. Authentication and non-student preferences have separate storage policies. Reports explicitly saved by the user and screenshots are outside those temporary caches and may persist after sign-out.

Reports are read-only, permission-scoped datasets generated from server results. CSV/XLSX/PDF exports must preserve authorization, formula protections, missing-registration provenance and session checks. An administrator correction does not retroactively establish a missing payment or unknown physical entry time. Never replay [the retired reconciliation script](../server/reconcile-missing-registration-v077.sql).

## Deferred and optional subsystems

The repository retains locator, notification and voice/relay implementations, SQL, Workers and tests. These are important history and future development inputs, but **0.9.0 excludes location sharing, voice and event alerts**:

- [Release manifest](../native-app/src/release/AndroidManifest.xml): microphone/location permissions removed, event-push service/activity entries removed, dormant voice service disabled.
- [Android asset copy rules](../native-app/build.gradle.kts) and [browser packaging](../tools/package-web.py): deferred interface assets omitted.
- Push and voice Gradle properties default off. Optional Daily/Opus/ABI paths do not describe the default shipped artifact.
- The checked-in API entry point uses `renewalEnabled: false`. Existing refresh/revoke compatibility handling and a potential gateway are different from enabled new-family issuance.

Read [the communications design](superpowers/specs/2026-10-19-navrang-080-communications-design.md), [relay bridge](CLOUDFLARE-RELAY-BRIDGE.md), [push integration](native-push-0.8.0.md) and [browser session plan](browser-session-v090-plan.md) as scoped design/source records, not current product promises. Any activation needs its own configuration, authorization and acceptance evidence.

## Release and deployment trust

The updater validates version, size/hash, package and signing identity; admission work has priority over installation. It does not silently replace the application. Public certificate fingerprints and artifact digests are verification metadata, not private signing material.

Repository source, Android artifacts, GitHub Releases, the hosted portal, Edge/database changes and optional Workers are independent publication surfaces. A merge or passing CI does not synchronize them. Preserve the original signing identity and existing update channel. Refer to [the release procedure](RELEASE-PROCEDURE.md), [security policy](../SECURITY.md) and [current evidence limits](CURRENT-STATUS.md#what-the-evidence-establishes).
