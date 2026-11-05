package in.navrang.gate;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/** Actual per-room native ports. Construction performs no network, credential or audio work. */
public final class NativeRelayOwnerRuntime implements VoiceMediaTransport,GateRelayAuthority.Admission,AutoCloseable {
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final WebSocketAudioRelayTransport.Scheduler loop=new WebSocketAudioRelayTransport.Scheduler(){
        public long now(){return SystemClock.elapsedRealtime();}
        public VoiceAuthority.Pending delay(Runnable work,long ms){
            if(!handler.postDelayed(work,ms))throw new IllegalStateException("Relay owner stopped");
            return ()->handler.removeCallbacks(work);
        }
    };
    private final AtomicLong identityEpoch=new AtomicLong();
    private final RelayMediaOwner owner;private final NativeRelayClockProbe probe;
    public NativeRelayOwnerRuntime(Context context,String origin,long referenceAdvancePpm,boolean enabled){
        probe=new NativeRelayClockProbe(origin,loop);
        owner=new RelayMediaOwner(new RelayMediaOwner.Factory(){
            public boolean configured(){return enabled;}
            public boolean canPublish(){return NativeRelayAudio.encoderAvailable();}
            public RelayMediaOwner.Slot create(String room,RelayV1Driver.RetiredEpochs retired){
                return new Slot(context,origin,room,referenceAdvancePpm,retired);
            }
        },loop);
    }
    /** Runs on the authority worker; probe does not consume the one-use WSS upgrade credential. */
    @Override public VoiceAuthority.Pending probe(VoiceAuthority.Identity identity,RelayNativeCredential credential,VoiceAuthority.Result<Boolean> result){
        long epoch=identityEpoch.get();
        try{
            if(!configured())throw new IllegalStateException();
            NativeRelayClockProbe.Sample sample=probe.sample(credential);
            synchronized(this){
                if(identityEpoch.get()!=epoch||credential.revoked()||!owner.observeAuthenticated(credential.room(),sample.serverUnixMs,sample.sentElapsedMs,sample.receivedElapsedMs))throw new IllegalStateException();
            }
            result.success(Boolean.TRUE);
        }catch(Exception failure){owner.discardRoom(credential.room());result.failure();}
        return ()->owner.discardRoom(credential.room());
    }
    @Override public VoiceAuthority.Pending prepare(VoiceAuthority.Identity identity,RelayMediaOwner.Admission admission,RelayMediaOwner.PreparedResult result){return owner.prepare(admission,result);}
    public boolean configured(){return owner.configured();}public boolean available(){return owner.available();}
    public boolean canPublish(){return owner.canPublish();}
    public VoiceAuthority.Pending receive(Credential c,Result<Receiver> r){return owner.receive(c,r);}
    public VoiceAuthority.Pending preparePublisher(Credential c,Result<Publisher> r){return owner.preparePublisher(c,r);}
    public synchronized void foreground(boolean active){if(!active)identityEpoch.incrementAndGet();owner.foreground(active);}
    public synchronized void authorizationChanged(){identityEpoch.incrementAndGet();owner.authorizationChanged();}
    public synchronized void stop(){identityEpoch.incrementAndGet();owner.stop();}public synchronized void close(){identityEpoch.incrementAndGet();owner.close();}
    private void post(Runnable work){if(!handler.post(work))throw new IllegalStateException("Relay owner stopped");}

    /** No callback entering RelayMediaOwner is invoked while a driver/socket lock is held. */
    private final class Slot implements RelayMediaOwner.Slot {
        final String room;final RelayClock clock;final RelayV1Driver driver;
        final AtomicBoolean cancelled=new AtomicBoolean(),input=new AtomicBoolean(),txPending=new AtomicBoolean();
        RelayNativeCredential credential;
        volatile WebSocketAudioRelayTransport.Connection connection;
        RelayMediaOwner.Admission admission;RelayMediaOwner.PreparationEvents preparation;
        VoiceAuthority.Pending timeout,expiry;volatile boolean opened;
        Slot(Context context,String origin,String room,long ppm,RelayV1Driver.RetiredEpochs retired){
            this.room=room;clock=new RelayClock(loop,0,ppm);
            driver=new RelayV1Driver(clock,new NativeRelaySocket(origin,clock),new NativeRelayAudio(context,clock),retired);
            driver.bindOwner(new Object());
        }
        public String room(){return room;}public RelayClock clock(){return clock;}
        private void deadlines(RelayNativeCredential auth,Runnable failed){
            timeout=loop.delay(()->{if(!opened){cancelled.set(true);abort(ok->{});failed.run();}},5000);
            expiry=loop.delay(()->{cancelled.set(true);abort(ok->{});failed.run();},Math.max(1,auth.deadlineElapsedMs()-loop.now()));
        }
        public VoiceAuthority.Pending receive(RelayNativeCredential auth,Result<Receiver> result){
            credential=auth;deadlines(auth,()->result.failed());
            connection=driver.open(auth,new WebSocketAudioRelayTransport.Events(){
                public void opened(){post(()->{if(cancelled.get())return;opened=true;result.ready(()->close(ok->{}));});}
                public void disconnected(){cancelled.set(true);post(result::disconnected);}
                public void captured(byte[] bytes,long captured){}
                public void received(byte[] bytes,Runnable consumed){
                    WebSocketAudioRelayTransport.Connection active=connection;
                    if(cancelled.get()||active==null){consumed.run();return;}
                    long expires=Math.min(auth.deadlineElapsedMs(),clock.now()+250);
                    if(!active.playAudio(bytes,expires,ok->{if(ok&&!cancelled.get())consumed.run();else{cancelled.set(true);abort(done->{});post(result::disconnected);}})){
                        cancelled.set(true);abort(done->{});post(result::disconnected);
                    }
                }
            });
            return ()->close(ok->{});
        }
        public VoiceAuthority.Pending prepare(RelayMediaOwner.Admission admission,RelayMediaOwner.PreparationEvents events){
            this.admission=admission;this.preparation=events;this.credential=admission.credential;
            deadlines(admission.credential,events::failed);
            connection=driver.openPrepared(admission.credential,new RelayV1Driver.PreparedEvents(){
                public void admitted(){post(()->{if(!cancelled.get())events.admitted();});}
                public void granted(RelayV1Protocol.Grant grant){
                    RelayMediaOwner.Binding binding=new RelayMediaOwner.Binding(room,grant.subject,admission.lease,admission.generation,grant.grantId,grant.epoch,grant.deadlineUnixMs);
                    post(()->{if(!cancelled.get())events.granted(binding);});
                }
                public void opened(){post(()->{if(cancelled.get())return;opened=true;events.ready(new Publisher(){
                    public void microphone(boolean enabled){microphone(enabled,new InputResult(){public void applied(boolean value){}public void failed(){}});}
                    public void microphone(boolean enabled,InputResult result){
                        if(!enabled)input.set(false);
                        WebSocketAudioRelayTransport.Connection active=connection;
                        if(active==null||cancelled.get()){post(result::failed);return;}
                        active.microphone(enabled,new InputResult(){
                            public void applied(boolean value){
                                if(value&&!cancelled.get())input.set(true);
                                post(()->{if(cancelled.get()&&value)result.failed();else result.applied(value);});
                            }
                            public void failed(){input.set(false);post(result::failed);}
                        });
                    }
                    public void close(){Slot.this.close(ok->{});}
                });});}
                public void disconnected(){cancelled.set(true);input.set(false);post(events::failed);}
                public void captured(byte[] bytes,long captured){
                    WebSocketAudioRelayTransport.Connection active=connection;
                    long now=clock.now();
                    if(cancelled.get()||!input.get()||active==null||captured<0||now<captured||now-captured>=250||!txPending.compareAndSet(false,true))return;
                    long expires=Math.min(admission.credential.deadlineElapsedMs(),captured+250);
                    if(!active.sendAudio(bytes,expires,ok->{txPending.set(false);if(!ok){input.set(false);cancelled.set(true);abort(done->{});post(events::failed);}})){
                        input.set(false);cancelled.set(true);abort(done->{});post(events::failed);
                    }
                }
                public void received(byte[] bytes,Runnable consumed){consumed.run();}
            });
            return ()->close(ok->{});
        }
        public void activateMedia(){
            WebSocketAudioRelayTransport.Connection active=connection;
            if(cancelled.get()||!(active instanceof RelayV1Driver.PreparedConnection))throw new IllegalStateException("Prepared relay unavailable");
            ((RelayV1Driver.PreparedConnection)active).activateMedia();
        }
        private void abort(WebSocketAudioRelayTransport.Completion released){
            WebSocketAudioRelayTransport.Connection active=connection;
            if(active==null)post(()->released.complete(true));else active.abort(ok->post(()->released.complete(ok)));
        }
        public void close(WebSocketAudioRelayTransport.Completion released){
            cancelled.set(true);input.set(false);txPending.set(false);if(credential!=null)credential.destroy();if(timeout!=null)timeout.cancel();if(expiry!=null)expiry.cancel();abort(released);
        }
    }
}
