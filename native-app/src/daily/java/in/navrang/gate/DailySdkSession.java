package in.navrang.gate;

/**
 * One serialized SDK slot. Optional source only; not a VoiceMediaTransport factory.
 * Acknowledgements describe SDK operations, never physical capture latency or relay revocation.
 */
public final class DailySdkSession {
    public interface Completion { void done(boolean acknowledged); }
    public interface Listener { void joined(); void failed(); void disconnected(); }
    public interface Loop {
        boolean current(); long now(); void post(Runnable work); void delay(Runnable work, long milliseconds);
    }
    public interface Driver {
        void join(DailyNativeCredential credential, Completion completed, Runnable disconnected);
        void microphone(boolean enabled, Completion completed);
        void leave(Completion completed);
        void release();
    }
    public interface Factory { Driver create(); }
    private static final long OPERATION_MS = 1500;
    private final Loop loop;
    private final Factory factory;
    private Slot active;
    private long epoch;
    private boolean poisoned;

    private static final class Slot {
        final Driver driver; final DailyNativeCredential credential; final Listener listener;
        boolean joined, closing, terminal, released; long inputRevision;
        Slot(Driver d, DailyNativeCredential c, Listener l) { driver=d; credential=c; listener=l; }
    }
    public DailySdkSession(Loop loop, Factory factory) { this.loop=loop; this.factory=factory; }
    private void owner() { if (!loop.current()) throw new IllegalStateException("Daily session owner thread required."); }
    public boolean busy() { owner(); return active != null; }
    /** No new CallClient is created until the previous slot has left and released. */
    public VoiceAuthority.Pending open(DailyNativeCredential credential, Listener listener) {
        owner(); final long operation=++epoch;
        if (credential == null || !credential.usable(loop.now()) || poisoned) {
            if (credential != null) credential.destroy(); listener.failed(); return () -> {};
        }
        Slot previous=active;
        closeSlot(previous, ok -> {
            if (operation != epoch || !ok || !credential.usable(loop.now())) { credential.destroy(); listener.failed(); return; }
            Slot slot;
            try { slot=new Slot(factory.create(),credential,listener); } catch (Exception failure) { credential.destroy(); listener.failed(); return; }
            active=slot;
            loop.delay(() -> { if (active==slot && !slot.joined && !slot.closing) fail(slot); }, Math.min(OPERATION_MS, credential.deadlineElapsedMs-loop.now()));
            loop.delay(() -> { if (active==slot) fail(slot); }, credential.deadlineElapsedMs-loop.now());
            try { slot.driver.join(credential, success -> loop.post(() -> {
                if (active!=slot || slot.closing || slot.joined || operation!=epoch) return;
                if (!success || loop.now()>=credential.deadlineElapsedMs) { fail(slot); return; }
                slot.joined=true; slot.listener.joined();
            }), () -> loop.post(() -> { if (active==slot && !slot.closing) fail(slot); })); }
            catch (Exception failure) { fail(slot); }
            finally { credential.destroy(); }
        });
        return () -> loop.post(() -> { if (operation==epoch) close(ignored -> {}); });
    }
    /** Enable succeeds only after SDK acknowledgement for this exact slot/input revision. */
    public void microphone(boolean enabled, Completion completed) {
        owner(); Slot slot=active;
        if (slot==null || slot.closing || !slot.joined || loop.now()>=slot.credential.deadlineElapsedMs ||
                enabled && slot.credential.role!=DailyNativeCredential.Role.PUBLISHER) { completed.done(false); return; }
        if (!enabled) { close(completed); return; } // A revoked publisher is terminal; never reuse it.
        final long input=++slot.inputRevision;
        final boolean[] settled={false};
        Runnable timeout=() -> {
            if (!settled[0]) { settled[0]=true; if(active==slot && !slot.closing && input==slot.inputRevision)fail(slot); completed.done(false); }
        };
        loop.delay(timeout,Math.min(OPERATION_MS,slot.credential.deadlineElapsedMs-loop.now()));
        try { slot.driver.microphone(true, success -> loop.post(() -> {
            if (settled[0]) return; settled[0]=true;
            boolean accepted=success && active==slot && !slot.closing && input==slot.inputRevision && loop.now()<slot.credential.deadlineElapsedMs;
            if (!accepted && active==slot && !slot.closing && input==slot.inputRevision) fail(slot);
            completed.done(accepted);
        })); } catch(Exception failure) { timeout.run(); }
    }
    /** Stops future enable intent immediately on this owner thread, then bounds mute/leave ACKs. */
    public void close(Completion completed) { owner(); ++epoch; closeSlot(active,completed); }
    private void fail(Slot slot) {
        if (active!=slot || slot.closing) return;
        boolean joined=slot.joined;
        closeSlot(slot, ignored -> {});
        if (!slot.terminal) { slot.terminal=true; if(joined)slot.listener.disconnected();else slot.listener.failed(); }
    }
    private void closeSlot(Slot slot, Completion completed) {
        if (slot==null) { completed.done(!poisoned); return; }
        // Do not race a second replacement against an uncertain close.
        if (slot.closing) { completed.done(false); return; }
        slot.closing=true; ++slot.inputRevision; slot.credential.destroy();
        final boolean[] finished={false};
        Completion finish=ack -> {
            if (finished[0])return; finished[0]=true;
            try { if(!slot.released){slot.released=true;slot.driver.release();} }
            catch(Exception failure){poisoned=true;ack=false;}
            if (!ack) poisoned=true; // Uncertain teardown requires a new transport owner.
            if(active==slot)active=null; completed.done(ack&&!poisoned);
        };
        loop.delay(() -> finish.done(false),OPERATION_MS);
        try { slot.driver.microphone(false, muted -> loop.post(() -> {
            if(finished[0])return;
            if(!muted){finish.done(false);return;}
            try { slot.driver.leave(left -> loop.post(() -> finish.done(left))); }
            catch(Exception failure){finish.done(false);}
        })); } catch(Exception failure){finish.done(false);}
    }
}
