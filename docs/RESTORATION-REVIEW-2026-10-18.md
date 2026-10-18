# Restoration release review disposition

The owner approved publication of 0.7.8/code 16 and bypass of the remaining handoff acceptance hold at 21:37:24 IST on 18 October 2026: “approved bypass handoff”. Original signing identity, exact-byte publication checks, server authorization/data and normal repository protections remain in force. Unperformed device checks are recorded as skipped, not passed.

Codex code and security reviews completed on `4a077f8775b2bfc44ac7042d63ab6ec170163025` with no findings. The three earlier Codex findings were already addressed. CodeRabbit subsequently posted seven comments, checked against the actual source before this release:

| Finding | Disposition |
|---|---|
| Icon-only changes omitted from visual workflow | Added the canonical old-logo asset to the path filter. |
| Dual grants should bypass the saved station | Not applied. `server/schema.sql` explicitly requires the saved Checker station for check-in and saved Help Desk station for desk actions. The owner's existing choose-once/admin-reassignment rule is also enforced by role/database regressions. Both flags remain editable/preserved; changing the predicates alone would expose routes the server denies, while changing SQL would broaden existing authorization. |
| Import refresh lost behind an active poll | Coalesce a pending forced refresh and run it immediately after the active poll, with the existing identity/generation fences. A functional regression covers two import notifications during an active request. |
| Scanner pause/resume clears the updater guard | Keep the scanner model at `Destination.Scanner` before foreground restoration and when its profile becomes ready. A lifecycle regression checks pause/resume updater blocking. |
| Host updater assertion assumes debug | Select the expected default using `BuildConfig.DEBUG`. |
| Only web logo checked, not the launcher | Generate the launcher from the exact canonical original PNG, preserve its bytes in the release resource build and verify both shipped PNGs against the original SHA-256. No new artwork is generated. |
| Classic-host replacements may silently miss | Require each structural source pattern exactly once; allow multiple qualified outer-instance references. Generator regressions cover missing/ambiguous back-navigation hooks and verify no partial host is written. |

This release does not modify deployed SQL, station permissions, historical corrections, admissions, registrations, staff grants, OAuth configuration, hosted portal/backend deployment or paid services. Google branding remains deferred.
