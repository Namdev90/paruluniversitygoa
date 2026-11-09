package in.navrang.gate;

import java.util.Objects;

/** Bounded async ownership. Admission/completion never means audible playback. */
public final class WebSocketAudioRelayTransport implements VoiceMediaTransport, AutoCloseable {
    public enum Role { RECEIVER, PUBLISHER }
    public interface Authorization extends Credential { Role role(); long deadlineElapsedMs(); boolean revoked(); }
    public interface Scheduler { long now(); VoiceAuthority.Pending delay(Runnable task,long delayMs); }
    public interface Completion { void complete(boolean success); }
    public interface Events {
        void opened(); void disconnected(); void captured(byte[] frame,long capturedElapsedMs);
        void received(byte[] frame,Runnable consumed);
    }
    public interface Connection {
        void microphone(boolean enabled,InputResult result);
        /** Copy on admission; one outstanding native packet. Completion relinquishes the buffer. */
        boolean sendAudio(byte[] frame,long expiresElapsedMs,Completion completion);
        boolean playAudio(byte[] frame,long expiresElapsedMs,Completion completion);
        /** Fence immediately; completion follows owned resource teardown, not just posting stop. */
        void abort(Completion released);
    }
    public interface Driver {
        boolean available(); default boolean configured(){return available();} Connection open(Authorization authorization,Events events);
        default void bindOwner(Object owner) {}
    }
    public static final class Limits {
        public final long frameAgeMs,connectMs,releaseMs,pollMs;
        public Limits(long frameAgeMs,long connectMs,long releaseMs,long pollMs) {
            if(frameAgeMs<20||frameAgeMs>1000||connectMs<1||connectMs>5000||releaseMs<1||releaseMs>5000||pollMs<1||pollMs>100)
                throw new IllegalArgumentException("Invalid relay limits");
            this.frameAgeMs=frameAgeMs;this.connectMs=connectMs;this.releaseMs=releaseMs;this.pollMs=pollMs;
        }
        public static Limits defaults(){return new Limits(250,5000,2000,20);}
    }
    private final boolean enabled;private final Scheduler scheduler;private final Driver driver;private final Limits limits;
    private Request<Receiver> receiver;private Request<Publisher> publisher;
    private boolean foreground,closed,poisoned;private int retiring;private long lastNow=-1;
    private final class Request<T> {
        final Authorization auth;final Role role;final Result<T> result;final Handle handle;final long deadline,connectUntil;
        Connection connection;VoiceAuthority.Pending timer,releaseTimer;InputResult inputResult;
        long inputOperation,inputUntil,packetOperation;boolean ended,opening,opened,ready,micEnabled,packetPending,released,releaseSuccess;
        Runnable consumed;Completion releaseResult;
        Request(Authorization auth,Role role,Result<T> result,long now,long deadline){
            this.auth=auth;this.role=role;this.result=result;this.deadline=deadline;
            connectUntil=Math.min(deadline,add(now,limits.connectMs));handle=new Handle(this);
        }
    }
    private final class Handle implements Receiver,Publisher {
        final Request<?> request;Handle(Request<?> request){this.request=request;}
        public void close(){synchronized(WebSocketAudioRelayTransport.this){retire(request,false,null);}}
        public void microphone(boolean enabled){microphone(enabled,new InputResult(){public void applied(boolean value){}public void failed(){}});}
        public void microphone(boolean enabled,InputResult result){synchronized(WebSocketAudioRelayTransport.this){input(request,enabled,result);}}
    }
    public WebSocketAudioRelayTransport(boolean enabled,Scheduler scheduler,Driver driver,Limits limits){
        this.enabled=enabled;this.scheduler=Objects.requireNonNull(scheduler);this.driver=Objects.requireNonNull(driver);
        this.limits=Objects.requireNonNull(limits);driver.bindOwner(this);
    }
    public synchronized boolean configured(){try{return enabled&&!closed&&!poisoned&&driver.configured();}catch(RuntimeException failure){return false;}}
    public synchronized boolean available(){try{return enabled&&!closed&&!poisoned&&driver.available();}catch(RuntimeException failure){return false;}}
    public synchronized VoiceAuthority.Pending receive(Credential credential,Result<Receiver> result){return submit(credential,Role.RECEIVER,result);}
    public synchronized VoiceAuthority.Pending preparePublisher(Credential credential,Result<Publisher> result){return submit(credential,Role.PUBLISHER,result);}
    private <T> VoiceAuthority.Pending submit(Credential credential,Role role,Result<T> result){
        Objects.requireNonNull(result);long time=now();Authorization auth=credential instanceof Authorization?(Authorization)credential:null;
        long until=-1;boolean usable=false;
        try{if(auth!=null){until=auth.deadlineElapsedMs();usable=auth.role()==role&&!auth.revoked();}}catch(RuntimeException ignored){}
        if(!available()||!foreground||!usable||time<0||until<=time||until-time>60000){destroy(credential);safe(result::failed);return ()->{};}
        retire(role==Role.RECEIVER?receiver:publisher,true,null);
        Request<T> request=new Request<>(auth,role,result,time,until);assign(request);tick(request);
        return ()->{synchronized(WebSocketAudioRelayTransport.this){retire(request,false,null);}};
    }
    @SuppressWarnings("unchecked") private <T> void assign(Request<T> request){if(request.role==Role.RECEIVER)receiver=(Request<Receiver>)request;else publisher=(Request<Publisher>)request;}
    private void start(Request<?> request){
        if(request.opening||request.connection!=null||retiring!=0||!valid(request,now()))return;request.opening=true;
        try{
            Connection connection=driver.open(request.auth,new Events(){
                public void opened(){synchronized(WebSocketAudioRelayTransport.this){request.opened=true;ready(request);}}
                public void disconnected(){synchronized(WebSocketAudioRelayTransport.this){retire(request,true,null);}}
                public void captured(byte[] bytes,long captured){synchronized(WebSocketAudioRelayTransport.this){
                    if(request.role==Role.PUBLISHER&&request.micEnabled)packet(request,bytes,captured,null);
                }}
                public void received(byte[] bytes,Runnable consumed){synchronized(WebSocketAudioRelayTransport.this){
                    if(request.role==Role.RECEIVER)packet(request,bytes,now(),consumed);else safe(consumed);
                }}
            });
            request.connection=connection;request.opening=false;
            if(request.ended){if(request.released&&connection!=null)connection.abort(ok->{});else release(request);}else if(connection==null)retire(request,true,null);else ready(request);
        }catch(RuntimeException failure){request.opening=false;poison();}
    }
    @SuppressWarnings("unchecked") private <T> void ready(Request<T> request){
        long time=now();if(!valid(request,time)||request.ready||!request.opened||request.connection==null)return;
        if(time>=request.connectUntil){retire(request,true,null);return;}request.ready=true;
        try{request.result.ready((T)request.handle);}catch(RuntimeException failure){retire(request,false,null);}
    }
    private void input(Request<?> request,boolean enabled,InputResult result){
        Objects.requireNonNull(result);
        if(!enabled){retire(request,false,success->{if(success)result.applied(false);else result.failed();});return;}
        if(!valid(request,now())||!request.ready||request.role!=Role.PUBLISHER||request.inputResult!=null){safe(result::failed);return;}
        request.micEnabled=false;request.inputResult=result;long operation=++request.inputOperation;
        request.inputUntil=Math.min(request.deadline,add(now(),limits.connectMs));
        try{request.connection.microphone(true,new InputResult(){
            public void applied(boolean value){synchronized(WebSocketAudioRelayTransport.this){
                if(request.ended||operation!=request.inputOperation||request.inputResult!=result)return;
                if(!value||!valid(request,now())||now()>=request.inputUntil){retire(request,true,null);return;}
                request.inputResult=null;request.micEnabled=true;safe(()->result.applied(true));
            }}
            public void failed(){synchronized(WebSocketAudioRelayTransport.this){if(operation==request.inputOperation)retire(request,true,null);}}
        });}catch(RuntimeException failure){retire(request,true,null);}
    }
    private void packet(Request<?> request,byte[] bytes,long captured,Runnable consumed){
        long time=now();
        if(!valid(request,time)||!request.ready||request.packetPending||bytes==null||bytes.length<1||bytes.length>2048||
                captured<0||captured>time||time-captured>=limits.frameAgeMs){safe(consumed);return;}
        request.packetPending=true;request.consumed=consumed;long operation=++request.packetOperation;
        long expires=Math.min(request.deadline,add(captured,limits.frameAgeMs));
        Completion completion=success->{synchronized(WebSocketAudioRelayTransport.this){
            if(operation!=request.packetOperation||!request.packetPending)return;
            request.packetPending=false;Runnable done=request.consumed;request.consumed=null;
            if(!success)retire(request,true,null);safe(done);
        }};
        try{
            boolean admitted=request.role==Role.PUBLISHER?request.connection.sendAudio(bytes,expires,completion):request.connection.playAudio(bytes,expires,completion);
            if(!admitted)completion.complete(false);
        }catch(RuntimeException failure){completion.complete(false);}
    }
    private void tick(Request<?> request){
        request.timer=null;long time=now();if(!valid(request,time))return;
        if(!request.ready&&time>=request.connectUntil||request.inputResult!=null&&time>=request.inputUntil){retire(request,true,null);return;}
        start(request);if(request.ended)return;
        try{request.timer=scheduler.delay(()->{synchronized(WebSocketAudioRelayTransport.this){tick(request);}},Math.min(limits.pollMs,Math.max(1,request.deadline-time)));}
        catch(RuntimeException failure){retire(request,true,null);}
        if(request.timer==null&&!request.ended)retire(request,true,null);
    }
    private boolean valid(Request<?> request,long time){
        if(request==null||request.ended)return false;boolean authorized=false;
        try{authorized=request.auth.role()==request.role&&!request.auth.revoked()&&time<request.auth.deadlineElapsedMs();}catch(RuntimeException ignored){}
        if(time<0||time>=request.deadline||!foreground||closed||poisoned||!authorized||(request.role==Role.RECEIVER?receiver:publisher)!=request){retire(request,true,null);return false;}return true;
    }
    private void retire(Request<?> request,boolean notify,Completion done){
        if(request==null){complete(done,true);return;}
        if(request.ended){complete(done,request.released&&request.releaseSuccess);return;}
        request.ended=true;request.micEnabled=false;request.inputOperation++;request.packetOperation++;request.releaseResult=done;
        if(receiver==request)receiver=null;if(publisher==request)publisher=null;
        if(request.timer!=null)safe(request.timer::cancel);request.timer=null;
        Runnable consumed=request.consumed;request.consumed=null;request.packetPending=false;
        InputResult input=request.inputResult;request.inputResult=null;retiring++;
        try{request.releaseTimer=scheduler.delay(()->{synchronized(WebSocketAudioRelayTransport.this){released(request,false);}},limits.releaseMs);}
        catch(RuntimeException failure){poison();}
        if(request.releaseTimer==null)poison();
        // Reentrant open must first return its connection; posting stop is not a release acknowledgement.
        if(!request.opening)release(request);
        destroy(request.auth);safe(consumed);if(input!=null)safe(input::failed);
        if(notify){if(request.ready)safe(request.result::disconnected);else safe(request.result::failed);}
    }
    private void release(Request<?> request){
        if(request.released)return;
        if(request.connection==null){released(request,true);return;}
        try{request.connection.abort(success->{synchronized(WebSocketAudioRelayTransport.this){released(request,success);}});}
        catch(RuntimeException failure){released(request,false);}
    }
    private void released(Request<?> request,boolean success){
        if(request.released)return;request.released=true;request.releaseSuccess=success;
        if(request.releaseTimer!=null)safe(request.releaseTimer::cancel);request.releaseTimer=null;
        retiring=Math.max(0,retiring-1);if(!success)poison();Completion done=request.releaseResult;request.releaseResult=null;complete(done,success);
    }
    private void poison(){if(poisoned)return;poisoned=true;stop();}
    private long now(){long time;try{time=scheduler.now();}catch(RuntimeException failure){time=-1;}
        if(time<0||time<lastNow){poison();return -1;}lastNow=time;return time;}
    private static long add(long a,long b){return a>Long.MAX_VALUE-b?Long.MAX_VALUE:a+b;}
    private static void safe(Runnable work){if(work!=null)try{work.run();}catch(RuntimeException ignored){}}
    private static void complete(Completion completion,boolean success){if(completion!=null)safe(()->completion.complete(success));}
    private static void destroy(Credential credential){if(credential!=null)safe(credential::destroy);}
    public synchronized void foreground(boolean value){foreground=value;if(!value)stop();}
    public synchronized void authorizationChanged(){stop();}
    public synchronized void reconnecting(){stop();}
    public synchronized void stop(){retire(publisher,true,null);retire(receiver,true,null);}
    public synchronized void close(){closed=true;stop();}
}
