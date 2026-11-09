package in.navrang.gate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Synthetic orchestration tests: no network, credentials issued, microphone, or codecs. */
public final class RelayMediaOwnerTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static final class Loop implements WebSocketAudioRelayTransport.Scheduler {
        long elapsed=1000;final List<Runnable> timers=new ArrayList<>();
        public long now(){return elapsed;}
        public VoiceAuthority.Pending delay(Runnable task,long ms){timers.add(task);return ()->timers.remove(task);}
    }
    static final class Result<T> implements VoiceMediaTransport.Result<T> {
        T value;int failed,disconnected;
        public void ready(T value){this.value=value;}
        public void failed(){failed++;}
        public void disconnected(){disconnected++;}
    }
    static final class Publisher implements VoiceMediaTransport.Publisher {
        int enables,closes;VoiceMediaTransport.InputResult delayed;boolean delay;
        public void microphone(boolean value){if(value)enables++;}
        public void microphone(boolean value,VoiceMediaTransport.InputResult result){
            if(value)enables++;if(delay)delayed=result;else result.applied(value);
        }
        public void close(){closes++;}
    }
    static final class Slot implements RelayMediaOwner.Slot {
        final String room;final RelayClock clock;final Publisher publisher=new Publisher();
        RelayMediaOwner.PreparationEvents events;WebSocketAudioRelayTransport.Completion released;
        int activations,closes,cancels;boolean automaticRelease=true;
        Slot(String room,Loop loop){this.room=room;clock=new RelayClock(loop,0,0);}
        public String room(){return room;}
        public RelayClock clock(){return clock;}
        public VoiceAuthority.Pending receive(RelayNativeCredential credential,VoiceMediaTransport.Result<VoiceMediaTransport.Receiver> result){return ()->{};}
        public VoiceAuthority.Pending prepare(RelayMediaOwner.Admission admission,RelayMediaOwner.PreparationEvents events){this.events=events;return ()->cancels++;}
        public void activateMedia(){activations++;}
        public void close(WebSocketAudioRelayTransport.Completion completion){closes++;released=completion;if(automaticRelease)completion.complete(true);}
    }
    static final class Factory implements RelayMediaOwner.Factory {
        final Loop loop;final Map<String,Slot> slots=new HashMap<>();RelayV1Driver.RetiredEpochs retired;
        boolean encoder=true;int creates;
        Factory(Loop loop){this.loop=loop;}
        public boolean configured(){return true;}
        public boolean canPublish(){return encoder;}
        public RelayMediaOwner.Slot create(String room,RelayV1Driver.RetiredEpochs retired){
            check(this.retired==null||this.retired==retired,"retirement metadata shared across rooms");this.retired=retired;
            Slot slot=new Slot(room,loop);slots.put(room,slot);creates++;return slot;
        }
    }
    static final class PreparedResult implements RelayMediaOwner.PreparedResult {
        RelayMediaOwner.Prepared prepared;int failed;
        public void admitted(RelayMediaOwner.Prepared prepared){this.prepared=prepared;}
        public void failed(){failed++;}
    }
    static final class Fixture {
        final Loop loop=new Loop();final Factory factory=new Factory(loop);
        final RelayMediaOwner owner=new RelayMediaOwner(factory,loop);
        Fixture(){owner.foreground(true);}
        Slot sample(String room){check(owner.observeAuthenticated(room,1000000,1000,1000),"room probe accepted");return factory.slots.get(room);}
        RelayMediaOwner.Admission admission(String room){return new RelayMediaOwner.Admission("lease1",3,
            new RelayNativeCredential(room,"speaker1",WebSocketAudioRelayTransport.Role.PUBLISHER,11000,1010000,"aaaaaaaa.bbbbbbbb.cccccccc".toCharArray()));}
        RelayMediaOwner.Binding binding(String room){return new RelayMediaOwner.Binding(room,"speaker1","lease1",3,"grant1",1,1009000);}
    }
    static void handoff(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult prepared=new PreparedResult();
        f.owner.prepare(f.admission("room1"),prepared);
        check(slot.activations==0&&prepared.prepared==null,"preparation cannot create audio or claim authority");
        slot.events.admitted();Result<VoiceMediaTransport.Credential> committed=new Result<>();
        prepared.prepared.committed(f.binding("room1"),committed);
        check(committed.value==null&&slot.activations==0,"backend commit alone cannot hand off or activate audio");
        slot.events.granted(f.binding("room1"));
        check(committed.value!=null&&slot.activations==0,"matching live grant permits ticket only");
        Result<VoiceMediaTransport.Publisher> publisher=new Result<>();f.owner.preparePublisher(committed.value,publisher);
        check(slot.activations==1&&publisher.value==null&&slot.publisher.enables==0,"coordinator claim activates muted initialization");
        slot.events.ready(slot.publisher);check(publisher.value!=null&&slot.publisher.enables==0,"ready publisher remains muted");
        publisher.value.microphone(true);check(slot.publisher.enables==1,"claimed committed publisher may enable");
        Result<VoiceMediaTransport.Publisher> replay=new Result<>();f.owner.preparePublisher(committed.value,replay);
        check(replay.failed==1&&slot.closes==1,"ticket replay fails closed and cancels original");
    }
    static void mismatch(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult result=new PreparedResult();
        f.owner.prepare(f.admission("room1"),result);slot.events.admitted();slot.events.granted(f.binding("room1"));
        Result<VoiceMediaTransport.Credential> committed=new Result<>();
        result.prepared.committed(new RelayMediaOwner.Binding("room1","speaker1","lease1",3,"different",1,1009000),committed);
        check(committed.failed==1&&slot.activations==0&&slot.closes==1,"different exact receipt never activates");
    }
    static void cancellation(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult result=new PreparedResult();
        VoiceAuthority.Pending pending=f.owner.prepare(f.admission("room1"),result);slot.events.admitted();pending.cancel();
        slot.events.granted(f.binding("room1"));slot.events.ready(slot.publisher);
        check(slot.activations==0&&slot.publisher.closes==1&&slot.closes==1,"late grant/readiness cannot revive canceled admission");
    }
    static void isolatedClocksAndRelease(){
        Fixture f=new Fixture();Slot first=f.sample("room1");first.automaticRelease=false;
        PreparedResult result=new PreparedResult();f.owner.prepare(f.admission("room2"),result);
        check(result.failed==1&&f.factory.creates==1,"room1 time never qualifies room2");
        Slot second=f.sample("room2");check(first.clock!=second.clock,"room actors use separate clocks");
        f.owner.authorizationChanged();
        check(!f.owner.observeAuthenticated("room1",1000000,1000,1000),"same-room reconnect waits for release acknowledgement");
        first.released.complete(true);check(f.owner.observeAuthenticated("room1",1000000,1000,1000),"fresh room clock allocated after actual release");
    }
    static void capabilityAndFailure(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");f.factory.encoder=false;PreparedResult result=new PreparedResult();
        f.owner.prepare(f.admission("room1"),result);check(result.failed==1&&slot.events==null,"missing encoder rejects before speaker admission");
        f.factory.encoder=true;f.owner.prepare(f.admission("room1"),new PreparedResult());slot.automaticRelease=false;
        f.owner.stop();slot.released.complete(false);check(!f.owner.configured(),"uncertain release poisons whole owner");
    }
    static void readyBeforeClaim(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult result=new PreparedResult();
        f.owner.prepare(f.admission("room1"),result);slot.events.admitted();slot.events.ready(slot.publisher);
        check(slot.publisher.closes==1&&slot.closes==1&&slot.activations==0,"native readiness before coordinator claim is protocol failure");
    }
    static void probeCleanup(){
        Fixture f=new Fixture();f.sample("room1");f.sample("room2");
        check(!f.owner.observeAuthenticated("room3",1000000,1000,1000),"probe capacity bounded at two rooms");
        f.owner.discardRoom("room1");f.sample("room3");
        for(Runnable timer:new ArrayList<>(f.loop.timers))timer.run();
        f.sample("room4");check(f.factory.slots.get("room2").closes==1,"idle probe rooms release without media admission");
        f.owner.discardRoom("room4");
        for(int i=0;i<70;i++){String room="next"+i;f.sample(room);f.owner.discardRoom(room);}
        check(f.owner.configured(),"released room clocks do not impose a lifetime room limit");
    }
    static void lateEnable(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult prepared=new PreparedResult();
        f.owner.prepare(f.admission("room1"),prepared);slot.events.admitted();slot.events.granted(f.binding("room1"));
        Result<VoiceMediaTransport.Credential> committed=new Result<>();prepared.prepared.committed(f.binding("room1"),committed);
        Result<VoiceMediaTransport.Publisher> publisher=new Result<>();f.owner.preparePublisher(committed.value,publisher);slot.events.ready(slot.publisher);
        slot.publisher.delay=true;final int[] applied={0},failed={0};
        publisher.value.microphone(true,new VoiceMediaTransport.InputResult(){public void applied(boolean value){applied[0]++;}public void failed(){failed[0]++;}});
        f.owner.authorizationChanged();slot.publisher.delayed.applied(true);
        check(applied[0]==0&&failed[0]==1&&slot.publisher.closes==1,"late enable acknowledgement cannot escape identity fence");
    }
    static void activeDisconnect(){
        Fixture f=new Fixture();Slot slot=f.sample("room1");PreparedResult prepared=new PreparedResult();
        f.owner.prepare(f.admission("room1"),prepared);slot.events.admitted();slot.events.granted(f.binding("room1"));
        Result<VoiceMediaTransport.Credential> committed=new Result<>();prepared.prepared.committed(f.binding("room1"),committed);
        Result<VoiceMediaTransport.Publisher> publisher=new Result<>();f.owner.preparePublisher(committed.value,publisher);slot.events.ready(slot.publisher);
        slot.events.failed();slot.events.failed();
        check(publisher.disconnected==1&&slot.publisher.closes==1,"active socket failure informs coordinator exactly once");
    }
    public static void main(String[] args){activeDisconnect();handoff();mismatch();cancellation();isolatedClocksAndRelease();capabilityAndFailure();readyBeforeClaim();probeCleanup();lateEnable();
        System.out.println("Relay media owner checks passed: "+checks);}
}
