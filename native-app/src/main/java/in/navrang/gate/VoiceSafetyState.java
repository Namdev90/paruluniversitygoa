package in.navrang.gate;

import java.util.regex.Pattern;

/**
 * Provider-independent local voice fence. All times are monotonic elapsed milliseconds.
 * No method opens a microphone, connects media, sends a request, or persists credentials.
 * The host must apply each resulting micAllowed=false to its transport BEFORE network
 * cleanup, and compensate a rejected late grant using the reply's exact lease identity.
 * A local timer is defense in depth; the relay must independently enforce expiry.
 */
public final class VoiceSafetyState {
    public static final long MAX_AUTHORITY_MS = 60_000;
    public static final long MAX_LEASE_MS = 15_000;
    public static final long MAX_GENERATION = 9_007_199_254_740_991L;
    public static final long JOIN_TIMEOUT_MS = 10_000;
    public static final long REQUEST_TIMEOUT_MS = 5_000;
    private static final long NONE = -1;
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");

    public static final class Snapshot {
        public final long epoch, identityGeneration, leaseGeneration, leaseUntil, authorityUntil;
        public final long joinOperation, floorOperation, renewOperation;
        public final String sessionId, state, leaseId;
        public final boolean connected, pressed, micAllowed;
        private Snapshot(VoiceSafetyState source) {
            epoch = source.epoch; identityGeneration = source.identityGeneration;
            sessionId = source.sessionId; leaseId = source.leaseId;
            leaseGeneration = source.leaseGeneration; leaseUntil = source.leaseUntil;
            authorityUntil = source.authorityUntil;
            joinOperation = source.joinOperation; floorOperation = source.floorOperation;
            renewOperation = source.renewOperation;
            connected = source.connected; pressed = source.pressed;
            micAllowed = source.canTalk();
            state = !source.enabled || !source.active || source.clockFailed ? "unavailable"
                : joinOperation != NONE ? "joining" : micAllowed ? "talking"
                : floorOperation != NONE ? "requesting" : connected ? "listening"
                : source.closed ? "closed" : "idle";
        }
    }

    private final boolean enabled;
    private String scope = "", sessionId = "", leaseId = "";
    private long identityGeneration = NONE, epoch, sequence, now = NONE;
    private long authorityUntil = NONE, leaseGeneration = NONE, leaseUntil = NONE;
    private long joinOperation = NONE, floorOperation = NONE, renewOperation = NONE;
    private long joinUntil = NONE, floorUntil = NONE, renewUntil = NONE;
    private boolean active, foreground, backgroundReception, microphonePermission, audioFocus, connected, pressed, closed, clockFailed;

    public VoiceSafetyState(boolean enabled) { this.enabled = enabled; }

    public synchronized void identity(String scope, long generation, boolean active, long now) {
        advance(now);
        String checked = scope == null || scope.length() > 512 ? "" : scope;
        boolean authorized = active && !checked.isEmpty() && generation >= 0;
        if (!this.scope.equals(checked) || identityGeneration != generation || this.active != authorized) dropConnection();
        this.scope = checked; identityGeneration = generation; this.active = authorized;
    }

    public synchronized void environment(boolean foreground, boolean microphonePermission, boolean audioFocus, long now) {
        environment(foreground, false, microphonePermission, audioFocus, now);
    }

    /** Only an already-running foreground playback service may retain reception. */
    public synchronized void environment(boolean foreground, boolean backgroundReception, boolean microphonePermission, boolean audioFocus, long now) {
        advance(now);
        this.foreground = foreground; this.backgroundReception = backgroundReception;
        this.microphonePermission = microphonePermission; this.audioFocus = audioFocus;
        if ((!foreground && !backgroundReception) || !audioFocus) dropConnection();
        else if (!foreground || !microphonePermission) clearFloor();
    }

    /** Explicit user join only. Listening does not require microphone permission. */
    public synchronized long beginJoin(String sessionId, long now) {
        advance(now);
        if (!foreground || !eligible() || connected || joinOperation != NONE || !validSession(sessionId)) return NONE;
        long operation = operation(); if (operation == NONE) return NONE;
        this.sessionId = sessionId; closed = false;
        joinOperation = operation; joinUntil = deadline(JOIN_TIMEOUT_MS);
        return operation;
    }

    public synchronized boolean joined(long operation, long authorityUntilElapsed, long now) {
        advance(now);
        if (operation == NONE || operation != joinOperation) return false;
        if (!eligible() || !boundedFuture(authorityUntilElapsed, MAX_AUTHORITY_MS)) { dropConnection(); return false; }
        connected = true; joinOperation = NONE; joinUntil = NONE; authorityUntil = authorityUntilElapsed;
        return true;
    }

    /** Fresh server duty/session authority, correlated with the current connected epoch. */
    public synchronized boolean extendAuthority(long expectedEpoch, long authorityUntilElapsed, long now) {
        advance(now);
        if (expectedEpoch != epoch || !connected) return false;
        if (!eligible() || !boundedFuture(authorityUntilElapsed, MAX_AUTHORITY_MS) || authorityUntilElapsed < authorityUntil) {
            dropConnection(); return false;
        }
        authorityUntil = authorityUntilElapsed; return true;
    }

    /** A new pointer/key press. Repeated down events never issue another floor request. */
    public synchronized long press(long now) {
        advance(now);
        if (!foreground || !eligible() || !connected || !microphonePermission || pressed) return NONE;
        long operation = operation(); if (operation == NONE) return NONE;
        pressed = true; floorOperation = operation;
        floorUntil = Math.min(deadline(REQUEST_TIMEOUT_MS), authorityUntil);
        return operation;
    }

    public synchronized boolean granted(long operation, String leaseId, long leaseGeneration, long leaseUntilElapsed, long now) {
        advance(now);
        if (operation == NONE || operation != floorOperation) return false;
        if (!foreground || !eligible() || !connected || !microphonePermission || !pressed || !validId(leaseId) || leaseGeneration < 0 ||
            !boundedFuture(leaseUntilElapsed, MAX_LEASE_MS) || leaseUntilElapsed > authorityUntil) {
            clearFloor(); return false;
        }
        this.leaseId = leaseId; this.leaseGeneration = leaseGeneration; leaseUntil = leaseUntilElapsed;
        floorOperation = NONE; floorUntil = NONE;
        return true;
    }

    /** Renewal keeps the current local deadline; a pending response never extends capture. */
    public synchronized long beginRenew(long now) {
        advance(now);
        if (!canTalk() || renewOperation != NONE) return NONE;
        long operation = operation(); if (operation == NONE) return NONE;
        renewOperation = operation; renewUntil = Math.min(deadline(REQUEST_TIMEOUT_MS), leaseUntil);
        return operation;
    }

    public synchronized boolean renewed(long operation, String leaseId, long leaseGeneration, long leaseUntilElapsed, long now) {
        advance(now);
        if (operation == NONE || operation != renewOperation) return false;
        if (!canTalk() || !this.leaseId.equals(leaseId) || this.leaseGeneration != leaseGeneration ||
            !boundedFuture(leaseUntilElapsed, MAX_LEASE_MS) || leaseUntilElapsed < leaseUntil || leaseUntilElapsed > authorityUntil) {
            clearFloor(); return false;
        }
        leaseUntil = leaseUntilElapsed; renewOperation = NONE; renewUntil = NONE;
        return true;
    }

    /**
     * A relay may replace a lease instead of extending it. The user must still
     * hold the same press, and the old lease must remain valid at receipt. A new
     * UUID and strictly higher safe generation fence the replaced publisher.
     * The host must mute/close that publisher before activating the replacement.
     */
    public synchronized boolean rotated(long operation, String newLeaseId, long newGeneration, long newUntil, long now) {
        advance(now);
        if (operation == NONE || operation != renewOperation) return false;
        if (!canTalk() || !validId(newLeaseId) || leaseId.equalsIgnoreCase(newLeaseId) ||
            newGeneration <= leaseGeneration || newGeneration > MAX_GENERATION ||
            !boundedFuture(newUntil, MAX_LEASE_MS) || newUntil > authorityUntil) {
            clearFloor(); return false;
        }
        leaseId = newLeaseId; leaseGeneration = newGeneration; leaseUntil = newUntil;
        renewOperation = NONE; renewUntil = NONE;
        return true;
    }

    /** Release is local and immediate; the host handles any server cleanup separately. */
    public synchronized void release(long now) { advance(now); clearFloor(); }
    public synchronized void disconnect(long now) { advance(now); dropConnection(); }

    /** Fail only the matching request; late errors cannot end a replacement operation. */
    public synchronized void failed(long operation, long now) {
        advance(now);
        if (operation == NONE) return;
        if (operation == joinOperation) dropConnection();
        else if (operation == floorOperation || operation == renewOperation) clearFloor();
    }

    /** The host calls this on its timer and before every media effect. */
    public synchronized Snapshot snapshot(long now) { advance(now); return new Snapshot(this); }

    private boolean eligible() { return enabled && active && (foreground || backgroundReception) && audioFocus && !clockFailed; }
    private boolean canTalk() {
        return foreground && eligible() && connected && microphonePermission && pressed && !leaseId.isEmpty() &&
            now < leaseUntil && now < authorityUntil;
    }
    private void clearFloor() {
        pressed = false; leaseId = ""; leaseGeneration = NONE; leaseUntil = NONE;
        floorOperation = NONE; floorUntil = NONE; renewOperation = NONE; renewUntil = NONE;
    }
    private void dropConnection() {
        clearFloor(); connected = false; sessionId = ""; authorityUntil = NONE;
        joinOperation = NONE; joinUntil = NONE; closed = true;
        if (epoch < Long.MAX_VALUE) epoch++; else clockFailed = true;
    }
    private void advance(long now) {
        if (now < 0 || this.now > now) { clockFailed = true; dropConnection(); return; }
        this.now = now;
        if (joinOperation != NONE && now >= joinUntil || connected && now >= authorityUntil) dropConnection();
        else if (floorOperation != NONE && now >= floorUntil || !leaseId.isEmpty() && now >= leaseUntil ||
            renewOperation != NONE && now >= renewUntil) clearFloor();
    }
    private long operation() {
        if (sequence == Long.MAX_VALUE) { clockFailed = true; dropConnection(); return NONE; }
        return ++sequence;
    }
    private long deadline(long duration) { return now > Long.MAX_VALUE - duration ? Long.MAX_VALUE : now + duration; }
    private boolean boundedFuture(long deadline, long maximum) { return deadline > now && deadline - now <= maximum; }
    private static boolean validId(String value) { return value != null && ID.matcher(value).matches(); }
    private static boolean validSession(String value) { return "channel".equals(value) || validId(value); }
}
