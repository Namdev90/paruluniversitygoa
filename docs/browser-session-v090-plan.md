# Browser renewal implementation

Implement the already approved15-minute access /7-day inactivity /30-day absolute policy through a same-origin HTTPS gateway. Do not put access/refresh credentials in JavaScript storage, URLs or logs. The existing static GitHub browser page cannot itself set HttpOnly cookies; actual gateway hosting/configuration remains a deployment gate.

The gateway uses __Host- cookies with Secure, HttpOnly, SameSite=Strict and Path=/. It accepts only its configured HTTPS origin, JSON requests and a custom same-origin request header; it does not enable CORS or accept caller Authorization headers. Existing API validation and backend role checks remain authoritative. No provider credential or new signing secret is needed.

Renewal is two phase. Prepare stores the client-generated successor and request UUID only in a short-lived HttpOnly pending cookie. Commit sends only its hash and the existing refresh proof to the current backend. An uncertain commit retries that exact proof within the existing backend idempotency window. Browser Web Locks serialize renewal between tabs, and an in-memory request deadline bounds all steps. Unsupported browser coordination fails closed rather than risking reuse-family invalidation.

Explicit logout clears private UI immediately. A nonsecret local logout-intent marker blocks cold restoration while offline. Once reachable, the gateway clears active cookies and retains only an HttpOnly revocation proof until the existing backend confirms revocation. That proof can never authenticate normal requests. A nonsecret cross-tab identity marker clears stale private UI after login/logout or grant change. No student data or credential is saved in browser storage.

Use Request/Response and jsdom fixtures for login/cold restore, 401 versus infrastructure failure, concurrent tabs, uncertain refresh, offline logout/retry, expiry/revocation, role loss and late callbacks. Test strict origin, cookie flags, duplicate/malformed cookies, body limits and secret-free responses. No listener, production migration or live credential operation is started by importing the module.

References checked25 October2026: https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API and https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie . The native Android vault/biometric policy is unchanged.
