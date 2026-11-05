# Consented volunteer locator and find-me

Implements the user's already approved local feature scope. No production migration, provider configuration, real notification or tracking activation is part of this implementation pass.

- Disclose after login, before optional duty features: latest location only, assigned event administrators, timestamp/accuracy and expiry. Registration and existing station work remain available when declined.
- Separate location and find-me choices, both off initially. A voluntary duty session lasts at most one hour and has visible Stop/expiry. Stop or revocation removes the latest fix and pending requests.
- An explicitly assigned event administrator may request one selected, consenting on-duty volunteer. Server identity supplies the administrator name; never trust an actor or recipient supplied by the phone. The existing single-event app uses O9KL3; an explicit private assignment row is required, with no automatic new assignment.
- Request expiry two minutes; one active target per administrator; one request per target per minute, at most ten per administrator per ten minutes. Retries reuse the original request UUID without repeating sound or extending expiry.
- Requests say who is looking. The recipient may independently choose Share once, Play find-me sound, Open bright identification screen, Decline or Stop. Acknowledged, found and sent are different states. Bright screen and short ordinary sound/vibration require an explicit foreground action; no DND bypass or forced full-screen/background UI.
- Share once requires current location consent and duty; a response to find-me is also bound to that current request. Store only the latest fix with capture time and accuracy, visible for at most two minutes and no longer than duty/request expiry. Roster responses contain no coordinates; an assigned administrator fetches one selected person's latest fix. No location history, public topic coordinates, background-location permission or inference of misconduct from missing fixes.
- Private server tables, service-only invoker RPC, hashed opaque-session authentication and fresh active/role/event authorization for every operation. A volunteer cannot read another volunteer's fix or write another identity's consent/location. Renewable sessions keep the same principal; logout/revocation invalidates duty ownership.
- Expired fixes/requests are filtered even before physical deletion. A private pruning operation removes coordinates after expiry and audit metadata after 24 hours. Audit contains action/outcome/identity/time, never coordinates or provider credentials.
- Settings explain each optional permission and open the appropriate Android system page. Contextual system prompts cannot silently grant access.

Ruling: the user requested short retention/cooldowns but did not fix durations. The conservative bounds above are local defaults, displayed in the UI; they can be reviewed before deployment. They do not grant live access.
