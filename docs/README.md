# Navrang Gate documentation

Start with the current release and development guides; use dated implementation notes as history, not automatic evidence of what is shipped or deployed.

[Project overview](../README.md) · [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) · [Accessibility](../ACCESSIBILITY.md) · [License](../LICENSE)

## Current release and day-to-day use

- [Current status](CURRENT-STATUS.md): 0.9.0/code 19, final artifact identity, included/excluded features and remaining evidence limits.
- [Installation and staff access](../README.md#current-installation-and-access): Android requirements, safe upgrade and station authorization.
- [0.9.0 release record](RESTORATION-RELEASE-0.9.0.md): final publication provenance and the separate earlier candidate.
- [Staff access reference](STAFF-ACCESS.md) and [feature catalogue](FEATURES.md): permission model and detailed historical behavior inventory. The catalogue's 0.7.9 visuals/checkpoints are labelled, with current scope linked at the top.
- [In-app updates](APP-UPDATES.md): update trust, download and recovery context.
- [Operations reference](OPERATIONS.md): retained older operational checkpoints. Use current status for release/version decisions.
- [Support and safe reporting](../README.md#help-and-safe-reporting): distinguish software bugs, organizer questions and security reports; never post private attendee records.

## Develop and verify

- [Development setup](GETTING-STARTED.md): Node/Python/JDK/SDK prerequisites, exact command scopes, synthetic previews, Android debug builds and troubleshooting.
- [Architecture](ARCHITECTURE.md): shared original interface, AndroidX/native scanner, API/database boundaries and deferred subsystems.
- [Contribution guide](../CONTRIBUTING.md) and [server testing](../server/TESTING.md): focused PRs, isolated fixtures and hosted-test mutation warnings.
- [Upgrade/acceptance checklist](NEXT-STEPS.md): current decisions plus preserved historical requirements.

A test count belongs to its source, fixture and environment. Synthetic rendering, host-side checks, emulator upgrades, physical-device acceptance and hosted-service verification are different. A skip or waiver is not a pass.

## History and release provenance

- [Project history and full baseline commit ledger](history/PROJECT-HISTORY.md): milestones, all 146 commits reachable from the pinned main baseline, 19 published Releases and separate unmerged work.
- [Changelog](../CHANGELOG.md): version-by-version product changes from 0.1.0 through 0.9.0.
- [GitHub Releases](https://github.com/Namdev90/paruluniversitygoa/releases), [archive policy](history/GITHUB-RELEASES.md), [17-version inventory](history/apk-inventory.json) and [publication receipt](history/publication-receipt-2026-10-19.json): original artifact history versus actual GitHub publication time.
- Release records: [0.7.7](NATIVE-RELEASE-0.7.7.md), [0.7.8](RESTORATION-RELEASE-0.7.8.md), [0.7.9](RESTORATION-RELEASE-0.7.9.md), [0.8.0](RESTORATION-RELEASE-0.8.0.md), [0.9.0](RESTORATION-RELEASE-0.9.0.md).
- Initial development: [specification](spec.md), [plan](plan.md), [progress](progress.md), [live-service design](LIVE-V02-DESIGN.md), [live progress](live-progress.md).

Do not treat retired offline/rehearsal behavior as the current admission model, replay old data corrections or infer that an older version is maintained. Version numbers in a candidate document title may describe a proposal that changed before publication.

## Build, release and deployment

- [Original-key release procedure](RELEASE-PROCEDURE.md): source-bound approval, signed-byte verification and separate publication.
- [Portal deployment](PORTAL-DEPLOYMENT.md): the existing companion site is deployed separately from source/APK changes.
- [Google sign-in setup](GOOGLE-SIGNIN-SETUP.md): configuration reference; no credentials or access changes are authorized by reading it.
- [ABI packaging](ANDROID-ABI-PACKAGING.md) and [staged release bundle](STAGED-RELEASE-BUNDLE.md): optional candidate delivery/verification work, not claims about the default published APK.

APKs belong in the download archive and Releases. The private Node test harness is not a published application package. Source/PR changes do not deploy services, apply migrations, grant roles or sign releases.

## Design, artwork and licensing

- [Artwork provenance](ARTWORK.md), [combined mark](branding/COMBINED-MARK.md), [design notes](DESIGN-NOTES.md) and [historical asset notes](../app/assets/art/ASSET-NOTES.md).
- [Third-party notices](../THIRD-PARTY-NOTICES.md), [MIT License](../LICENSE) and [accessibility guidance](../ACCESSIBILITY.md).

Marks, bundled libraries and supplied assets retain their separate rights. Documentation/screenshots do not imply institutional endorsement or accessibility certification. Public previews use synthetic records.

## Additional implementation and evidence catalogue

The following retained documents are useful for deeper investigation. **Their title, timestamp, status or proposed version is not a current release claim.** Read their source/evidence scope alongside [current status](CURRENT-STATUS.md); do not repeat a deployment or historical approval from these notes. In particular, communications/location/voice remain excluded from 0.9.0 even where their source is implemented.

### Native, reporting and earlier review

- [LOGIN-PRESENTATION-2026-11-05.md](LOGIN-PRESENTATION-2026-11-05.md)
- [NATIVE-IMPLEMENTATION-2026-10-18.md](NATIVE-IMPLEMENTATION-2026-10-18.md)
- [NATIVE-PARITY.md](NATIVE-PARITY.md)
- [ORIGINAL-DESIGN-RESTORATION.md](ORIGINAL-DESIGN-RESTORATION.md)
- [PRODUCTION-REVIEW-2026-10-17.md](PRODUCTION-REVIEW-2026-10-17.md)
- [RELEASE-HANDOFF-2026-10-18.md](RELEASE-HANDOFF-2026-10-18.md)
- [RESTORATION-REVIEW-2026-10-18.md](RESTORATION-REVIEW-2026-10-18.md)
- [TEACHER-REPORT-VERIFICATION-2026-10-18.md](TEACHER-REPORT-VERIFICATION-2026-10-18.md)
- [VERIFICATION-2026-10-18.md](VERIFICATION-2026-10-18.md)

### Communications, voice and notification research

- [CLOUDFLARE-NOTIFICATION-IDENTITY.md](CLOUDFLARE-NOTIFICATION-IDENTITY.md)
- [CLOUDFLARE-RELAY-BRIDGE.md](CLOUDFLARE-RELAY-BRIDGE.md)
- [FCM-IDENTITY-APPROVAL.md](FCM-IDENTITY-APPROVAL.md)
- [OPUS-FOUR-ABI-RECOVERY.md](OPUS-FOUR-ABI-RECOVERY.md)
- [RELAY-REPLAY-RETENTION.md](RELAY-REPLAY-RETENTION.md)
- [cloudflare-candidate-integration-review.md](cloudflare-candidate-integration-review.md)
- [communications-integration-0.8.0.md](communications-integration-0.8.0.md)
- [native-voice-0.8.0.md](native-voice-0.8.0.md)
- [native-voice-v090-binding-plan.md](native-voice-v090-binding-plan.md)
- [notification-worker-0.8.0.md](notification-worker-0.8.0.md)
- [superpowers/plans/2026-10-26-relay-integration.md](superpowers/plans/2026-10-26-relay-integration.md)
- [superpowers/specs/2026-10-19-navrang-080-communications-design.md](superpowers/specs/2026-10-19-navrang-080-communications-design.md)
- [superpowers/specs/2026-10-26-relay-integration-design.md](superpowers/specs/2026-10-26-relay-integration-design.md)
- [voice-controller-0.8.0.md](voice-controller-0.8.0.md)
- [voice-controller-concurrency-2026-11-05.md](voice-controller-concurrency-2026-11-05.md)
- [voice-daily-candidate-0.8.0.md](voice-daily-candidate-0.8.0.md)
- [voice-daily-integration-review-0.8.0.md](voice-daily-integration-review-0.8.0.md)
- [voice-relay-boundary-0.8.0.md](voice-relay-boundary-0.8.0.md)
- [voice-relay-isolated-patch-2026-10-26.md](voice-relay-isolated-patch-2026-10-26.md)

### Sessions, app lock and locator research

- [biometric-feasibility-integration-note.md](biometric-feasibility-integration-note.md)
- [biometric-v090-validation-ledger.md](biometric-v090-validation-ledger.md)
- [browser-session-v090-plan.md](browser-session-v090-plan.md)
- [locator-v090-progress.md](locator-v090-progress.md)
- [session-renewal-v090-deployment.md](session-renewal-v090-deployment.md)
- [session-renewal-v090-design.md](session-renewal-v090-design.md)
- [session-retention-investigation-2026-10-25.md](session-retention-investigation-2026-10-25.md)
- [superpowers/plans/2026-10-25-volunteer-locator.md](superpowers/plans/2026-10-25-volunteer-locator.md)
- [superpowers/specs/2026-10-25-volunteer-locator.md](superpowers/specs/2026-10-25-volunteer-locator.md)

### Recovery, planning and candidate checkpoints

- [DB-BOUNDARY-RECOVERY-2026-11-05.md](DB-BOUNDARY-RECOVERY-2026-11-05.md)
- [NEXT-ACTIONS-CLOUD.md](NEXT-ACTIONS-CLOUD.md)
- [RELEASE-CANDIDATE-0.8.0.md](RELEASE-CANDIDATE-0.8.0.md)
- [RELEASE-READINESS-2026-11-05.md](RELEASE-READINESS-2026-11-05.md)
- [native-push-0.8.0.md](native-push-0.8.0.md)
- [navrang-v090-cloud-handoff.md](navrang-v090-cloud-handoff.md)
- [navrang-v090-current-checkpoint.md](navrang-v090-current-checkpoint.md)
- [release-delivery-plan.md](release-delivery-plan.md)
- [superpowers/plans/2026-10-16-navrang-live.md](superpowers/plans/2026-10-16-navrang-live.md)
- [v090-requirements-checklist.md](v090-requirements-checklist.md)

### Machine-readable evidence

JSON receipts are preserved separately from narrative guides. Inspect their version/source/environment fields before relying on them. They are evidence, not configuration to replay.

- [RELEASE-SIGNING-HANDOFF-0.8.0.json](RELEASE-SIGNING-HANDOFF-0.8.0.json)
- [android-diagnostic-evidence-2026-11-05.json](android-diagnostic-evidence-2026-11-05.json)
- [communications-readiness-0.8.0.json](communications-readiness-0.8.0.json)
- [history/restoration-release-approval-0.7.8.json](history/restoration-release-approval-0.7.8.json)
- [history/restoration-release-approval-0.7.9.json](history/restoration-release-approval-0.7.9.json)
- [history/signature-verification-0.7.9.json](history/signature-verification-0.7.9.json)
- [hosted-order-evidence-2026-11-05.json](hosted-order-evidence-2026-11-05.json)
- [native-release-evidence.json](native-release-evidence.json)
- [opus-four-abi-evidence-2026-11-05.json](opus-four-abi-evidence-2026-11-05.json)
- [production-boundary-evidence-2026-11-05.json](production-boundary-evidence-2026-11-05.json)
- [production-connection-evidence-2026-11-05.json](production-connection-evidence-2026-11-05.json)
- [production-feature-evidence-2026-11-05.json](production-feature-evidence-2026-11-05.json)
- [release-0.8.0-verified.json](release-0.8.0-verified.json)
- [release-candidate-plan.json](release-candidate-plan.json)
- [restoration-release-approval.json](restoration-release-approval.json)
- [resume-readiness-evidence-2026-11-05.json](resume-readiness-evidence-2026-11-05.json)
