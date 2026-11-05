package in.navrang.gate;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import co.daily.CallClient;
import co.daily.CallClientListener;
import co.daily.model.CallState;
import co.daily.model.MeetingToken;
import co.daily.settings.ClientSettingsUpdate;
import co.daily.settings.Disable;
import co.daily.settings.InputSettingsUpdate;
import co.daily.settings.PublishingSettingsUpdate;
import java.util.concurrent.atomic.AtomicBoolean;

/** Actual co.daily:client:0.41.0 calls. No automatic production factory registration. */
public final class DailySdkDriver implements DailySdkSession.Driver {
    private static final AtomicBoolean CLIENT_OWNED=new AtomicBoolean();
    private final CallClient client;
    private final Handler owner;
    private boolean released;
    private long inputRevision;
    private Runnable disconnected=() -> {};
    private final CallClientListener listener=new CallClientListener() {
        @Override public void onCallStateUpdated(CallState state) { if(!released && state==CallState.left)disconnected.run(); }
        @Override public void onError(String ignored) { if(!released)disconnected.run(); }
    };
    public DailySdkDriver(Context context, Handler owner) {
        this.owner=owner;
        if(Looper.myLooper()!=owner.getLooper())throw new IllegalStateException("Daily owner thread required.");
        if(!CLIENT_OWNED.compareAndSet(false,true))throw new IllegalStateException("A Daily client still owns native audio.");
        CallClient created=null;
        try {
            created=new CallClient(context.getApplicationContext(),null,owner);created.addListener(listener);client=created;
        } catch(RuntimeException|LinkageError failure) {
            // If allocation/release is uncertain, retain the process-wide fence.
            if(created!=null)try{created.release();CLIENT_OWNED.set(false);}catch(RuntimeException|LinkageError ignored){}
            throw failure;
        }
    }
    private void requireOwner() {
        if(Looper.myLooper()!=owner.getLooper())throw new IllegalStateException("Daily owner thread required.");
    }
    public static DailySdkSession createSession(Context context, Handler owner) {
        return new DailySdkSession(loop(owner),()->new DailySdkDriver(context.getApplicationContext(),owner));
    }
    /** Optional factory used only by an explicitly configured native voice build. */
    public static VoiceMediaTransport createTransport(Context context, Handler owner) {
        Context application=context.getApplicationContext();
        return new DailyMediaTransport(loop(owner),()->new DailySdkDriver(application,owner));
    }
    private static DailySdkSession.Loop loop(Handler owner) {
        return new DailySdkSession.Loop(){
            public boolean current(){return Looper.myLooper()==owner.getLooper();}
            public long now(){return SystemClock.elapsedRealtime();}
            public void post(Runnable work){owner.post(work);}
            public void delay(Runnable work,long ms){owner.postDelayed(work,Math.max(0,ms));}
        };
    }
    @Override public void join(DailyNativeCredential credential, DailySdkSession.Completion completed, Runnable disconnected) {
        requireOwner();
        this.disconnected=disconnected;
        InputSettingsUpdate inputs=new InputSettingsUpdate(new Disable<>(),new Disable<>(),new Disable<>());
        PublishingSettingsUpdate publishing=new PublishingSettingsUpdate(new Disable<>(),new Disable<>(),null,null,new Disable<>());
        ClientSettingsUpdate muted=new ClientSettingsUpdate.Builder().withInputSettings(inputs).withPublishingSettings(publishing).build();
        client.join(credential.roomUrl,new MeetingToken(credential.consumeToken()),muted,
            result->completed.done(!released && !result.isError() && result.getSuccess()!=null));
    }
    @Override public void microphone(boolean enabled, DailySdkSession.Completion completed) {
        requireOwner();
        if(released){completed.done(false);return;}
        final long revision=++inputRevision;
        if(enabled)client.setIsPublishing(false,true,publishing->{
            if(released||revision!=inputRevision||publishing.isError()){completed.done(false);return;}
            client.setInputsEnabled(false,true,input->completed.done(!released&&revision==inputRevision&&!input.isError()));
        });
        else client.setInputsEnabled(false,false,input->{
            if(released||revision!=inputRevision||input.isError()){completed.done(false);return;}
            client.setIsPublishing(false,false,publishing->completed.done(!released&&revision==inputRevision&&!publishing.isError()));
        });
    }
    @Override public void leave(DailySdkSession.Completion completed) {
        requireOwner();
        if(released){completed.done(false);return;}client.leave(result->completed.done(!released&&!result.isError()));
    }
    @Override public void release() {
        requireOwner();
        if(released)return;released=true;disconnected=()->{};
        try{client.removeListener(listener);}finally{client.release();CLIENT_OWNED.set(false);}
    }
}
