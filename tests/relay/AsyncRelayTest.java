package in.navrang.gate;

import java.util.*;

public final class AsyncRelayTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static class Time implements RelayV1Driver.Time {
        long elapsed=1000,unix=1000000;final List<Task> tasks=new ArrayList<>();
        class Task {long due;Runnable task;boolean cancelled;Task(long due,Runnable task){this.due=due;this.task=task;}}
        public long now(){return elapsed;}
        public long serverUpperBoundUnixMs(){return unix;}
        public VoiceAuthority.Pending delay(Runnable task,long delay){Task t=new Task(elapsed+delay,task);tasks.add(t);return ()->t.cancelled=true;}
        void advance(long ms){long target=elapsed+ms;while(true){Task next=null;for(Task t:tasks)if(!t.cancelled&&t.due<=target&&(next==null||t.due<next.due))next=t;
            if(next==null)break;long step=next.due-elapsed;elapsed+=step;unix+=step;next.cancelled=true;next.task.run();}unix+=target-elapsed;elapsed=target;}
    }
    static class Auth implements RelayV1Driver.SessionAuthorization {
        final WebSocketAudioRelayTransport.Role role;boolean dead,used;
        Auth(WebSocketAudioRelayTransport.Role role){this.role=role;}
        public WebSocketAudioRelayTransport.Role role(){return role;}
        public long deadlineElapsedMs(){return 31000;}
        public long expiresAtMs(){return 1030000;}
        public boolean revoked(){return dead;}
        public void destroy(){dead=true;}
        public String room(){return "room1";}
        public String subject(){return role==WebSocketAudioRelayTransport.Role.PUBLISHER?"speaker1":"listener1";}
        public boolean claimUpgrade(){if(used)return false;used=true;return true;}
    }
    static class Socket implements RelayV1Driver.Socket {
        RelayV1Driver.SocketEvents events;WebSocketAudioRelayTransport.Completion sent,released;
        boolean ended;final List<byte[]> packets=new ArrayList<>();final List<String> controls=new ArrayList<>();
        public boolean binary(byte[] bytes,long expires,long deadline,WebSocketAudioRelayTransport.Completion done){
            check(!ended&&sent==null,"one outstanding socket packet");packets.add(bytes.clone());sent=done;return true;
        }
        public boolean text(String text){controls.add(text);return !ended;}
        public void abort(int code,String reason,WebSocketAudioRelayTransport.Completion done){ended=true;released=done;}
        void drain(){WebSocketAudioRelayTransport.Completion done=sent;sent=null;done.complete(true);}
        void release(){if(released!=null){WebSocketAudioRelayTransport.Completion done=released;released=null;done.complete(true);}}
        void ready(Auth auth){events.text("{\"type\":\"ready\",\"role\":\""+(auth.role()==WebSocketAudioRelayTransport.Role.PUBLISHER?"speaker":"listener")+"\",\"subject\":\""+auth.subject()+"\"}");}
    }
    static class Audio implements RelayV1Driver.Audio {
        RelayV1Driver.Capture capture;WebSocketAudioRelayTransport.Completion ready,played,released;
        VoiceMediaTransport.InputResult microphone;boolean reset,ended;int plays;
        public void microphone(boolean value,VoiceMediaTransport.InputResult result){microphone=result;}
        public boolean playOpus(byte[] bytes,boolean reset,long expires,long deadline,WebSocketAudioRelayTransport.Completion done){
            check(played==null&&!ended,"one outstanding decoder packet");this.reset=reset;plays++;played=done;return true;
        }
        public void abort(WebSocketAudioRelayTransport.Completion done){ended=true;released=done;}
        void initialized(){ready.complete(true);}
        void consume(){WebSocketAudioRelayTransport.Completion done=played;played=null;done.complete(true);}
        void release(){if(released!=null){WebSocketAudioRelayTransport.Completion done=released;released=null;done.complete(true);}}
    }
    static class Result<T> implements VoiceMediaTransport.Result<T>{T value;int failed,disconnected;
        public void ready(T value){this.value=value;}public void failed(){failed++;}public void disconnected(){disconnected++;}}
    static class Fixture {
        final Time time=new Time();final List<Socket> sockets=new ArrayList<>();final List<Audio> audios=new ArrayList<>();
        final RelayV1Driver driver=new RelayV1Driver(time,new RelayV1Driver.Connector(){
            public boolean configured(){return true;}
            public RelayV1Driver.Socket upgrade(RelayV1Driver.Upgrade upgrade,RelayV1Driver.SocketEvents events){Socket s=new Socket();s.events=events;sockets.add(s);return s;}
        },(role,until,deadline,capture,ready)->{Audio audio=new Audio();audio.capture=capture;audio.ready=ready;audios.add(audio);return audio;});
        final WebSocketAudioRelayTransport transport=new WebSocketAudioRelayTransport(true,time,driver,WebSocketAudioRelayTransport.Limits.defaults());
        final RelayV1Protocol.Grant grant=new RelayV1Protocol.Grant("12345678-1234-1234-1234-123456789abc",1,"speaker1",1015000);
        Fixture(){transport.foreground(true);}
        Socket socket(){return sockets.get(sockets.size()-1);}Audio audio(){return audios.get(audios.size()-1);}
        void grant(){socket().events.text("{\"type\":\"grant\",\"grantId\":\""+grant.grantId+"\",\"epoch\":1,\"subject\":\"speaker1\",\"deadline\":1015000}");}
        Result<VoiceMediaTransport.Receiver> receive(){Result<VoiceMediaTransport.Receiver> r=new Result<>();Auth a=new Auth(WebSocketAudioRelayTransport.Role.RECEIVER);transport.receive(a,r);socket().ready(a);return r;}
        Result<VoiceMediaTransport.Publisher> publish(){Result<VoiceMediaTransport.Publisher> r=new Result<>();Auth a=new Auth(WebSocketAudioRelayTransport.Role.PUBLISHER);transport.preparePublisher(a,r);socket().ready(a);grant();return r;}
    }
    static void quietChannel(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> r=f.receive();check(r.value==null,"media readiness asynchronous");f.audio().initialized();check(r.value!=null,"quiet listener joins without a speaker grant");f.time.advance(5100);check(r.disconnected==0,"quiet listener remains connected");}
    static void replacement(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> old=f.receive();f.audio().initialized();Socket socket=f.socket();Audio audio=f.audio();old.value.close();
        Result<VoiceMediaTransport.Receiver> replacement=new Result<>();f.transport.receive(new Auth(WebSocketAudioRelayTransport.Role.RECEIVER),replacement);f.time.advance(40);check(f.sockets.size()==1,"replacement waits for teardown");
        socket.release();f.time.advance(20);check(f.sockets.size()==1,"socket release alone does not relinquish codec");audio.release();f.time.advance(20);check(f.sockets.size()==2,"replacement starts only after both releases");}
    static void timeout(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> r=f.receive();f.audio().initialized();r.value.close();f.time.advance(2001);check(!f.transport.available(),"unacknowledged release poisons owner");f.audio().release();f.socket().release();check(!f.transport.available(),"late release does not unpoison");}
    static void publisherCredit(){Fixture f=new Fixture();Result<VoiceMediaTransport.Publisher> r=f.publish();f.audio().initialized();
        check(f.socket().packets.isEmpty(),"publisher starts muted");final int[] enabled={0};r.value.microphone(true,new VoiceMediaTransport.InputResult(){public void applied(boolean value){if(value)enabled[0]++;}public void failed(){}});
        f.audio().capture.opus(new byte[]{1},f.time.elapsed);check(f.socket().packets.isEmpty(),"discard capture before native input confirmation");f.audio().microphone.applied(true);check(enabled[0]==1,"exact input operation confirmed");
        f.audio().capture.opus(new byte[]{1},f.time.elapsed);f.audio().capture.opus(new byte[]{2},f.time.elapsed);check(f.socket().packets.size()==1,"capture drops while socket owns one packet");
        f.socket().drain();f.time.advance(21);f.audio().capture.opus(new byte[]{3},f.time.elapsed);check(f.socket().packets.size()==2,"native queue drain releases packet credit");
        RelayV1Protocol.Frame packet=RelayV1Protocol.decode(f.socket().packets.get(1));check(packet.sequence==2,"dropped local capture does not create sequence gap");packet.destroy();
        r.value.close();f.audio().capture.opus(new byte[]{4},f.time.elapsed);f.audio().microphone.applied(true);check(f.socket().packets.size()==2,"late input/capture fenced after stop");}
    static void receiveCredit(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> r=f.receive();f.audio().initialized();f.grant();
        f.socket().events.binary(RelayV1Protocol.encode(f.grant,7,new byte[]{1}));check(f.audio().reset,"late first packet resets decoder");check(f.socket().controls.isEmpty(),"no ACK at decoder admission");
        f.audio().consume();check(f.socket().controls.size()==1&&f.socket().controls.get(0).contains("\"sequence\":7"),"exact ACK after actual native consume");
        f.socket().events.binary(RelayV1Protocol.encode(f.grant,8,new byte[]{2}));check(!f.audio().reset,"contiguous packet keeps decoder state");f.audio().consume();
        f.socket().events.binary(RelayV1Protocol.encode(f.grant,10,new byte[]{3}));check(f.audio().reset,"skipped packet flushes decoder/output");f.audio().consume();
        f.time.advance(15000);check(r.disconnected==1,"immutable grant deadline ends receiver");check(f.audio().ended&&f.socket().ended,"deadline aborts output and socket");}
    static void earlyCancel(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> r=f.receive();Audio audio=f.audio();f.transport.stop();check(audio.ended,"cancel during initialization reaches native handle");audio.initialized();check(r.value==null,"late ready cannot restore stopped session");}
    static void invalidFrames(){Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> r=f.receive();f.audio().initialized();f.grant();f.socket().events.binary(new byte[41]);check(r.disconnected==1,"malformed frame closes receiver");}
    static void clockRollback(){Fixture f=new Fixture();f.receive();f.audio().initialized();f.time.unix--;check(!f.driver.available(),"server upper-bound rollback fails closed");}
    public static void main(String[] args){quietChannel();replacement();timeout();publisherCredit();receiveCredit();earlyCancel();invalidFrames();clockRollback();System.out.println("Async relay checks passed: "+checks);}
}
