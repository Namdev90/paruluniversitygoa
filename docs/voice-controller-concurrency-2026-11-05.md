# Voice controller concurrency recovery

Reconstructed and checked locally on 5 November 2026 from the recovered
`b70be8d` source checkpoint. This is a new tested repair, not a claim that the
unavailable later historical commit was recovered byte for byte.

## Corrections

- `server/cloudflare-platform/owner.mjs` shares one in-flight cleanup result
  between concurrent requests and alarms. Previously an overlapping call
  returned `BUSY`, cleared the worker freshness timestamp, and could dispatch a
  request before the actual cleanup had completed. Successful cleanup updates
  freshness once; real failures still clear it. A rejected cycle releases its
  slot so later work can retry. Results are bound to the runtime that started
  them, so a late old-runtime result cannot overwrite replacement freshness or
  detach the replacement's pending cleanup.
- `server/voice/cloudflare-controller.mjs` reserves the room exchange slot
  synchronously before dispatching its bounded asynchronous operation. Two
  same-turn callers could previously both pass the empty-slot check and send
  uncorrelated requests, replacing the first receipt consumer. Contention now
  rejects the second request without damaging the first; the slot is released
  when that operation settles.

The existing disabled deployment flags, independent media qualification,
deadlines, exact receipt matching, actor authorization and cleanup-only status
semantics are unchanged. No production database, provider or device was used.

## Verification

Seven added regressions cover concurrent owner calls, both request/alarm
arrival orders, failed cleanup and retry, unexpected exceptions, old-runtime
completion and same-turn relay exchanges. Deterministic deferred responses
reproduced freshness clearing and duplicate sends before the repairs.

- Focused platform, voice controller, Cloudflare controller/runtime/service
  suites: **88 passed, zero failures or skips**.
- `node --test server/tests/*.test.mjs server/relay-v1/test/*.test.mjs
  server/cloudflare-platform/test/*.test.mjs`: **500 passed, zero failures,
  one skipped** across 501 tests in the shared recovery checkout. The skipped
  optional Android branding compile requires an installed Android SDK.
- `git diff --check` for the repaired source and tests: passed.
- Runtime: Node.js 24.22.1. These are synthetic local checks, not Cloudflare
  deployment, live-media qualification, Android assembly or signed-release
  acceptance.
