# Restricted database adapter recovery

The complete latest historical source archive was unavailable. This recovery starts at verified archive commit `b70be8dc881a6b914ac3ceb7625a1784685ff144`; it does not claim to reproduce historical `bedf9e3` byte for byte.

## Restored approval-bound SQL

The exact two reviewed SQL files were recovered and hashed before being added to this tree. They were initially restored without production changes; after explicit approval, both were applied and independently verified on 2026-11-05 as recorded below.

| File | Bytes | SHA256 |
| --- | ---: | --- |
| server/voice-worker-boundary-v1.sql | 7398 | 8f2e52420c65456e3cd1b50233f560434427074dc63273306da8f28ea2a02102 |
| server/notification-bridge-v080.sql | 7896 | 816034a20886322ef8d55db333bd121d217d9dcb1f5fb6c34d18b0a4db0a5c30 |

The proposed roles cannot log in and have no private-schema usage or membership in the existing service role. They receive usage/execute only on the named wrapper schemas. Wrapper ownership is transferred to the existing non-login service role; temporary schema CREATE is revoked before commit. Existing role/schema names and unsafe prerequisite privileges fail closed. No password, key, public function, notification send or activation flag is created.

Each migration has its own transaction. If the second fails after the first commits, the first can remain installed. Inspect the actual result before retrying; do not treat name conflicts as permission to adopt existing objects.

## Recovered application adapters

- Cloudflare actor operations use only `navrang_voice_worker_api.actor(text,jsonb,text)` with the existing hashed actor token and the sixteen reviewed action names.
- Cloudflare cleanup uses only `navrang_voice_worker_api.controller(text,jsonb)` and its six lifecycle actions. It cannot call the legacy Daily acknowledgement.
- Cloudflare notification delivery uses only `navrang_notification_bridge.claim`, `check_delivery` and `finish`.
- Release authorization hashes the raw app bearer and accepts only literal `true` from `navrang_notification_bridge.is_active_admin`. Full actor records no longer cross this connection.
- Legacy standalone/Daily adapters remain separate. Missing wrappers or denied privileges fail rather than switching roles or falling back to private functions.

The notification claim wrapper intentionally does not acquire a new config-row lock before calling the legacy claimant. The original claimant prunes receipts before updating configuration; an opposite lock order could deadlock during a brief overlap with a drained legacy worker. Delivery flags are rechecked before leasing. A send already in flight cannot be recalled.

## Current validation and limits

On 2026-11-05, the focused adapter/integration suite passed 51 tests, including seven new regressions for exact fixed SQL, action scope, no fallback, strict boolean authorization and approval-bound SQL hashes. The complete offline app suite passed 846 of 849 tests, with three existing optional fixture/Android-SDK skips and zero failures. Concurrency reconstruction was included in that run.

A fresh disposable PostgreSQL 17.11 cluster on the laptop passed the exact current five baseline SQL files and both reviewed boundary migrations. Seven baseline suites, eleven failure/rollback cases, wrapper ownership/ACL/search-path checks, disabled defaults, direct-private/SET-role denials, sixty-four voice allowlist/input assertions, twelve notification invalid-input cases, strict boolean-admin checks and an actual two-connection legacy/new claimant lock overlap passed. Both repeat migrations were rejected atomically. The test cluster was stopped after the run. These are local fixture results, not evidence of production deployment.

Both Cloudflare packages also passed fresh local-only Wrangler 4.152.0 dry-run bundling: voice 327,335 bytes, notifications 255,722 bytes. Activation flags remained false; no database binding or credentials were added.

After explicit action-time approval, the two exact migrations were applied to project `mzesveurjzxjybkejqmx`: `20261105082055_navrang_voice_worker_boundary_v1` and `20261105082141_navrang_notification_bridge_v080`. Each returned success, its migration history entry was verified, and each scope was checked before moving on. All six installed wrapper body hashes exactly match source; intended roles, owners, search paths and ACLs pass. Both capability roles remain non-login/non-admin, with no direct private-schema access, service-role membership or CREATE permission. Public client roles have no execute permission. Notification center/delivery remain false. The post-change security advisor reports no new finding relative to the baseline (private service-only RLS/no-policy information and the pre-existing Auth leaked-password-protection warning remain).

This applied boundary step creates no password or operational connection. Credential creation, Hyperdrive, issuer/Firebase secret binding, Worker deployment/activation, device installation, signing and publication remain separate gates. See `production-boundary-evidence-2026-11-05.json` for verified metadata.
