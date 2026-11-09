# Locator ledger — plan: docs/superpowers/plans/2026-10-25-volunteer-locator.md

2026-10-25: Resume the original dirty branch; no repeated port or credentials. Existing user approvals cover this local implementation. Follow the approved disclosure/consent design rather than asking again.

Pre-flight: strict Edge contract -> service-only SQL RPC -> client controller -> contextual native actions. All share event O9KL3 and request UUID; private location never belongs in an FCM payload. Native callback acceptance also depends on session generation and current lock/consent.

Ruling: use a separate service-only invoker RPC and explicit event assignment rows, matching existing communications authorization. No automatic administrator assignment or new client grants; deployment remains gated. This must not be confused with the earlier denied public controller grant patch.

Task 1: local implementation and disposable database verification complete; production deployment is not performed.

17:20 UTC checkpoint: strict Edge contract/routing passed eight tests after observed unknown-action failures. Private service-only invoker SQL passed rollback fixtures for default-off consent, explicit event assignment, own duty/location, targeting, replay/cooldown, selected-person reads, Stop and active-account revocation. A new physical cleanup test failed on family logout; family/legacy-session retirement triggers then passed, along with coordinate expiry and24-hour metadata pruning assertions. No assignment or notification was created in production. Concurrent database verification and the UI/native tasks remain.

Ruling: roster responses contain no coordinates. An assigned administrator reads one selected volunteer through locator-view; location-only consent also allows an explicit voluntary Share once without opting into find-me. This preserves separate choices rather than making location consent depend on find-me.

Resumed checkpoint25October: the consent/request UI is wired into the original app and browser packaging. Native foreground one-shot location, named/time-bound identification and a short sound respecting Android quiet/DND settings are implemented. No background-location permission, forced full-screen intent or persistent brightness change is used. Tests use synthetic location/effects, not physical acceptance.

Integrated locator22/22 passed after correcting the synthetic WebView callback sink; the production WebView86+ gate remains. A real dialog test found retained private text; cleanup now clears it and cancels timers. Full Android240/240 and lint0 errors/44 warnings then passed. A later canonical-role-loss test found another native cleanup gap; the fix passed a focused60/60 group including app-lock, locator, bridge, find-me and role loss. A fresh full aggregate is required after that final change.

Private find-me notices now use the existing outbox and one recipient, contain no coordinates, distinguish queued/provider-accepted/device-acknowledged/found and invalidate only assigned-administrator metadata. Stop cancels actionable notices/jobs. Delivery rechecks current duty/consent/assignment even if optional notice cleanup fails. Rollback delivery/retention/replay fixtures and two real-connection races pass. Eight existing SQL fixtures and both refresh races pass. No sender, real push, audio room or production SQL ran.

Client/UI26/26 includes scoped revision deduplication, hidden-tab coalescing, selected-request acknowledgement, clearing on assignment loss/denial and caller-owned response immutability. Native effects follow canonical role scope rather than queued event payloads. Local code is substantially implemented; responsive screenshots, configured transport/maintenance and final signed physical acceptance remain.
