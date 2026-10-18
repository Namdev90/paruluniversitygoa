# Navrang 0.8.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved compact interface, five-item Android/in-app notifications, and authenticated event voice without changing attendance integrity or signing identity.

**Architecture:** Retain the released ClassicActivity/web interface and existing custom Navrang sessions. Build three independently testable workstreams in sequence: compact UI; server notification center and Android delivery; native voice and administrator broadcast. Provider-dependent tasks have explicit readiness gates while independent UI/backend work can continue.

**Tech Stack:** Existing AndroidX/Kotlin/Java host, HTML/CSS/JavaScript, Node tests, Python Playwright, Postgres and Supabase Edge; FCM delivery and a revocation-capable LiveKit-compatible relay. Pin Firebase BoM 35.0.2 / messaging 26.0.0 / Google services plugin 4.5.0 and LiveKit Android 2.29.0, verified by the research agents against current official docs/artifacts; resolve and compile them in Task 1 before use. No unversioned dependencies.

**Spec:** `docs/superpowers/specs/2026-10-19-navrang-080-communications-design.md` (owner approved 19 October 2026).

## Global Constraints

- Baseline `6f450eb5b03183d5cd2a15de48a33ab820e94f93`; target 0.8.0/code 18, package `in.navrang.gate`, original certificate `0b3c42f8b3aa0b49541be98278c8b4da96bad90616aa78a2a6b5e110fb2117ce`.
- Preserve all historical APKs, existing verified reporting repair, source data/audits and original key. Never disclose/transfer signing or provider secrets.
- Existing session role `checker` covers multiple capabilities; selected login role never authorizes anything. Resolve effective audience from current server permissions.
- At most five notification items per recipient plus one separate pinned live card. Keep existing device-wide verified APK update alerts separate from account activity retention.
- Normal Reports uses consolidated pages without vertical scrolling; accessibility dialogs may scroll when necessary to prevent clipping.
- Start main transitions at 350–450 ms and control feedback at 150–220 ms. Authentication revocation and scan acknowledgements never wait for animation.
- No production test announcements to real staff. Use isolated synthetic identities/devices for communication checks. No paid hosting commitment without authorization.
- Physical checks remain `SKIPPED_BY_OWNER` until performed; do not substitute fixtures for actual push/voice transport evidence.
- Execution method: root implements; the five requested agents review/research/check first, with independent review at subsystem integration points. The watchdog monitors the active session, particularly GitHub stalls.

## Review Focus

- Rapid navigation plus account revocation must not retain an administrator screen in animation snapshots (Task 3).
- A cancelled save picker must not become a completed teacher-download alert (Task 6).
- Concurrent sixth-item insertions and aggregate updates must converge to the same five IDs on every device (Task 5).
- Logout while offline, token rotation and an old push arriving after account switch must not expose the previous account (Task 7).
- A revoked voice member must not rejoin with a previously issued or provider-refreshed token (Tasks 1 and 9).

## File boundaries and contracts

| Module | Responsibility / interface |
| --- | --- |
| `app/assets/auth-flow.js` | Pre-auth stages, intent persistence, native Google progress/fallback; `AuthFlow.mount({client,onStageChange})`, `AuthFlow.reset()` |
| `app/assets/presentation-motion.js` | Retargetable non-sensitive navigation decoration; `Motion.navigate(commit,{sensitive:boolean})`, `Motion.cancel()` |
| `app/assets/pagination.js` | `pageItems(items,{page,size}) -> {items,page,pages,total}`; pure, clamps after filter changes |
| `app/assets/report-layout.js` | Overview/Downloads/Teacher access pages, size-aware metric pagination, focus; `ReportLayout.mount({isAdmin})`, `ReportLayout.setMetrics(metrics)` |
| `server/functions/navrang-gate/communications-contract.mjs` | Strict action/payload limits and canonical event/template types; no authorization from client fields |
| `server/functions/navrang-gate/communications.mjs` | Service adapters and authenticated action orchestration; inject `rpc`, `push`, `relay`, `clock` for tests |
| `server/communications-v080.sql` | Private state, current-capability resolver, transactional events, pruning, outbox, duty/floor functions; mirror generated schema section |
| `app/assets/notifications.js` | Five-item feed/pinned dashboard/composer, allowlisted destinations and reconnect delta handling |
| `native-app/src/main/kotlin/in/navrang/gate/communications/` | Identity-scoped native notification store/service, push adapter, voice service and relay adapter; no alternate Compose home |

All communication requests use the existing `GateClient.api(action,payload)` / bearer contract. New actions are allowlisted in `security.mjs` and routed in `index.ts`; private SQL RPC `navrang_communications(p_action text,p jsonb,p_token text)` accepts the session hash, validates fresh access, and is executable only by service_role.

Define JSON types in the contract module and matching native models: `Feed={revision,serverTime,items:NotificationItem[0..5],activeIds:string[],dashboard:Dashboard|null}`; item `{id,revision,kind,title,body,at,read,destination}`; dashboard `{revision,generatedAt,status,totals,hidden}`. Return a full authoritative five-ID set on every feed response so skipped push events cannot prevent pruning. Cursor is a nonnegative integer revision; updated aggregates advance it. Never put student contact/payment data or report rows in notifications.

Notification actions: `notifications-feed {afterRevision}`, `notifications-read {id}`, `notifications-dashboard {hidden}`, `notifications-preview {template,audience}`, `notifications-send {requestId,template,audience,previewHash}`, `notifications-end {id}`, `notifications-device {installationId,providerTarget:{type:'fid'|'legacyToken',value},bindingId}`, `notifications-unregister {installationId,bindingId,unlinkProof}`. Server returns recipient count/preview hash from preview; send rechecks permissions and recipient count, returning a changed-preview response before sending if the audience changed. Templates allow 100-character title, 1000-character body, optional 120-character meeting location and ISO meeting time; disallow HTML, arbitrary URLs and client actor IDs.

Registration returns a random one-use unlink proof only to the native installation; store its hash on the server. Unregister may authenticate by that proof solely to delete the exact installation/binding, granting no feed/account access. Durable offline unlink retries store only this restricted proof, never an old Navrang bearer. Replacement registration atomically invalidates the previous binding and proof.

Voice actions: `duty-join {installationId}`, `duty-heartbeat {dutyId}`, `duty-leave {dutyId}`, `voice-join {dutyId,sessionId}`, `voice-floor {sessionId,requestId}`, `voice-renew {sessionId,leaseId}`, `voice-release {sessionId,leaseId}`, `voice-broadcast-start {requestId,audience,previewHash}`, `voice-broadcast-end {sessionId}`, `voice-invite {requestId,staffId,previewHash}`. Join returns `{sessionId,relayUrl,token,expiresAt,mode,generation}` with subscribe-only permission by default. Floor leases last 15 seconds, renew every 5 seconds; duty heartbeat every 15 seconds expires after 60 seconds. Server-owned sequence/generation prevents delayed floor updates from restoring a preempted speaker.

### Task 1: Baseline and provider readiness (no production user messages)

**Files:** Create `docs/communications-readiness-0.8.0.json`, `tools/check-communications-readiness.py`; test `tests/communications-readiness.test.cjs`; inspect existing build/release scripts and reviewed production backend receipt.

**Interfaces:** Produces a secret-free receipt `{baseline,reportBodyHashes,push:{configured,artifactResolved,deliveryVerified,project,apiVersion,sdkVersion},voice:{configured,artifactResolved,deliveryVerified,url,serverVersion,sdkVersion,revocationVerified},checks:{...},blockers:string[]}`. SDK versions must be exact literal versions selected from official release metadata, with artifact resolution verified before dependency edits.

- [ ] Write `reject_unconfigured_transport` asserting readiness is false with missing push credentials/relay and `reject_reusable_revoked_token` asserting false when an old/reconnect token rejoins. Existing report body hashes/ACLs must match the reviewed deployed v7 source.
- [ ] Run `node --test tests/communications-readiness.test.cjs`; expect missing checker failure before implementation.
- [ ] Implement `check_readiness(config: dict, evidence: dict) -> dict` in the Python checker. Discover existing authorized projects/config names without reading secret values into output; reconcile released report bodies from the private verified package. Record unconfigured transport as a blocker, not as a passing disabled feature. Continue Tasks 2–6 while provider setup is unavailable; hold Tasks 7/9 delivery acceptance and final publication.
- [ ] Run the checker tests and official SDK artifact-resolution check. Configuration/artifact readiness permits implementation; deliveryVerified is populated only by Tasks 7/9 after their services exist, preventing a circular prerequisite. Use synthetic opted-in Google-enabled emulator/device endpoints for actual push and two-identity voice evidence; physical/OEM checks remain separately deferred. Until those checks run, preserve them as NOT_RUN with exact reason.
- [ ] Commit the secret-free readiness checker/receipt: `git add tools/check-communications-readiness.py tests/communications-readiness.test.cjs docs/communications-readiness-0.8.0.json` then `git commit -m 'Record communications provider readiness and baseline'`.

### Task 2: Staged sign-in and compact branding

**Files:** Create `app/assets/auth-flow.js`, `tests/auth-flow.test.cjs`; modify `app/assets/index.html`, `app/assets/art/brand-shell.js`, `app/assets/art/classic-restore.css`, `app/assets/gate.js`, `native-app/src/main/kotlin/in/navrang/gate/MainActivity.kt`.

**Interfaces:** Produces AuthFlow interface above; consumes existing `C.googleLogin`, `C.googleBrowserLogin`, `C.profile`, existing server station requests. Native credential events include an operation ID and session generation; pending state lasts through the asynchronous native callback, not just the bridge invocation. Ignore stale callbacks after a new sign-in. Events become `{phase:'pending'|'cancelled'|'failed'|'completed',generation}` and never carry token/password values.

- [ ] Write tests `admin_staff_role_then_signin`, `intent_does_not_grant_access`, `cancel_reveals_browser_retry`, `back_preserves_intent`, `single_brand_line` asserting stage order, one role-picker owner, no permission mutation, no automatic browser launch on explicit cancellation, and one ordinary header brand group.
- [ ] Run `node --test tests/auth-flow.test.cjs`; expect missing module/stage failures.
- [ ] Implement AuthFlow and replace brand-shell role/admin injection ownership. Keep credential nonce/PKCE/session-generation paths; diagnose native failures by safe error classes, distinguishing cancellation from provider errors. Add creator text, preserve authenticated official assets, remove duplicate card/footer logos; retain code login as secondary. No invented Chota Namu portrait.
- [ ] Run the focused DOM tests plus `npm test`; confirm both native-credential and browser flows reach the server-approved station under fixtures, and cancellation leaves the identity unchanged.
- [ ] Commit as `feat: simplify role selection and sign-in presentation` with only task files and required existing-test updates.

### Task 3: Consolidated Reports, paginated lists, dialogs and motion

**Files:** Create `app/assets/report-layout.js`, `app/assets/pagination.js`, `app/assets/presentation-motion.js`, `tests/compact-layout.test.cjs`; modify `app/assets/reports.js`, `gate.js`, `index.html`, `style.css`, `art/brand-shell.css`, `art/classic-restore.css`, `tests/responsive-browser-check.py`.

**Interfaces:** Produces ReportLayout/Motion/pageItems above. Keep `gate.js:setView` as sole authorized navigation commit point; decorate only after authorization, refresh once. Reuse `showStudent()`'s authorized model for administrator rows; entry detail dialogs consume only already-permitted receipt fields.

- [ ] Write `reports_fit_viewport_without_scrolling`, `eleven_metrics_all_reachable`, `teacher_access_admin_only`, `filtered_page_clamps`, `cancel_signout_has_no_effect`, `rapid_tabs_last_wins`, `revocation_removes_private_snapshot`, and `reduced_motion_preserves_navigation`. Assert all datasets/buttons remain reachable and 44px targets stay usable across small supported viewports.
- [ ] Run `node --test tests/compact-layout.test.cjs` and `python3 tests/responsive-browser-check.py --sizes 320x480,320x640,360x800,390x844,412x915,640x360`; expect old scrolling/layout behavior to fail.
- [ ] Implement the three Reports tabs; use ResizeObserver-measured available height and metric/approval pagination, resetting pages on filter changes. Replace ordinary Reports overflow-auto rather than clipping it. Make account/readiness/update regions compact, add sign-out dialog and permission-scoped row dialogs. Implement interruptible WAAPI/FLIP transform/shape animation around synchronous navigation; cancel snapshots immediately on identity/access change and honor reduced motion/native animator scale exposed by the host. Remove competing legacy view animations in both style sheets. Back closes ordinary dialogs, then returns to the previous login stage, then uses the existing exit/pending-work flow; protected scanner results retain mandatory acknowledgement. Preserve short visible reporting provenance while full caveats open in Details.
- [ ] Run focused tests, browser tests at 200% text/keyboard/dialog cases and `npm test`. Test every report tab/page with scrollTop=0, scrollHeight<=clientHeight+1 and no scroll_into_view helper, including expanded notices/update banners. Inspect resulting screenshots and animation clips; scan acknowledgements and navigation state must remain immediate.
- [ ] Commit as `feat: consolidate reports and add coherent screen motion`.

### Task 4: Private communication capabilities and strict API contracts

**Files:** Create contract/SQL modules in boundary map and `server/tests/communications-contract.test.mjs`, `server/tests/communications-db.sql`; modify `server/schema.sql`, `security.mjs`, `index.ts`, `handler.mjs`.

**Interfaces:** `resolve_actor(session_hash text) -> {principal,admin,scanner,helpdesk,faculty,active,capabilityRevision}` is private SQL; `validateCommunication(action:string,payload:object) -> object` is the pure strict parser. Staff principal is stable UUID; admin is `admin`. Existing source/reporting contracts remain backward compatible.

- [ ] Write `selected_role_is_not_authority`, `faculty_requires_current_grant`, `expired_staff_is_denied`, `oversized_or_spoofed_payload_rejected`, `private_table_acl` with a complete role/event matrix and anonymous/unsupported-action cases.
- [ ] Run `node --test server/tests/communications-contract.test.mjs` and the local Postgres fixture SQL suite; expect new API/schema missing.
- [ ] Implement current-role resolver using existing session/checker/station/report rules, the explicit action contracts above, and service-only RLS tables. Add new routed RPC without widening existing table/function grants. Create migration through discovered Supabase CLI command; iterate locally, then capture the reviewed migration. Recheck official Supabase changelog/docs before any deployment.
- [ ] Run contract/SQL role tests and existing `npm test`; verify old 0.7.9 action responses/report hashes and grants are unchanged. Run advisors on the local/integration database and resolve introduced findings.
- [ ] Commit as `feat: add private communications capabilities and contracts`.

### Task 5: Transactional five-item feed and delivery outbox

**Files:** Extend `server/communications-v080.sql`, `communications.mjs`, `handler.mjs`; create `server/tests/notification-feed.test.mjs`, `server/tests/notification-concurrency-db.sql`.

**Interfaces:** `append_event(event jsonb, recipients text[]) -> event_id`, `read_feed(actor,after_revision) -> Feed`, `dispatch_batch(limit:integer) -> {accepted,retried,removed}`. Provider interface `push.send({providerId,eventId,bindingId}) -> {accepted:boolean,permanentFailure:boolean}`. Only generic identifiers/wake intent leave the server in push payloads.

- [ ] Write tests `sixth_item_prunes_oldest`, `concurrent_insert_still_five`, `read_dismiss_not_delete`, `aggregate_bump_advances_revision`, `dispatch_rechecks_revoked_capability`, `mutation_success_survives_delivery_failure`, `retry_is_idempotent`, `dashboard_outside_limit`.
- [ ] Run new Node and local two-connection SQL tests; expect missing feed/concurrency behavior.
- [ ] Implement per-principal serialized insert/prune, authoritative active IDs, outbox leases/backoff, current-permission dispatch checks and invalid-provider-registration cleanup. Generate events transactionally via SQL hooks/triggers on committed admission/attempt (including duplicate/blocked), helpdesk save/edit/review, station/report-grant, report preparation and outcome changes, never an Edge append after RPC commit. Fault-inject lost HTTP after DB commit and prove retry creates one event. Aggregate admin scan events per actor in 10-second windows with revision increments; never alter audits. Keep delivery metadata 7 days, prune operational records only after outbox settlement, and bound retained outbox failures to 7 days with visible failure counts. Dispatch via a narrowly authenticated worker scheduled independently of user actions; never block admission commits on provider HTTP.
- [ ] Run matrix/concurrency/retry tests; verify duplicate check-in request ID yields one event and preserves the original admission. Test cursor gaps and collapsed wakeups converge to the authoritative five.
- [ ] Commit as `feat: add bounded notification feed and reliable outbox`.

### Task 6: Feed/composer UI and honest report save outcomes

**Files:** Create `app/assets/notifications.js`, `tests/notifications-flow.test.cjs`; modify `index.html`, `gate.js`, `client.js`, `reports.js`, `app/java/in/navrang/gate/MainActivity.java`, report SQL and notification orchestration; add Android `ReportSaveOutcomeTest.kt` under existing test package.

**Interfaces:** `GateClient.saveReport(name,mime,bytes,{operationId,dataset,format})` emits `report-save {operationId,outcome:'saved'|'cancelled'|'failed'|'initiated',generation}`. Server `reports-export` optionally accepts `{kind,format,requestId}` and returns `operationId`; add `reports-summary-prepare {requestId}` for PDF and `reports-save-outcome {operationId,outcome}`. Bind operation to actor/session, kind/format and allowed prepared -> initiated -> saved/cancelled/failed transitions, with cancelled/failed also allowed directly from prepared. These are device-reported receipts, not cryptographic proof of filesystem state; browser requests can report only initiated. Preserve old request compatibility.

- [ ] Write `pinned_card_hide_restore`, `admin_preview_before_send`, `five_recent_after_os_dismiss`, `picker_cancel_is_not_download_success`, `old_generation_save_ignored`, `browser_download_only_initiated`. Assert previews revalidate changing recipients and no HTML/unapproved deep link renders.
- [ ] Run focused Node/Robolectric tests; expect missing native result callback/center.
- [ ] Implement compact notification center, explicit live hide/restore, administrator template fields/audience preview and Send. In foreground poll deltas every 5 seconds with capped exponential backoff to 60 seconds, pause browser polling only while hidden/offline/session invalid; On duty gates voice only, never ordinary signed-in notification access, and show stale time. Thread export operation/dataset/format through Android SAF callbacks and emit saved only after successful output-stream flush AND close plus final identity/access recheck; browser marks initiated only. Save success triggers faculty-own/admin events; Help Desk retains inline feedback rather than routine center alerts.
- [ ] Run focused tests and existing report export/browser/SQL tests; denied/cancelled/failed saves must never notify a completed download, and server preparation remains separately recorded.
- [ ] Commit as `feat: add notification center and accurate report save receipts`.

### Task 7: Android push delivery and centralized identity cleanup

**Files:** Create `communications/NotificationStore.kt`, `GateMessagingService.kt`, `NotificationSync.kt`, `CommunicationLifecycle.kt` plus focused native tests; modify `GateSession.java`, `GateRuntime.java`, `GateReadiness.java`, native `MainActivity.kt`, Android manifest and version catalog/build config.

**Interfaces:** `CommunicationLifecycle.onIdentityChanged(generation:Long)` cancels account notifications, clears cache, stops duty/audio and schedules best-effort server unbinding. `NotificationSync.refresh(expectedGeneration:Long): Feed`; local binding `{installationId,bindingId,principal,generation}`. App installationId is separate from provider FID and survives provider-target rotation. Use FCM26 onRegistered(installationId), enable firebase_messaging_installation_id_enabled, support transitional onNewToken without duplicate bindings, and send HTTP v1 message.fid for FID targets. Keep .internal Firebase configuration isolated; do not auto-register/send to production from tests.

- [ ] Write `offline_logout_clears_before_network`, `late_push_for_old_binding_ignored`, `rotated_registration_replaces_binding`, `permission_denied_keeps_inapp`, `sixth_cancels_stale_system_id`, `update_alert_not_pruned_by_activity`, `disabled_channel_no_play_services`, `deleted_messages_full_reconcile`, `forged_deeplink_denied`, `out_of_order_push_no_resurrection`, `same_account_role_revocation`.
- [ ] Run the targeted native unit tests; expect missing service/store/lifecycle hooks.
- [ ] Implement data-only private invalidation (opaque notice ID, binding epoch, revision, schema version); never use auto-display notification payloads. Use normal priority for routine activity, high only for visible urgent notices, and 30-second TTL for voice invitations. Implement channel groups (announcements default/urgent high/admin activity low/live); use generic lock-screen text, authenticated sync before rendering, allowlisted deep links, deterministic account item IDs and separate update IDs. Persist deleteIntent dismissal IDs only while their items remain in the authoritative five; ordinary refresh must not repost a dismissed item. Centralize generation-change cleanup beneath every clear/expiry path, not only the sign-out button, and revalidate on capability/profile changes; store an unbinding tombstone for retry without retaining an active session. Request permissions in context; no auto-reprompt loop. Remove GateReadiness automatic maximum-volume changes on create/resume, separating deliberate broadcast volume from existing scan sound controls.
- [ ] Run native tests and one synthetic actual-device/provider push in foreground/background/dismissed states when Task 1 is ready. Reconcile five items after missed/collapsed messages and verify old-account content never appears.
- [ ] Commit as `feat: deliver scoped Android alerts and clear identity state`.

### Task 8: Server duty, floor control and administrator priority

**Files:** Extend communications SQL/orchestration; create `voice-contract.mjs`, `relay-livekit.mjs`, `server/tests/voice-floor.test.mjs`, `server/tests/voice-floor-db.sql`.

**Interfaces:** `relay.joinToken({principal,sessionId,generation,expiresAt,canPublish:false})`; `relay.setPublisher({sessionId,principal,allowed,generation})`; `relay.revoke({principal,cutoff,generation})`. Pin LiveKit Android 2.29.0. Require Cloud explicit revoke_token_ts cutoff (including same-second/refreshed-token tests) or a self-host admission guard covering every initial/reconnect signaling path without direct bypass; stock self-host TTL/webhooks are insufficient. Adapter must prove old-token rejection as required by Task 1; failure cannot be reported as successful floor ownership.

- [ ] Write `one_floor_under_race`, `admin_preempts_existing_publisher`, `delayed_grant_cannot_restore_old_floor`, `lease_expiry_unpublishes`, `revoked_staff_cannot_rejoin`, `call_invitation_requires_authorized_recipient`, `duty_membership_expires`.
- [ ] Run Node and two-connection database tests; expect missing floor/duty implementation.
- [ ] Implement duty membership, server-issued subscribe-only credentials and serialized 15-second leases. Use a durable outbox/generation for relay permission mutations and an authenticated 1-second expiry/reconciliation sweep while sessions are active (verify database subsecond scheduler support; otherwise require an external continuously runnable worker). Use one leased worker per room, 2-second relay timeout, 3-second stale-worker health cutoff, and deny new grants/renewals when stale; never use a minute cron or an eternal Edge loop for 15-second floor expiry. On relay-control outage fail closed for new publishers, display degraded status and retry revoke; hard malicious-publisher cutoff at lease expiry requires relay-local enforcement and must not be claimed without it. While PREEMPTING, grant a new publisher only after previous permission removal is acknowledged. On failed preemption show failed/pending and do not start two microphones. Broadcast transitions update the pinned live state and recipient counts from 60-second duty freshness. Selected-role/private invitations use separate opaque relay rooms and server-checked membership; never rely on local subscription/UI filtering in a common all-staff room. Listener counts intersect current authorized membership with actual relay connections and bounded heartbeat. No audio content in database/logs.
- [ ] Run race/failure tests plus relay integration with two synthetic identities. Verify existing/refreshed tokens fail after revocation, including same-second disconnect/rejoin and cross-audience/private-room denial races; retain exact evidence/provider version.
- [ ] Commit as `feat: enforce event voice floor and admin broadcast priority`.

### Task 9: Native on-duty voice reception and push-to-talk

**Files:** Create `communications/VoiceSessionService.kt`, `VoiceController.kt`, `VoiceAudioPolicy.kt`, `RelayClient.kt`, native voice tests and `app/assets/voice.js`; modify native host bridge, manifest, index/styles, dependency catalog and build inputs.

**Interfaces:** Bridge accepts only `duty-join|duty-leave|talk-start|talk-end|broadcast-start|broadcast-end|invite` with bounded JSON and current generation. Native emits `{state,sessionId,speaker,mode,connection,listenerCount,generation}`; tokens never enter web DOM. `VoiceAudioPolicy.enter(config)` / `leave()` restores route/volume safely.

- [ ] Write `receive_only_never_opens_microphone`, `background_requires_user_started_duty`, `stop_logout_revocation_closes_audio`, `focus_loss_stops_or_ducks`, `volume_restored_without_fighting_user`, `disconnect_discards_stale_audio`, `gesture_cancel_releases_floor`.
- [ ] Run targeted native tests; expect missing voice service/controller behavior.
- [ ] Configure the relay SDK audio switch before connection and use one audio-focus owner, not a competing second manager. Implement visible user-started duty service, correct media/microphone foreground types and permissions, route/focus handling and compact in-app corner chip. Microphone opens only with a server-confirmed publishing floor plus deliberate talk/broadcast gesture. Hold-to-talk release/cancel, app interruption and generation change always close capture; receiver never starts transmitting. Unsupported/force-stopped/offline state produces Join/missed announcement, never a fake listener acknowledgement.
- [ ] Run native tests plus actual transport tests for screen-off reception, two-device contention, admin priority, revoked reconnect, Bluetooth/headset and interruption behavior as available. Record unavailable physical checks as owner-deferred, and block unsupported reliability claims.
- [ ] Commit as `feat: add deliberate staff voice and administrator broadcasts`.

### Task 10: Integrated review, rollout, signed release and public verification

**Files:** Modify `release.json`, `CHANGELOG.md`, `README.md`, release evidence/approval JSON, `updates/latest.json`, `SHA256SUMS.txt`; append `downloads/Navrang-Gate-0.8.0.apk`; never replace an old APK.

**Interfaces:** Consumes all previous task evidence. Produces immutable reviewed source SHA, signing approval checkout, signed artifact receipt, expected publication head, merged main SHA and independently verified public manifest/APK.

- [ ] Write/adjust release checks asserting code 18/name 0.8.0, original signer, unchanged historical file hashes and no unconfigured communications described as live. Run existing release gates before any publication.
- [ ] Run `npm test`, `npm run test:dom`, `npm run test:native`, responsive/export browser checks, and `./gradlew :native-app:assembleDebug :native-app:testDebugUnitTest :native-app:lintDebug`; all required checks must pass. Do not repeatedly rerun successful suites without a new change/failure.
- [ ] Request independent whole-branch review; resolve findings. Deploy additive backend with communications off, check exact old-client reporting/access invariants, configure and verify worker/push/relay, then enable. Deploy matched website after backend acceptance. No production test broadcast without specific recipients approved.
- [ ] Freeze reviewed source; use retained original key in its current custody with `tools/build.py` and documented release gates. Independently verify signer/package/version/assets/size/SHA256; prepare the append-only artifact/manifest commit and run all three PR workflows on its exact SHA. Merge with expected head only when green. Download canonical public main APK/manifest/checksums and verify exact bytes, original certificate and code 18 before reporting release success.
- [ ] Commit/publication uses the existing reviewed binary-transfer procedure if connector limits require it; never upload signing material. Retire staging transfer workflow after immutable blob creation. Preserve prior build/blob receipts if transport fails.

## Stall recovery and completion

- Each task checkpoint records last successful SHA, tests/evidence, current external blocker and next independent task in an ignored private receipt; never put credentials in it.
- Watchdog receives each provider/GitHub milestone, run IDs and failure summaries. Two equivalent failed attempts trigger investigation or a different safe route; no blind retry loop.
- Use GitHub connector/API for authenticated writes if shell git authentication is unavailable. Never request/export a token. Pin refs to expected SHA and inspect head after an ambiguous write before trying again.
- Poll queued/running jobs with useful intervals, compare step age to measured successful runs (last native workflow approximately 5m52s), and inspect logs for an actual failure. Never cancel/rerun solely because a build is slow.
- Provider setup gates only dependent delivery/voice work; finish independent UI/server checks and report exact missing project/endpoint/configuration. No new public release may be claimed to contain functioning push/voice until real transport acceptance passes.
- Rollback disables new communications and restores compatible website presentation without deleting state/audits. A corrective APK uses a versionCode greater than 18; do not point the updater at code 17 as an automatic downgrade.

## Review status

Five requested reviewers completed research/review; root incorporated their corrections and performs a final coverage/type check before implementation. The owner approved the written specification and explicitly delegated the preimplementation plan review to these five agents. Continue with root execution and independent review, honoring that instruction rather than adding another approval cycle. Provider readiness remains an evidence gate, not a request to disclose secrets.
