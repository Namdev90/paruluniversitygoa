# Volunteer locator implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline. Resume from the ledger and preserve the existing dirty branch.

**Goal:** Add transparent, one-person duty/find-me features without unrelated mandatory permissions.

**Architecture:** Strict Edge request contracts route to one service-only invoker RPC over private tables. A focused client controller owns consent, request state and foreground one-shot actions. Existing FCM carries only invalidation identifiers, never coordinates.

**Tech Stack:** PostgreSQL, existing Supabase Edge JavaScript, existing WebView UI and Android location/system settings.

**Spec:** docs/superpowers/specs/2026-10-25-volunteer-locator.md

## Global constraints

Single event O9KL3; assigned admin only; separate default-off opt-ins; one-hour duty; two-minute request/fix visibility; no history/background tracking; no real sends, credentials, deployment or new client grants.

## Review focus

Replays and concurrent targets must not repeat alerts or extend expiry. Renewal must not expand identity scope. Logout/account revocation must remove access. A late location callback must fail after Stop/lock/identity change. Declining permissions must preserve registration/scanner work.

### Task 1: contract and private SQL

Files: server/functions/navrang-gate/locator-contract.mjs, security.mjs, index.ts; server/locator-v090.sql; server/tests/locator-contract.test.mjs, locator-routing.test.mjs, locator-db.sql.

Interfaces: isLocatorAction(action), validateLocator(action,payload); public.navrang_locator(p_action,p,p_token), existing navrang_private.resolve_actor(p_token).

- [ ] Write/run rejection tests for actor/target injection, invalid coordinates/time, stale consent/version and multiple targets.
- [ ] Implement strict canonical contract and dedicated hashed-bearer routing; verify isolated HTTP fixtures.
- [ ] Write rollback SQL assertions for assignment, own writes, Stop/revocation, one active target, replay/cooldown, expiry, retention and anonymous denial; watch fail before creating schema.
- [ ] Implement private schema/RPC and run real disposable PostgreSQL fixtures, including concurrent requests. Preserve production untouched.

### Task 2: disclosure and request UI

Files: app/assets/locator.js, locator.css, index.html, gate.js; tests/locator-flow.test.cjs.

Interfaces: NavrangLocator.create({api,root,profile,onShareOnce,onSound,onBright}); updateProfile(profile), refresh(), destroy(). No private state survives destroy/role loss.

- [ ] Write/run DOM tests for separate opt-ins, decline, one-person selection, truthful states, expiry, rapid navigation and role loss.
- [ ] Implement accessible burgundy/gold controls and register after login; no automatic location/sound/fullscreen action.
- [ ] Verify keyboard, reduced motion, large text and short screens using synthetic fixtures.

### Task 3: native actions and efficient delivery

Files: native-app/src/main/kotlin/in/navrang/gate/NativeLocator.kt, MainActivity.kt; notification/update policies and focused host tests.

Interfaces: one foreground request-bound fix; ordinary short sound; foreground bright screen; settings/readiness. Every asynchronous result checks current identity, request, consent, expiry and unlock.

- [ ] Test denied/revoked permission, Stop/lock/process loss, duplicate notification, stale callback and no location leakage.
- [ ] Implement contextual one-shot location without background permission and route notification invalidation only to the current authenticated recipient.
- [ ] Run aggregate source/native/Android checks. Keep live readiness false and record device/provider/deployment gates.
