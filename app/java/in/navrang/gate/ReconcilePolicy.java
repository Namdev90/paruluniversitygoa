package in.navrang.gate;

/** One monotonic, claim-fenced schedule per kind; no timer or network of its own. */
public final class ReconcilePolicy {
    public static final int PROFILE=0,DATA=1,QUEUE=2;
    private static final long FALLBACK_MS=30000,HINT_MS=1000;
    private static final class State {
        long active,version=1,claimedVersion,lastAttempt,lastSuccess,retryAt;
        int failures;boolean attempted,succeeded,dirty=true;
    }
    private final State[] states={new State(),new State(),new State()};
    private long sequence;
    private State state(int kind){if(kind<0||kind>=states.length)throw new IllegalArgumentException("Unknown reconciliation kind.");return states[kind];}
    public synchronized void reset(){for(int index=0;index<states.length;index++)states[index]=new State();}
    public synchronized void invalidate(int kind){State value=state(kind);value.dirty=true;value.version++;}
    public synchronized long begin(int kind,long now){
        State value=state(kind);
        if(now<0||value.active!=0||now<value.retryAt)return 0;
        if(value.attempted&&now<value.lastAttempt)return 0;
        if(kind!=QUEUE&&value.attempted){
            if(value.dirty&&now-value.lastAttempt<HINT_MS)return 0;
            if(!value.dirty&&value.succeeded&&now-value.lastSuccess<FALLBACK_MS)return 0;
        }
        long claim=++sequence;if(claim<=0)return 0;
        value.active=claim;value.claimedVersion=value.version;value.lastAttempt=now;value.attempted=true;return claim;
    }
    public synchronized void success(int kind,long claim,long now,boolean more){
        State value=state(kind);if(claim<=0||value.active!=claim)return;
        value.active=0;value.failures=0;value.retryAt=0;value.succeeded=true;value.lastSuccess=now;
        value.dirty=more||value.version!=value.claimedVersion;
    }
    public synchronized void failure(int kind,long claim,long now,long entropy){
        State value=state(kind);if(claim<=0||value.active!=claim)return;
        value.active=0;value.dirty=true;value.failures=Math.min(12,value.failures+1);
        long base=Math.min(60000,2000L*(1L<<Math.min(5,value.failures-1)));
        long delay=Math.min(60000,base+Math.floorMod(entropy,base/10+1));
        value.retryAt=now>Long.MAX_VALUE-delay?Long.MAX_VALUE:now+delay;
    }
}
