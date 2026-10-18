# Navrang 0.8.0: compact screens, notifications and event voice

Status: approved by the owner on 19 October 2026. Five parallel agents are reviewing and improving the implementation plan before product implementation. Publication remains subject to the verification and provider-readiness requirements below.

## Outcome and baseline

Make event work easier on a phone: coherent navigation, compact reports, useful role-specific Android notifications, and deliberate internet voice sessions. Preserve the burgundy/gold identity, verified attendance, reporting access rules, original signing identity, and every historical APK.

Start from released main `6f450eb5b03183d5cd2a15de48a33ab820e94f93`, version 0.7.9/code 17. Target the next release as 0.8.0/code 18. Recheck main before implementation and publication to avoid replacing concurrent work.

The released Android interface is HTML/CSS/JavaScript hosted by `ClassicActivity`, with AndroidX authentication, CameraX scanner, and native update/export handling. The separate Compose navigation is not the released home UI. Change the released web interface and its native host; do not switch the app to the alternate Compose interface.

Production `navrang-gate` is version 7. Preserve its reviewed reporting repair. Repository schema/source must be reconciled against that reviewed repair before generating any backend deployment. Never overwrite production with an older repository function body.

## Evidence from the owner recording

Source: five-minute recording `1000507871.mp4`; audio extracted and transcribed locally. Speech recognition is approximate; the timestamps below identify the review evidence rather than asserting exact quotations.

| Recording time | Observation and accepted change |
| --- | --- |
| 00:03–00:45 | Repeated logos and too many simultaneous choices. Split Administrator/Staff, then staff role, then sign-in. |
| 00:45–01:16 | Owner reports the native Google button does not work; the visible message is a cancellation, which alone does not establish a provider fault. Browser sign-in works. Diagnose the credential path and show a single primary sign-in action, with browser fallback after failure. |
| 01:16–02:00 | Staff-code entry should be secondary; center the layout, reduce explanatory text, and use legible animated transitions. |
| 02:02–03:06 | Clarify Namdev as administrator/creator; use authentic Chota Namu artwork only if found. Improve the administrator workspace. |
| 03:06–03:18 | Ask for confirmation before sign-out. |
| 03:18–04:02 | Keep list rows compact and open authorized person details in a popup. The wording about scrolling is interpreted alongside the explicit Reports no-scroll instruction; long data collections use pagination. |
| 04:02–04:59 | Use free space purposefully, animate logo size between contexts, consolidate repeated university branding, and add creator credit. |

## Chosen approach and alternatives

Use the current application/server, add server-owned notification records and a delivery outbox, FCM for Android push, and a LiveKit-compatible WebRTC relay for real voice transport. Keep push and voice as distinct transports with explicit health status. Pin exact supported dependency versions during implementation.

Polling alone would simplify setup but does not meet background Android alert expectations. Sending audio through push notifications or database rows is unsuitable for live walkie-talkie. Peer-to-peer fan-out from the administrator phone grows with every recipient and fails on many mobile networks; a relay with TURN support is the chosen architecture.

No push or voice integration was found in the current source; no notification tables exist in `navrang_private`. An existing Firebase project or voice relay has not been established. Use existing owner-controlled infrastructure if found through authorized tools. Otherwise the concrete provisioning requirements are an FCM-enabled Android project for `in.navrang.gate`, server-side send credentials, and a reachable authenticated WebRTC relay with TURN and server-side signing credentials. Do not fabricate credentials, publish secrets, silently incur paid service commitments, or present disabled adapters as working delivery. A missing provider must be reported explicitly before release can be called complete.

## Screen layout and motion

1. Welcome offers Administrator and Staff. Staff opens Checker / Help Desk / Faculty; role selection is a request, never an authorization grant. Sign-in follows selection and retains server-approved station access.
2. One primary Google action with a loading state; reveal browser fallback after failure and retain it for retry. Preserve nonce, PKCE, session-generation checks, certificate/client identity validation, and Google token exchange. Diagnose provider/client mismatch without displaying credential values. Staff code remains available as a secondary action.
3. One compact shared brand header. Remove repeated logos inside ordinary cards and the duplicate footer brand strip. Preserve authoritative logo pixels/aspect ratios. Keep navigation and primary actions reachable.
4. Reports uses Overview / Downloads / Teacher access tabs; Teacher access is administrator-only. No Reports page or panel vertical scrolling on normal supported portrait sizes. Overview metrics use compact groups and explicit pagination where necessary; explanatory detail opens a dialog. Downloads has dataset plus CSV, Excel and summary PDF actions. Staff approvals use search and page controls. Do not hide controls to pass a height check.
5. Student and entry collections retain search, filters and accurate counts, with compact paginated rows. A selected row opens a details dialog showing only data already permitted for that identity. Do not expand teacher/checker access to private contact/payment data.
6. Account has compact identity, readiness and updates areas and a creator credit. Sign-out confirmation offers Cancel / Sign out; cancelling performs no logout or session mutation. Pending work remains protected by existing recovery behavior.
7. Use CSS/shared layout transitions for the hosted screens and native transitions at actual native boundaries. Retain persistent header/navigation; move the active indicator and related cards smoothly. Start with 350–450 ms screen transitions and 150–220 ms control feedback, then tune against the recording. Use size/position/shape interpolation plus restrained fading, not only delayed opacity. Repeated taps retarget/cancel animations without queuing navigation. Scanner/check-in feedback never waits for decorative animation. Honor reduced motion and Android animation settings.
8. At large accessibility fonts or an open keyboard, switch to smaller logical pages and usable dialogs rather than clipping text. If a device cannot fit a particular dialog, allow necessary dialog scrolling; the ordinary Reports screen remains consolidated.
9. Reuse authentic Chota Namu assets if found in approved project resources; otherwise retain a text identity. Do not invent or substitute unrelated artwork.

## Notifications and live dashboard

The in-app center has one separate pinned live dashboard card, followed by at most five newest authorized notification items. Keep the dashboard in its own storage/state slot, outside the five-item limit. It refreshes in place with server time and connection status. Never describe stale cached values as live.

The live card cannot be swiped away in the app; an explicit Hide live card action hides it for that user, with Restore live card available in the center. Hiding does not end the event or broadcast. Only administrators can end an administrator live announcement. Android ongoing notifications use supported APIs but cannot be promised universally non-dismissible.

Five recent items means five per recipient after authorization filtering, ordered by server sequence/time with a stable identifier tie-breaker. Adding a sixth removes the oldest recipient notification item and cancels its Android notification when the client syncs. Pruning must not delete admissions, attempts, helpdesk audit records or reporting records. Global event records/outbox receive a separate bounded operational retention policy; the recipient center never exposes an older notification history.

Swiping an Android notification dismisses only that system presentation; its in-app item remains among the latest five. Opening an alert marks it read and opens the authorized destination; reading does not delete it. Repeated delivery of an event is idempotent. On account switch/logout, cancel identity-scoped alerts, unbind the device registration and clear its private cache. On permission revocation, server queries and voice credentials must stop exposing the old role immediately.

Administrator composer templates: Announcement, Emergency, Meeting, Call request, Update, and Live broadcast. Template fields include title/body; meeting location/time; urgency; audience (everyone, administrator, checker, faculty, helpdesk, or selected authorized staff). Call request is an in-app voice-session invitation, not an automatic cellular call. Show a recipient count and preview; require an explicit Send action. No test announcements are sent to real staff without explicit test authorization. Initial template types do not imply image/file upload.

| Event | Administrator | Faculty | Checker | Help Desk |
| --- | --- | --- | --- | --- |
| Administrator announcement/update | If targeted | If targeted | If targeted | If targeted |
| Ticket checks / entry activity | Yes | No | No routine feed item | No |
| Faculty report download outcome | Yes, actor and dataset/status | Own outcome only | No | No |
| Help Desk work | Yes, action/actor/status | No | No | No routine activity feed item |
| Access or station change | Relevant administrative action | Own change | Own change | Own change |
| Own app update state | Yes | Yes | Yes | Yes |

Activity events are produced from committed server operations, never invented by a client. Reuse existing authoritative audits, without logging downloaded report contents. Summarize ticket activity bursts per actor in short windows to avoid a flood; the live dashboard retains current totals and detailed audits remain accessible through existing authorized views. Teachers receive saved/download-completed wording only after the device confirms save success; server export preparation is a distinct event. Help Desk success feedback remains on the work screen without becoming a routine notification feed item.

## Backend contract and push

Add private RLS-enabled tables for notification events, recipient items, device registrations, delivery outbox, dashboard state, duty sessions, voice sessions/membership, and voice floor leases. No direct anonymous/authenticated access. Extend the existing Edge Function with explicit authenticated actions for feed read, read-state, dashboard hide/restore, device register/unregister, administrator send/end, duty join/leave, voice token and floor acquire/renew/release. Implement the final action/payload schema in a separate contract module during planning.

Authenticate every action through existing Navrang sessions and fresh server-side staff/report permissions. Never authorize from a client-selected role, device token or editable metadata. Bind device registrations to a validated account/session and installation identifier. Use private per-device delivery rather than public role topics for activity alerts. Exclude personal/student details from lock-screen push payloads; retrieve authorized details in app. Treat deep-link input as untrusted and allow only known destinations.

Create notification records and outbox entries transactionally with the underlying operation where possible. A delivery outage must not undo an admission, export or Help Desk save. An independently runnable authenticated worker processes the outbox, deduplicates messages, retries bounded transient failures, removes invalid device tokens, and exposes delivery state to administrators. Distinguish queued, provider accepted, device received/read, and failed; provider acceptance is not proof a person saw an alert. FCM is not a guaranteed emergency delivery service.

Foreground clients refresh through an authorized subscription if compatible with the current custom session model; otherwise use bounded delta polling with a cursor and retry backoff. Do not expose private database tables merely to get realtime subscriptions. Push prompts a background refresh; opening the app always reconciles the latest five and dashboard. Missing notification permission or Play services keeps the in-app center usable and displays a clear readiness state.

## Walkie-talkie and administrator broadcast

Scope: one event staff channel, half-duplex push-to-talk, administrator priority broadcast to all on-duty authorized members or selected roles. A private Call request invites the selected member into an authenticated voice session; do not claim a full telephone replacement.

Users explicitly enable On duty while the app is visible. Explain speaker/volume behavior and request notification/microphone permissions when needed. Receive-only duty does not activate the microphone. A sender's microphone opens only while holding the talk button or explicitly starting an administrator broadcast. Show a clear transmitting/receiving state and Stop / Leave controls. No recording or audio retention by default.

The native service owns the audio session so reception can continue when the screen is off. Use correct foreground service types, audio focus and lifecycle APIs; never spoof alarms or calls to bypass restrictions. Inside the app show a compact corner chip; outside the app show supported Android foreground/media controls, not an overlay permission demand. A force-stopped, offline or non-duty phone is unavailable, not a confirmed listener. On reconnect do not play stale live speech.

Clients obtain short-lived, room-scoped relay credentials from the server after a fresh role/duty check. Keep relay signing secrets exclusively server-side. Room publish permissions and server floor leases enforce one ordinary speaker at a time; the relay must enforce publish revocation, not just a disabled UI button. Administrator broadcast preempts an ordinary floor, temporarily revokes other publishing and shows recipients the speaker identity. Expired leases, lost connections, sign-out, revoked access and ended sessions release the microphone/floor promptly. Broadcast recipients do not transmit automatically. Relay readiness must prove that previously issued/reconnect credentials cannot rejoin after revocation; short token expiry alone is insufficient. If the chosen provider cannot enforce that property, require an admission guard or a provider with explicit token revocation before enabling voice.

The receiver can opt into speaker routing and a chosen broadcast volume, including full volume where the OS permits. Save and restore the previous route/volume after the session; do not fight a user's volume adjustment during a session. Respect audio interruptions, Bluetooth/headsets and device policy. Automatic background playback/full-volume changes cannot be guaranteed across Android versions and manufacturers; if a session is unavailable, deliver a join notification and keep the missed announcement in app. Display connection/receiver counts honestly, excluding stale heartbeats.

## Verification and release acceptance

- Layout checks at 320/360/390/412 px widths, small heights, landscape, desktop, enlarged text and keyboard-open states; Reports controls must remain reachable without ordinary page scrolling.
- DOM/browser tests for staged login, Google fallback, back navigation, sign-out cancellation, pagination, authorized details, notification limits and pin/restore behavior. Verify actual transitions preserve navigation order and respect reduced motion.
- Server/SQL tests for every role/event matrix cell; spoofed actor/audience; revocation; account switching; idempotency; concurrent sixth items; transactional event generation; audit preservation; outbox retries and lock-screen privacy.
- Android tests for channels/permission denial, token rotation, deep links, account cleanup, duplicate delivery, dismissed-alert in-app persistence, background reception readiness, audio interruption/restoration and foreground-service lifecycle.
- Voice integration tests with at least two isolated identities: floor contention, priority preemption, token expiry, network loss/reconnect, receive-only microphone inactivity, sign-out/revocation, end-broadcast cleanup and stale listener removal. Check transport publication permission, not only local button state.
- Run the existing Node, browser responsive/export, native unit and lint checks. Review final code and deployment diff before publishing. Keep existing reporting summary/export tests and the repaired SQL literal semantics intact.
- The prior physical-device-check deferral remains recorded as `SKIPPED_BY_OWNER`, never passed. New voice/background/OEM behavior cannot be described as physically verified without actual device evidence. If essential end-to-end push/relay verification cannot be performed, report an exact blocker rather than label the requested feature complete.
- Provision additive backend changes first and verify old 0.7.9 clients still work; then publish matched website/APK clients. Keep communications disabled on server until configured and integration checks pass. Never send unsolicited production test broadcasts.
- Build 0.8.0/code 18 using the retained original signing key in place. Verify package, version/code, SDK requirements, original certificate, signed schemes, exact APK byte size/SHA256, packaged reviewed assets and source pins. Do not transfer or expose signing material.
- Append the new APK without replacing any historical artifact, including newly released 0.7.9. Update manifest/checksums only after checks pass, merge with expected head, then independently download and verify the public main APK and manifest.
- Rollback uses a server feature switch and compatible website rollback; preserve additive tables/audits. Do not advertise Android code 17 as an automatic downgrade from code 18. A corrective Android release requires a higher versionCode.

## References checked during design

- Android background audio: https://developer.android.com/about/versions/17/changes/bg-audio
- Android ongoing notification behavior: https://developer.android.com/about/versions/14/behavior-changes-all
- Android foreground service restrictions: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Material motion: https://m3.material.io/styles/motion/overview/how-it-works
- Android shared element transitions: https://developer.android.com/develop/ui/compose/animation/shared-elements
- FCM Android integration: https://firebase.google.com/docs/cloud-messaging/android/get-started
- Relay client connection model: https://docs.livekit.io/intro/basics/connect/

Supabase changelog index retrieval failed during design; retry the official changelog and relevant current docs before implementing Supabase changes. This failure does not imply any backend mutation occurred.
