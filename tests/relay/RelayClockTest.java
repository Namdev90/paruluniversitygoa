package in.navrang.gate;

public final class RelayClockTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static final class Loop implements WebSocketAudioRelayTransport.Scheduler {
        long elapsed=1000;
        public long now(){return elapsed;}
        public VoiceAuthority.Pending delay(Runnable task,long ms){return ()->{};}
    }
    public static void main(String[] args){
        Loop loop=new Loop();RelayClock clock=new RelayClock(loop,50,1000);
        check(clock.serverUpperBoundUnixMs()==-1,"unobserved clock unavailable");
        check(clock.observeAuthenticated(1000000,900,1000),"bounded authenticated sample admitted");
        check(clock.serverUpperBoundUnixMs()==1000151,"upper bound includes entire RTT, RTT drift and explicit skew");
        loop.elapsed+=1000;
        check(clock.serverUpperBoundUnixMs()==1001152,"upper bound advances with drift budget");
        check(clock.observeAuthenticated(1000900,1900,2000),"replacement sample admitted");
        check(clock.serverUpperBoundUnixMs()>=1001152,"refresh never decreases returned bound");
        loop.elapsed+=15001;
        check(clock.serverUpperBoundUnixMs()==-1,"stale sample unavailable");
        loop.elapsed=20000;check(!clock.observeAuthenticated(1000000,17000,20000),"large RTT rejected");
        check(clock.serverUpperBoundUnixMs()==-1,"rejected sample cannot revive stale clock");
        check(!clock.observeAuthenticated(RelayV1Protocol.MAX_SAFE_INTEGER,20000,20000),"upper bound overflow rejected");
        check(!clock.observeAuthenticated(1000000,20001,20000),"negative RTT rejected");
        check(!clock.observeAuthenticated(1000000,20000,20001),"future response rejected");
        check(clock.observeAuthenticated(1020000,19900,20000),"fresh valid sample recovers after invalid input");
        loop.elapsed--;check(clock.serverUpperBoundUnixMs()==-1,"elapsed rollback fails closed");
        check(!clock.observeAuthenticated(1020000,19900,19999),"rollback permanently invalidates owner");
        System.out.println("Relay clock checks passed: "+checks);
    }
}
