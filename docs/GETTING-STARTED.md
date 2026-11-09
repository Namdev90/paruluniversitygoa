# Development setup and verification

For installing the published app, use the [user installation guide](../README.md#current-installation-and-access). This page is for a clean source checkout. It describes commands present at the [documented baseline](CURRENT-STATUS.md), not a claim that every check has passed on every environment.

## Prerequisites

- Git and a clean checkout of this repository. Keep existing work, ignored files and signing material intact; use a separate clone or worktree.
- **Node.js 22**, **Python 3.12** and **JDK 21** match the general [verification workflow](../.github/workflows/navrang-verification.yml). Node dependencies are development-only (`package.json` is private); use the committed lockfile.
- For Android builds, the [native workflow](../.github/workflows/navrang-native.yml) uses **JDK 17**, Android platform **37.0** and build-tools **36.0.0**. Use the committed Gradle wrapper (9.6.0), not a separately guessed Gradle version. Exact library/plugin versions are in [the version catalogue](../gradle/libs.versions.toml).
- A local Android SDK is needed only for Android assembly/lint/device work. Set `ANDROID_HOME` to the installed SDK or use your local Android Studio SDK configuration. Follow applicable SDK terms; do not install optional toolchains or accept new licenses silently.

The application supports minimum Android API 24 (Android 7); compilation/target API and the developer toolchain are separate from that minimum. The native build compiles Java source for Java 17.

## Install and run local source checks

```sh
git clone https://github.com/Namdev90/paruluniversitygoa.git
cd paruluniversitygoa
npm ci --ignore-scripts
npm test
npm run test:dom
npm run test:native
python3 tests/sqlite-check.py
```

Run commands from the repository root. `npm test` runs the explicit Node/browser-model/server/relay test list in [package.json](../package.json); it is not an Android emulator test. `test:dom` skips by default; when supplied `NAVRANG_TEST_CREDENTIALS` and `NAVRANG_TEST_STATE`, it performs live integration against the configured service and must use the same disposable-project safeguards as hosted tests. Do not supply production credentials to enable it. `test:native` runs Python/Java platform-fake and policy harnesses and does not install an APK. SQLite checks exercise an in-memory model, not production PostgreSQL migrations. Read each result for skips as well as failures.

The private organizer-workbook checks can require `NAVRANG_TEST_XLSX` and `NAVRANG_LATEST_XLSX`; do not download, invent or commit private datasets to make a skipped fixture test appear passed. Synthetic cases are the default for public contributions.

## Build the browser companion locally

```sh
python3 tools/package-web.py .build/web-portal
python3 -m http.server 8000 --directory .build/web-portal --bind 127.0.0.1
```

Open `http://127.0.0.1:8000` for the packaged interface. **This output is not an isolated test backend:** it copies the repository's public connection configuration. Do not sign in with production credentials, create cases or scan real tickets as a local test. Use the synthetic browser harness below for safe workflow verification. Stop the local server when finished.

The packager copies shared interface scripts/art/audio and omits deferred location/voice/event-alert assets. `--gateway` adds a same-origin `/navrang` setting; it does not deploy a gateway, provision authentication or make an HTTP preview suitable for persistent sign-in. See [browser gateway design](browser-session-v090-plan.md) and [portal deployment](PORTAL-DEPLOYMENT.md).

## Synthetic visual and report checks

The [responsive workflow](../.github/workflows/navrang-responsive-review.yml) pins Playwright 1.64.0, openpyxl 3.1.5 and pypdf 6.10.0, and installs Chromium. In an already prepared environment:

```sh
python3 -m playwright install chromium
NAVRANG_CHROMIUM="$(python3 -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()')" \
  python3 tests/responsive-browser-check.py --sizes 320x480,390x844,640x360,1366x768 --report-stress --output .build/visual-check
NAVRANG_CHROMIUM="$(python3 -c 'from playwright.sync_api import sync_playwright; p=sync_playwright().start(); print(p.chromium.executable_path); p.stop()')" \
  python3 tests/teacher-reports-browser-check.py --output .build/report-check
```

Install the workflow's Python packages into your usual isolated environment first. These harnesses use synthetic transport/records. A screenshot pass does not prove live API compatibility, physical camera behavior, Android document picking or hosted-site deployment.

## Android development build

```sh
./gradlew :native-app:assembleDebug :native-app:testDebugUnitTest :native-app:lintDebug
```

Use `gradlew.bat` on Windows. Debug builds use `in.navrang.gate.internal` and a `-native-internal` version suffix, so they cannot replace the installed production app or receive its production OAuth callback. Do not mistake a debug build for an in-place upgrade test or a shareable signed release.

The build generates the original-interface host, copies shared Java/resources/assets and retains Kotlin/Compose native scanning and authentication. Do not edit generated build directories. Voice, push, Daily SDK, bundled Opus, optimization and ABI-split properties are optional candidate configuration; their existence is not authorization to enable them. See [architecture](ARCHITECTURE.md) and [ABI policy](ANDROID-ABI-PACKAGING.md).

No private signing key is required for the commands above. The signing/build publication tools are **not** a normal getting-started step. Use [the release procedure](RELEASE-PROCEDURE.md) only for a separately authorized, source-bound release.

## Unsigned production-source verification

Native CI also builds and lints the release variant on every matching pull request, even when `release.json` still names the published version. It checks out the exact PR head and runs `tools/verify-unsigned-candidate.py --source-check` against the unsigned APK. The receipt binds the source tree and APK digest and is always non-publishable. This is source QA, not a new release or an update to existing release evidence.

The inspector checks package/version/API levels, unsigned status, original artwork, required client assets, and the intentionally excluded location, voice and event-alert surface. Synthetic policy tests run with `python3 tests/unsigned-candidate-check.py`. Without `--source-check`, candidate inspection still requires a strictly newer Android version code. Original-key signing, fresh source acceptance and public-download verification remain separate release gates; no old acceptance waiver is reused.

## Backend tests and production safety

Read [server/TESTING.md](../server/TESTING.md) before any hosted check. `npm run test:hosted` is **mutating**: it replaces registrations and creates synthetic admissions in a separate disposable project. It requires the isolated API, a private credentials file and `NAVRANG_TEST_ALLOW_MUTATIONS=isolated-project`; it is not part of the default local sequence above. Never use the live event project or live credentials.

SQL suites require an isolated database and explicit transactions/rollback. Do not execute every SQL file alphabetically, replay retired reconciliation SQL, or initialize an existing production database from `schema.sql`. Dated migration receipts explain dependencies and previously applied work, not permission to apply it again.

## Troubleshooting

- **Cannot find jsdom/fake-indexeddb:** finish `npm ci --ignore-scripts` successfully before starting Node/DOM tests.
- **Java compiler/release metadata missing:** verify `java` and `javac` point to a complete JDK. Use the workflow's JDK for the relevant suite; a JRE alone is insufficient.
- **SDK/platform or Gradle dependency failure:** compare the native workflow and version catalogue with the installed toolchain. Do not report an assembly or lint stage as passed if it never started.
- **Playwright browser missing:** install Chromium in the same environment as the harness and point `NAVRANG_CHROMIUM` at that executable.
- **Sign-in or station denied:** local packaging does not create accounts or grant roles. Do not change production permissions to make a test pass.
- **Signature mismatch on upgrade:** stop and use the original-key procedure; do not uninstall or replace the signing identity as a workaround.

Include source SHA, command, tool versions, result counts/skips and the precise blocker in a PR. Never include private data or credentials in logs, screenshots or public test artifacts.
