# Native sign-in completion boundary

This isolated refactoring slice starts at released main `b21798702fe2a99e1d419e15b8d31011f2fc7fa6`. It does not change the published APK, production services, signing, release metadata, or other worktrees. Existing comments and tests are preserved.

## Decision log before implementation

- Make successful native sign-in acknowledgements identify the native session generation they committed, independently of notification delivery order.
  - The Java bridge saves a session and emits `auth` before acknowledging the initiating JavaScript request.
  - The client increments its notification fence on `auth`, so it rejects that request's successful response as superseded.
  - The application can enter the signed-in screen through the event listener while skipping the promise continuation that clears the submitted staff code.
- Validate the acknowledgement against the current canonical native session and the latest initiating identity request.
  - An event payload is not session authority and cannot revive a signed-out or locked profile.
  - A newer JavaScript login/logout must supersede an older request even before native state changes.
  - Native account changes must also supersede a receipt, even before their event is delivered.
- Keep ordinary request-generation and permission-scope fences unchanged.
  - A sign-in acknowledgement contains no private report or attendee data. It must not create an exception for late private responses.
  - Existing auth events still invalidate outstanding private work and location/report operations.

The receipt belongs in the native response envelope, outside the public API body. It contains only a generation counter, not credentials. Successful native sign-ins without a valid receipt fail closed; the shared legacy and AndroidX hosts are generated from the same updated source. Browser authentication and durable logout remain unchanged.

App lock deliberately hides the canonical profile without changing its generation. A valid receipt must still allow the submitted credential to be cleared while the lock remains in place. It never imports the response profile into the client or unlocks the app. Actual sign-out or account replacement advances the native generation and invalidates the receipt. A failed canonical bridge read cannot validate a receipt.

## Verification plan

Add regression coverage for both event orders, all three bridge sign-in actions, newer identity requests, logout, external same-role account replacement, malformed receipts, locked canonical state, reentrant listeners, and late private responses. Exercise the real UI's staff-code cleanup with the real client. Run existing source, DOM, and applicable native checks without removing assertions. Record any missing Android/device validation explicitly before integration.

## Deferred work

Token rotation in push opening, access-token versus account expiry, selected-location invalidation, and the unpublished-candidate packaging check remain separate review items. This slice does not enable deferred features or modify another owner's voice/relay work.

## Local verification

- New client acknowledgement tests first failed against the released implementation, then passed with the explicit commit receipt.
- The focused real-client/UI and bridge suite passed 51 tests. This includes staff-code cleanup in both event orders with an exposed or app-lock-hidden profile, plus 36 synthetic checks executing the shipped Java bridge method.
- The source suite passed 883 tests, failed none, and reported three skips. No existing tests or assertions were removed.
- The complete native policy suite passed with official Eclipse Temurin 17.0.21+9. Its archive was verified against the publisher's size and SHA-256 before use in task-local tooling.
- SQLite rollback/duplicate protection, generated-host checks, web packaging and whitespace checks passed.
- The legacy DOM command reported one skipped test; this is not DOM acceptance. The new real-client/gate UI tests above executed with synthetic records.
- An independent read-only reviewer found no blocking issue and separately reran the focused 51-test suite successfully.

Android assembly/lint and device acceptance for this patch have not been established by these local checks. No new APK has been signed or published. The original release, updater metadata, app-lock policy and production data are unchanged.
