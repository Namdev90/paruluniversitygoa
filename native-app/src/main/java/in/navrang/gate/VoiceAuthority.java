package in.navrang.gate;

/** Native-only authority boundary. These values are NOT a public wire protocol. */
public interface VoiceAuthority {
    interface Pending { void cancel(); }
    /** Exactly one terminal callback; cancellation can still race with success. */
    interface Result<T> { void success(T value); void failure(); }
    final class Identity {
        public final String token, scope, family;
        public final long generation;
        public Identity(String token, String scope, long generation) {
            this(token,scope,generation,"");
        }
        public Identity(String token, String scope, long generation, String family) {
            this.token = token; this.scope = scope; this.generation = generation; this.family = family == null ? "" : family;
        }
        public boolean samePrincipal(Identity other) {
            return other != null && generation == other.generation && scope.equals(other.scope) &&
                (family.isEmpty() ? other.family.isEmpty() && token.equals(other.token) : family.equals(other.family));
        }
    }
    final class Join {
        public final String sessionId, dutyId;
        public final long serverTimeMs, expiresAtMs;
        public final VoiceMediaTransport.Credential receive;
        public final boolean speaking;
        public final String leaseId;
        public final long leaseGeneration;
        public Join(String sessionId, String dutyId, long serverTimeMs, long expiresAtMs, VoiceMediaTransport.Credential receive) {
            this(sessionId,dutyId,serverTimeMs,expiresAtMs,receive,false,"",-1);
        }
        public Join(String sessionId, String dutyId, long serverTimeMs, long expiresAtMs, VoiceMediaTransport.Credential receive,
                    boolean speaking,String leaseId,long leaseGeneration) {
            this.sessionId = sessionId; this.dutyId = dutyId; this.serverTimeMs = serverTimeMs; this.expiresAtMs = expiresAtMs; this.receive = receive;
            this.speaking=speaking;this.leaseId=leaseId;this.leaseGeneration=leaseGeneration;
        }
    }
    final class Floor {
        public final String sessionId, leaseId;
        public final long generation, serverTimeMs, expiresAtMs;
        public final VoiceMediaTransport.Credential transmit;
        public Floor(String sessionId, String leaseId, long generation, long serverTimeMs, long expiresAtMs, VoiceMediaTransport.Credential transmit) {
            this.sessionId = sessionId; this.leaseId = leaseId; this.generation = generation;
            this.serverTimeMs = serverTimeMs; this.expiresAtMs = expiresAtMs; this.transmit = transmit;
        }
    }
    /** Rotating relay rooms require old input fenced before the renewal request. */
    default boolean rotatesTransportOnRenew(){return false;}
    boolean configured();
    // Implementations must refresh authorization, bind replies to this identity,
    // and return only committed relay-enforced grants. Tokens stay in native memory.
    Pending join(Identity identity, String requestedSessionId, Result<Join> result);
    Pending floor(Identity identity, String sessionId, Result<Floor> result);
    Pending renew(Identity identity, String sessionId, String leaseId, long generation, Result<Floor> result);
    /** An adapter must opt in only when it refreshes duty and discovers current authorized rooms. */
    default boolean supportsRefresh() { return false; }
    default Pending refresh(Identity identity, Join current, Result<Join> result) { result.failure(); return () -> {}; }
    // These enqueue bounded cleanup; they must never block the UI/mute thread.
    void release(Identity identity, String sessionId, String leaseId);
    void leave(Identity identity, String dutyId);
    default void close() {}
    static VoiceAuthority unavailable() {
        return new VoiceAuthority() {
            public boolean configured() { return false; }
            public Pending join(Identity i, String s, Result<Join> r) { r.failure(); return () -> {}; }
            public Pending floor(Identity i, String s, Result<Floor> r) { r.failure(); return () -> {}; }
            public Pending renew(Identity i, String s, String l, long g, Result<Floor> r) { r.failure(); return () -> {}; }
            public void release(Identity i, String s, String l) {}
            public void leave(Identity i, String d) {}
        };
    }
}
