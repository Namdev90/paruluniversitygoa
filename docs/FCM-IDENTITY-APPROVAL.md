# Specific FCM identity decision (no live action performed)

The offline OAuth provider is implemented in server/voice/fcm-oauth.mjs. It accepts an already imported non-extractable RSA/SHA-256 signing CryptoKey, service-account email and key identifier; construction performs no network or import. It signs a five-minute OAuth assertion, exchanges it only at https://oauth2.googleapis.com/token with scope https://www.googleapis.com/auth/firebase.messaging, uses a bounded short-lived in-memory token cache, and never stores or logs key/token data. This is not a working deployed identity until the following values and permissions are independently verified.

## Recommended zero-cost selection

Use the existing Cloudflare account and an EXISTING owned Firebase project/service account/key if one exists. Do not create a Compute host solely to satisfy the old metadata adapter. First identify project ID, original Android package in.navrang.gate, service-account email, existing key ID/custodian and current target-project IAM permission using metadata only. No Firebase connector is currently available to establish these facts. No suitable existing key has been verified; existence must not be assumed.

## One bounded approval after identifying existing material

May I import the identified existing service-account RSA key into one named notification Worker secret FCM_SERVICE_ACCOUNT_KEY (never the Android signer or Ed25519 voice key), configure only the identified service-account email/key ID/target FCM project, and use it to obtain short-lived OAuth tokens for sending notifications to that project? Keep scheduled delivery disabled until separate synthetic/provider/device acceptance. Present the exact Worker name, project, principal and key ID before this action; those operational values are not invented here.

Risk: possession of that key allows impersonating its service account for every permission it already has, not merely the OAuth scope selected by this adapter. Inspect and report existing IAM scope before import. Do not import a broadly privileged account under this proposal. Limit the target-project sender permission to cloudmessaging.messages.create where a supported custom role already exists, or separately approve the exact narrowly scoped role creation/binding. Google's documented predefined alternative is Firebase Cloud Messaging API Admin (roles/firebasecloudmessaging.admin); inspect its actual permissions before proposing it, because it includes more than message sending. No Editor, Owner, Firebase Admin, domain-wide delegation, billing role or unrelated data access is approved.

## If material is missing

An existing key import does not authorize new identity/key creation. Request a distinct action-time decision to create a dedicated notification service account in the named existing Firebase project, assign the reviewed sending permission only, create one RSA key, transfer it directly into the named Cloudflare secret, and establish a named custodian, revocation and rotation process. Never paste the private key in chat, source, artifacts or logs. No new project, billing plan or card may be created. If the project itself is absent, present project creation as a separate exact scope rather than silently assuming it.

Keyless federation is preferable only if an actual external issuer and Google Workload Identity pool/provider already exist or their exact trust setup is separately approved. Cloudflare hosting by itself is not a configured Google workload identity. Do not invent a federation issuer or grant token-creator access broadly. Existing Google Compute metadata identity remains usable only on an already authorized zero-cost workload; this plan does not provision one.

## Remaining code/acceptance

The bounded Cloudflare scheduled dispatcher, SQLite quota and authenticated public release-hint trigger are composed offline in server/cloudflare-platform. The checked-in Worker has no cron, public route or operational bindings and remains disabled. Actual uncached private SQL, verified FCM identity, original public signer certificate and provider/device acceptance remain separate live gates. Preserve current outbox leases, audience rechecks, invalid-token handling and disabled flags. Before activation, verify provider acceptance and ORIGINAL-app/ORIGINAL-signer device delivery, permission/channel behavior, token rotation, unlink/logout, account switching and stale/reordered messages. No separate app or replacement signer is proposed.

Primary references:
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://firebase.google.com/docs/cloud-messaging/send/v1-api
- https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging
- https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
