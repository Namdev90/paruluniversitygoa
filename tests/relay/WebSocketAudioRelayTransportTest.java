package in.navrang.gate;

import java.util.ArrayList;
import java.util.List;

/** Offline contract tests; no sockets, credentials, microphone or Android runtime. */
public final class WebSocketAudioRelayTransportTest {
    private static int passed;
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static final class Clock implements WebSocketAudioRelayTransport.Scheduler {
        long now = 100;
        final List<Task> tasks = new ArrayList<>();
        static final class Task { long at; Runnable work; boolean cancelled; }
        public long now() { return now; }
        public VoiceAuthority.Pending delay(Runnable work, long ms) {
            Task task = new Task(); task.at = now + ms; task.work = work; tasks.add(task);
            return () -> { task.cancelled = true; tasks.remove(task); };
        }
        void advance(long target) {
            while (true) {
                Task first = null;
                for (Task task : tasks) if (!task.cancelled && task.at <= target && (first == null || task.at < first.at)) first = task;
                if (first == null) break;
                tasks.remove(first); now = first.at; first.work.run();
            }
            now = target;
        }
    }
    private static final class Grant implements WebSocketAudioRelayTransport.Authorization {
        final WebSocketAudioRelayTransport.Role role;
        long deadline = 1000; boolean revoked; int destroyed;
        Grant(WebSocketAudioRelayTransport.Role role) { this.role = role; }
        public WebSocketAudioRelayTransport.Role role() { return role; }
        public long deadlineElapsedMs() { return deadline; }
        public boolean revoked() { return revoked; }
        public long expiresAtMs() { return 123456; }
        public void destroy() { destroyed++; }
    }
    private static final class Result<T> implements VoiceMediaTransport.Result<T> {
        T handle; int failed, disconnected, ready;
        public void ready(T value) { handle = value; ready++; }
        public void failed() { failed++; }
        public void disconnected() { disconnected++; }
    }
    private static final class Wire implements WebSocketAudioRelayTransport.Driver {
        final List<Connection> connections = new ArrayList<>();
        boolean autoOpen = true, rejectSend, abortAcknowledged = true, throwOpen;
        public boolean available() { return true; }
        public WebSocketAudioRelayTransport.Connection open(WebSocketAudioRelayTransport.Authorization grant,
                WebSocketAudioRelayTransport.Events events) {
            Connection connection = new Connection(this, events); connections.add(connection);
            if (throwOpen) throw new IllegalStateException("synthetic open failure");
            if (autoOpen) events.opened();
            return connection;
        }
    }
    private static final class Connection implements WebSocketAudioRelayTransport.Connection {
        final Wire wire; final WebSocketAudioRelayTransport.Events events;
        final List<byte[]> sent = new ArrayList<>(), played = new ArrayList<>();
        boolean muted = true; int aborts; VoiceMediaTransport.InputResult pendingInput;
        boolean asyncInput, asyncPacket; WebSocketAudioRelayTransport.Completion pendingPacket, pendingRelease; byte[] borrowed; long packetExpires;
        Connection(Wire wire, WebSocketAudioRelayTransport.Events events) { this.wire = wire; this.events = events; }
        public void microphone(boolean enabled, VoiceMediaTransport.InputResult result) {
            if (asyncInput) { pendingInput = result; return; }
            muted = !enabled; result.applied(enabled);
        }
        public boolean sendAudio(byte[] frame, long expires, WebSocketAudioRelayTransport.Completion done) {
            if (wire.rejectSend) return false;
            packetExpires=expires; borrowed=frame; sent.add(frame.clone()); if(asyncPacket) pendingPacket=done; else done.complete(true); return true;
        }
        public boolean playAudio(byte[] frame, long expires, WebSocketAudioRelayTransport.Completion done) { played.add(frame.clone()); if(asyncPacket) pendingPacket=done; else done.complete(true); return true; }
        public void abort(WebSocketAudioRelayTransport.Completion done) { aborts++; muted = true; if(wire.abortAcknowledged) done.complete(true); else pendingRelease=done; }
    }
    private static final class Fixture {
        final Clock clock = new Clock(); final Wire wire = new Wire();
        final WebSocketAudioRelayTransport relay = new WebSocketAudioRelayTransport(true, clock, wire,
                new WebSocketAudioRelayTransport.Limits(50,100,100,10));
        final Grant tx = new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER);
        final Grant rx = new Grant(WebSocketAudioRelayTransport.Role.RECEIVER);
        final Result<VoiceMediaTransport.Publisher> publish = new Result<>();
        final Result<VoiceMediaTransport.Receiver> receive = new Result<>();
        Fixture() { relay.foreground(true); }
        Connection publisher() { relay.preparePublisher(tx, publish); return wire.connections.get(wire.connections.size() - 1); }
        Connection receiver() { relay.receive(rx, receive); return wire.connections.get(wire.connections.size() - 1); }
    }
    private static void test(String name, Runnable work) {
        work.run(); passed++; System.out.println("PASS " + name);
    }
    public static void main(String[] args) {
        test("default disabled creates no connection", () -> {
            Clock clock = new Clock(); Wire wire = new Wire();
            WebSocketAudioRelayTransport relay = new WebSocketAudioRelayTransport(false, clock, wire, WebSocketAudioRelayTransport.Limits.defaults());
            Result<VoiceMediaTransport.Publisher> result = new Result<>(); Grant grant = new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER);
            relay.foreground(true); relay.preparePublisher(grant, result);
            check(!relay.available() && wire.connections.isEmpty() && result.failed == 1, "default must fail closed");
        });
        test("explicit opt in still requires foreground", () -> {
            Clock clock = new Clock(); Wire wire = new Wire();
            WebSocketAudioRelayTransport relay = new WebSocketAudioRelayTransport(true, clock, wire, WebSocketAudioRelayTransport.Limits.defaults());
            Result<VoiceMediaTransport.Publisher> result = new Result<>(); relay.preparePublisher(new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER), result);
            check(relay.available() && wire.connections.isEmpty() && result.failed == 1, "foreground gate");
        });
        test("publisher starts muted and explicit enable gates capture", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher();
            c.events.captured(new byte[]{1}, 100); f.clock.advance(110);
            check(f.publish.ready == 1 && c.sent.isEmpty(), "muted capture dropped");
            f.publish.handle.microphone(true); c.events.captured(new byte[]{2}, 110); f.clock.advance(120);
            check(c.sent.size() == 1 && c.sent.get(0)[0] == 2, "authorized capture sent");
        });
        test("one outstanding send drops capture until ownership completion", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); c.asyncPacket=true; f.publish.handle.microphone(true);
            c.events.captured(new byte[]{1},100); c.events.captured(new byte[]{2},100); c.events.captured(new byte[]{3},100);
            check(c.sent.size()==1 && c.sent.get(0)[0]==1,"one native packet without retry queue");
            c.pendingPacket.complete(true); c.events.captured(new byte[]{4},100);
            check(c.sent.size()==2 && c.sent.get(1)[0]==4,"completion releases exact send credit");
        });
        test("per-frame byte boundary accepts maximum and drops oversized capture", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); f.publish.handle.microphone(true);
            c.events.captured(new byte[2049],100); c.events.captured(new byte[0],100); c.events.captured(new byte[2048],100);
            check(c.sent.size()==1 && c.sent.get(0).length==2048,"bounded native packet size");
        });
        test("driver copies capture on admission and caller retains its buffer", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); c.asyncPacket=true; f.publish.handle.microphone(true);
            byte[] frame={7}; c.events.captured(frame,100); frame[0]=9;
            check(c.sent.get(0)[0]==7 && frame[0]==9,"copy on admission and caller ownership");
            c.pendingPacket.complete(true);
        });
        test("expired and future capture timestamps rejected", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); f.publish.handle.microphone(true);
            c.events.captured(new byte[]{1}, 50); c.events.captured(new byte[]{2}, 101); c.events.captured(new byte[]{3}, -1);
            f.clock.advance(110); check(c.sent.isEmpty(), "invalid timestamp must not be sent");
        });
        test("capture at exact age boundary is discarded before admission", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); f.publish.handle.microphone(true);
            f.clock.advance(150); c.events.captured(new byte[]{1},100);
            check(c.sent.isEmpty(),"frame at expiry boundary discarded");
        });
        test("stop fences stale captures and completions across replacement", () -> {
            Fixture f=new Fixture(); Connection old=f.publisher(); old.asyncPacket=true; f.publish.handle.microphone(true);
            old.events.captured(new byte[]{1},100); WebSocketAudioRelayTransport.Completion late=old.pendingPacket;
            f.relay.stop(); old.events.opened(); old.events.captured(new byte[]{2},100); late.complete(true);
            check(old.sent.size()==1 && old.aborts==1 && f.tx.destroyed==1,"stop fences outstanding packet epoch");
            Result<VoiceMediaTransport.Publisher> fresh=new Result<>(); f.relay.preparePublisher(new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER),fresh);
            fresh.handle.microphone(true); old.events.disconnected(); late.complete(false);
            check(fresh.ready==1 && fresh.disconnected==0,"stale failure cannot affect replacement");
        });
        test("background fences both directions with no automatic resume", () -> {
            Fixture f=new Fixture(); Connection tx=f.publisher(); Connection rx=f.receiver(); f.publish.handle.microphone(true);
            f.relay.foreground(false); f.relay.foreground(true);
            tx.events.captured(new byte[]{3},100); rx.events.received(new byte[]{4},()->{}); f.clock.advance(120);
            check(tx.sent.isEmpty() && rx.played.isEmpty() && tx.aborts==1 && rx.aborts==1,"background fences both directions");
        });
        test("role loss and reconnect require fresh grants", () -> {
            for(boolean reconnect:new boolean[]{false,true}) {
                Fixture f=new Fixture(); Connection c=f.publisher(); f.publish.handle.microphone(true);
                if(reconnect)f.relay.reconnecting();else f.relay.authorizationChanged();
                c.events.opened(); c.events.captured(new byte[]{1},100); f.clock.advance(120);
                check(c.sent.isEmpty() && c.aborts==1 && f.publish.disconnected==1,"invalidation terminates active handle");
            }
        });
        test("revoked or expired grant aborts before media effects", () -> {
            for(boolean revoke:new boolean[]{false,true}) {
                Fixture f=new Fixture(); Connection c=f.publisher(); f.publish.handle.microphone(true);
                if(revoke)f.tx.revoked=true;else f.tx.deadline=110;
                f.clock.advance(110); c.events.captured(new byte[]{1},110);
                check(c.sent.isEmpty() && c.aborts==1 && f.publish.disconnected==1,"grant checked before admission");
            }
        });
        test("pending open expires and late ready is fenced", () -> {
            Fixture f = new Fixture(); f.wire.autoOpen = false; Connection c = f.publisher(); f.clock.advance(200); c.events.opened();
            check(f.publish.failed == 1 && f.publish.ready == 0 && c.aborts == 1 && f.clock.tasks.isEmpty(), "bounded connect timeout");
        });
        test("cancel pending is silent and clears timer", () -> {
            Fixture f = new Fixture(); f.wire.autoOpen = false; VoiceAuthority.Pending pending = f.relay.preparePublisher(f.tx, f.publish);
            pending.cancel(); f.wire.connections.get(0).events.opened(); f.clock.advance(300);
            check(f.publish.ready == 0 && f.publish.failed == 0 && f.clock.tasks.isEmpty(), "cancel is terminal and silent");
        });
        test("wrong local grant role fails without opening", () -> {
            Fixture f = new Fixture(); f.relay.preparePublisher(f.rx, f.publish);
            check(f.publish.failed == 1 && f.wire.connections.isEmpty() && f.rx.destroyed == 1, "publisher role mismatch");
        });
        test("receiver owns one packet and publisher drops inbound with completion", () -> {
            Fixture f=new Fixture(); Connection rx=f.receiver(); Connection tx=f.publisher(); rx.asyncPacket=true;
            final int[] consumed={0};
            rx.events.received(new byte[]{1},()->consumed[0]++); rx.events.received(new byte[]{2},()->consumed[0]++);
            tx.events.received(new byte[]{3},()->consumed[0]++);
            check(rx.played.size()==1 && tx.played.isEmpty() && consumed[0]==2,"bounded receive ownership and direction");
            rx.pendingPacket.complete(true); rx.pendingPacket.complete(true);
            check(consumed[0]==3,"native completion returns receive credit exactly once");
        });
        test("socket backpressure terminates instead of retrying stale audio", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); f.publish.handle.microphone(true); f.wire.rejectSend = true;
            c.events.captured(new byte[]{1}, 100); f.clock.advance(120);
            check(c.sent.isEmpty() && c.aborts == 1 && f.publish.disconnected == 1, "failed send must abort");
        });
        test("late microphone enable cannot survive disable", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); c.asyncInput = true; final int[] acknowledgements = {0,0};
            f.publish.handle.microphone(true, new VoiceMediaTransport.InputResult() {
                public void applied(boolean enabled) { acknowledgements[0]++; }
                public void failed() { acknowledgements[1]++; }
            });
            VoiceMediaTransport.InputResult late = c.pendingInput; f.publish.handle.microphone(false); late.applied(true);
            c.events.captured(new byte[]{1}, 100); f.clock.advance(120);
            check(acknowledgements[0] == 0 && acknowledgements[1] == 1 && c.sent.isEmpty() && c.aborts == 1, "late input fenced");
        });
        test("unacknowledged abort poisons transport", () -> {
            Fixture f = new Fixture(); f.publisher(); f.wire.abortAcknowledged = false; f.relay.stop(); f.clock.advance(200);
            Grant fresh = new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER); Result<VoiceMediaTransport.Publisher> result = new Result<>(); f.relay.preparePublisher(fresh, result);
            check(!f.relay.available() && f.wire.connections.size() == 1 && result.failed == 1, "uncertain media ownership forbids replacement");
        });
        test("clock regression fails closed", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); f.publish.handle.microphone(true); f.clock.now = 99; c.events.captured(new byte[]{1}, 99);
            check(c.aborts == 1 && !f.relay.available(), "monotonic clock regression");
        });
        test("close is idempotent and terminal", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); f.relay.close(); f.relay.close();
            check(c.aborts == 1 && !f.relay.available() && f.clock.tasks.isEmpty(), "terminal close");
        });
        test("ready at exact connection deadline cannot resurrect pending open", () -> {
            Fixture f = new Fixture(); f.wire.autoOpen = false; Connection c = f.publisher();
            f.clock.now = 200; c.events.opened();
            check(f.publish.failed == 1 && f.publish.ready == 0 && c.aborts == 1, "exact connection deadline");
        });
        test("unacknowledged microphone input has bounded lifetime", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); c.asyncInput = true; f.publish.handle.microphone(true);
            f.clock.advance(200);
            check(c.aborts == 1 && f.publish.disconnected == 1 && f.clock.tasks.isEmpty(), "bounded input acknowledgement");
        });
        test("reentrant stop callback cannot start a replacement connection", () -> {
            Fixture f = new Fixture(); f.wire.abortAcknowledged=false; final Result<VoiceMediaTransport.Publisher> replacement = new Result<>();
            f.relay.preparePublisher(f.tx, new VoiceMediaTransport.Result<VoiceMediaTransport.Publisher>() {
                public void ready(VoiceMediaTransport.Publisher publisher) {}
                public void failed() {}
                public void disconnected() {
                    f.relay.preparePublisher(new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER), replacement);
                }
            });
            f.relay.stop();
            check(f.wire.connections.size()==1 && replacement.ready==0,"reentrant replacement waits for release");
            f.clock.advance(200); check(replacement.failed==1 && !f.relay.available() && f.clock.tasks.isEmpty(),"release timeout fences reentrant replacement");
        });
        test("partial open exception poisons uncertain ownership", () -> {
            Fixture f = new Fixture(); f.wire.throwOpen = true; f.relay.preparePublisher(f.tx, f.publish);
            check(!f.relay.available() && f.publish.failed == 1, "cannot reuse driver after uncertain open");
        });
        test("input acknowledgement at exact deadline is rejected", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher(); c.asyncInput = true; final int[] enabled = {0};
            f.publish.handle.microphone(true, new VoiceMediaTransport.InputResult() {
                public void applied(boolean value) { if (value) enabled[0]++; }
                public void failed() {}
            });
            f.clock.now = 200; c.pendingInput.applied(true);
            check(enabled[0] == 0 && c.aborts == 1 && f.publish.disconnected == 1, "late input ack");
        });
        test("failed async packet completion terminates without retry", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); c.asyncPacket=true; f.publish.handle.microphone(true);
            c.events.captured(new byte[]{7},100); c.pendingPacket.complete(false); c.pendingPacket.complete(true);
            c.events.captured(new byte[]{8},100); f.clock.advance(120);
            check(c.sent.size()==1 && c.aborts==1 && f.publish.disconnected==1,"failed completion terminates exactly once");
        });
        test("disable during synchronous enable acknowledgement always wins", () -> {
            Fixture f = new Fixture(); Connection c = f.publisher();
            f.publish.handle.microphone(true, new VoiceMediaTransport.InputResult() {
                public void applied(boolean enabled) { f.publish.handle.microphone(false); }
                public void failed() {}
            });
            c.events.captured(new byte[]{1}, 100); f.clock.advance(120);
            check(c.aborts == 1 && c.sent.isEmpty(), "reentrant disable must never be rejected");
        });
        test("reentrant dropped-frame completion stops pending native playback", () -> {
            Fixture f=new Fixture(); Connection c=f.receiver(); c.asyncPacket=true; final int[] drops={0};
            c.events.received(new byte[]{1},()->drops[0]++);
            c.events.received(new byte[]{2},f.relay::stop);
            c.events.received(new byte[]{3},()->drops[0]++);
            c.pendingPacket.complete(true);
            check(drops[0]==2 && c.aborts==1 && f.clock.tasks.isEmpty(),"reentrant drop retires pending native ownership once");
        });
        test("replacement is opened only after successful asynchronous release", () -> {
            Fixture f=new Fixture(); Connection old=f.publisher(); f.wire.abortAcknowledged=false; f.relay.stop();
            Result<VoiceMediaTransport.Publisher> next=new Result<>();
            f.relay.preparePublisher(new Grant(WebSocketAudioRelayTransport.Role.PUBLISHER),next); f.clock.advance(120);
            check(f.wire.connections.size()==1 && next.ready==0,"replacement pending while old native owner retires");
            old.pendingRelease.complete(true); f.clock.advance(130);
            check(f.wire.connections.size()==2 && next.ready==1,"release acknowledgement permits replacement");
        });
        test("late release cannot restore a poisoned owner", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); f.wire.abortAcknowledged=false; f.relay.stop();
            f.clock.advance(200); c.pendingRelease.complete(true);
            check(!f.relay.available(),"release timeout remains terminal after late acknowledgement");
        });
        test("packet admission carries the exact earliest capture and authorization cutoff", () -> {
            Fixture f=new Fixture(); Connection c=f.publisher(); f.publish.handle.microphone(true);
            c.events.captured(new byte[]{1},90); check(c.packetExpires==140,"capture age bounds packet lifetime");
            f.clock.advance(980); c.events.captured(new byte[]{2},980);
            check(c.packetExpires==1000,"authorization deadline bounds packet lifetime");
        });
        System.out.println("PASS " + passed + " relay contract tests");
    }
}
