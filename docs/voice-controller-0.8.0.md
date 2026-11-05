# Voice controller source checkpoint

Checked 25 October 2026. This is staged source, with local synthetic tests only.
Voice remains unavailable to public callers. No relay credentials, live audio,
production database changes or deployment were used for this work.

## Implemented

`server/voice/controller.mjs` runs a persistent one-second reconciliation loop.
It obtains an exclusive controller lease, reads a bounded durable removal batch,
sends strict relay removals, and acknowledges each command only after the relay
accepts revocation. A failed request or missing acknowledgement leaves durable
work for the next iteration. It never publishes audio, creates a grant, or
automatically upgrades transport acceptance flags. Status is `CLEANUP_ONLY`,
`STANDBY`, `PARTIAL`, `DEGRADED`, `BUSY`, or `STOPPED`; none means voice is ready.

Each request and cycle has a bounded deadline. Iterations never overlap. A
shutdown signal aborts pending requests and attempts to release ownership.
Abrupt termination must instead be handled by database ownership expiry and an
independent media fence. Diagnostics contain status and counts only.

The entry point is `server/workers/voice.mjs`, using the worker package's pinned
PostgreSQL dependency. It expects private process environment configuration:
`NAVRANG_VOICE_CONTROLLER=enabled`, `NAVRANG_WORKER_DATABASE_URL`, `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. The existing database login must
already have usable service-role privileges. No role switch or access grant is
performed by the process. It is intended for a
persistent process supervisor. It is not a scheduled Edge Function: Supabase
documents finite worker lifetimes of 150/400 seconds and a two-second CPU budget.
See [Supabase Edge Function limits](https://supabase.com/docs/guides/functions/limits).

The Cloud adapter signs receive-only credentials and uses strict token cutoffs
for removal. Publishing and renewal remain unavailable. See
[the relay boundary and official references](voice-relay-boundary-0.8.0.md).

`voice-control.mjs` now requires a valid server lease before any grant, then an
exact relay-enforced lease receipt containing the same lease ID, generation,
and expiry before committing. A bare permission-update success cannot commit.
`voice_ready()` now also requires `lease_enforced` and `worker_death_verified`;
both default to false. A recent database heartbeat alone cannot enable voice.

## Existing private database boundary

`server/workers/voice-store.mjs` uses one fixed, parameterized PostgreSQL call to
the existing `navrang_private.voice_rpc(text,jsonb,text)` function. Its internal
controller actions require an empty application bearer and existing usable
service-role privileges, checked with `pg_has_role(current_user,'service_role',
'USAGE')`. The function remains `SECURITY INVOKER` with an empty search path and
its original access grants. No public endpoint, role, permission statement or
application action is added. Existing public voice actions retain their 503
response. Production deployment and the existing connection's configuration
remain separate operational gates.

The implemented internal protocol is:

| Action | Input | Required behavior |
| --- | --- | --- |
| `controller-claim` | `controllerId` | Atomically acquire/renew a five-second exclusive ownership lease; reject a second live owner |
| `controller-poll` | `controllerId` | Require current ownership, run existing expiry checks and return at most 32 durable revoke commands plus `more` |
| `controller-ack` | `controllerId`, `commandId`, `generation` | Require current ownership and exact command generation; record strict relay acknowledgement using the existing private helper |
| `controller-heartbeat` | `controllerId` | Record successful cleanup/liveness; never write media acceptance flags; ambiguous failed grants keep readiness false |
| `controller-release` | `controllerId` | Clear only this owner's lease and worker freshness |

All operations share the existing voice advisory transaction lock and use
database time after acquiring the lock. An expired owner cannot acknowledge work
or extend freshness. Only the current owner can release its lease. Heartbeats
follow successful complete cleanup cycles; new work arriving concurrently is
processed in the next cycle without invalidating an otherwise healthy grant.
Ambiguous grant quarantine and independent media acceptance remain mandatory.
Provider credentials belong only in the server process.

Automatic approval review rejected the proposed source patch that included the
endpoint's database privilege statements. The patch was not applied, and the
endpoint or privilege changes were not retried. The narrower alternative was
then explicitly authorized: reuse the existing private function and existing
database permissions without adding a public route or modifying privileges.
The unused HTTP adapter was removed. The original ten explicit function access
statements remain unchanged; the controller has no dependency on the rejected
endpoint. This records the rejection rather than treating it as approval.

## Acceptance still required

Local tests cover strict removal ordering, failure/retry, contention, deadlines,
cancellation, persistent iteration, redacted errors, token TTL/signatures and
fixed authenticated transport. Disposable SQL coverage includes unprivileged
execution rights, public action rejection, ownership takeover, stale-owner and
generation rejection, and heartbeat/media safety separation. These checks do
not prove provider behavior.

Operational acceptance needs deployment with the existing authorized database
identity, an owner-controlled relay, a relay-owned generation/deadline fence that prevents late grants after
expiry, and isolated tests of both active-media termination and token replay
after controller death, network loss, logout and role revocation. Native audio
service/client integration and two-device checks remain pending. Neither token
TTL nor an external watchdog that merely sends a later removal satisfies the
late-grant race. No release-readiness result is claimed here.

The secret-free readiness checker also requires explicit `leaseEnforced`,
`workerDeathVerified` and `lateGrantRejected` evidence. It rejects self-hosted
TTL-only revocation and Cloud token lifetimes over 600 seconds. Its input flags
must summarize recorded acceptance tests; running this checker does not produce
that evidence.

The remaining owner decision is the strict media enforcement target: an
owner-controlled relay with a documented atomic grant/generation/deadline API,
or a separately reviewed custom relay/gateway implementation that can provide
the same behavior. Selecting stock LiveKit Cloud alone does not satisfy this
requirement. Native voice integration depends on that protocol selection; no
microphone service, live media test, hosted service commitment or new provider
account has been created as part of this checkpoint.
