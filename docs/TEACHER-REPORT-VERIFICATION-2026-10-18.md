# Teacher report download repair and verification

## Scope

This source-only repair covers Faculty Reports in the shared browser/Android interface. It does not change database tables, permissions, grants, the deployed server, the updater, or any published APK.

## Reproduced and fixed

- Empty CSV/Excel downloads previously contained no headings. All twelve datasets now retain their explicit column headings, with a clear empty-result message.
- Changing the selected dataset while the account check was in progress could download a different dataset from the one clicked. The selection is now captured at click time.
- Failed refreshes left earlier totals displayed. Refresh clears old totals and invalid/missing summary data stays unavailable.
- An old account's cancelled export could clear the busy flag belonging to a newer account's export. Each export now owns its completion token.
- Server-side permission revocation clears previously displayed report totals, including when the browser account refresh has not emitted a separate profile event.
- Dataset shape, kind, count, generation timestamp and all displayed summary counters are checked before saving. Unexpected response fields are excluded from CSV/Excel by the explicit dataset schemas.
- Invalid XML noncharacters are removed from workbook cells. Existing CSV formula escaping and Excel text-cell handling remain intact.
- Browser completion text points to browser downloads; Android text still asks for a save location. Neither message claims that the Android document picker has completed a write.

## Local synthetic verification

No real account, production request or attendee data was used.

- npm test: 247 passed, zero failed, three existing environment-dependent skips.
- npm run test:native: passed all existing synthetic native harnesses.
- python3 tests/sqlite-check.py: passed the existing in-memory data checks.
- tests/teacher-reports-flow.test.cjs: all twelve CSV/Excel datasets; PDF; denied/revoked/replaced identities; empty/error/retry cases; repeated clicks and cross-account races; malformed results; unexpected private-field exclusion; actual browser Blob/anchor logic; actual Android JavaScript Base64 bridge chunking and size rejection.
- server/tests/report-routing.test.mjs: 31 synthetic checks load the real Edge entrypoint with mocked fetch, covering all report routes, bearer hashing, validation and error propagation. They do not execute SQL.
- python3 tests/teacher-reports-browser-check.py --formats-only: independently parsed 49 files generated through the actual report UI/generator with synthetic transport. These are populated and empty CSV/XLSX for all twelve datasets, plus the PDF. Python CSV, openpyxl and pypdf verified the outputs, Unicode, formulas-as-text, column exclusion and summary provenance.
- Independent source review and whitespace checks passed.

## Remaining acceptance boundaries

Actual browser downloads could not be exercised in the local restricted runner. The existing classic-visual CI job now runs tests/teacher-reports-browser-check.py in Chromium, downloads and parses all 49 files, and verifies three native JavaScript bridge formats. Synthetic files and its result JSON are retained with the existing visual-review artifact. A passing local format check is not a passing browser-download check.

The native JavaScript bridge is exercised, but physical Android document selection, cancellation, storage-provider failures and the eventual device file write still require runtime acceptance. The existing Java host continues to refresh server authority before opening the selected output destination; this repair does not alter that security boundary.

SQL filter/role behavior was source-reviewed, but no local PostgreSQL runtime was available for database-fixture execution. Deployed server compatibility and authenticated teacher acceptance remain separate requirements. Do not describe production reporting as repaired based solely on this source change, local tests, or a new APK.

## Repeatable commands

```sh
npm ci --ignore-scripts
npm test
npm run test:native
python3 tests/sqlite-check.py
python3 tests/teacher-reports-browser-check.py --formats-only
# In an environment with supported local Chromium:
python3 tests/teacher-reports-browser-check.py --output .build/report-downloads
```

The Python parser/browser check requires Playwright, openpyxl and pypdf. The workflow pins the tested versions. All fixtures are synthetic and outbound browser requests are aborted.
