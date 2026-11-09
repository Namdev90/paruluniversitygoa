# Current Cloudflare relay candidate review

Updated 2026-10-26T03:35:54+00:00. This section supersedes the older31-test snapshot and its per-frame SQLite quota warning below. No relay code was applied to the app or deployed.

Current ZIP SHA256 verified: e73ade9bd7f12dbb7b0202e2bc67751a00d6710de040e0055379ea3709cdba79. Parent/worker reports42local tests passed; root reviewed currentQUOTA-REPORT.md/PROTOCOL.md and did not independently rerun those tests.

Frames and ACKs now use zero SQLite writes; reconstruction durably retires any active grant and requires a greater epoch. The obsolete baseline actually had1+2L writes/frame (ACKs included),850rows/sec at8listeners, not450. The old exhaustion warning is historical and must not be used as the current result.

Current remaining resource limit: request accounting, not that old write hot path. Under50fps,80-byte payload, ACK-per-frame,15sec grants,30sec fresh-authorized reconnections and20%headroom, the worker models about58.2cumulative room-minutes/day at8listeners. That is an assumption-based account-wide model, not production capacity or a promise; CPU, larger Opus packets, abuse, other apps and reconstruction can reduce it. Eight listeners remains a prototype test cap, not an approved product limit.

Mid-lease admission now sends ready then the unchanged active grant; discovery cannot renew deadline/epoch or sender sequence. A late listener may first see sequence>1 and must reset decoder/jitter on gaps. This must match the Android adapter. Real Opus/clock/queue acceptance, positive authorized JWT handshake, issuer/app-role mapping, reconnect experience and free-budget performance remain open. Clock behavior is still a physical-time proof gap, not a demonstrated deployed Cloudflare failure. No unconditional cutoff guarantee is claimed.

## Historical review retained for traceability (superseded where noted)

# Cloudflare relay candidate integration review

Checked 2026-10-26T03:15:20+00:00. REVIEW ONLY. No prototype code applied to the app, provider action, deployment, credential/token creation, new build or live-media test.

Artifact SHA256: {"navrang-relay.zip": "2e1c1d67b4e80a855986fd9267b402eb5da69585f1ac974ab4ec542130fe05a6", "navrang-relay.patch": "c7cf51ac48d4b1bcad546128ac0a560d85937fef4bbd9db42f62419be8b2ffe6"}
Reference-only source hash comparisons: {"LICENSE": true, "THIRD-PARTY-NOTICES.md": true, "package.json": true}. The package copies no app source and declares all deliverable paths new. A target directory and absence/hash checks are still required before any integration; do not blindly apply a root-relative patch.

Read PROTOCOL.md, TEST-REPORT.md, DEPLOY-PLAN.md and CLOCK-EVIDENCE.md. Candidate reports31 Node tests, local workerd/SQLite synthetic integration and dry-build passes. Root did not independently rerun those tests or verify a positive signed JWT handshake. Existing app acceptance results remain the previously reported600 source/250 Android/183 responsive results; they are not transport acceptance.

## Integration gates

* External Ed25519 issuer is absent. Claims bind room, subject, role, authVersion and single-use jti; <=300sec token life. Existing app opaque sessions, duty/access changes and server floor authority must map to this contract. No new issuer/private key is authorized yet.
* Prototype caps each room at1controller,1speaker,8listeners,4096 replay tombstones,50frames/sec. These are feasibility bounds, not an accepted production user-capacity decision. Role transitions, fresh authorization/reconnect and administrator preemption must be integrated with the existing workflow.
* Codec1 is Opus mono48kHz/20ms. Synthetic bytes are not codec/media acceptance. Android's adapter owner must verify capture/encode/decode support across supported API/ABI devices, sequence resets, deadline synchronization and hardware queue clearing. Do not claim API24/all-ABI voice from current mocks.
* Worst-case storage calculation in DEPLOY-PLAN:9metadata writes/frame*50fps=450rows/sec. Free100000rows/day can therefore run out in roughly222seconds at maximum fanout before other traffic. This is a documented-source calculation, not a measured cloud-quota event. The durable hot path needs optimization/load evidence and fail-closed account-wide budget behavior before a practical INR0 claim.
* One unacknowledged frame/listener and256KiB lifetime outbound budget bound enqueueing, not audible playback. ACK is not proof the buffer was heard/cleared; high payload rates may close a socket within15sec. Reauthorization capacity and audio discontinuities need acceptance.
* Clock nuance: official timers advance after I/O, so they can be frozen during I/O-free synchronous execution; they are not proven frozen for an entire event. The docs do not establish this handler's behavior across OS suspension or every synchronous SQLite/attachment boundary. No deployed suspension failure was reproduced. The current issue is a physical-time proof gap, not a demonstrated Cloudflare platform bug. Local frozen-clock tests demonstrate algorithm dependence only.
* Observed-clock immutable lease checks and post-bookkeeping recheck are useful. Alarms remain cleanup. No unconditional last-byte/last-audible hard deadline is accepted without appropriate runtime evidence plus Android queue tests. Do not weaken the existing relay/lease/watchdog requirement silently.

## Next bounded work

Parent owns the isolated Cloudflare/native-adapter implementation. Coordinate protocol changes there, reduce per-frame durable writes while keeping restart/replay fail-closed, add positive local-only auth fixtures only within explicit test-token permission, and test real codec/clock/queue semantics without real people. Integrator then reviews source hashes and runs combined app regressions. Existing app's fail-closed voice flags stay false. No accounts/billing/credentials/deployment or phone actions are authorized by this review.

Packaging remains: current Daily diagnostic universal38.55MiB fails old25MiB limit and x86 lacks Daily native library. A validated replacement transport could change final dependencies/size, but no dependency was removed and no feature was omitted here. Final original-key signing/metadata/version/installed-data upgrade and physical acceptance remain release gates.
