package in.navrang.gate;

/** One mono20ms PCM packet's native progress and deadlines; never an audible-cutoff proof. */
final class RelayPlaybackFence {
    enum State { WAITING,DRAINED,EXPIRED,INVALID }
    private static final long UINT32=0xffffffffL;
    private final long elapsedDeadline,unixDeadline,startHead;
    private int bytesWritten;
    static boolean outputCanStart(int effectiveBufferFrames,int startThresholdFrames){
        return effectiveBufferFrames>0&&effectiveBufferFrames<=960&&startThresholdFrames>0&&startThresholdFrames<=effectiveBufferFrames;
    }
    RelayPlaybackFence(long elapsedDeadline,long unixDeadline,long startHead){
        if(elapsedDeadline<=0||unixDeadline<=0||startHead<0||startHead>UINT32)throw new IllegalArgumentException("Invalid playback fence");
        this.elapsedDeadline=elapsedDeadline;this.unixDeadline=unixDeadline;this.startHead=startHead;
    }
    boolean written(int bytes){
        if(bytes<0||(bytes&1)!=0||bytesWritten>1920-bytes)return false;
        bytesWritten+=bytes;return true;
    }
    State state(long head,long elapsed,long serverUpper,boolean decoderExhausted){
        if(elapsed<0||serverUpper<0||elapsed>=elapsedDeadline||serverUpper>=unixDeadline)return State.EXPIRED;
        if(head<0||head>UINT32)return State.INVALID;
        long played=(head-startHead)&UINT32;
        if(played>bytesWritten/2)return State.INVALID;
        return decoderExhausted&&bytesWritten>0&&played==bytesWritten/2?State.DRAINED:State.WAITING;
    }
}
