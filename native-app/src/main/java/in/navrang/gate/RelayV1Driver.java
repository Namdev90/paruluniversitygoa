package in.navrang.gate;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.LinkedHashMap;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Map;
import java.util.Objects;

/** Concrete v1 wire adaptation with injected native upgrade and Opus/device boundaries. */
public final class RelayV1Driver implements WebSocketAudioRelayTransport.Driver {
    public interface Time extends WebSocketAudioRelayTransport.Scheduler {
        /** Conservative synchronized server Unix-time upper bound; -1 means unavailable. Never device wall time alone. */
        long serverUpperBoundUnixMs();
    }
    public interface SessionAuthorization extends WebSocketAudioRelayTransport.Authorization {
        /** Native authority owns verified identity/role and a fresh externally issued JWT; never stringify it. */
        String room(); String subject();
        /** Atomically consume this upgrade authorization once; reconnect needs a fresh server jti. */
        boolean claimUpgrade();
    }
    public static final class Upgrade {
        public final String method="GET", authorizationHeaderName="Authorization", authorizationScheme="Bearer", path;
        public final String upgradeHeaderName="Upgrade",upgradeHeaderValue="websocket";
        private final SessionAuthorization authorization;
        Upgrade(SessionAuthorization authorization) { this.authorization=authorization; path="/v1/rooms/"+authorization.room()+"/socket"; }
        public SessionAuthorization authorization() { return authorization; }
        public String toString() { return "RelayUpgrade[redacted]"; }
    }
    public interface SocketEvents { void text(String text); void binary(byte[] bytes); void closed(); }
    public interface Socket {
        /** Borrow bytes only during call; one bounded async admission, no retry; completion releases its copied packet. This is not write/playback proof. */
        boolean binary(byte[] bytes,long expiresElapsedMs,long deadlineUnixMs,WebSocketAudioRelayTransport.Completion completion);
        boolean text(String text);
        /** Invalidate immediately and cancel queued socket bytes. Acknowledge actual local teardown asynchronously. */
        void abort(int code,String reason,WebSocketAudioRelayTransport.Completion released);
    }
    public interface Connector {
        boolean configured();
        /** Use configured TLS origin, exact GET path, Upgrade:websocket and Authorization:Bearer native header. No query tokens. */
        Socket upgrade(Upgrade request,SocketEvents events);
    }
    /** Speaker admission is distinct from authority commit and device audio ownership. */
    public interface PreparedEvents extends WebSocketAudioRelayTransport.Events {
        void admitted(); void granted(RelayV1Protocol.Grant grant);
    }
    public interface PreparedConnection extends WebSocketAudioRelayTransport.Connection {
        void activateMedia();
    }
    public interface Capture { void opus(byte[] bytes,long capturedElapsedMs); }
    public interface Audio {
        void microphone(boolean enabled,VoiceMediaTransport.InputResult result);
        /** Consume borrowed Opus mono 48kHz nominal-20ms packet now; enforce deadlines in bounded decoder/jitter/output queues too. */
        boolean playOpus(byte[] bytes,boolean reset,long expiresElapsedMs,long deadlineUnixMs,WebSocketAudioRelayTransport.Completion consumed);
        /** Flush decoder/jitter AND output on a sequence gap; no concealment across a stale grant. */
        void abort(WebSocketAudioRelayTransport.Completion released);
    }
    public interface AudioFactory {
        /** Return an immediately cancellable, muted handle. Initialize resources on an owned worker; acknowledge readiness asynchronously. */
        Audio open(WebSocketAudioRelayTransport.Role role,long expiresElapsedMs,long deadlineUnixMs,Capture capture,WebSocketAudioRelayTransport.Completion ready);
    }
    /** Owner-lifetime replay metadata: exact recent floors plus permanent conservative tombstones.
     * No clock observation proves old floors safe to forget. Evicted rooms are therefore
     * represented by an append-only Bloom filter: collisions reject, never admit, a grant.
     */
    public static final class RetiredEpochs {
        private static final int RECENT_ROOMS=64, FILTER_BYTES=8*1024*1024, HASHES=7;
        private final Map<String,Long> rooms=new LinkedHashMap<>();
        private final MessageDigest digest;
        private byte[] tombstones;
        private boolean failed;
        public RetiredEpochs() {
            try { digest=MessageDigest.getInstance("SHA-256"); }
            catch (NoSuchAlgorithmException failure) { throw new IllegalStateException("Replay digest unavailable",failure); }
        }
        public synchronized long floor(String room) {
            if(failed)return RelayV1Protocol.MAX_UINT32;
            Long exact=rooms.get(room);
            if(exact!=null)return exact;
            return contains(room)?RelayV1Protocol.MAX_UINT32:0;
        }
        public synchronized boolean retire(String room,long epoch) {
            if(failed||!RelayV1Protocol.identifier(room)||epoch<=0||epoch>RelayV1Protocol.MAX_UINT32)return false;
            try {
                Long previous=rooms.get(room);
                if(previous!=null){rooms.put(room,Math.max(epoch,previous));return true;}
                if(contains(room))return !failed; // Already permanently fenced (or a safe false positive).
                if(rooms.size()>=RECENT_ROOMS){
                    String oldest=rooms.keySet().iterator().next();
                    remember(oldest); // Publish every tombstone bit BEFORE removing the exact floor.
                    rooms.remove(oldest);
                }
                rooms.put(room,epoch);return true;
            } catch(OutOfMemoryError failure) {
                // Never continue with a partially recorded retirement after allocation failure.
                failed=true;return false;
            }
        }
        private byte[] hash(String room){return digest.digest(room.getBytes(StandardCharsets.UTF_8));}
        private int bit(byte[] hash,int probe){
            int at=probe*4;
            int word=(hash[at]&255)<<24|(hash[at+1]&255)<<16|(hash[at+2]&255)<<8|(hash[at+3]&255);
            return word&(FILTER_BYTES*8-1);
        }
        private boolean contains(String room){
            if(tombstones==null)return false;
            try {
                byte[] hash=hash(room);
                for(int i=0;i<HASHES;i++){int bit=bit(hash,i);if((tombstones[bit>>>3]&(1<<(bit&7)))==0)return false;}
                return true;
            } catch(OutOfMemoryError failure){failed=true;return true;}
        }
        private void remember(String room){
            if(tombstones==null)tombstones=new byte[FILTER_BYTES];
            byte[] hash=hash(room);
            for(int i=0;i<HASHES;i++){int bit=bit(hash,i);tombstones[bit>>>3]|=(byte)(1<<(bit&7));}
        }
    }
    private final Time time;
    private final Connector connector;
    private final AudioFactory audioFactory;
    private final RetiredEpochs retiredEpochs;
    private final List<Session> sessions=new ArrayList<>(2);
    private Object owner=new Object();
    private boolean bound, poisoned, clockObserved;
    private long lastElapsed=-1,lastUnix=-1;
    private static final int SOCKET_BUDGET=262144;
    public RelayV1Driver(Time time,Connector connector,AudioFactory audioFactory) {
        this(time,connector,audioFactory,new RetiredEpochs());
    }
    public RelayV1Driver(Time time,Connector connector,AudioFactory audioFactory,RetiredEpochs retiredEpochs) {
        this.time=Objects.requireNonNull(time); this.connector=Objects.requireNonNull(connector); this.audioFactory=Objects.requireNonNull(audioFactory);
        this.retiredEpochs=Objects.requireNonNull(retiredEpochs);
    }
    public void bindOwner(Object owner) {
        if (bound || !sessions.isEmpty()) throw new IllegalStateException("Relay driver already owned");
        this.owner=Objects.requireNonNull(owner); bound=true;
    }
    public boolean configured() { synchronized (owner) {
        try { return bound && !poisoned && connector.configured(); }
        catch (RuntimeException ignored) { return false; }
    } }
    public boolean available() { synchronized (owner) {
        try { return bound && !poisoned && connector.configured() && sample()!=null; }
        catch (RuntimeException ignored) { return false; }
    } }
    public WebSocketAudioRelayTransport.Connection open(WebSocketAudioRelayTransport.Authorization authorization,WebSocketAudioRelayTransport.Events events) {
        return openInternal(authorization,events,false);
    }
    public PreparedConnection openPrepared(WebSocketAudioRelayTransport.Authorization authorization,PreparedEvents events) {
        return (PreparedConnection)openInternal(authorization,events,true);
    }
    private WebSocketAudioRelayTransport.Connection openInternal(WebSocketAudioRelayTransport.Authorization authorization,WebSocketAudioRelayTransport.Events events,boolean prepared) {
        synchronized (owner) {
            if (!(authorization instanceof SessionAuthorization) || prepared && authorization.role()!=WebSocketAudioRelayTransport.Role.PUBLISHER || !available()) { events.disconnected(); return null; }
            SessionAuthorization auth=(SessionAuthorization)authorization;
            if (!RelayV1Protocol.identifier(auth.room()) || !RelayV1Protocol.identifier(auth.subject()) || auth.revoked() ||
                    auth.role()==null || sessions.size()>=2 || sessions.stream().anyMatch(s -> s.role==auth.role()) || !auth.claimUpgrade()) {
                events.disconnected(); return null;
            }
            Session session=new Session(auth,events,prepared); sessions.add(session);
            try {
                session.socketOpening=true;
                Socket socket=connector.upgrade(new Upgrade(auth),new SocketEvents() {
                    public void text(String text) { synchronized (owner) { session.control(text); } }
                    public void binary(byte[] bytes) { synchronized (owner) { session.incoming(bytes); } }
                    public void closed() { synchronized (owner) { session.end(true,null); } }
                });
                session.socketOpening=false;
                if (session.ended) { if (socket!=null) socket.abort(1008,"relay stopped",session::partReleased);else session.partReleased(true); }
                else if (socket==null) session.end(true,null);
                else { session.socket=socket; session.initialize(); }
            } catch (RuntimeException ignored) { session.uncertain=true; session.end(true,null); poison(); }
            return session;
        }
    }
    private static final class Sample {
        final long elapsed,unix;
        Sample(long elapsed,long unix) { this.elapsed=elapsed; this.unix=unix; }
    }
    private Sample sample() {
        if (poisoned) return null;
        long elapsed,unix;
        try { elapsed=time.now(); unix=time.serverUpperBoundUnixMs(); }
        catch (RuntimeException ignored) { elapsed=-1; unix=-1; }
        if (elapsed<0 || unix<0 || unix>RelayV1Protocol.MAX_SAFE_INTEGER || elapsed<lastElapsed || unix<lastUnix) {
            if (clockObserved || !sessions.isEmpty()) poison(); return null;
        }
        clockObserved=true; lastElapsed=elapsed; lastUnix=unix; return new Sample(elapsed,unix);
    }
    private void poison() {
        poisoned=true;
        for (Session session:new ArrayList<>(sessions)) session.end(true,null);
    }
    private boolean retireRoom(String room,long epoch) {
        boolean recorded=retiredEpochs.retire(room,epoch);
        if (!recorded) { poison(); return false; }
        for (Session session:new ArrayList<>(sessions)) {
            if (session.room.equals(room) && session.grant!=null && session.grant.epoch<=epoch) session.end(true,null);
        }
        return true;
    }
    private final class Session implements PreparedConnection {
        final SessionAuthorization authorization;
        final WebSocketAudioRelayTransport.Events events;
        final WebSocketAudioRelayTransport.Role role;
        final String room,subject;
        final long authorityUntil;
        final ArrayDeque<Long> framesSent=new ArrayDeque<>(), controlsSent=new ArrayDeque<>(), controlsReceived=new ArrayDeque<>();
        Socket socket; Audio audio; RelayV1Protocol.Grant grant;
        VoiceAuthority.Pending expiry;
        long grantUntil,txSequence,rxSequence,pendingSequence,inputOperation;
        int sentBytes,receivedBytes;
        boolean mediaAllowed,serverReady,appReady,audioOpening,socketOpening,ended,capturing,uncertain,released,releaseSuccess,resetPlayback,txPending,rxPending;
        int releases; final List<WebSocketAudioRelayTransport.Completion> releaseCallbacks=new ArrayList<>();
        Session(SessionAuthorization authorization,WebSocketAudioRelayTransport.Events events,boolean prepared) {
            mediaAllowed=!prepared;
            this.authorization=authorization; this.events=events; role=authorization.role();
            room=authorization.room(); subject=authorization.subject(); authorityUntil=authorization.deadlineElapsedMs();
        }
        Sample current(boolean requireGrant) {
            if (ended) return null;
            Sample now=sample();
            boolean valid=false;
            try { valid=now!=null && !authorization.revoked() && authorization.role()==role && room.equals(authorization.room()) &&
                    subject.equals(authorization.subject()) && now.elapsed<authorityUntil && now.elapsed<authorization.deadlineElapsedMs() &&
                    (!requireGrant || grant!=null) && (grant==null || now.elapsed<grantUntil && now.unix<grant.deadlineUnixMs &&
                    grant.epoch>retiredEpochs.floor(room)); }
            catch (RuntimeException ignored) { }
            if (!valid) { end(true,null); return null; }
            return now;
        }
        void control(String text) {
            Sample now=current(false); if (now==null) return;
            try {
                if (text==null || text.length()>512 || !rate(controlsReceived,now.elapsed,100) ||
                        !receiveBudget(text.getBytes(StandardCharsets.UTF_8).length)) { end(true,null); return; }
                RelayV1Protocol.Control control=RelayV1Protocol.control(text);
                switch (control.type) {
                    case "ready":
                        if (serverReady || !subject.equals(control.subject) || !wireRole().equals(control.role)) { end(true,null); return; }
                        serverReady=true; if(events instanceof PreparedEvents)((PreparedEvents)events).admitted(); break;
                    case "grant":
                        if (!serverReady || role==WebSocketAudioRelayTransport.Role.PUBLISHER && !subject.equals(control.grant.subject)) { end(true,null); return; }
                        if (grant!=null) { if (!grant.same(control.grant)) end(true,null); return; }
                        if (control.grant.epoch<=retiredEpochs.floor(room)) { end(true,null); return; }
                        long remaining=control.grant.deadlineUnixMs-now.unix;
                        if (remaining<=0 || remaining>15000 || now.elapsed>Long.MAX_VALUE-remaining) { end(true,null); return; }
                        grant=control.grant; grantUntil=Math.min(authorityUntil,now.elapsed+remaining);
                        expiry=time.delay(() -> { synchronized (owner) { end(true,null); } },grantUntil-now.elapsed);
                        if (expiry==null) { uncertain=true; poison(); return; }
                        if(events instanceof PreparedEvents)((PreparedEvents)events).granted(grant);
                        break;
                    case "revoked":
                        // Any revocation ends this local lease; stale/unknown epochs also fail closed.
                        retireRoom(room,control.epoch);
                        end(true,null); return;
                    default: end(true,null); return;
                }
                initialize();
            } catch (RuntimeException ignored) { end(true,null); }
        }
        String wireRole() { return role==WebSocketAudioRelayTransport.Role.PUBLISHER ? "speaker":"listener"; }
        public void activateMedia() { synchronized(owner) {
            if(ended||mediaAllowed||role!=WebSocketAudioRelayTransport.Role.PUBLISHER||grant==null||current(true)==null)return;
            mediaAllowed=true;initialize();
        } }
        void initialize() {
            if (!mediaAllowed || ended || appReady || audioOpening || socket==null || !serverReady || role==WebSocketAudioRelayTransport.Role.PUBLISHER && grant==null || current(false)==null) return;
            try {
                audioOpening=true;
                Audio port=audioFactory.open(role,grant==null?authorityUntil:grantUntil,grant==null?authorization.expiresAtMs():grant.deadlineUnixMs,(bytes,captured) -> { synchronized (owner) {
                    if (capturing && appReady && current(true)!=null && bytes!=null && bytes.length>0 && bytes.length<=RelayV1Protocol.MAX_PAYLOAD_BYTES)
                        events.captured(bytes,captured);
                } },success->{synchronized(owner){
                    if(!success){end(true,null);return;}
                    audioReady=true;audioInitialized();
                }});
                audio=port;audioOpening=false;
                if(ended){if(port!=null)port.abort(ok->{synchronized(owner){partReleased(ok);}});else partReleased(true);return;}
                if(port==null){end(true,null);return;}audioInitialized();
            } catch (RuntimeException ignored) { audioOpening=false;uncertain=true;end(true,null);poison(); }
        }
        boolean audioReady;
        void audioInitialized(){
            if(!ended&&!appReady&&audio!=null&&audioReady&&current(false)!=null){appReady=true;events.opened();}
        }

        void incoming(byte[] bytes) {
            if (current(true)==null) return;
            RelayV1Protocol.Frame frame=null;
            try {
                if (!appReady || role!=WebSocketAudioRelayTransport.Role.RECEIVER || pendingSequence!=0 || bytes==null ||
                        !receiveBudget(bytes.length)) { end(true,null); return; }
                frame=RelayV1Protocol.decode(bytes);
                if (!frame.matches(grant) || frame.sequence<=rxSequence) { end(true,null); return; }
                resetPlayback=frame.sequence!=rxSequence+1;
                rxSequence=frame.sequence; pendingSequence=frame.sequence;
                long sequence=frame.sequence;
                // The adapter invokes completion only after its queue actually consumes/drops this frame.
                events.received(frame.payload,() -> { synchronized (owner) { consumed(sequence); } });
            } catch (RuntimeException ignored) { end(true,null); }
            finally { if (frame!=null) frame.destroy(); }
        }
        void consumed(long sequence) {
            if (ended || pendingSequence!=sequence) return;
            Sample now=current(true); if (now==null) return;
            String ack=RelayV1Protocol.ack(grant.epoch,sequence);
            if (!rate(controlsSent,now.elapsed,100) || !sendBudget(ack.length())) { end(true,null); return; }
            pendingSequence=0;
            try { if (!socket.text(ack)) end(true,null); } catch (RuntimeException ignored) { end(true,null); }
        }
        public void microphone(boolean enabled,VoiceMediaTransport.InputResult result) { synchronized (owner) {
            if (!enabled) { end(false,success->{if(success)result.applied(false);else result.failed();}); return; }
            if (!appReady || role!=WebSocketAudioRelayTransport.Role.PUBLISHER || current(true)==null) { result.failed(); return; }
            long operation=++inputOperation; capturing=false;
            try { audio.microphone(true,new VoiceMediaTransport.InputResult() {
                public void applied(boolean value) { synchronized (owner) {
                    if (operation!=inputOperation || ended) return;
                    if (!value || current(true)==null) { end(true,null); result.failed(); return; }
                    capturing=true; result.applied(true);
                } }
                public void failed() { synchronized (owner) {
                    if (operation!=inputOperation || ended) return;
                    end(true,null); result.failed();
                } }
            }); } catch (RuntimeException ignored) { end(true,null); result.failed(); }
        } }
        public boolean sendAudio(byte[] payload,long expiresElapsedMs,WebSocketAudioRelayTransport.Completion completion) { synchronized (owner) {
            Sample now=current(true); if (now==null) return false;
            if (!appReady || !capturing || txPending || role!=WebSocketAudioRelayTransport.Role.PUBLISHER || expiresElapsedMs<=now.elapsed ||
                    txSequence>=RelayV1Protocol.MAX_UINT32 || !rate(framesSent,now.elapsed,50)) { end(true,null); return false; }
            byte[] packet=null;
            try {
                packet=RelayV1Protocol.encode(grant,txSequence+1,payload);
                if (!sendBudget(packet.length) || current(true)==null || !sendPacket(packet,Math.min(expiresElapsedMs,grantUntil),completion)) {
                    end(true,null); return false;
                }
                txSequence++; return !ended;
            } catch (RuntimeException ignored) { end(true,null); return false; }
            finally { if (packet!=null) Arrays.fill(packet,(byte)0); }
        } }
        public boolean playAudio(byte[] payload,long expiresElapsedMs,WebSocketAudioRelayTransport.Completion completion) { synchronized (owner) {
            Sample now=current(true); if (now==null) return false;
            if (!appReady || rxPending || role!=WebSocketAudioRelayTransport.Role.RECEIVER || pendingSequence==0 || expiresElapsedMs<=now.elapsed) {
                end(true,null); return false;
            }
            try {
                rxPending=true;
                boolean accepted=audio.playOpus(payload,resetPlayback,Math.min(expiresElapsedMs,grantUntil),grant.deadlineUnixMs,
                    success->{synchronized(owner){if(!rxPending)return;rxPending=false;if(!success)end(true,null);completion.complete(success&&!ended);}});
                if (!accepted){rxPending=false;end(true,null);} return accepted && !ended;
            } catch (RuntimeException ignored) { end(true,null); return false; }
        } }
        boolean receiveBudget(int bytes) {
            if (bytes<0 || receivedBytes>SOCKET_BUDGET-bytes) return false; receivedBytes+=bytes; return true;
        }
        boolean sendBudget(int bytes) {
            if (bytes<0 || sentBytes>SOCKET_BUDGET-bytes) return false; sentBytes+=bytes; return true;
        }
        boolean sendPacket(byte[] packet,long expires,WebSocketAudioRelayTransport.Completion completion){
            txPending=true;
            boolean admitted=socket.binary(packet,expires,grant.deadlineUnixMs,success->{synchronized(owner){
                if(!txPending)return;txPending=false;if(!success)end(true,null);completion.complete(success&&!ended);
            }});
            if(!admitted)txPending=false;return admitted;
        }
        void end(boolean notify,WebSocketAudioRelayTransport.Completion completion) {
            if(completion!=null){if(released){completion.complete(releaseSuccess);return;}releaseCallbacks.add(completion);}
            if(ended)return;
            ended=true;capturing=false;inputOperation++;pendingSequence=0;txPending=false;rxPending=false;
            if(grant!=null&&!retireRoom(room,grant.epoch))uncertain=true;
            if(expiry!=null){try{expiry.cancel();}catch(RuntimeException ignored){uncertain=true;}expiry=null;}
            // Reserve both completions before any synchronous callback can occur.
            releases=(audio!=null||audioOpening?1:0)+(socket!=null||socketOpening?1:0);
            Audio oldAudio=audio;audio=null;Socket oldSocket=socket;socket=null;
            if(oldAudio!=null)try{oldAudio.abort(success->{synchronized(owner){partReleased(success);}});}catch(RuntimeException failure){partReleased(false);}
            if(oldSocket!=null)try{oldSocket.abort(1008,"relay stopped",success->{synchronized(owner){partReleased(success);}});}catch(RuntimeException failure){partReleased(false);}
            framesSent.clear();controlsSent.clear();controlsReceived.clear();
            finishRelease();
            if(notify)try{events.disconnected();}catch(RuntimeException ignored){}
        }
        void partReleased(boolean success){if(released)return;if(!success)uncertain=true;if(releases>0)releases--;finishRelease();}
        void finishRelease(){
            if(released||!ended||releases!=0)return;released=true;releaseSuccess=!uncertain;sessions.remove(this);
            if(uncertain)poison();
            for(WebSocketAudioRelayTransport.Completion done:new ArrayList<>(releaseCallbacks))try{done.complete(releaseSuccess);}catch(RuntimeException ignored){}
            releaseCallbacks.clear();
        }
        public void abort(WebSocketAudioRelayTransport.Completion completion){synchronized(owner){end(false,completion);}}
    }

    private static boolean rate(ArrayDeque<Long> samples,long now,int maximum) {
        while (!samples.isEmpty() && samples.peekFirst()<=now-1000) samples.removeFirst();
        if (samples.size()>=maximum) return false; samples.addLast(now); return true;
    }
}
