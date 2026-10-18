# Navrang Gate 0.7.7 — native release record

Candidate: Android version code 15, package `in.navrang.gate`, minimum API 24, target API 37. Publication is pending signed artifact verification and the normal PR merge. The public channel remains authoritative.

## Owner instruction and verification waiver

On 18 October 2026 at 17:02:35 IST the owner instructed: “skip that and release”, after the remaining device/sign-in, original-key upgrade/reboot, performance and backend/portal acceptance evidence was explained. This supersedes the earlier evidence hold; Google branding had separately been deferred. The waiver is limited to 0.7.7/code 15 and source `38cc5a591091272939c9d85d08d8cc847a0a849e`, including the review fixes made under that release instruction. It is recorded in `native-release-evidence.json` and cannot automatically authorize another version/source.

N01–N18 are implemented; their remaining real-device parity acceptance is unverified. Credential Manager account selection/real sign-in, API-24/current-Android device operation, installed-user upgrade, installer reboot, hardware performance, hosted portal and coordinated backend acceptance were **skipped by the owner**, not passed. API-24/35 Robolectric results are host tests only. Production SQL, admissions, registrations, staff grants, deployed portal, OAuth project/audience/scopes and paid domains were not changed by this release operation.

The original signing key, actual APK certificate/package/version/hash checks, strictly increasing Android version code, immutable archived downloads, clean source pin and normal repository protections remain required.

## Automated verification

- Earlier clean release assembly and release lint passed in 2m25s at `3698921`; the final original-key build is repeated on the source pinned above before publication. At the final source, 49 native host tests passed with no failures/skips (34 domain, 11 workflow, 4 stable-list tests).
- Node: 165 passed, 3 skipped. Legacy Java harnesses: 313 checks passed, including 123 session and 118 updater checks. SQLite rollback/privacy checks passed.
- Seven signer/publication policy checks and eleven native gate/waiver checks passed. Wrong keys/packages/versions, archive replacement, changed or dirty source and reuse of the waiver remain rejected.
- Earlier source portal run: 120 synthetic checks passed across eight viewports. A new local attempt could not launch its missing Chromium binary; this is not counted as a pass. Latest CI results are checked before merge.
- An initial incremental mixed-variant build reported duplicate Kotlin declarations; the clean build above passed. No failed attempt is counted as successful evidence.

## Independent review disposition

CodeRabbit and Codex reviewed PR #7 at `62d40b0`. CodeRabbit posted eight actionable comments; Codex code review posted six P2 findings. The separate Codex security review reported no findings at that head. Historical CodeRabbit console scan statuses were not dismissed or represented as approval of the new source.

Fixed under this release: ordered foreground runtime transitions; durable, fail-closed sign-out with a visible pending/retry state; background snapshot conversion; permission readiness refresh on resume; export busy-state cleanup after scope changes; invalid numeric registration rejection; eligible-attendance correction exclusion in both SQL source definitions; scrolling for the portal Edit/stats tab; source/version-bound approval; staged legacy branding generation; retired-SQL handoff text; explicit native/legacy build commands; no persisted write token during the one-time integration workflow's build/test steps.

The optional report-query index remains a follow-up; no database migration was executed. The completed one-time integration workflow was retired from the final branch because its helper was already removed; this also removes its write-token/hook surface. CodeRabbit's docstring coverage advisory is not evidence of a functional or security defect. Its additional CSV concern is covered by `app/assets/desk-core.js` formula neutralization and the passing Help Desk CSV regression. Reconnect/storage-exception concerns were marked non-actionable by the review itself.

## Publication

Pending original-key signing, exact-byte metadata preparation, branch checks, normal merge and an independent download of the published bytes. All fourteen earlier APKs must remain unchanged.


Follow-up review: identity reads now use request ordering so an older asynchronous result cannot overwrite a newer profile, and sign-out retains the original revocation token in RAM until durable clearing succeeds. The legacy WebView export callback finding does not affect this native APK, whose excluded legacy activity is not packaged; native exports refresh `me` after the picker. Any separately approved legacy release must address that legacy callback first. The review's ancestry warning evaluated a synthetic squash commit; this release uses a normal merge retaining the verified source ancestor, and the successful real-branch signing gate is retained without a squash exception.

The original private signing workspace became unavailable during workspace maintenance. The original key was recovered privately from the existing 0.1.0 source backup and its public certificate exactly matched the expected installed-app certificate. No replacement key was generated or uploaded. The superseded candidate built from `3698921` is not the final release and is not published.
