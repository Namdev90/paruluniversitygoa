package in.navrang.gate;

import java.net.URI;
import java.util.Arrays;

/** SDK-independent native-only descriptor; contains no provider SDK or persistent token storage. */
public final class DailyNativeCredential implements VoiceMediaTransport.Credential {
    public enum Role { LISTENER, PUBLISHER }
    final String roomUrl, roomId, identity, leaseId;
    final long generation, deadlineElapsedMs;
    final Role role;
    private final long expiresAt;
    private char[] token;

    public DailyNativeCredential(String approvedHost, String roomUrl, String roomId, String identity,
            String leaseId, long generation, long expiresAtMs, long deadlineElapsedMs,
            long nowElapsedMs, Role role, char[] token) {
        try {
            URI uri = new URI(roomUrl);
            if (approvedHost == null || !approvedHost.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.daily\\.co") ||
                !"https".equals(uri.getScheme()) || !approvedHost.equals(uri.getHost()) || uri.getPort() != -1 ||
                uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                roomId == null || !roomId.matches("nv_[a-f0-9]{32}") || !('/' + roomId).equals(uri.getRawPath()) ||
                !uuid(identity) || !uuid(leaseId) || generation < 1 || generation > 9007199254740991L ||
                expiresAtMs <= 0 || nowElapsedMs < 0 || deadlineElapsedMs <= nowElapsedMs ||
                deadlineElapsedMs - nowElapsedMs > 15000 || role == null || token == null ||
                token.length < 3 || token.length > 8192 || !new String(token).matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"))
                throw new IllegalArgumentException();
        } catch (Exception rejected) { throw new IllegalArgumentException("Invalid authorized Daily descriptor."); }
        this.roomUrl = roomUrl; this.roomId = roomId; this.identity = identity; this.leaseId = leaseId;
        this.generation = generation; this.expiresAt = expiresAtMs; this.deadlineElapsedMs = deadlineElapsedMs;
        this.role = role; this.token = token.clone();
    }
    private static boolean uuid(String value) { return value != null && value.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[1-8][a-fA-F0-9]{3}-[89abAB][a-fA-F0-9]{3}-[a-fA-F0-9]{12}"); }
    synchronized String consumeToken() {
        if (token == null) throw new IllegalStateException("Daily credential is no longer available.");
        String value = new String(token); destroy(); return value;
    }
    synchronized boolean usable(long now) { return token != null && now >= 0 && now < deadlineElapsedMs; }
    @Override public long expiresAtMs() { return expiresAt; }
    @Override public boolean sameBinding(VoiceMediaTransport.Credential other) {
        if(!(other instanceof DailyNativeCredential))return false;
        DailyNativeCredential value=(DailyNativeCredential)other;
        return roomUrl.equals(value.roomUrl)&&roomId.equals(value.roomId)&&identity.equals(value.identity)&&
            leaseId.equals(value.leaseId)&&generation==value.generation&&expiresAt==value.expiresAt&&role==value.role;
    }
    @Override public synchronized void destroy() { if (token != null) { Arrays.fill(token, '\0'); token = null; } }
    @Override public String toString() { return "DailyNativeCredential[redacted]"; }
}
