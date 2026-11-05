package in.navrang.gate;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

/** App-owned composition of actual native ports, with no issuer or credential fabrication.
 * The default application provider remains disabled. An authorized issuer/controller bridge
 * must supply compatible authority before this owner can be composed into a live service.
 */
public final class NativeRelayRuntime implements VoiceMediaTransport,AutoCloseable {
    private final RelayClock clock;
    private final WebSocketAudioRelayTransport media;

    public NativeRelayRuntime(Context context,String approvedOrigin,long evidencedSkewMs,long evidencedDriftPpm,boolean enabled){
        Handler handler=new Handler(Looper.getMainLooper());
        WebSocketAudioRelayTransport.Scheduler loop=new WebSocketAudioRelayTransport.Scheduler(){
            public long now(){return SystemClock.elapsedRealtime();}
            public VoiceAuthority.Pending delay(Runnable task,long ms){
                if(!handler.postDelayed(task,ms))throw new IllegalStateException("Relay owner stopped");
                return ()->handler.removeCallbacks(task);
            }
        };
        clock=new RelayClock(loop,evidencedSkewMs,evidencedDriftPpm);
        RelayV1Driver driver=new RelayV1Driver(clock,new NativeRelaySocket(approvedOrigin,clock),new NativeRelayAudio(context,clock));
        media=new WebSocketAudioRelayTransport(enabled,clock,driver,WebSocketAudioRelayTransport.Limits.defaults());
    }
    public RelayClock clock(){return clock;}
    /** Invoke only after authenticated authority response and current-identity validation.
     * No sampling request, retry, credential or network connection is created here.
     */
    public boolean observeAuthenticated(long serverUnixMs,long sentElapsedMs,long receivedElapsedMs){
        boolean valid=clock.observeAuthenticated(serverUnixMs,sentElapsedMs,receivedElapsedMs);
        if(!valid)media.stop();return valid;
    }
    @Override public boolean configured(){return media.configured();}
    @Override public boolean available(){return media.available();}
    @Override public boolean canPublish(){return available()&&NativeRelayAudio.encoderAvailable();}
    @Override public VoiceAuthority.Pending receive(Credential credential,Result<Receiver> result){return media.receive(credential,result);}
    @Override public VoiceAuthority.Pending preparePublisher(Credential credential,Result<Publisher> result){
        if(!canPublish()){
            if(credential!=null)credential.destroy();result.failed();return ()->{};
        }
        return media.preparePublisher(credential,result);
    }
    @Override public void foreground(boolean active){media.foreground(active);}
    @Override public void authorizationChanged(){media.authorizationChanged();clock.close();}
    @Override public void stop(){media.stop();}
    @Override public void close(){media.close();clock.close();}
}
