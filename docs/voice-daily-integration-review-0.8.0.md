# Daily integration: source approval review

25 October 2026. This is a review record, not an applied integration or a deployment instruction.

The isolated files `server/voice/daily-relay.mjs` and `server/voice/daily-service.mjs` are local source. The relay reports all media/revocation/controller-death acceptance gates false; its normal grant, renew and revoke methods return 503. The service refuses to call its database or provider adapters when those gates fail. Tests use synthetic in-process fixtures only. No provider account, real credential, room, media session or production migration has been created.

Automatic approval review rejected a subsequent combined source patch. Its reason was: “The patch wires Daily voice actions into the handler and enables credential minting/provider operations, but the trusted user instructions explicitly prohibit creating credentials or changing externally reachable behavior without additional authorization.” The rejected patch was not retried. A read immediately after rejection found none of its changes present.

The proposed source changes were:

- `server/functions/navrang-gate/handler.mjs`: accept an optional `voiceService` dependency; after existing request validation and bearer hashing, dispatch only existing duty/voice action names to that dependency. With no dependency, the current RPC path and 503 behavior remain. No public action names or endpoint are added. When a future deployment injects a verified service, this route can return native voice credentials, which changes externally reachable behavior.
- `server/workers/voice-store.mjs`: add a fixed, parameterized call to the existing private `navrang_private.voice_rpc(text,jsonb,text)` for the foreground service, and a controller method carrying an exact Daily room-deletion receipt. The existing authorized database identity is reused. No grants, revokes, roles, role switching, public RPC or application allowlist expansion are part of the proposal.
- `server/voice/controller.mjs`: recognize saved Daily room plans in the existing cleanup queue; request deletion of that exact room, and acknowledge it only when every identifier and the independent media-termination receipt match. A 404, sent-only result or the current candidate's unverified observation cannot clear the queue.
- `server/workers/daily-voice.mjs`: compose the existing authenticated handler dependency and persistent controller with an externally supplied, already-authorized database pool. No new listener, environment credential discovery or request runs at import time. The real candidate transport remains disabled.

The specific authorization needed is for those local, gated source integrations, including the future capability to return native-only provider tokens through the existing authenticated voice route. This does not request authorization to create actual credentials, contact a provider, run live audio, change access privileges, deploy, apply production migrations or spend money. Those actions remain separate. Provider acceptance, a native SDK binding and device verification are still required before any operational claim.

The earlier rejected public-controller-RPC/ACL patch is a different event. It was not retried; the already-tested persistent controller instead uses the existing private function and unchanged permissions. This new review does not revive that rejected public-RPC proposal.
