package in.navrang.gate;

/** Public release metadata only; never a location, authentication or exact-alarm schedule. */
public final class UpdateCheckPolicy {
    public static final long ORDINARY_MS=30*60*1000L, ACTIVE_ADMIN_MS=5*60*1000L, MINIMUM_MS=30*1000L;
    public static long interval(boolean foreground,boolean authenticatedAdmin) {
        return foreground&&authenticatedAdmin?ACTIVE_ADMIN_MS:ORDINARY_MS;
    }
    public static boolean due(long now,long lastAttempt,long retryAt,boolean foreground,
            boolean authenticatedAdmin,boolean manual,boolean invalidated) {
        if(now<0||now<retryAt)return false;
        if(lastAttempt==0)return true;
        long elapsed=now-lastAttempt;
        return elapsed>=0&&elapsed>=(manual||invalidated||retryAt>0?MINIMUM_MS:interval(foreground,authenticatedAdmin));
    }
    public static long backoff(int failures,long entropy) {
        long base=MINIMUM_MS*(1L<<Math.min(6,Math.max(0,failures-1)));
        base=Math.min(ORDINARY_MS,base);
        return Math.min(ORDINARY_MS,base+Math.floorMod(entropy,base/10+1));
    }
    private UpdateCheckPolicy() {}
}
