package in.navrang.gate;

import java.util.Objects;

/** Monotonic upper bound from an authenticated authority sample, never device wall time.
 * The caller must have external evidence for authority-to-relay skew and reference advance:
 * reference milliseconds advance at most (1 + driftPpm/1_000_000) per elapsed millisecond.
 * This is not a raw oscillator error bound (which would need reciprocal conversion).
 * Supplying these numbers is not itself evidence or permission to activate a provider.
 */
public final class RelayClock implements RelayV1Driver.Time,AutoCloseable {
    private static final long MAX_AGE_MS=15000,MAX_RTT_MS=2000,PPM=1000000;
    private final WebSocketAudioRelayTransport.Scheduler loop;
    private final long skewMs,driftPpm;
    private long lastElapsed=-1,sampledAt=-1,sampleUpper=-1,lastUpper=-1;
    private boolean invalid;

    public RelayClock(WebSocketAudioRelayTransport.Scheduler loop,long skewMs,long driftPpm){
        this.loop=Objects.requireNonNull(loop);
        if(skewMs<0||skewMs>60000||driftPpm<0||driftPpm>PPM)throw new IllegalArgumentException("Evidenced clock bounds required");
        this.skewMs=skewMs;this.driftPpm=driftPpm;
    }
    @Override public synchronized long now(){
        if(invalid)return -1;
        long value;
        try{value=loop.now();}catch(RuntimeException failure){value=-1;}
        if(value<0||value<lastElapsed){invalid=true;return -1;}
        lastElapsed=value;return value;
    }
    /** Called solely after the existing HTTPS authority and identity checks succeed.
     * serverUnixMs must be stamped during [sentElapsedMs,receivedElapsedMs].
     * Rejecting a sample clears prior timing; failed synchronization cannot prolong access.
     */
    public synchronized boolean observeAuthenticated(long serverUnixMs,long sentElapsedMs,long receivedElapsedMs){
        sampledAt=-1;sampleUpper=-1;
        long current=now();
        if(current<0||serverUnixMs<0||serverUnixMs>RelayV1Protocol.MAX_SAFE_INTEGER||sentElapsedMs<0||
                receivedElapsedMs<sentElapsedMs||receivedElapsedMs>current||current-receivedElapsedMs>MAX_AGE_MS||
                receivedElapsedMs-sentElapsedMs>MAX_RTT_MS)return false;
        long roundTrip=receivedElapsedMs-sentElapsedMs;
        long allowance=roundTrip+(roundTrip*driftPpm+PPM-1)/PPM+skewMs;
        if(serverUnixMs>RelayV1Protocol.MAX_SAFE_INTEGER-allowance)return false;
        sampleUpper=serverUnixMs+allowance;sampledAt=receivedElapsedMs;
        return serverUpperBoundUnixMs()>=0;
    }
    @Override public synchronized long serverUpperBoundUnixMs(){
        long current=now();
        if(current<0||sampledAt<0||current<sampledAt||current-sampledAt>MAX_AGE_MS)return -1;
        long age=current-sampledAt;
        long advance=age+(age*driftPpm+PPM-1)/PPM;
        if(sampleUpper>RelayV1Protocol.MAX_SAFE_INTEGER-advance){sampledAt=-1;return -1;}
        lastUpper=Math.max(lastUpper,sampleUpper+advance);return lastUpper;
    }
    @Override public VoiceAuthority.Pending delay(Runnable task,long delayMs){
        if(task==null||delayMs<0)throw new IllegalArgumentException("Invalid relay timer");
        return loop.delay(task,delayMs);
    }
    @Override public synchronized void close(){invalid=true;sampleUpper=-1;sampledAt=-1;}
}
