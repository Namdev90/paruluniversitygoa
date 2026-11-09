# Renewal rollout and rollback gate

No production change has been performed. Apply the source SQL transactionally only after the disposable migration, compatibility, concurrency and native tests pass. Record source digests and back up the existing function definition before deployment.

The HTTP handler defaults new-family issuance off. The existing clients and new clients behind that gate keep the legacy login shape. NAVRANG_RENEWAL_ENABLED=true is an explicit activation setting, observable through the existing config response. Existing renewable families can still refresh when new issuance is disabled, so an emergency issuance rollback does not strand already-issued15-minute access sessions.

Preserve session_families, consumed-token history and the compatibility RPC during a handler rollback. Do not drop this data or revoke all users as a routine rollback. Existing opaque12-hour clients keep their current expiry and service-only access; the wrapper rebinds private push, voice duty and report-operation rows only within the same validated family before old access rows are retired.

Final release acceptance must require renewal issuance enabled, actual native encrypted rotation and lock behavior, authoritative revocation/expiry, and a configured HttpOnly same-origin gateway before claiming persistent browser login. The current cross-origin browser path retains legacy tab-scoped behavior. Token-family retention requires the reviewed maintenance worker; no new public/client grants are introduced.
