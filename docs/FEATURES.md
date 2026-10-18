# Feature catalogue

This is a capability inventory, not a claim that every source change has shipped. **Public APK baseline: 0.7.6 / Android code 14.** Teacher Reports, the refreshed brand shell and responsive refinements are coordinated **unreleased 0.7.7 candidate** work. Installer lifecycle PR #3 is merged source, but is not contained in the archived 0.7.6 APK.

## Four clearly separated responsibilities

| Capability | Checker | Help Desk | Faculty (candidate) | Administrator |
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

## Scanner and gate operation — available by 0.7.6

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

## Help Desk and administration — available by 0.7.6

The current Help Desk form collects name, email, mobile and quantity. The fee preview is ₹100 per person. The server assigns a ticket ID when required and records who saved the case and when. Email-based duplicate-case checks and UUID retries protect repeated submissions. Staff can read their own saved cases, not other staff members' contact lists.

The administrator can view all cases, edit pending details, review or reject a case, and explicitly confirm the person and payment before creating/linking an eligible single-entry ticket. Quantities above one require separate named tickets. An existing ticket with a payment problem must be corrected and explicitly linked; a Help Desk case does not silently rewrite original payment evidence. Review uses optimistic versions, so a stale form cannot overwrite a newer review. Each create/edit/review has a private audit record.

Admin-only College CSV exports include Help Desk attribution. Ordinary staff cannot import, export, back up the roster, approve payment or modify registrations. Late searches, saves, reviews and exports have identity/version guards. Sign-out clears hidden forms, dialogs, drafts and temporary details.

Admin registration and entry lists support search, filtering and pagination. Account management includes real-name changes, named random staff codes, access enable/suspend, first-station locking and administrator reassignment. Re-login does not undo suspension. Google email addresses remain private from ordinary checkers. Administrator password changes invalidate other administrator sessions.

## Faculty reports — unreleased app candidate

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

## Branding, interface and accessibility

| Area | Candidate refinement |
|---|---|
| Original event mark | Exact cropped pixels from the verified organizer brochure; used by the opening/header and generated native launcher/scanner branding. |
| University wordmark | Original institutional vector, with its white lettering on a dark field instead of an unreadable pale chip. No generated seal or retyped replacement. |
| Entry choices | Checker, Help Desk and Faculty appear once as peers; Administration has a separate, more prominent full-access entry. |
| Visual hierarchy | Restrained charcoal/green surfaces, cream text, original burgundy/gold event accents, consistent controls and fewer decorative effects. |
| Motion | Transform-only dancer entrances and gentle weight shifts; logos are not morphed. Opening is skippable; reduced motion and page-hidden pausing are respected. |
| Screen sizes | Adaptive branding, flexible toolbars, wrapping long labels, compact navigation, scrollable content and small-height dialog/layout rules. Wide reporting views use a two-column arrangement. |
| Input and feedback | Visible focus, readable field labels, keyboard-safe scrolling and large core tap targets. No accessibility certification or universal device-performance claim. |
| Proof | Screenshots and automated local-source render checks use only explicitly synthetic records. Real phone, Safari/iOS and hosted-portal checks remain a release-validation responsibility. |

## Installation, updates and recovery

From 0.4 onward, the app checks a repository update manifest on startup/resume, foreground intervals and Android's network job, subject to settings and device power/network policy. It validates package, higher version code, byte size, SHA-256 and the installed signing certificate. Automatic checks/downloads can be disabled; optional notifications lead back into the guarded update screen.

Automatic update work yields to scanning. Installation waits for unresolved check-ins, rechecks before committing/opening Android confirmation, and blocks new scans while installation is unresolved. Android may require permission to install from this app and requires its installation confirmation. The workflow is not a promise of silent forced installation.

Merged-source PR #3 adds recovery from Android-owned installer sessions after process recreation and reboot. Account recovery does not depend on a surviving cached APK or update manifest. Scans resume only after Android confirms completion/removal; uncertain installer state remains guarded. This still needs actual-device validation in the final signed release.

The original signing key stays only in the original build environment. Release tooling refuses a missing/replaced signing identity, changed bytes under an existing version and channel rollback. A source push does not automatically create a signed release.

## Sound and device readiness

Bundled licensed CC0 cues distinguish reading, success, pending, duplicate/invalid/error states and navigation. Device volume, vibration and activity brightness controls respect hardware, operating-system and Do Not Disturb limitations. Camera/notification permissions require the phone owner's approval; the app cannot grant itself permission. App sound remains enabled in the established product policy; this refresh does not silently change that choice.

## Engineering evidence and historical changes

Node tests cover parsing, eligibility, request/receipt handling, API validation, staff flows, Help Desk privacy, report outputs, branding, packaging and release policy. Java harnesses exercise the actual session, runtime, scanner and updater classes with controlled Android substitutes; they are not phone installations. SQL/SQLite tests verify transaction and deduplication behaviour. The render harness exercises source DOM/CSS/JS with intercepted synthetic transport; it does not authenticate against production.

The full [Changelog](../CHANGELOG.md) documents all fourteen retained APK versions. The preserved [Operations reference](OPERATIONS.md) retains earlier detailed notes. Rehearsal/simulation, older offline storage and early broad Google access are historical states, not features to re-enable in the current release.
