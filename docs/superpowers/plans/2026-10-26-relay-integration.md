# Relay Integration Implementation Plan

**Goal:** Integrate current async relay code into the app's owned native boundaries, preserving fail-closed activation.
**Architecture:** Task9 async ports + monotonic bounded clock + app-owned runtime, with existing authority interface and explicit lifecycle forwarding.
**Tech Stack:** Java8/17, Kotlin, Android API24 minimum, Node24, PostgreSQL17.
**Spec:** ../specs/2026-10-26-relay-integration-design.md

## Global constraints
No original snapshot edits, credentials, live provider activation, security changes, signing or publication. Preserve minSdk24 and package/release identity. Missing protocol/clock/device acceptance stays blocked.

## Review focus
- No trusted clock before join must allow configuration discovery, never socket/media admission.
- Expired/rollback/overflow clock samples stop operations; no wall-clock fallback.
- Logout/background/close fence async callbacks before cleanup.
- Unsupported encoder prevents publisher floor acquisition while preserving receive capability.
- Same-binding credential refresh must not revoke an active relay handle.

## Tasks
- [x] Import exactly eight task9 production files and retain provenance and separate baseline commit.
- [ ] Test RelayClock missing/stale/bounded/rollback/overflow behavior, observe expected failing test, implement minimal clock, rerun.
- [ ] Port both old synchronous test files into async contracts (separate test owner, no overlapping product writes).
- [ ] Test and implement lifecycle/configuration/capability app composition and NativeRelayRuntime.
- [ ] Test actual encoder capability selection on API24/28/35; preserve fail-closed unsupported path.
- [ ] Run affected and aggregate Node/native/relay/Android suites; review final diff independently.
- [ ] Run isolated official PostgreSQL fixtures; verify optional SDK/ABI sizes and updater compatibility.
- [ ] Preserve final source, patches, exact commands/results and external activation blockers.
