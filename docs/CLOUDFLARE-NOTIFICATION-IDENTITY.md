# Non-Compute notification identity proposal

Target the same existing Cloudflare Free account as voice. Do not provision a paid Compute host merely to satisfy the current metadata-token adapter. No project, account, key, IAM grant, secret or live sender is created by this plan.

The existing FCM HTTP v1 transport accepts a short-lived OAuth token provider. A Cloudflare implementation can use an explicitly approved existing Google service-account RSA signing key, imported into Web Crypto as non-extractable, to sign a bounded OAuth assertion and exchange it only at Google's fixed token endpoint. Scope must be exactly `https://www.googleapis.com/auth/firebase.messaging`; the target project is server-owned configuration. Cache only the short-lived access token in memory, refresh before expiry, reject redirects, bound response sizes/deadlines, redact all errors and never send credentials to the app. The issuer for voice uses a separate Ed25519 key and must never be reused for FCM or Android signing.

This is an implementation proposal, not permission to create or import a key. First read-only inventory must identify an existing owned Firebase project, matching original `in.navrang.gate` Android client, authorized service account, existing suitable key/custodian, and its current FCM permission. If no existing key is available, present exact creation/custody/rotation and IAM changes for approval. Do not silently fall back to a downloaded key or invent Cloudflare-native Google workload identity. Keyless federation is an alternative only after identifying a real external identity provider and reviewing its Google trust configuration; none is currently configured or assumed.

After identity selection, implement the token-provider adapter and synthetic exchange tests, compose the existing outbox dispatcher in a bounded scheduled Worker/DO invocation using uncached private PostgreSQL access, and compose the existing public release-hint sender with an explicit authorized trigger. No endlessly running Node loop is assumed on Workers. Preserve SQL delivery flags default false, actor/audience rechecks, token invalidation, retry leases and bounded batches. Provider acceptance remains distinct from phone delivery.

Required live approvals are specific: existing key import into one named Worker secret, any necessary FCM IAM change, exact project/Android configuration and sender scheduling/activation. Keep all account plans Free and fail closed when quotas are exhausted. Before enabling delivery, complete original-app/original-signer device tests for permission, background delivery, token rotation, unlink/logout, account switching and stale/reordered messages. No separate app or replacement signer is proposed.

Primary references:
- https://firebase.google.com/docs/cloud-messaging/send/v1-api
- https://firebase.google.com/docs/cloud-messaging/server-environment
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
- https://developers.cloudflare.com/workers/configuration/secrets/
