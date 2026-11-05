# Navrang local relay feasibility

Protocol first: [PROTOCOL.md](PROTOCOL.md). Review and remaining blockers: [DEPLOY-PLAN.md](DEPLOY-PLAN.md). This is an isolated original server package; no live app files were changed. Sole integration owner: `01a17125-ef68-704d-b8ee-504240b680d3`.

Run dependency-free tests with Node24: `node --test test/*.test.mjs`. Runtime test: `node test/emulator.mjs`, reusing task-5's pinned existing Miniflare/workerd. Start-Local.ps1 reuses its Wrangler with a fresh isolated config directory and loopback-only binds. No verifier is configured, so the production route fails closed. The test-only runtime harness does not verify auth and must never be deployed; production main is src/worker.mjs and does not import tests.

Server: per-room SQLite DO, hibernation attachments, external Ed25519 JWT verifier, persistent single-use reconnect identifiers and role versions, immutable15s leases, binary envelope/sequence/rate/bounds checks, no audio persistence,8-listener fanout, one inflight frame credit and256KiB lifetime outbound budget per socket. Alarms only clean up. Metadata snapshots remain in SQLite; the app integrator should define an approved metadata-retention policy before any deployment. Removing a room's replay/epoch history while authorizations remain valid is unsafe.

No credentials or usable tokens were read or created. Synthetic tests do not establish live Opus acceptance, real Android playback cutoff, production quota capacity or unconditional physical deadline enforcement under Cloudflare's frozen-in-event clock. No cloud deployment was performed.

Quota revision: see QUOTA-REPORT.md. No per-frame/ACK SQLite writes. Every actor reconstruction retires the active grant; a new explicit grant/epoch is required. Recovery behavior changes, while binary/control wire schema remains unchanged.
