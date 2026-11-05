# Relay continuation design

Continue the verified migrated app in this isolated Git history; preserve every source snapshot and existing release identity. Use task9 async ports, not the synchronous task7 overlay. Main, relay server and integration candidates remain independently recoverable.

The authorized approach is native integration with tested monotonic clock bounds, acknowledged teardown, lifecycle forwarding, and capability-based Opus encoding. Alternatives (blind overlay; replacing the existing Daily authority with fabricated relay credentials) are rejected because their ownership and grant contracts differ. Voice stays disabled; no production security, provider configuration, credential generation, signing or deployment changes are allowed.

Implement a pure monotonic RelayClock consuming only trusted authenticated request/response timing plus explicitly evidenced authority-to-relay skew and oscillator bounds. Reject missing, stale, invalid, overflow or rollback samples. Do not use device wall time. NativeRelayRuntime owns that clock and the actual socket/audio ports, exposes explicit authenticated time observation, and requires configured authority at app composition. Configuration availability must be distinct from fresh-clock admission so join can obtain time.

Forward app lifecycle and synchronous identity invalidation into transport. Keep receiving/transmitting operation-time authorization separate. Query actual mono48kHz Opus MediaCodec encoder capability on API24+; devices lacking an encoder cannot acquire a floor. Physical encoder behavior is a device gate; bundled software codec support is a separate deliverable if platform capability is absent.

A discovered external protocol blocker prevents enabling relay: task6 requires speaker connection before a controller grant; existing authority returns a committed floor before opening its publisher. No issuer/controller bridge exists. Do not invent wire endpoints, JWTs, committed grants, or a skew bound. App composition can be tested with injected synthetic authority; production activation remains blocked until a separately authorized bridge and measured clock assumptions exist.
