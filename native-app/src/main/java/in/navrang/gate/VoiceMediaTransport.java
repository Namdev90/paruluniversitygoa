package in.navrang.gate;

/** Injectable media boundary; no SDK, credentials or live transport are fabricated. */
public interface VoiceMediaTransport {
    /** Provider-owned native credential. Never stringify, log, persist, or send to the WebView. */
    interface Credential {
        long expiresAtMs(); void destroy();
        /** Compare immutable room/lease/identity bindings, never token strings. */
        default boolean sameBinding(Credential other) { return this == other; }
    }
    interface Receiver { void close(); }
    interface InputResult { void applied(boolean enabled); void failed(); }
    interface Publisher {
        // Implementations MUST immediately issue local disable on false/close,
        // fence late enable callbacks, and bound async acknowledgement/teardown.
        // Physical stop latency still needs device proof. Publishers start muted.
        void microphone(boolean enabled);
        // Async providers override this and acknowledge only the matching local
        // input operation. The synchronous default supports synchronous transports.
        default void microphone(boolean enabled, InputResult result) {
            try { microphone(enabled); result.applied(enabled); }
            catch (Exception ignored) { result.failed(); }
        }
        void close();
    }
    interface Result<T> { void ready(T connection); void failed(); void disconnected(); }
    boolean available();
    /** Structural configuration only; authority may obtain time before media admission. */
    default boolean configured() { return available(); }
    /** Capability checked before acquiring a floor, including on API24-28. */
    default boolean canPublish() { return available(); }
    /** Native owner remains active only while the UI or its foreground service owns audio. */
    default void foreground(boolean value) {}
    /** Must synchronously fence native queues before asynchronously posting identity cleanup. */
    default void authorizationChanged() {}
    default void stop() {}
    VoiceAuthority.Pending receive(Credential credential, Result<Receiver> result);
    VoiceAuthority.Pending preparePublisher(Credential credential, Result<Publisher> result);
    static VoiceMediaTransport unavailable() {
        return new VoiceMediaTransport() {
            public boolean available() { return false; }
            public VoiceAuthority.Pending receive(Credential c, Result<Receiver> r) { r.failed(); return () -> {}; }
            public VoiceAuthority.Pending preparePublisher(Credential c, Result<Publisher> r) { r.failed(); return () -> {}; }
        };
    }
}
