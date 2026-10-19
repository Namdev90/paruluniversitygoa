# Feature catalogue

**Published Android baseline: 0.7.9 / versionCode 17.** This release keeps the original burgundy/gold interface, adds the owner-supplied transparent in-app wordmark, scroll-and-search lists and reachable phone report downloads, and retains native Credential Manager/PKCE sign-in, CameraX scanning, native imports, encrypted sessions and installer recovery. See the [0.7.9 release record](RESTORATION-RELEASE-0.7.9.md) and [earlier 0.7.8 restoration](RESTORATION-RELEASE-0.7.8.md).

This inventory describes the published app and its implemented source contracts. Backend and laptop-portal deployment are separate: a merged Android/source release alone does not prove either hosted service was updated. The 0.7.9 record documents the deployed reporting repair, Site version 11 phone layout, authenticated administrator summary and owner-confirmed CSV export. Separately granted faculty access, physical-device behavior, installed upgrade/reboot, accessibility and hardware/performance acceptance remain unverified; the device-check deferral is scoped to 0.7.9. The historical [native parity record](NATIVE-PARITY.md) describes the earlier Compose checkpoint; the owner's original-design restoration supersedes its presentation direction.

The next requested work is tracked separately in [the upgrade checklist](NEXT-STEPS.md). Unpublished requests and test plans are not shipped capabilities.

## Four clearly separated responsibilities

| Capability | Checker | Help Desk | Faculty | Administrator |
|---|:---:|:---:|:---:|:---:|
| Google sign-in and saved real name | Yes | Yes | Yes | Separate administrator credentials |
| Assigned random staff code | Yes | Yes | No | Creates codes |
| Scan / exact ticket-ID fallback | Yes | No | No | Yes |
| Own confirmed scan count and total entries | Yes | Yes | Reporting view | All statistics |
| Create Help Desk cases | No | Yes | No | Yes |
| Read all Help Desk records and approve payment | No | No | No | Yes |
| Review / download attendance datasets | No | No | Approved read-only access | Yes |
| Add or correct registration fields | No | No | No | Yes |
| Approve, suspend or reassign accounts | No | No | No | Yes |

A button or station choice expresses intent. It never grants authority. Existing server permissions remain authoritative, including expiry and suspension. Faculty permissions are mutually exclusive with scanner/Help Desk permissions; the administrator retains the full set.

## Scanner and gate operation

| Area | Integrated behaviour |
|---|---|
| Continuous entry | Tap Start scanning or swipe down; camera remains available across successive QR reads. Held-code suppression prevents repeated camera frames from becoming repeated requests. |
| Exact fallback | Manual eight-character Transaction ID; strict letter/digit validation; O and 0 remain different. Arbitrary QR URLs are not followed as instructions. |
| QR decoding | Bundled ZXing; inverted codes; tap/continuous focus when supported; torch, zoom and reset controls; bounded small-code zoom and low-light assistance. |
| Camera guidance | Heuristic soft-image/lighting guidance. These aids are not a promise of zero scan failures. |
| Camera lifecycle | Camera work runs off the UI thread; duplicate launches, late startup results, cancellation, pause and destruction are guarded. |
| Immediate feedback | Local read sound/vibration is separate from the server's final admission outcome. Sound loading does not block scanning. |
| Confirmed admission | Green requires the server's committed receipt, not merely a successful QR decode or local button press. |
| Duplicate / re-entry | One event ticket, one admission. Duplicate scans show the original receipt; they do not create another attendee. Re-entry remains disabled. |
| Missing or blocked ticket | The result pauses new submissions for an acknowledged Help Desk alert. Acknowledgement is not permission to enter. |
| Pending requests | Per-ticket grace period and a stable request UUID. Retrying the same request does not create a second admission. A late final response replaces the pending warning. |
| Receipt queue | Multiple outcomes are queued rather than overwriting one another. Previously acknowledged pending warnings do not continually interrupt the same ticket. |
| Session safety | Revoked or expired scanner access closes/disables the scanning path. Old-session responses cannot authorize a new identity. |
| Attribution | Immutable account keys, saved checker names, device/request identifiers, server timestamps and admission sequence numbers. |

## Help Desk and administration

The current Help Desk form collects name, email, mobile and quantity. The fee preview is ₹100 per person. The server assigns a ticket ID when required and records who saved the case and when. Email-based duplicate-case checks and UUID retries protect repeated submissions. Staff can read their own saved cases, not other staff members' contact lists.

The administrator can view all cases, edit pending details, review or reject a case, and explicitly confirm the person and payment before creating/linking an eligible single-entry ticket. Quantities above one require separate named tickets. An existing ticket with a payment problem must be corrected and explicitly linked; a Help Desk case does not silently rewrite original payment evidence. Review uses optimistic versions, so a stale form cannot overwrite a newer review. Each create/edit/review has a private audit record.

Admin-only College CSV exports include Help Desk attribution. Ordinary staff cannot import, export, back up the roster, approve payment or modify registrations. Late searches, saves, reviews and exports have identity/version guards. Sign-out clears hidden forms, dialogs, drafts and temporary details.

Admin registration and entry lists support search, filtering and bounded scrolling without page-arrow controls in 0.7.9. Account management includes real-name changes, named random staff codes, access enable/suspend, first-station locking and administrator reassignment. Re-login does not undo suspension. Google email addresses remain private from ordinary checkers. Administrator password changes invalidate other administrator sessions.

## Faculty reports

**Implementation and acceptance scope:** the following report workflows and datasets are present in the published client and repository source. The 0.7.9 release record confirms the deployed backend repair, authenticated administrator summary and owner-confirmed live CSV download. This does not establish acceptance under a separately granted faculty identity, every hosted export format or the physical Android document picker. Future deployments still require service compatibility and scoped authenticated acceptance. See [the portal publication checklist](PORTAL-DEPLOYMENT.md).

Teachers sign in with Google, save their real name and request report access. An administrator reviews the account and can grant/revoke read-only reporting without giving the teacher registration-edit, Help Desk or scanner privileges. The administration entry is visually separate and includes every reporting feature.

| Dataset | Meaning |
|---|---|
| Complete master | Active registrations together with unmatched confirmed admissions; it does not drop an attendee merely because their registration is missing. |
| All confirmed attendees | Ordinary admissions and documented organizer-confirmed admissions, with source differences retained. |
| No verified entry | Eligible registrations without a verified admission. This is **not proof of physical absence**. |
| Ineligible / blocked | Registration eligibility problems, separate from attendance. |
| Recorded entry issues | Tickets with server-recorded blocked/not-found outcomes. Local failed reads and lost/unsent requests cannot be reconstructed. |
| Resolved issues | Recorded issue tickets subsequently associated with an admission. |
| Issues without verified entry | Recorded issue tickets with no confirmed admission. Not a claim that security refused physical entry. |
| Duplicate attempts | Repeated ticket attempts, not additional people. |
| Gate activity | Admission activity and timing evidence, separating correction recording time from unknown actual entry time. |
| Help Desk cases | Reviewed/pending case metadata; reporting does not grant access to the administrator's contact export. |
| Pending cases | Help Desk work awaiting review. |
| Missing-registration admissions | “Admitted — registration data missing,” backed by the organizer's instruction and original not-found scan evidence. |

CSV and genuine XLSX exports are generated locally from authorized server results. CSV formula prefixes are escaped; XLSX text cells are not formulas. Each row carries the report generation time. The PDF is a statistical summary, not a participant-level PDF roster. It separates total admitted, admissions matched to the registration master, and organizer-confirmed admissions, and preserves the unknown-time caveat. Android uses its document picker; the app does not silently send files or request broad storage access.

Report grants, requests and export metadata are private, service-role-only server objects. Authentication is checked again before downloads, and session changes invalidate pending exports. Temporary teacher-management failure no longer disables an otherwise valid administrator attendance download.

## Data integrity and privacy

The event server uses indexed ticket records and serializes imports/admissions. Canonical organizer eligibility uses event ID, successful transaction description, minimum amount, single-person quantity and refund state; merchant payout settlement is not the student's eligibility test. Imports preserve immutable admission receipts and approved Help Desk tickets. Repeated matching ticket IDs are handled as ticket records, not merged merely because names/email addresses coincide.

Student rosters and unconfirmed requests in the current clients are **RAM-only**. They do not survive process death; a connection is required for confirmation and Help Desk saves. The app does not promise fully disconnected multi-device admission. Historical persistent roster/receipt caches are retired. Authentication and non-student preferences are separately protected; the public APK/repository does not contain the live attendee roster, private workbook, service-role key or original signing key.

The historical missing-data correction is narrowly scoped to event-day not-found scans and the organizer's confirmation. It is idempotent, preserves original attempts and registration records, and does not invent a name, payment or exact physical admission time. Later matched registrations require review rather than blind replay. This is not a future “accept every scanned ticket” policy.

Downloaded CSV/XLSX/PDF files and user-captured screenshots are separate from the RAM-only app caches. They can persist in the chosen device or storage location after sign-out. Handle those copies securely and never include real attendee records in public bug reports. Screenshot/screen capture is enabled in 0.7.9; device policies may independently restrict it.

## Branding, interface and accessibility

| Area | Published 0.7.9 behaviour |
|---|---|
| Owner-approved app mark | The in-app wordmark uses the owner-supplied transparent derivative documented in [artwork provenance](ARTWORK.md). The original square Android launcher is preserved, SHA-256 `b3c9bec6b50d466c244e5b127b87cace038a16d3a236303f4b141e5ea285de9a`. That launcher mark is owner-approved historical generated/edited artwork, not a newly independently authenticated official brochure logo. The organizer-supplied poster and officially sourced university vector have distinct provenance; see [asset notes](../app/assets/art/ASSET-NOTES.md). |
| University wordmark | Original institutional vector, with its white lettering on a dark field instead of an unreadable pale chip. No generated seal or retyped replacement. |
| Entry choices | Checker, Help Desk and Faculty appear once as peers; Administration has a separate, more prominent full-access entry. |
| Visual hierarchy | Original burgundy/gold identity, dimensional controls, cream text and clear role/action hierarchy. The owner rejected a Material-style restyle; 0.7.9 deepens the existing identity rather than replacing it. |
| Motion | Transform-only dancer entrances and gentle weight shifts; logos are not morphed. Opening is skippable; reduced motion and page-hidden pausing are respected. |
| Screen sizes | Adaptive branding, flexible toolbars, wrapping long labels, compact navigation, scrollable content and small-height dialog/layout rules. Wide reporting views use a two-column arrangement. |
| Input and feedback | Visible focus, readable field labels, keyboard-safe scrolling and large core tap targets. No accessibility certification or universal device-performance claim. |
| Proof | Screenshots and automated local-source render checks use only explicitly synthetic records. Real phone, Safari/iOS and hosted-portal checks remain a release-validation responsibility. |

## Installation, updates and recovery

From 0.4 onward, the app checks a repository update manifest on startup/resume, foreground intervals and Android's network job. In 0.7.9 release builds, automatic checks/downloads remain enabled even when an older saved preference had disabled them; the Account screen shows a read-only status. Android power/network policy can delay work, and internal/debug builds stay isolated. The app validates package, higher version code, byte size, SHA-256 and the installed signing certificate. Optional notifications lead back into the guarded update screen.

Automatic update work yields to scanning. Installation waits for unresolved check-ins, rechecks before committing/opening Android confirmation, and blocks new scans while installation is unresolved. Android may require permission to install from this app and requires its installation confirmation. The workflow is not a promise of silent forced installation.

The published app includes PR #3 recovery from Android-owned installer sessions after process recreation and reboot. Account recovery does not depend on a surviving cached APK or update manifest. Scans resume only after Android confirms completion/removal; uncertain installer state remains guarded. Physical-device process-kill, reboot and installed-upgrade acceptance remains unverified; host-side regression results are not a substitute.

The original signing key stays only in the original build environment. Release tooling refuses a missing/replaced signing identity, changed bytes under an existing version and channel rollback. A source push does not automatically create a signed release.

## Sound and device readiness

Bundled licensed CC0 cues distinguish reading, success, pending, duplicate/invalid/error states and navigation. Device volume, vibration and activity brightness controls respect hardware, operating-system and Do Not Disturb limitations. Camera/notification permissions require the phone owner's approval; the app cannot grant itself permission. App sound remains enabled in the established product policy; this refresh does not silently change that choice.

## Engineering evidence and historical changes

Node tests cover parsing, eligibility, request/receipt handling, API validation, staff flows, Help Desk privacy, report outputs, branding, packaging and release policy. Java harnesses exercise the actual session, runtime, scanner and updater classes with controlled Android substitutes; they are not phone installations. SQL/SQLite tests verify transaction and deduplication behaviour. The render harness exercises source DOM/CSS/JS with intercepted synthetic transport; it does not authenticate against production.

The full [Changelog](../CHANGELOG.md) documents all seventeen retained APK versions through 0.7.9. The preserved [Operations reference](OPERATIONS.md) retains earlier detailed notes. Rehearsal/simulation, older offline storage and early broad Google access are historical states, not features to re-enable in the current release.
