package in.navrang.gate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Objects;

/** Offline orchestration boundary. Slots implement actual TLS/codec I/O; none is invented here.
 * Every slot must start muted, report admitted only after authenticated speaker admission,
 * report granted only for its observed live grant, and fence immediately on close. Close
 * completion means actual owned resource release. No slot may enable input by itself.
 * Metadata callbacks MUST be dispatched asynchronously on the owner scheduler, never while
 * holding a driver/socket lock. This prevents owner/driver lock inversion.
 */
public final class RelayMediaOwner implements VoiceMediaTransport, AutoCloseable {
    public interface Factory {
        boolean configured(); boolean canPublish();
        Slot create(String room, RelayV1Driver.RetiredEpochs retired);
    }
    public interface Slot {
        String room(); RelayClock clock();
        VoiceAuthority.Pending receive(RelayNativeCredential credential, Result<Receiver> result);
        VoiceAuthority.Pending prepare(Admission admission, PreparationEvents events);
        void activateMedia();
        void close(WebSocketAudioRelayTransport.Completion released);
    }
    public interface PreparationEvents {
        void admitted();
        void granted(Binding observedGrant);
        void ready(Publisher mutedPublisher);
        void failed();
    }
    public interface PreparedResult { void admitted(Prepared prepared); void failed(); }
    /** Actor/lease binding already validated by the authenticated authority, never client claims. */
    public static final class Admission {
        public final String room, subject, lease;
        public final long generation, deadlineUnixMs;
        public final RelayNativeCredential credential;
        public Admission(String lease,long generation,RelayNativeCredential credential) {
            if(!RelayV1Protocol.identifier(lease)||generation<0||generation>RelayV1Protocol.MAX_SAFE_INTEGER||
                    credential==null||credential.role()!=WebSocketAudioRelayTransport.Role.PUBLISHER)
                throw new IllegalArgumentException("Actor-bound speaker admission required");
            this.room=credential.room();this.subject=credential.subject();this.lease=lease;
            this.generation=generation;this.deadlineUnixMs=credential.expiresAtMs();this.credential=credential;
        }
    }
    /** Exact committed controller receipt and observed live grant must agree on all fields. */
    public static final class Binding {
        public final String room,subject,lease,grantId;
        public final long generation,epoch,deadlineUnixMs;
        public Binding(String room,String subject,String lease,long generation,String grantId,long epoch,long deadlineUnixMs){
            if(!RelayV1Protocol.identifier(room)||!RelayV1Protocol.identifier(subject)||!RelayV1Protocol.identifier(lease)||
                    !RelayV1Protocol.identifier(grantId)||generation<0||generation>RelayV1Protocol.MAX_SAFE_INTEGER||
                    epoch<=0||epoch>RelayV1Protocol.MAX_UINT32||deadlineUnixMs<=0||deadlineUnixMs>RelayV1Protocol.MAX_SAFE_INTEGER)
                throw new IllegalArgumentException("Exact relay receipt required");
            this.room=room;this.subject=subject;this.lease=lease;this.generation=generation;
            this.grantId=grantId;this.epoch=epoch;this.deadlineUnixMs=deadlineUnixMs;
        }
        boolean matches(Admission a){return room.equals(a.room)&&subject.equals(a.subject)&&lease.equals(a.lease)&&
            generation==a.generation&&deadlineUnixMs<=a.deadlineUnixMs;}
        boolean same(Binding b){return b!=null&&room.equals(b.room)&&subject.equals(b.subject)&&lease.equals(b.lease)&&
            generation==b.generation&&grantId.equals(b.grantId)&&epoch==b.epoch&&deadlineUnixMs==b.deadlineUnixMs;}
    }
    private final Factory factory;
    private final WebSocketAudioRelayTransport.Scheduler scheduler;
    // Retained across room release, identity changes and foreground cycles; never reset to regain capacity.
    private final RelayV1Driver.RetiredEpochs retired=new RelayV1Driver.RetiredEpochs();
    private final Map<String,Entry> rooms=new HashMap<>();
    private final IdentityHashMap<RelayClock,Boolean> clocks=new IdentityHashMap<>();
    private boolean foreground,closed,poisoned;private long lastNow=-1;
    private final class Entry {
        final String room;final Slot slot;final RelayClock clock;
        boolean ended,released;VoiceAuthority.Pending releaseTimer,idleTimer;
        Prepared prepared;Result<Receiver> listener;Receiver receiver;VoiceAuthority.Pending receiving;
        Entry(String room,Slot slot){this.room=room;this.slot=slot;this.clock=slot.clock();}
    }
    /** Single-use preparation owned by one identity epoch. Cancellation also revokes handoff. */
    public final class Prepared implements VoiceAuthority.Pending {
        private final Entry entry;private final Admission admission;private final PreparedResult result;
        private VoiceAuthority.Pending opening,expiry;private Binding observed,committed;
        private Publisher publisher;private Result<Credential> commitResult;private Result<Publisher> claimResult,publisherResult;
        private boolean admitted,settled,claimed,ended;
        private Prepared(Entry entry,Admission admission,PreparedResult result){this.entry=entry;this.admission=admission;this.result=result;}
        /** Invoke only after backend commit of the exact prepared controller receipt. */
        public void committed(Binding binding,Result<Credential> result){synchronized(RelayMediaOwner.this){
            Objects.requireNonNull(result);
            if(!usable(this)||!admitted||committed!=null||binding==null||!binding.matches(admission)||
                    !live(entry,binding.deadlineUnixMs)){safe(result::failed);cancel();return;}
            committed=binding;commitResult=result;handoff(this);
        }}
        @Override public void cancel(){synchronized(RelayMediaOwner.this){end(entry,true);}}
    }
    private final class Ticket implements Credential {
        final Prepared prepared;Ticket(Prepared prepared){this.prepared=prepared;}
        public long expiresAtMs(){return prepared.committed.deadlineUnixMs;}
        public void destroy(){prepared.cancel();}
        public String toString(){return "RelayPreparedHandle[redacted]";}
    }
    public RelayMediaOwner(Factory factory,WebSocketAudioRelayTransport.Scheduler scheduler){
        this.factory=Objects.requireNonNull(factory);this.scheduler=Objects.requireNonNull(scheduler);
    }
    @Override public synchronized boolean configured(){try{return !closed&&!poisoned&&factory.configured();}catch(RuntimeException e){return false;}}
    @Override public synchronized boolean available(){return configured()&&foreground;}
    @Override public synchronized boolean canPublish(){try{return available()&&factory.canPublish();}catch(RuntimeException e){return false;}}
    private long now(){long value;try{value=scheduler.now();}catch(RuntimeException e){value=-1;}
        if(value<0||value<lastNow){poisoned=true;return -1;}lastNow=value;return value;}
    /** Allocates at most two separate room clocks, including slots awaiting release. */
    private Entry entry(String room){
        Entry old=rooms.get(room);if(old!=null)return old.ended?null:old;
        if(!available()||!RelayV1Protocol.identifier(room)||rooms.size()>=2)return null;
        Slot slot=null;
        try{slot=factory.create(room,retired);
            if(slot==null||!room.equals(slot.room())||slot.clock()==null||clocks.containsKey(slot.clock()))throw new IllegalStateException();
            Entry created=new Entry(room,slot);rooms.put(room,created);clocks.put(created.clock,Boolean.TRUE);return created;
        }catch(RuntimeException failure){poisoned=true;if(slot!=null)try{slot.close(ok->{});}catch(RuntimeException ignored){}return null;}
    }
    public synchronized boolean observeAuthenticated(String room,long serverUnixMs,long sent,long received){
        Entry entry=entry(room);if(entry==null)return false;
        boolean valid=entry.clock.observeAuthenticated(serverUnixMs,sent,received);
        if(!valid)end(entry,true);
        else if(entry.prepared==null&&entry.listener==null){
            if(entry.idleTimer!=null)safe(entry.idleTimer::cancel);
            try{entry.idleTimer=scheduler.delay(()->{synchronized(RelayMediaOwner.this){
                if(entry.prepared==null&&entry.listener==null)end(entry,false);
            }},5000);if(entry.idleTimer==null){end(entry,true);return false;}}
            catch(RuntimeException failure){end(entry,true);return false;}
        }
        return valid;
    }
    /** Release a probe-only room after authority cancellation/failure. Active media is untouched. */
    public synchronized void discardRoom(String room){Entry e=rooms.get(room);if(e!=null&&e.prepared==null&&e.listener==null)end(e,false);}
    private boolean live(Entry entry,long unix){long elapsed=now(),upper=entry.clock.serverUpperBoundUnixMs();
        return elapsed>=0&&upper>=0&&upper<unix&&!entry.ended&&available();}
    private boolean usable(Prepared p){return !p.ended&&p.entry.prepared==p&&live(p.entry,p.admission.deadlineUnixMs)&&
        now()<p.admission.credential.deadlineElapsedMs()&&!p.admission.credential.revoked();}
    public synchronized VoiceAuthority.Pending prepare(Admission admission,PreparedResult result){
        Objects.requireNonNull(result);
        Entry entry=admission==null?null:rooms.get(admission.room);
        if(!canPublish()||entry==null||entry.prepared!=null||entry.listener!=null||!live(entry,admission.deadlineUnixMs)){
            if(admission!=null)admission.credential.destroy();safe(result::failed);return ()->{};}
        Prepared p=new Prepared(entry,admission,result);entry.prepared=p;
        if(entry.idleTimer!=null)safe(entry.idleTimer::cancel);entry.idleTimer=null;
        try{
            long remaining=admission.credential.deadlineElapsedMs()-now();
            if(remaining<=0)throw new IllegalStateException();
            p.expiry=scheduler.delay(p::cancel,remaining);if(p.expiry==null)throw new IllegalStateException();
            VoiceAuthority.Pending opening=entry.slot.prepare(admission,new PreparationEvents(){
                public void admitted(){synchronized(RelayMediaOwner.this){
                    if(!usable(p)||p.admitted){end(entry,true);return;}p.admitted=true;
                    try{result.admitted(p);}catch(RuntimeException failure){end(entry,true);}
                }}
                public void granted(Binding binding){synchronized(RelayMediaOwner.this){
                    if(!usable(p)||!p.admitted||p.observed!=null||binding==null||!binding.matches(admission)){
                        end(entry,true);return;}
                    p.observed=binding;handoff(p);
                }}
                public void ready(Publisher publisher){synchronized(RelayMediaOwner.this){
                    if(publisher==null||!usable(p)||!p.claimed||p.publisher!=null||p.claimResult==null||
                            !p.committed.same(p.observed)||!live(entry,p.committed.deadlineUnixMs)){
                        if(publisher!=null)safe(publisher::close);end(entry,true);return;}
                    p.publisher=publisher;deliverPublisher(p);
                }}
                public void failed(){synchronized(RelayMediaOwner.this){end(entry,true);}}
            });
            if(p.ended){if(opening!=null)safe(opening::cancel);}else{p.opening=opening;if(opening==null)end(entry,true);}
        }catch(RuntimeException failure){end(entry,true);}
        return p;
    }
    private void handoff(Prepared p){
        if(p.committed==null||p.observed==null||p.settled)return;
        if(!usable(p)||!p.committed.same(p.observed)||!live(p.entry,p.committed.deadlineUnixMs)){end(p.entry,true);return;}
        p.settled=true;Result<Credential> result=p.commitResult;p.commitResult=null;
        try{result.ready(new Ticket(p));}catch(RuntimeException failure){end(p.entry,true);}
    }
    @Override public synchronized VoiceAuthority.Pending preparePublisher(Credential credential,Result<Publisher> result){
        Objects.requireNonNull(result);
        Prepared p=credential instanceof RelayMediaOwner.Ticket?((Ticket)credential).prepared:null;
        if(p==null||rooms.get(p.entry.room)!=p.entry||!p.settled||p.claimed||!usable(p)||!live(p.entry,p.committed.deadlineUnixMs)){
            if(credential!=null)safe(credential::destroy);safe(result::failed);return ()->{};}
        p.claimed=true;p.claimResult=result;
        try{p.entry.slot.activateMedia();}catch(RuntimeException failure){p.cancel();}
        return p;
    }
    private void deliverPublisher(Prepared p){
        Result<Publisher> result=p.claimResult;p.claimResult=null;p.publisherResult=result;
        Publisher handle=new Publisher(){
            public void microphone(boolean enabled){microphone(enabled,new InputResult(){public void applied(boolean value){}public void failed(){}});}
            public void microphone(boolean enabled,InputResult callback){synchronized(RelayMediaOwner.this){
                if(!enabled){p.cancel();safe(()->callback.applied(false));return;}
                if(!usable(p)||!p.claimed||!live(p.entry,p.committed.deadlineUnixMs)){safe(callback::failed);p.cancel();return;}
                try{p.publisher.microphone(true,new InputResult(){
                    public void applied(boolean value){synchronized(RelayMediaOwner.this){
                        if(!value||!usable(p)||!live(p.entry,p.committed.deadlineUnixMs)){safe(callback::failed);p.cancel();return;}
                        safe(()->callback.applied(true));}}
                    public void failed(){synchronized(RelayMediaOwner.this){safe(callback::failed);p.cancel();}}
                });}catch(RuntimeException failure){safe(callback::failed);p.cancel();}
            }}
            public void close(){p.cancel();}
        };
        try{result.ready(handle);}catch(RuntimeException failure){p.cancel();}
    }
    @Override public synchronized VoiceAuthority.Pending receive(Credential credential,Result<Receiver> result){
        Objects.requireNonNull(result);
        RelayNativeCredential auth=credential instanceof RelayNativeCredential?(RelayNativeCredential)credential:null;
        Entry e=auth==null?null:rooms.get(auth.room());
        if(e==null||auth.role()!=WebSocketAudioRelayTransport.Role.RECEIVER||e.listener!=null||e.prepared!=null||!live(e,auth.expiresAtMs())){
            if(credential!=null)safe(credential::destroy);safe(result::failed);return ()->{};}
        e.listener=result;if(e.idleTimer!=null)safe(e.idleTimer::cancel);e.idleTimer=null;
        try{VoiceAuthority.Pending pending=e.slot.receive(auth,new Result<Receiver>(){
            public void ready(Receiver receiver){synchronized(RelayMediaOwner.this){
                if(receiver==null||e.ended||!live(e,auth.expiresAtMs())){if(receiver!=null)safe(receiver::close);end(e,true);return;}
                e.receiver=receiver;try{result.ready(()->{synchronized(RelayMediaOwner.this){end(e,false);}});}catch(RuntimeException failure){end(e,true);}
            }}
            public void failed(){synchronized(RelayMediaOwner.this){end(e,true);}}
            public void disconnected(){synchronized(RelayMediaOwner.this){end(e,true);}}
        });if(e.ended){if(pending!=null)safe(pending::cancel);}else{e.receiving=pending;if(pending==null)end(e,true);}
        }catch(RuntimeException failure){end(e,true);}
        return ()->{synchronized(RelayMediaOwner.this){end(e,false);}};
    }
    private void end(Entry e,boolean notify){
        if(e.ended)return;e.ended=true;if(e.idleTimer!=null)safe(e.idleTimer::cancel);e.idleTimer=null;
        Prepared p=e.prepared;
        if(p!=null){p.ended=true;if(p.expiry!=null)safe(p.expiry::cancel);if(p.opening!=null)safe(p.opening::cancel);
            p.admission.credential.destroy();if(p.publisher!=null)safe(p.publisher::close);
            Result<Credential> pending=p.commitResult;p.commitResult=null;if(pending!=null)safe(pending::failed);
            if(p.claimResult!=null){Result<Publisher> claim=p.claimResult;p.claimResult=null;safe(claim::failed);}
            if(notify&&p.publisherResult!=null){Result<Publisher> active=p.publisherResult;p.publisherResult=null;safe(active::disconnected);}
            if(notify&&!p.settled)safe(p.result::failed);}
        if(e.receiving!=null)safe(e.receiving::cancel);if(e.receiver!=null)safe(e.receiver::close);
        try{e.releaseTimer=scheduler.delay(()->{synchronized(RelayMediaOwner.this){released(e,false);}},2000);
            if(e.releaseTimer==null)poisoned=true;
        }catch(RuntimeException failure){poisoned=true;}
        try{e.slot.close(ok->{synchronized(RelayMediaOwner.this){released(e,ok);}});}catch(RuntimeException failure){released(e,false);}
        e.clock.close();
        if(notify&&e.listener!=null){if(e.receiver==null)safe(e.listener::failed);else safe(e.listener::disconnected);}
    }
    private void released(Entry e,boolean success){
        if(e.released)return;e.released=true;if(e.releaseTimer!=null)safe(e.releaseTimer::cancel);
        if(!success){poisoned=true;stop();return;}rooms.remove(e.room,e);clocks.remove(e.clock);
    }
    @Override public synchronized void foreground(boolean value){foreground=value;if(!value)stop();}
    @Override public synchronized void authorizationChanged(){stop();}
    @Override public synchronized void stop(){for(Entry e:new ArrayList<>(rooms.values()))end(e,true);}
    @Override public synchronized void close(){closed=true;stop();}
    private static void safe(Runnable action){try{action.run();}catch(RuntimeException ignored){}}
}
