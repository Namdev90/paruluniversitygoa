# Contributing to Navrang Gate

Navrang Gate supports Android QR entry, Help Desk cases, staff access and attendance reporting for Parul University Goa events. Start with the [project overview](README.md), [documentation index](docs/README.md) and [feature catalogue](docs/FEATURES.md).

## Report a bug or suggest a change

Search the [existing issues](https://github.com/Namdev90/paruluniversitygoa/issues) and [open pull requests](https://github.com/Namdev90/paruluniversitygoa/pulls) before opening a new report. For an ordinary bug, include:

- App version or source commit, Android/WebView or browser version, and the affected role and screen.
- Minimal reproduction steps, expected behavior and what actually happened.
- Whether it reproduces with synthetic records, plus redacted logs or a synthetic screenshot when useful.
- Checks already tried and any limitation that prevented verification.

Never attach real rosters, payment details, contact lists, staff codes, tokens, passwords or signing material. For a suspected vulnerability, follow [Security](SECURITY.md) instead of posting exploit details publicly. Accessibility reports have a separate [checklist](ACCESSIBILITY.md#report-an-accessibility-barrier).

## Prepare a focused pull request

1. Branch from current `main` and check concurrent work before editing. Keep documentation, runtime, backend and release changes clearly scoped.
2. Preserve server-authorized roles, single-use admission, receipt attribution, pending-result handling, session cleanup and guarded updates. A station selection is not an access grant.
3. Use synthetic fixtures for tests and screenshots. Hosted tests require dedicated isolated credentials and test state; never run admission or mutation tests against real attendees.
4. Update the relevant documentation when behavior changes and add a regression test for a fixed defect. Keep dated evidence and old APKs as history.
5. Describe the change, its evidence and remaining risks in the PR. Report checks as passed, failed, skipped or not run. A synthetic rendering or host-side test is not physical-device acceptance.

## Run local checks

Use the versions and platform setup in the repository's [verification workflow](.github/workflows/navrang-verification.yml) and [native workflow](.github/workflows/navrang-native.yml). The general checks require Node.js, Python 3 and a JDK; Android assembly and lint additionally need the documented Android toolchain.

```sh
npm ci --ignore-scripts
npm test
npm run test:dom
npm run test:native
python3 tests/sqlite-check.py
python3 tools/package-web.py .build/web-portal
```

For layout or report changes, also use the synthetic [responsive harness](tests/responsive-browser-check.py), [report-download harness](tests/teacher-reports-browser-check.py) and [responsive workflow](.github/workflows/navrang-responsive-review.yml). See the dated [verification record](docs/VERIFICATION-2026-10-18.md) for what those checks establish and what they leave untested. Run the applicable checks on the final changed source, not only an earlier checkpoint.

## Releases, keys and production changes

Follow the [original-key release procedure](docs/RELEASE-PROCEDURE.md). Do not generate a replacement signing key, commit or upload a private key, overwrite an old APK, reset a version code or treat a source push as a published update. A PR does not deploy the [hosted portal](docs/PORTAL-DEPLOYMENT.md), migrate production data or publish a release by itself. Those steps require their own coordinated review and authorization.

Keep the [MIT License](LICENSE) and [third-party notices](THIRD-PARTY-NOTICES.md) intact. University/event marks and bundled third-party assets retain their separate rights and provenance. Keep review discussion respectful and specific to the work.
