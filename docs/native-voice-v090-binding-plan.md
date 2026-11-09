# Native voice binding execution notes

Finish the approved protocol/driver/session binding without enabling live services, creating credentials or treating mocks as provider acceptance.

1. Add an optional SDK-independent DailyMediaTransport using DailySdkSession's existing loop/factory. One slot serializes receiver/publisher replacements. Queue only the newest replacement while teardown is pending; wait for confirmed mute/leave/release. An uncertain1.5-second teardown poisons the owner. Publishers start muted; enable requires matching authority plus SDK acknowledgement. Stale handles cannot close/enable the replacement; expired/cancelled queued credentials are destroyed.
2. Prove fake-driver cases before implementation: late join/enable, cancellation, replacement, expiry, missing teardown acknowledgement and wrong roles. Run existing session/SDK compile checks. No network/audio in tests.
3. Supply an optional DailySdkDriver transport factory and bind VoiceSessionService to GateVoiceAuthority. Keep live flags off by default and require an approved hostname. Tokens remain native-memory-only. Service teardown owns media/authority cleanup.
4. The backend runtime needs an explicitly configured authenticated controller host. Preserve existing direct-PostgreSQL permissions and the denied public-grant patch. Never launch a new Edge invocation every second.
5. Final optimized APK acceptance covers JNI/reflection/callbacks, native ABI/page compatibility, original signature, physical microphone stop and relay cutoff after controller death/revocation. Class counts/fake drivers are insufficient.

External gate: existing Firebase/FCM project, reliable controller hosting and a voice account with approved cost policy remain unresolved. Daily has no hard free-spend cap. No billing, credentials, provider call or production migration occurs in this local pass.
