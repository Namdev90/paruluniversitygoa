# Daily immutable-room voice candidate

Status: isolated server candidate, not an enabled voice transport. Reviewed against official documentation on 2026-10-25. No Daily account, credential, room, billing setting, deployed function, or live media session was created or changed for this work.

`server/voice/daily-relay.mjs` is deliberately disconnected from the public voice actions and the running controller. Its `grant()`, `renew()`, and `revoke()` return 503. Readiness keeps `revocationVerified`, `leaseEnforced`, and `workerDeathVerified` false, with `transportEvidence: 'NOT_RUN'`. A mocked HTTP success must never change those flags.

## Candidate boundary

The candidate allocates a new opaque private room for one authorized lease. The room has an absolute deadline no more than 15 seconds away, rounded down to integral Unix seconds, and `eject_at_room_exp: true`. Every credential uses that same room and deadline with `eject_at_token_exp: true`. A replacement lease gets a different room name; the candidate exposes no in-place room renewal or restore-and-create operation.

Daily documents that room expiry alone prevents joining but can leave an existing meeting running. Enabling room ejection is therefore essential. Daily also documents that deleting a room kicks everyone out. [Rooms](https://docs.daily.co/reference/rest-api/rooms)

Token ejection properties override the room's ejection properties. Every token must therefore carry the matching absolute expiry and enabled token ejection; a token with a later deadline, a disabled ejection override, or only a relative duration could defeat the intended boundary. Private-room expiry also prevents joining with the expired token. [Meeting-token limits](https://docs.daily.co/reference/rest-api/meeting-tokens)

The API schema represents expiry as integer Unix seconds and documents `sfu_switchover: 0.5` for SFU use from the first participant. No minimum room/token lifetime, expiry processing interval, or maximum media-cutoff delay was found in the reviewed schema. Rounding down prevents the requested deadline from exceeding the database lease; it does not establish a provider timing guarantee. [Official OpenAPI schema](https://docs.daily.co/openapi.json)

## Permissions and observations

The room defaults to no sending, receiving, or administrative permission. Publisher credentials allow only `canSend: ['audio']`; listener credentials use `canSend: false`. Credentials are non-owner and have no administrative permissions. `canReceive` is an object: publisher-only credentials use `{base: false}`, while listeners permit microphone audio and explicitly exclude the other media types. The server fixes the publisher identity in the plan and refuses to mint a listener credential for that identity. These restrictions still require fresh application authorization before each credential is issued. [Permission model](https://docs.daily.co/reference/daily-js/types/daily-participant-permissions)

Room creation checks the returned room name, URL, privacy and security configuration against the plan. Credential creation currently checks the returned token's bounded JWT shape; it does not independently decode or verify each provider-issued claim. Neither observation proves active-media behavior.

Cleanup requires a successful DELETE response with `deleted === true` and the exact requested room name, followed by GET returning 404. That response shape is documented. [Delete Room](https://docs.daily.co/reference/rest-api/rooms/delete-room)

Daily documents room deletion as the way to revoke a Daily-issued token tied to that room. Never reuse the room name: re-creating the old namespace could make an unexpired token relevant again. [Working with meeting tokens](https://docs.daily.co/docs/guides/privacy-and-security/meeting-tokens)

The cleanup result is only `deleted` / `absenceObserved` control-plane evidence and explicitly retains `mediaTerminationVerified: false`. GET 404 alone is insufficient because expired rooms can disappear from API views while a meeting continues. The reviewed documentation does not say that DELETE acknowledgement waits for all SFUs to stop forwarding media. Consequently it cannot yet be used as the controller's strict revocation acknowledgement or as proof that an admin can publish without overlap.

## Private implementation and remaining integration

The local source now includes private SQL plan persistence in `server/voice-v080.sql` and an isolated `server/voice/daily-service.mjs` orchestration component. SQL binds the immutable plan to the exact floor lease, publisher, generation and effective deadline; reserves each room name in retained grant history; copies the plan into durable cleanup commands; rotates leases instead of extending rooms; and requires exact room-bound grant/removal receipts. The ordinary participant-removal ACK and legacy commit cannot acknowledge Daily plans. One strict room-destruction receipt acknowledges all pending removals for that identical plan, including multiple revoked listeners. These are synthetic state guarantees, not provider acceptance.

The existing public routes and readiness gates remain unavailable. Automatic approval review rejected the proposed handler, store, controller and runtime wiring because it would enable credential minting/provider operations and change externally reachable behavior beyond the approved scope. That wiring was not retried. The isolated components and private SQL are not a completed production integration.

The adapter's in-memory lifecycle is not a durable lease store by itself. The complete integration must preserve the following boundaries:

- Persist the exact lease ID, generation, publisher identity, unique room name, effective expiry, operation ID and lifecycle state before the provider request. Associate every returned credential and callback with that exact operation and current authenticated session.
- Record a creation attempt before sending it. A timeout, disconnect or crash leaves an uncertain outcome; never recreate that room name, even after an observed 404. Reconcile the saved room and allocate a fresh plan for any later attempt.
- Close the canonical in-process room state before DELETE, including when cleanup receives a deserialized database plan. Late creation/token responses must not restore that state or return usable credentials.
- Treat the rounded `exp * 1000` as the effective lease deadline. Recheck it after every awaited operation; reject late responses and never extend it during retries or rate-limit handling.
- Serialize floor changes and admin preemption in the database. Withhold publisher credentials until the exact generation is committed and preceding publishers have met the accepted revocation condition. An uncertain DELETE outcome must keep the next floor unavailable.
- Persist cleanup work across controller death. Do not equate successful cleanup polling or a fresh worker heartbeat with independently enforced media expiry. The provider deadline must already exist before publication begins.
- Implement credential delivery and generation changes for every authorized listener. A room-per-lease design makes all listeners move to a new room; it is not a transparent token refresh on an existing session.
- Preserve all existing public 503 and readiness gates until the independent media, replay and worker-death checks pass. The current candidate is not a drop-in replacement for the strict controller acknowledgement contract.

Broadcast and invitation discovery is also unfinished code. `daily-receive` reauthorizes the requested, already joined session; it does not tell a staff member polling the shared channel that an administrator has created a different broadcast session. Audience-filtered broadcast discovery and listener redistribution are required. Private invitations must remain explicit rather than silently auto-joining recipients.

## Native Android work remains

The Android source already contains `VoiceCoordinator`, `VoiceSafetyState`, injected authority/media contracts and momentary PTT controls. They handle local permission, focus, lifecycle, expiry, cancellation and generation boundaries. An optional typed Daily candidate also exists under `native-app/src/daily`, outside the default source sets. These are staged implementations with the build gate disabled and unavailable production factories, not an enabled media path.

Remaining code includes the concrete Daily authority parser/binding, duty heartbeat and session discovery, foreground service ownership for background listening, and complete listener redistribution across room rotations. Provider/device acceptance is separate. The selected universal Daily SDK also exceeds the current updater's APK size limit when added to this app, so packaging needs resolution. See [the current native implementation status](native-voice-0.8.0.md) for its precise test and build evidence; these gaps are not solely account/configuration dependencies.

Daily's native API exposes `join(..., clientSettings, ...)`, `setInputsEnabled()`, `setIsPublishing()`, subscription controls and participant/network callbacks. Operations and callbacks belong to one handler thread. Supplying an Activity lifecycle causes the client to be released when that Activity is destroyed. [Android CallClient](https://reference-android.daily.co/daily-android/co.daily/-call-client/index.html)

The native SDK can automatically resume sending when permission is restored if capture and publishing remained enabled. Permission loss, preemption and network interruption must therefore clear local PTT intent and disable both controls. Current release 0.41.0 requires Kotlin 2.2.20; the old quickstart's 0.8.0 example is not a current dependency recommendation. [Official Android changelog](https://raw.githubusercontent.com/daily-co/daily-client-android/main/CHANGELOG.md)

No in-call meeting-token replacement API or explicit guarantee of simultaneous joined Kotlin `CallClient` instances was found. Do not assume seamless 15-second renewal or reliable listener/publisher audio isolation. The current documented native entry point supplies the token at join. [Native join](https://reference-android.daily.co/daily-android/co.daily/-call-client/join.html)

Daily's installation guide says minimum SDK 21, while its overview says 23. Inspect and compile the selected artifact before fixing compatibility claims. Background operation needs an application foreground service; adapt the broad video-call sample to actual audio features. Android imposes microphone permission and foreground-start restrictions, and additional prerequisites for the `phoneCall` service type. [Daily installation](https://docs.daily.co/docs/android/installation), [Daily overview](https://docs.daily.co/docs/android), [Android foreground services](https://developer.android.com/develop/background-work/services/fgs/service-types)

## Quotas and cost

Daily currently documents 99 successful requests per five-second window for most room endpoints, counted per API key and per endpoint. Meeting-token creation currently has no per-endpoint rate limit. These are published limits, not capacity reserved for Navrang, and may change. [REST API limits](https://docs.daily.co/docs/rest-api)

At one replacement every 15 seconds, one continuously active logical staff room requires 240 room creates per hour, 240 deletes, and at least 240 deletion-verification GETs, plus tokens for each listener/publisher reconnect and any creation verification. Synchronized renewals, rapid preemption, retries and other application traffic add bursts. A bounded retry cannot move the absolute lease deadline.

The current private SQL retains grant room-name reservations and command history without a historical retention policy. One continuously rotating floor produces 5,760 grant records per day, plus revocation records and indexes. Database capacity is therefore a separate deployment gate, especially on a small free tier. Never prune unacknowledged or ambiguous cleanup. Any pruning of acknowledged, expired metadata needs a proved token-expiry and replay bound and a policy that preserves the no-room-reuse invariant; no such pruning is implemented here.

Current pricing lists 10,000 free participant-minutes monthly, then $0.00099 per audio-only participant-minute in the first paid tier. Listeners consume connected participant time; muting does not turn a participant-minute into a talk-minute. Any video track makes the session bill at the video rate. The pricing FAQ states up to 100,000 simultaneous calls/sessions with a card on file and no hard spending cap that automatically stops calls after the free allowance. Old 2019 room-plan limits must not be treated as current quotas. No short-session billing-rounding rule was found; do not assume the 15-second rotations have a particular rounding treatment. [Current pricing](https://www.daily.co/pricing/video-sdk/)

## Acceptance still required

Mocked tests can verify payloads, exact response validation, cancellation, stale callbacks, one-attempt creation, immutable deadlines and hard-disabled readiness. They cannot verify the provider's relay behavior.

Before enabling voice, independent receiver-side media evidence is required for expiry while the controller is killed, SDK/signalling disconnects, clock skew, delayed provider responses, DELETE/preemption ordering, replay of old publisher/listener tokens, duplicate publisher identities, and repeated room transitions. The evidence must show the media cutoff and overlap bound, not merely API status or local microphone UI state. Device acceptance must separately cover foreground/background transitions, microphone denial/revocation, Bluetooth and speaker routes, interruptions, logout, process death and reconnect churn. No such provider or physical-device acceptance was performed for this candidate.
