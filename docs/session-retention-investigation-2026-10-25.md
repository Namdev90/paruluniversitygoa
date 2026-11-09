# Session retention investigation

Priority: repair repeated sign-outs before locator/update-policy implementation. Work is local; no server TTL, grant, credential or production deployment change.

Verified live read-only metadata: current navrang-gate v7 has verify_jwt=false; both stored administrator and checker sessions have 12-hour lifetimes. Android uses the existing AndroidKeyStore AES/GCM encrypted preferences and restores that credential after process death. Browser credentials remain tab-scoped sessionStorage; moving them to plaintext persistent storage is not an approved remedy.

Verified client defects to reproduce: all 401 responses erase the current credential without distinguishing infrastructure/gateway errors; gate.js calls full sign-out every 100ms when the device wall clock considers expiresAt/accessExpiresAt passed. Clock skew can therefore revoke a still-valid session. Also inspect recovery when the keystore is temporarily unavailable and an unchanged server profile is not republished.

Do not claim these caused the user's particular incident without device evidence. Maintain definitive server expiry/revocation, explicit durable logout, account changes and stale-response generation fences. No automatic renewal exists for these opaque sessions; inventing a long-lived refresh credential or changing TTL is outside this fix.

Progress: reproduced and fixed uncertain-401 deletion, wall-clock-triggered full logout, and native renderer recovery when a successful unchanged profile was not republished. The focused client/UI run passes 32 tests; real encrypted GateSession passes 125 checks; real GateRuntime passes 32 race/recovery checks. Native tests/lint are running after fixing local Gradle IPC/interpreter setup and fetching missing public AndroidX dependencies. Full source verification must be rerun after updating the old test that required automatic logout.

The interrupted locator design/plan/progress files and UpdateCheckPolicyTest.kt were verified absent, and update-cadence-red.log did not exist. Prior sleep flag removed before restoring a new active-session inhibitor. New inhibitor marker reports process 5168; cleanup required at work end.

## Stay-signed-in proposal — approval required, not implemented

There is no Navrang refresh action/schema. server/schema.sql session-create issues a custom opaque bearer and stores its hash with a 12-hour expiry; server/functions/navrang-gate/handler.mjs creates that session for admin and checker login. Google exchange is only identity bootstrap; its Supabase refresh path does not renew this separate Navrang session. Do not store the user's password/code to replay login.

Proposed for both admin and volunteer roles: 15-minute access sessions, a device-bound rotating refresh family with a 7-day inactivity limit and 30-day absolute limit. Volunteers also stop at their existing staff-access deadline; assignment/access revocation is rechecked on every renewal. Android stores the existing and new session secrets only through the established Keystore-encrypted mechanism. For browser persistence, use a secure HttpOnly cookie design and CSRF controls; do not move raw tokens to localStorage.

Renewal would be serialized on-device and atomic on the server; store token hashes, rotate each successful refresh, allow only a narrowly bounded same-request retry receipt, and revoke a token family on out-of-window reuse. Logout revokes that device family and its access sessions; administrator password/security changes revoke relevant families. Explicit logout and uninstall remove the local credential. Short access tokens alone do not guarantee immediate revocation: existing server-side session/capability checks remain required.

The 7/30-day values are a proposal, not an existing entitlement or OWASP requirement. A compromised unlocked device could retain access longer than today's 12-hour session. Introducing refresh families, retry receipts, a renewal action and longer persistent access is a server security change requiring explicit approval and migration review. No TTL, grant, persistent refresh credential or production schema has changed.

Reference: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html (server-enforced idle/absolute limits and session renewal/invalidation principles).
