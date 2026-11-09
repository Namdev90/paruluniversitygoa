# Exact clock evidence and smallest next proof

Verified against official Cloudflare docs on2026-10-26. No cloud experiment or deployment was performed.

## What Cloudflare documents

[Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/), section `performance.now()` (retrieved lines596-616), says that deployed timer APIs including Date.now and performance.now **“only advance or increment after I/O occurs.”** The same section demonstrates an I/O-free synchronous loop whose start/end timestamps are identical, and states that local development timers advance without I/O.

Thus Date.now is frozen during I/O-free synchronous execution. It is not necessarily frozen for an entire event: I/O within an event can advance it. Replacing Date.now with performance.now does not address this documented behavior.

The documentation does NOT specify what happens to the timestamp after an OS-level suspension/resumption inside such a synchronous section. Our handler also performs synchronous SQLite and WebSocket attachment operations; the cited page does not specify whether each such operation refreshes the timestamp. We have not measured those boundaries in deployed Workers and do not claim a reproduced Cloudflare suspension failure or an established stale timestamp on this forwarding path. Earlier wording that a suspended production handler definitely resumes with stale time was too strong. The supported conclusion is a proof gap: per-send Date.now reads alone do not establish a physical elapsed-time bound through all pauses.

## Local targeted proof and correction

`test/clock-proof.test.mjs` holds the injected observed clock constant while actual Node monotonic time exceeds a short authorization-capped lease. Synthetic bytes are still forwarded because the observed clock remains before expiry. This expected model test demonstrates the algorithm's dependency on observed clock progress; it is not evidence of a specific deployed Worker pause behavior.

One concrete local boundary bug was corrected: src/core.mjs now rechecks current grant/roles/deadline immediately after final attachment bookkeeping and immediately before binary send. A new regression advances the injected clock to the deadline during that bookkeeping and verifies zero forwards plus release of unsent listener credit. This reduces the check-to-send window but does not create a production wall-clock guarantee or change PROTOCOL.md.

## Smallest further proof required

For the existing **observed-clock** contract, the current local tests provide evidence; no broad rewrite is needed. For a strict physical deadline under arbitrary runtime suspension, obtain an authoritative Cloudflare guarantee about timestamp refresh on resume/event dispatch or a supported authoritative elapsed-time source usable at the forwarding boundary. A production-runtime timing probe could add evidence only after separate authorization; no local workerd test can establish the documented production clock behavior because local timers explicitly differ.

A potential mitigation is an awaited, documented I/O boundary before final authorization/deadline validation. It would require rechecking immutable grant identity, roles and expiration after the await to address interleaving. Merely adding a Promise/microtask, a zero-duration timer, an alarm or another Date.now call is not a proven physical cutoff. Even a successful I/O probe would not by itself bound an arbitrary pause between final check and send. Do not present any of these as an established fix.

The test result addresses enqueue/forward decisions only. Absolute last audible playback additionally needs Android synchronized-time enforcement and decoder/jitter/hardware output queue tests. No server clock change can retract bytes already accepted into network or playback buffers.
