# Approved renewable sessions and local app lock

Approved25October:15-minute access; rotating refresh with7-day inactivity and30-day absolute expiry for admin and volunteer roles; current authorization and volunteer access deadlines still apply. All-user app lock: cold process locked, monotonic30-second background grace, immediate screen/device-lock response, one strong-biometric/supported-credential prompt, no persisted unlocked flag or silent voice/scanner exemption.

Existing12-hour sessions remain compatible until natural expiry. New clients advertise authProtocol1 plus installationId. Refresh secrets are256random bits, with only hashes stored in PostgreSQL. The client persists a random successor and operation UUID in its existing encrypted session before network I/O. An atomic server rotation permits only a30-second exact same-request/same-successor retry; any other consumed-token reuse revokes that family and its access sessions. Logout, password/account revocation and deadlines remain authoritative. Failed transport preserves the pending encrypted rotation and uses bounded retry/backoff. No raw tokens enter SQL/logs or the JavaScript bridge.

Browser persistence requires a same-origin HTTPS HttpOnly-cookie gateway with CSRF/origin protection; no localStorage refresh token or assumption that current cross-origin static hosting supplies this. Legacy tab-scoped browser login remains compatible until that gateway is configured and accepted.

Implement/test locally before deployment review. Original APK signer and all v0.9 feature/device gates still apply. No paid provider activation or unrelated grant/credential creation is covered.
