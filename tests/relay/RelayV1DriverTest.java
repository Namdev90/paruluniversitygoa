package in.navrang.gate;

import java.util.ArrayList;
import java.util.List;

/** In-memory socket and audio boundaries. No network, JWT, codec or hardware. */
public final class RelayV1DriverTest {
    private static final String ID="00112233-4455-6677-8899-aabbccddeeff";
    private static int passed;
    private static void check(boolean value, String reason) { if (!value) throw new AssertionError(reason); }
    private static void test(String name, Runnable work) { work.run(); passed++; System.out.println("PASS " + name); }
    private static final class Time implements RelayV1Driver.Time {
        long elapsed=100, unixBase=1000000, offset; boolean synchronizedClock=true;
        final List<Task> tasks=new ArrayList<>();
        static final class Task { long deadline; Runnable work; }
        public long now() { return elapsed; }
        public long serverUpperBoundUnixMs() { return synchronizedClock ? unixBase+elapsed-100+offset : -1; }
        public VoiceAuthority.Pending delay(Runnable work, long delay) {
            Task task=new Task(); task.deadline=elapsed+delay; task.work=work; tasks.add(task); return () -> tasks.remove(task);
        }
        void advance(long target) {
            while (true) {
                Task first=null;
                for (Task task:tasks) if (task.deadline<=target && (first==null || task.deadline<first.deadline)) first=task;
                if (first==null) break;
                tasks.remove(first); elapsed=first.deadline; first.work.run();
            }
            elapsed=target;
        }
    }
    private static final class Authorization implements RelayV1Driver.SessionAuthorization {
        final WebSocketAudioRelayTransport.Role role; boolean destroyed, claimed;
        String room="room_1", subject="listener"; long until=60000;
        Authorization(WebSocketAudioRelayTransport.Role role) { this.role=role; if (role==WebSocketAudioRelayTransport.Role.PUBLISHER) subject="speaker"; }
        public WebSocketAudioRelayTransport.Role role() { return role; }
        public long deadlineElapsedMs() { return until; }
        public boolean revoked() { return destroyed; }
        public long expiresAtMs() { return 1060000; }
        public void destroy() { destroyed=true; }
        public String room() { return room; }
        public String subject() { return subject; }
        public boolean claimUpgrade() { if (claimed) return false; claimed=true; return true; }
    }
    private static final class Network implements RelayV1Driver.Connector {
        RelayV1Driver.Upgrade request; RelayV1Driver.SocketEvents events;
        final List<byte[]> binary=new ArrayList<>(); final List<String> controls=new ArrayList<>();
        int opens, aborts; boolean rejectBinary, rejectText, abortAcknowledged=true, asyncBinary; byte[] borrowed;
        WebSocketAudioRelayTransport.Completion pendingBinary, pendingRelease;
        void drain(boolean success) { WebSocketAudioRelayTransport.Completion done=pendingBinary; pendingBinary=null; done.complete(success); }
        void release() { WebSocketAudioRelayTransport.Completion done=pendingRelease; pendingRelease=null; if(done!=null)done.complete(true); }
        public boolean configured() { return true; }
        public RelayV1Driver.Socket upgrade(RelayV1Driver.Upgrade request, RelayV1Driver.SocketEvents events) {
            this.request=request; this.events=events; opens++;
            return new RelayV1Driver.Socket() {
                public boolean binary(byte[] bytes,long elapsedDeadline,long unixDeadline,WebSocketAudioRelayTransport.Completion done) { borrowed=bytes; if (rejectBinary) return false; binary.add(bytes.clone()); if(asyncBinary)pendingBinary=done;else done.complete(true); return true; }
                public boolean text(String text) { if (rejectText) return false; controls.add(text); return true; }
                public void abort(int code, String reason,WebSocketAudioRelayTransport.Completion done) { aborts++; if (abortAcknowledged) done.complete(true); else pendingRelease=done; }
            };
        }
    }
    private static final class Sound implements RelayV1Driver.AudioFactory {
        final Time time; RelayV1Driver.Capture capture; int starts, stops, resets;
        boolean muted=true, abortAcknowledged=true; VoiceAuthority.Pending pending;
        WebSocketAudioRelayTransport.Completion ready, pendingRelease; boolean autoReady=true;
        void release() { WebSocketAudioRelayTransport.Completion done=pendingRelease; pendingRelease=null; if(done!=null)done.complete(true); }
        final List<byte[]> played=new ArrayList<>(); long outputElapsedDeadline, outputUnixDeadline;
        Sound(Time time) { this.time=time; }
        public RelayV1Driver.Audio open(WebSocketAudioRelayTransport.Role role,long until,long deadline,
                RelayV1Driver.Capture capture,WebSocketAudioRelayTransport.Completion ready) {
            this.capture=capture; this.ready=ready; starts++; if (autoReady) ready.complete(true);
            return new RelayV1Driver.Audio() {
                public void microphone(boolean enabled, VoiceMediaTransport.InputResult result) { muted=!enabled; result.applied(enabled); }
                public boolean playOpus(byte[] bytes,boolean reset,long elapsedDeadline,long unixDeadline,
                        WebSocketAudioRelayTransport.Completion consumed) {
                    check(pending==null,"only one outstanding native playback packet");
                    byte[] owned=bytes.clone(); outputElapsedDeadline=elapsedDeadline; outputUnixDeadline=unixDeadline;
                    if (reset) { resets++; played.clear(); }
                    pending=time.delay(() -> { pending=null;
                        if (time.now()>=elapsedDeadline || time.serverUpperBoundUnixMs()>=unixDeadline) { consumed.complete(false); return; }
                        played.add(owned); consumed.complete(true);
                    },20);
                    return true;
                }
                public void abort(WebSocketAudioRelayTransport.Completion done) {
                    stops++; muted=true; played.clear(); if(pending!=null) pending.cancel(); pending=null;
                    if (abortAcknowledged) done.complete(true); else pendingRelease=done;
                }
            };
        }
    }
    private static final class Result<T> implements VoiceMediaTransport.Result<T> {
        T handle; int failed, disconnected;
        public void ready(T value) { handle=value; }
        public void failed() { failed++; }
        public void disconnected() { disconnected++; }
    }
    private static final class Fixture {
        final Time time=new Time(); final Network network=new Network(); final Sound sound=new Sound(time);
        final RelayV1Driver driver;
        final WebSocketAudioRelayTransport relay;
        final Result<VoiceMediaTransport.Receiver> receiver=new Result<>();
        final Result<VoiceMediaTransport.Publisher> publisher=new Result<>();
        Authorization authorization; long deadline=1001000, epoch=1;
        Fixture() { this(WebSocketAudioRelayTransport.Limits.defaults()); }
        Fixture(WebSocketAudioRelayTransport.Limits limits) { this(limits,new RelayV1Driver.RetiredEpochs()); }
        Fixture(WebSocketAudioRelayTransport.Limits limits,RelayV1Driver.RetiredEpochs retired) {
            driver=new RelayV1Driver(time,network,sound,retired);
            relay=new WebSocketAudioRelayTransport(true,time,driver,limits); relay.foreground(true);
        }
        void open(boolean transmit) {
            authorization=new Authorization(transmit ? WebSocketAudioRelayTransport.Role.PUBLISHER : WebSocketAudioRelayTransport.Role.RECEIVER);
            if (transmit) relay.preparePublisher(authorization,publisher); else relay.receive(authorization,receiver);
        }
        void ready() { network.events.text("{\"type\":\"ready\",\"role\":\""+(authorization.role()==WebSocketAudioRelayTransport.Role.PUBLISHER ? "speaker" : "listener")+"\",\"subject\":\""+authorization.subject+"\"}"); }
        void grant() { network.events.text(grantJson(ID,epoch,"speaker",deadline)); }
        void start(boolean transmit) { open(transmit); ready(); grant(); }
        byte[] packet(long sequence) { return RelayV1Protocol.encode(new RelayV1Protocol.Grant(ID,epoch,"speaker",deadline),sequence,new byte[]{17,34}); }
    }
    private static String grantJson(String id,long epoch,String subject,long deadline) {
        return "{\"type\":\"grant\",\"grantId\":\""+id+"\",\"epoch\":"+epoch+",\"subject\":\""+subject+"\",\"deadline\":"+deadline+"}";
    }
    public static void main(String[] args) {
        test("upgrade request fixes GET route and native Authorization header scheme", () -> {
            Fixture f=new Fixture(); f.open(true);
            check(f.network.opens==1 && f.network.request.method.equals("GET") && f.network.request.path.equals("/v1/rooms/room_1/socket") &&
                    f.network.request.authorizationHeaderName.equals("Authorization") && f.network.request.authorizationScheme.equals("Bearer") &&
                    f.network.request.upgradeHeaderName.equals("Upgrade") && f.network.request.upgradeHeaderValue.equals("websocket") &&
                    f.network.request.authorization()==f.authorization, "native header upgrade metadata");
            check(f.sound.starts==0 && f.publisher.handle==null,"no capture before authenticated ready+grant"); f.relay.close();
        });
        test("ready role and subject must match native authority", () -> {
            for (String wrong:new String[]{"{\"type\":\"ready\",\"role\":\"listener\",\"subject\":\"speaker\"}",
                    "{\"type\":\"ready\",\"role\":\"speaker\",\"subject\":\"other\"}"}) {
                Fixture f=new Fixture(); f.open(true); f.network.events.text(wrong);
                check(f.publisher.failed==1 && f.network.aborts==1 && f.sound.starts==0,"ready identity fence");
            }
        });
        test("speaker grant must name own subject and last at most fifteen seconds", () -> {
            for (boolean wrongSubject:new boolean[]{true,false}) {
                Fixture f=new Fixture(); f.open(true); f.ready();
                f.network.events.text(grantJson(ID,1,wrongSubject ? "other":"speaker",wrongSubject?f.deadline:1015001));
                check(f.publisher.failed==1 && f.network.aborts==1,"grant scope and duration");
            }
        });
        test("publisher emits exact v1 framing with contiguous sequence and wiped write buffer", () -> {
            Fixture f=new Fixture(); f.start(true); check(f.publisher.handle!=null && f.sound.muted,"publisher initially muted");
            f.publisher.handle.microphone(true); f.sound.capture.opus(new byte[]{17,34},100); f.time.advance(120);
            f.sound.capture.opus(new byte[]{51},120); f.time.advance(140);
            check(f.network.binary.size()==2,"two frames"); RelayV1Protocol.Frame first=RelayV1Protocol.decode(f.network.binary.get(0));
            RelayV1Protocol.Frame next=RelayV1Protocol.decode(f.network.binary.get(1));
            check(first.sequence==1 && next.sequence==2 && first.deadlineUnixMs==1001000 && first.grantId.equals(ID),"immutable header + sequence");
            for (byte b:f.network.borrowed) check(b==0,"borrowed network packet wiped"); f.relay.close();
        });
        test("listener sends ACK only after consuming exact received frame", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(7));
            check(f.network.controls.isEmpty() && f.sound.played.isEmpty(),"no enqueue ACK"); f.time.advance(120);
            check(f.sound.played.size()==1 && f.network.controls.size()==1 && f.network.controls.get(0).equals("{\"type\":\"ack\",\"epoch\":1,\"sequence\":7}"),"exact consume ACK");
            check(f.sound.resets==1,"gap resets decoder/jitter/output");
            check(f.sound.outputElapsedDeadline<=1100 && f.sound.outputUnixDeadline==1001000,"sink receives both cutoff domains"); f.relay.close();
        });
        test("maximum-size listener frame returns one exact credit after consumption", () -> {
            Fixture f=new Fixture(new WebSocketAudioRelayTransport.Limits(50,100,100,10)); f.start(false); f.network.events.binary(RelayV1Protocol.encode(new RelayV1Protocol.Grant(ID,f.epoch,"speaker",f.deadline),1,new byte[2048])); f.time.advance(120);
            check(f.sound.played.size()==1 && f.network.controls.size()==1 && f.network.controls.get(0).contains("\"sequence\":1"),"maximum payload consumed and credited once"); f.relay.close();
        });
        test("second outstanding listener frame fails closed without a retry queue", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1)); f.network.events.binary(f.packet(2)); f.time.advance(120);
            check(f.receiver.disconnected==1 && f.network.aborts==1 && f.sound.played.isEmpty() && f.network.controls.isEmpty(),"one-frame credit bound");
        });
        test("duplicate listener sequence is rejected after ACK", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1)); f.time.advance(120); f.network.events.binary(f.packet(1));
            check(f.receiver.disconnected==1 && f.network.aborts==1 && f.sound.stops==1,"replay rejected and output purged");
        });
        test("grant UUID epoch deadline mismatches purge playback", () -> {
            for (int field:new int[]{8,16,24}) {
                Fixture f=new Fixture(); f.start(false); byte[] bytes=f.packet(1); bytes[field]^=1; f.network.events.binary(bytes);
                check(f.receiver.disconnected==1 && f.sound.stops==1 && f.network.controls.isEmpty(),"bound header mismatch");
            }
        });
        test("absolute deadline rejects playback even if elapsed clock has not advanced", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1)); f.time.offset=1000; f.time.advance(120);
            check(f.sound.played.isEmpty() && f.sound.stops==1 && f.network.controls.isEmpty(),"absolute expiry before media/ACK");
        });
        test("monotonic grant expiry independently aborts and clears timers", () -> {
            Fixture f=new Fixture(); f.start(false); f.time.advance(1100);
            check(f.receiver.disconnected==1 && f.sound.stops==1 && f.time.tasks.isEmpty(),"immutable monotonic lease deadline");
        });
        test("revocation purges pending playback before any ACK", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1));
            f.network.events.text("{\"type\":\"revoked\",\"epoch\":1,\"reason\":\"controller revoked\"}"); f.time.advance(120);
            check(f.receiver.disconnected==1 && f.sound.stops==1 && f.sound.played.isEmpty() && f.network.controls.isEmpty(),"revoke purge");
        });
        test("disconnect purges output and fences late binary callback", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1)); f.time.advance(120); f.network.events.closed();
            f.network.events.binary(f.packet(2)); f.time.advance(140);
            check(f.sound.stops==1 && f.sound.played.isEmpty() && f.network.controls.size()==1,"disconnect output flush and stale frame fence");
        });
        test("active grant cannot be extended or replaced", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.text(grantJson(ID,1,"speaker",1001500));
            check(f.receiver.disconnected==1 && f.sound.stops==1,"immutable active deadline");
        });
        test("unavailable or rolled-back synchronized clock fails closed", () -> {
            Fixture missing=new Fixture(); missing.time.synchronizedClock=false; missing.open(false);
            check(missing.network.opens==0 && missing.receiver.failed==1,"missing clock bound");
            Fixture rollback=new Fixture(); rollback.start(false); rollback.time.offset=-1; rollback.network.events.binary(rollback.packet(1));
            check(rollback.receiver.disconnected==1 && !rollback.relay.available(),"wall bound rollback poisons adapter");
        });
        test("socket backpressure ends publisher and never retries", () -> {
            Fixture f=new Fixture(); f.start(true); f.publisher.handle.microphone(true); f.network.rejectBinary=true;
            f.sound.capture.opus(new byte[]{1},100); f.time.advance(120); f.time.advance(200);
            check(f.publisher.disconnected==1 && f.network.binary.isEmpty() && f.network.aborts==1,"no send retry queue");
        });
        test("malformed controls and grant before ready fail closed", () -> {
            for (String control:new String[]{"{}",grantJson(ID,1,"speaker",1001000)}) {
                Fixture f=new Fixture(); f.open(false); f.network.events.text(control);
                check(f.receiver.failed==1 && f.network.aborts==1,"control ordering and schema");
            }
        });
        test("outbound lifetime byte budget terminates before unbounded socket buffering", () -> {
            Fixture f=new Fixture(); f.deadline=1015000; f.start(true); f.publisher.handle.microphone(true);
            for (int i=0;i<126;i++) { f.sound.capture.opus(new byte[2048],f.time.elapsed); f.time.advance(f.time.elapsed+20); }
            check(f.network.binary.size()==125 && f.network.aborts==1 && f.publisher.disconnected==1,"262144-byte lifetime bound");
        });
        test("local rolling frame rate is bounded without retaining retry audio", () -> {
            Fixture f=new Fixture(new WebSocketAudioRelayTransport.Limits(250,100,100,1)); f.start(true); f.publisher.handle.microphone(true);
            for (int i=0;i<51;i++) { f.sound.capture.opus(new byte[]{1},f.time.elapsed); f.time.advance(f.time.elapsed+1); }
            check(f.network.binary.size()==50 && f.publisher.disconnected==1,"50 frames per rolling second");
        });
        test("background aborts concrete socket and audio before returning", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.events.binary(f.packet(1)); f.relay.foreground(false);
            check(f.sound.stops==1 && f.network.aborts==1 && f.network.controls.isEmpty() && f.time.tasks.isEmpty(),"synchronous background purge");
        });
        test("unacknowledged audio or socket abort poisons the adapter after timeout", () -> {
            for (boolean audio:new boolean[]{true,false}) {
                Fixture f=new Fixture(); f.start(false);
                if (audio) f.sound.abortAcknowledged=false; else f.network.abortAcknowledged=false;
                f.relay.stop(); f.time.advance(2100); check(!f.relay.available(),"uncertain ownership cannot be reused after bounded release timeout");
            }
        });
        test("ACK backpressure purges output and ends the listener", () -> {
            Fixture f=new Fixture(); f.start(false); f.network.rejectText=true; f.network.events.binary(f.packet(1)); f.time.advance(120);
            check(f.receiver.disconnected==1 && f.sound.stops==1 && f.sound.played.isEmpty() && f.network.controls.isEmpty(),"ACK write failure");
        });
        test("invalid room is rejected before creating an upgrade URL", () -> {
            Fixture f=new Fixture(); Authorization auth=new Authorization(WebSocketAudioRelayTransport.Role.RECEIVER); auth.room="room?token=forbidden";
            f.relay.receive(auth,f.receiver); check(f.network.opens==0 && f.receiver.failed==1,"room identifier prevents query/path injection");
        });
        test("authorization object cannot be reused for another upgrade", () -> {
            Fixture f=new Fixture(); f.start(false); f.relay.stop(); f.authorization.destroyed=false;
            Result<VoiceMediaTransport.Receiver> result=new Result<>(); f.relay.receive(f.authorization,result);
            check(f.network.opens==1 && result.failed==1,"one-shot upgrade claim");
        });
        test("duplicate immutable grant never extends its original timer", () -> {
            Fixture f=new Fixture(); f.start(false); f.time.advance(500); f.grant(); f.time.advance(1100);
            check(f.receiver.disconnected==1 && f.sound.stops==1 && f.time.tasks.isEmpty(),"duplicate grant does not reset deadline");
        });
        test("midlease listener discovery accepts preserved grant and first sequence above one", () -> {
            Fixture f=new Fixture(); f.open(false); f.ready(); f.grant(); f.network.events.binary(f.packet(37)); f.time.advance(120);
            check(f.sound.played.size()==1 && f.network.controls.get(0).contains("\"sequence\":37") && f.sound.resets==1,
                    "ready plus existing immutable grant supports late listener join"); f.relay.close();
        });
        test("actor reconstruction revokes and reconnect rejects the retired epoch", () -> {
            Fixture f=new Fixture(); f.start(false); RelayV1Driver.SocketEvents old=f.network.events;
            old.binary(f.packet(1)); old.text("{\"type\":\"revoked\",\"epoch\":1,\"reason\":\"actor reconstructed\"}");
            check(f.sound.stops==1 && f.network.controls.isEmpty(),"retired actor grant purges outstanding frame");
            f.receiver.handle=null; f.open(false); f.ready(); f.grant();
            check(f.receiver.disconnected==2 && f.sound.stops==2,"old epoch cannot be resumed under a fresh authorization");
            f.epoch=2; f.open(false); f.ready(); f.grant(); old.binary(f.packet(9));
            check(f.receiver.handle!=null && f.receiver.disconnected==2,"fresh explicit greater epoch required; old callback stays fenced"); f.relay.close();
        });
        test("replacement native driver retains owner-scoped retired epoch floor", () -> {
            RelayV1Driver.RetiredEpochs retired=new RelayV1Driver.RetiredEpochs();
            Fixture first=new Fixture(WebSocketAudioRelayTransport.Limits.defaults(),retired); first.start(false); first.relay.close();
            Fixture replacement=new Fixture(WebSocketAudioRelayTransport.Limits.defaults(),retired); replacement.start(false);
            check(replacement.receiver.disconnected==1 && replacement.sound.stops==1,"replacement cannot forget retired lease after quiet receiver readiness");
            replacement.epoch=2; replacement.open(false); replacement.ready(); replacement.grant();
            check(replacement.receiver.handle!=null && replacement.receiver.disconnected==1 && replacement.sound.stops==1,"fresh greater epoch succeeds under fresh authorization"); replacement.relay.close();
        });
        test("native readiness is required and late initialization cannot revive cancellation", () -> {
            Fixture f=new Fixture(); f.sound.autoReady=false; f.open(false); f.ready();
            check(f.sound.starts==1 && f.receiver.handle==null,"native resources initialize asynchronously");
            f.relay.stop(); f.sound.ready.complete(true);
            check(f.receiver.handle==null && f.receiver.failed==1 && f.sound.stops==1 && f.network.aborts==1,
                    "late readiness fenced after cancelling native initialization");
        });
        test("failed native initialization aborts socket and never publishes readiness", () -> {
            Fixture f=new Fixture(); f.sound.autoReady=false; f.open(true); f.ready(); f.grant();
            f.sound.ready.complete(false);
            check(f.publisher.handle==null && f.publisher.failed==1 && f.sound.stops==1 && f.network.aborts==1,
                    "failed initialization relinquishes both resources");
        });
        test("publisher waits for native socket drain and drops excess capture without sequence gap", () -> {
            Fixture f=new Fixture(); f.network.asyncBinary=true; f.start(true); f.publisher.handle.microphone(true);
            f.sound.capture.opus(new byte[]{1},100); f.sound.capture.opus(new byte[]{2},100);
            check(f.network.binary.size()==1,"one outstanding socket packet");
            f.network.drain(true); f.time.advance(120); f.sound.capture.opus(new byte[]{3},120);
            check(f.network.binary.size()==2,"drain returns packet ownership");
            RelayV1Protocol.Frame frame=RelayV1Protocol.decode(f.network.binary.get(1));
            check(frame.sequence==2 && frame.payload[0]==3,"discarded capture consumes no wire sequence"); frame.destroy();
            WebSocketAudioRelayTransport.Completion late=f.network.pendingBinary; f.relay.stop(); late.complete(false);
            check(f.publisher.disconnected==1 && f.network.aborts==1,"late native failure cannot disconnect twice");
        });
        test("replacement waits for both audio and socket teardown acknowledgements", () -> {
            Fixture f=new Fixture(); f.start(false); f.sound.abortAcknowledged=false; f.network.abortAcknowledged=false;
            f.relay.stop(); f.open(false); f.time.advance(120);
            check(f.network.opens==1,"replacement waits for owned native resources");
            f.network.release(); f.time.advance(140);
            check(f.network.opens==1,"socket acknowledgement alone does not release audio");
            f.sound.release(); f.time.advance(160);
            check(f.network.opens==2,"both acknowledgements permit replacement");
            f.sound.abortAcknowledged=true; f.network.abortAcknowledged=true; f.epoch=2; f.ready(); f.grant();
            check(f.receiver.handle!=null && f.receiver.disconnected==1,"fresh epoch joins after complete teardown"); f.relay.close();
        });
        test("a million room retirements retain old replay fences without a hard room cutoff", () -> {
            RelayV1Driver.RetiredEpochs retired=new RelayV1Driver.RetiredEpochs();
            for(int i=0;i<1000000;i++)check(retired.retire("lease_room_"+i,1),"retirement stays available");
            for(int i=0;i<1000000;i++)check(retired.floor("lease_room_"+i)>=1,"no forgotten retirement");
            check(retired.floor("lease_room_999999")==1,"recent floor remains exact");
            check(retired.retire("max_epoch",RelayV1Protocol.MAX_UINT32)&&retired.floor("max_epoch")==RelayV1Protocol.MAX_UINT32,"maximum protocol epoch never wraps");
            check(retired.retire("lease_room_999999",2)&&retired.floor("lease_room_999999")==2,"recent epoch advances");
            check(retired.retire("lease_room_999999",1)&&retired.floor("lease_room_999999")==2,"floor cannot decrease");
            check(retired.floor("lease_room_0")==RelayV1Protocol.MAX_UINT32,"evicted room permanently fenced");
            check(retired.retire("lease_room_0",2)&&retired.floor("lease_room_0")==RelayV1Protocol.MAX_UINT32,"old room cannot regain an exact floor");
            check(!retired.retire("bad room",1)&&!retired.retire("valid",0)&&!retired.retire("valid",RelayV1Protocol.MAX_UINT32+1),"invalid retirement rejected");
            int rejected=0;
            for(int i=0;i<10000;i++)if(retired.floor("fresh_room_"+i)>0)rejected++;
            check(rejected<=1,"fresh rooms remain practically usable after a million retirements");
        });
        test("more than 64 distinct live rooms work and oldest replay remains fenced", () -> {
            RelayV1Driver.RetiredEpochs retired=new RelayV1Driver.RetiredEpochs();
            Fixture oldest=null;
            for(int i=0;i<256;i++){
                Fixture f=new Fixture(WebSocketAudioRelayTransport.Limits.defaults(),retired);
                Authorization auth=new Authorization(WebSocketAudioRelayTransport.Role.PUBLISHER);auth.room="turnover_"+i;
                f.authorization=auth;f.relay.preparePublisher(auth,f.publisher);f.ready();f.grant();
                check(f.publisher.handle!=null,"fresh room speaker admitted beyond old lifetime cap");
                f.publisher.handle.microphone(true);f.relay.close();
                check(f.sound.muted&&f.network.aborts==1,"resources released each turnover");
                if(i==0)oldest=f;
            }
            oldest.publisher.handle.microphone(true);oldest.network.events.text(grantJson(ID,2,"speaker",oldest.deadline));
            check(oldest.sound.muted&&oldest.network.opens==1,"stale handles cannot reopen old resources");
            Fixture replay=new Fixture(WebSocketAudioRelayTransport.Limits.defaults(),retired);
            replay.authorization=new Authorization(WebSocketAudioRelayTransport.Role.PUBLISHER);replay.authorization.room="turnover_0";
            replay.relay.preparePublisher(replay.authorization,replay.publisher);replay.ready();replay.epoch=2;replay.grant();
            check(replay.publisher.handle==null&&replay.publisher.failed==1&&replay.sound.starts==0,"evicted room rejects even a higher epoch");
        });
        test("filter collisions and saturation can only deny grants", () -> {
            RelayV1Driver.RetiredEpochs retired=new RelayV1Driver.RetiredEpochs();
            for(int i=0;i<65;i++)check(retired.retire("room_"+i,1),"seed filter");
            try {
                java.lang.reflect.Field field=RelayV1Driver.RetiredEpochs.class.getDeclaredField("tombstones");field.setAccessible(true);
                byte[] bits=(byte[])field.get(retired);check(bits.length==8*1024*1024,"fixed 8 MiB bit array");
                java.util.Arrays.fill(bits,(byte)255); // Deterministically exercise every possible collision.
            } catch(ReflectiveOperationException failure){throw new AssertionError(failure);}
            check(retired.floor("room_1")==1,"exact recent floor preserved despite collisions");
            check(retired.floor("unseen")==RelayV1Protocol.MAX_UINT32,"false positive fails closed");
            check(retired.retire("unseen",1)&&retired.floor("unseen")==RelayV1Protocol.MAX_UINT32,"retirement cannot erase false-positive fence");
            Fixture f=new Fixture(WebSocketAudioRelayTransport.Limits.defaults(),retired);f.start(true);
            check(f.publisher.handle==null&&f.publisher.failed==1&&f.sound.starts==0,"saturated filter never authorizes audio");
        });
        System.out.println("PASS " + passed + " driver contract tests");
    }
}
