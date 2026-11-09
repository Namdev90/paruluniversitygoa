# Native notification integration — not production verified

The AndroidX host keeps the existing HTML interface. Native push is disabled by default (`BuildConfig.PUSH_ENABLED=false`). No Firebase project mapping, credential, production send, or device evidence was created by this implementation. Server `delivery_enabled` and release-readiness gates must stay false until owner setup and device acceptance are independently complete.

## Implemented boundary

- Firebase Messaging is pinned through Android BoM **35.1.0** (Messaging **26.0.1**); Google Services plugin **4.5.0** is only applied when explicitly enabled. The native minimum API 24 meets the SDK minimum. Dependency resolution/Android compilation are separate verification requirements.
- `NavrangMessagingService` accepts only the existing server's HTTP v1 **data-only** envelope: UUID `eventId`, UUID `bindingId`, and a nonnegative JavaScript-safe integer `revision`. Unknown fields, notification payloads delivered to the callback, malformed IDs, and messages over 60 seconds old are rejected. The server transport uses a 30-second TTL and normal priority; timely delivery is not guaranteed under Android background restrictions.
- FCM auto initialization, Analytics collection, delegation, and delivery-metrics export are disabled. Token retrieval is explicit and requires both the build gate and Android notification permission, plus a current active session. The existing notification permission control remains the user entry point.
- `PushReconcileJob` persists a network-constrained job with exponential retry. `PushCoordinator` refreshes server authority and binds the provider target through `notifications-device`. A new session or token rotates the binding. Raw provider/session tokens are never sent to JavaScript, logged, or saved by the integration. The binding and narrow unlink proof are encrypted with an Android Keystore AES-GCM key and excluded from cloud/device-transfer backup.
- Sign-out/identity change blocks local delivery immediately and preserves the unlink proof for `notifications-unregister` without an account token. Offline cleanup retries; failed cleanup is not reported as completed. Received messages must match the active binding, session fingerprint, and generation. Per-event revision dedup is persisted and bounded to 64 entries; revisions for different events may arrive out of order. It is a bounded duplicate-suppression window, not an unlimited history.
- An authorized notification-feed response removes Android alerts absent from the current five `activeIds`, preserving the separate pinned announcement. Durable receive/prune revision watermarks reject delayed feed snapshots older than any received alert, including after bounded dedup entries expire. The retained IDs also prevent a delayed older push from reposting an alert already removed by that feed. Authentication callbacks enqueue push reconciliation to avoid locking the session monitor and push monitor in opposite order. Job replacement preserves rotation/logout wakeups; stopped jobs check cancellation between blocking steps and cannot publish a successful active binding from a late response.
- OS notifications have generic title/body only, secret lock-screen visibility, an immutable explicit PendingIntent, and no remote text, names, ticket IDs, destinations, or URLs. A non-exported activity accepts the tap and queues only an opaque event ID. Opening the ready HTML view refreshes `me` and the authorized notification feed on both native and JavaScript sides. Removed/revoked events do not open; a push never joins voice, activates the microphone, speaks, or navigates to a remote URL.

## Deliberate compatibility constraint

Current Firebase documentation deprecates `getToken`/`onNewToken` in favor of `register`/`onRegistered` with Firebase Installation IDs. The repository's server transport currently supports only `legacyToken`. This implementation therefore uses the still-present legacy APIs and does **not** enable `firebase_messaging_installation_id_enabled`. An FID implementation is not complete until the server transport and native callback path are changed and tested together. Do not change the manifest to FID mode while retaining this transport.

## Idempotent registration and cancellation

Before any registration request, the client durably encrypts a monotonically increasing `registrationRevision`, unique binding ID and a random 256-bit unlink proof. Unknown responses retry the same tuple. The server hashes the proof and retains exact idempotency receipts in the existing private `notification_requests` table, without introducing new grants. A later-arriving older revision cannot overwrite a newer binding. The revision survives successful unlink and account changes.

Unregister writes a tombstone for the exact installation/binding/proof-hash/revision even when a registration is still in flight. Such an unauthenticated tombstone never advances the installation's authenticated revision watermark or blocks an unrelated proof. The unlink endpoint always applies its IP/global rate budget, including when a caller supplies a fabricated bearer. Exact tombstones expire after seven days; registration additionally rejects sessions issued more than twelve hours earlier, so an old authorized request cannot outlive retention. Accepted watermarks are retained while a device remains bound or a receipt's original session could still act. Locally, a stopped job or changed identity cannot activate a late registration response; its retained proof is queued for cleanup.

The migration source allows `notification_requests.event_id` to be null only for the reserved device/unlink receipt namespaces. Notification-send receipts still require an event. This is source only; no production migration was executed.

## Owner setup and acceptance

The project owner must supply `native-app/google-services.json` for the intended application ID, then explicitly set `-PnavrangPushEnabled=true`. The file is ignored by Git; no template with invented identifiers is provided. Internal builds use `in.navrang.gate.internal` and require a matching owner-registered client. The service account/workload identity remains server-only. The sender must remain data-only: Android may auto-display background notification payloads before the app callback, bypassing the application content filter.

Required independent acceptance: resolve the pinned dependencies and compile; verify merged manifest; real Android 13+ permission denial/grant/channel disable; foreground/background/process-death reception; provider rotation and late old-binding delivery; offline sign-out then restart/unlink; same-device account switch; session expiry/revocation; duplicate/reordered delivery; lock-screen privacy; tap after logout, revocation, role change, pruning and process recreation; disabled build with no provider traffic. No physical-device or provider-delivery pass is claimed here.

## Local checks

`python tests/native-push-policy-check.py` compiled and executed the production pure Java validation/dedup/pruning policy: **37 checks passed**. The targeted notification UI, tap, contract and routing tests passed **85 tests**, including a fabricated-bearer rate-budget regression. PostgreSQL fixtures include exact retry receipts, older request arrival, precommit cancellation, old-proof cleanup, same-revision conflict and unrelated-proof high-revision tombstone attacks. These are synthetic checks, not Android service lifecycle, keystore, JobScheduler, Firebase transport, or hardware evidence; consult the final task evidence for PostgreSQL and Android build outcomes.

## Official references (reviewed 2026-10-25)

- [Android release notes and pinned versions](https://firebase.google.com/support/release-notes/android)
- [FCM Android setup, permission, registration and rotation](https://firebase.google.com/docs/cloud-messaging/android/get-started)
- [FirebaseMessaging APIs and legacy/FID mode restriction](https://firebase.google.com/docs/reference/android/com/google/firebase/messaging/FirebaseMessaging)
- [FirebaseMessagingService callbacks and execution window](https://firebase.google.com/docs/reference/android/com/google/firebase/messaging/FirebaseMessagingService)
- [Data versus notification delivery behavior](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)
