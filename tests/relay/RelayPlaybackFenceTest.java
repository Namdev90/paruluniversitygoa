package in.navrang.gate;

public final class RelayPlaybackFenceTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        check(!RelayPlaybackFence.outputCanStart(2048,2048),"large native startup threshold cannot deadlock one packet of credit");
        check(!RelayPlaybackFence.outputCanStart(960,1920),"threshold beyond packet capacity rejected");
        check(RelayPlaybackFence.outputCanStart(960,960),"one packet can fill bounded older-API output");
        check(RelayPlaybackFence.outputCanStart(960,1),"explicit low startup threshold admitted");
        check(!RelayPlaybackFence.outputCanStart(-1,1),"native buffer error rejected");
        RelayPlaybackFence fence=new RelayPlaybackFence(1000,20000,100);
        check(fence.written(1920),"one mono20ms frame can enter native output");
        check(fence.state(100,100,10000,true)==RelayPlaybackFence.State.WAITING,"write acceptance alone cannot return packet credit");
        check(fence.state(579,200,10100,true)==RelayPlaybackFence.State.WAITING,"partial playback retains expiry and credit");
        check(fence.state(1060,300,10200,true)==RelayPlaybackFence.State.DRAINED,"reported full native progress returns credit");
        check(!fence.written(2),"native output cannot accumulate another frame");
        check(fence.state(1060,1000,10200,true)==RelayPlaybackFence.State.EXPIRED,"elapsed cutoff wins even if native playback later completes");
        check(fence.state(1060,300,20000,true)==RelayPlaybackFence.State.EXPIRED,"server cutoff wins over later playback head");
        check(fence.state(1060,300,-1,true)==RelayPlaybackFence.State.EXPIRED,"unknown server clock cannot keep queued PCM valid");
        RelayPlaybackFence partial=new RelayPlaybackFence(1000,20000,100);
        check(partial.written(960),"partial native write admitted");
        check(partial.state(580,200,10100,false)==RelayPlaybackFence.State.WAITING,"decoder buffer must also be exhausted");
        check(!partial.written(1),"odd PCM16 byte counts rejected");
        check(partial.state(99,200,10100,false)==RelayPlaybackFence.State.INVALID,"native head reset cannot appear as progress");
        RelayPlaybackFence wrap=new RelayPlaybackFence(1000,20000,0xffffff00L);
        check(wrap.written(1920),"frame before uint32 wrap admitted");
        check(wrap.state(704,200,10100,true)==RelayPlaybackFence.State.DRAINED,"bounded uint32 head wrap counted exactly");
        System.out.println("Relay playback checks passed: "+checks);
    }
}
