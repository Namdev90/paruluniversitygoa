package in.navrang.gate;

import java.util.ArrayList;
import java.util.List;

/** One native SDK slot; credentials and audio never cross the WebView boundary. */
public final class DailyMediaTransport implements VoiceMediaTransport, AutoCloseable {
    private final DailySdkSession.Loop loop;
    private final DailySdkSession session;
    private final List<DailySdkSession.Completion> closeResults = new ArrayList<>();
    private Request<?> active, queued;
    private boolean closing;
    private volatile boolean closed, poisoned;

    private final class Request<T> {
        final DailyNativeCredential credential;
        final Result<T> result;
        final boolean publisher;
        final Handle handle = new Handle(this);
        boolean ready, ended, cancelled;
        Request(DailyNativeCredential credential, Result<T> result, boolean publisher) {
            this.credential = credential; this.result = result; this.publisher = publisher;
        }
        @SuppressWarnings("unchecked")
        void joined() {
            if (active != this || ended || closed || poisoned) return;
            ready = true;
            // A handle exposes only the interface requested by the authenticated coordinator.
            result.ready((T) handle);
        }
        void reject() {
            if (ended) return;
            ended = true; credential.destroy();
            if (!cancelled && !ready) result.failed();
        }
    }

    private final class Handle implements Receiver, Publisher {
        final Request<?> request;
        Handle(Request<?> request) { this.request = request; }
        @Override public void close() { dispatch(() -> retire(request, null)); }
        @Override public void microphone(boolean enabled) {
            microphone(enabled, new InputResult() {
                public void applied(boolean ignored) {}
                public void failed() {}
            });
        }
        @Override public void microphone(boolean enabled, InputResult result) {
            dispatch(() -> {
                if (active!=request || request.ended || !request.publisher || !request.ready) { result.failed(); return; }
                if (!enabled) {
                    retire(request, acknowledged -> {
                        if (acknowledged) result.applied(false); else result.failed();
                    });
                    return;
                }
                if (!current(request)) { retire(request,null);result.failed();return; }
                session.microphone(true, acknowledged -> {
                    if (acknowledged && current(request)) result.applied(true); else result.failed();
                });
            });
        }
    }

    public DailyMediaTransport(DailySdkSession.Loop loop, DailySdkSession.Factory factory) {
        this.loop = loop; session = new DailySdkSession(loop, factory);
    }
    private void dispatch(Runnable work) { if (loop.current()) work.run(); else loop.post(work); }
    private boolean current(Request<?> request) {
        return active == request && !request.ended && !closed && !poisoned &&
            loop.now() < request.credential.deadlineElapsedMs;
    }
    @Override public boolean available() { return !closed && !poisoned; }
    @Override public VoiceAuthority.Pending receive(Credential credential, Result<Receiver> result) {
        return submit(credential, result, false);
    }
    @Override public VoiceAuthority.Pending preparePublisher(Credential credential, Result<Publisher> result) {
        return submit(credential, result, true);
    }
    private <T> VoiceAuthority.Pending submit(Credential credential, Result<T> result, boolean publisher) {
        if (!(credential instanceof DailyNativeCredential)) {
            if (credential != null) credential.destroy();
            dispatch(result::failed); return () -> {};
        }
        Request<T> request = new Request<>((DailyNativeCredential) credential, result, publisher);
        dispatch(() -> enqueue(request));
        return () -> dispatch(() -> {
            request.cancelled = true;
            if (queued == request) { queued = null; request.reject(); }
            else if (active == request) retire(request, null);
            else request.credential.destroy();
        });
    }
    private void enqueue(Request<?> request) {
        DailyNativeCredential.Role role = request.publisher ? DailyNativeCredential.Role.PUBLISHER : DailyNativeCredential.Role.LISTENER;
        if (!available() || request.cancelled || request.credential.role != role || !request.credential.usable(loop.now())) {
            request.reject(); return;
        }
        if (queued != null) queued.reject();
        queued = request;
        loop.delay(() -> {
            if (queued == request) { queued = null; request.reject(); }
        }, request.credential.deadlineElapsedMs - loop.now());
        if (active != null) retire(active, null);
        else if (!closing) startNext();
    }
    private void startNext() {
        if (closing || active != null || queued == null) return;
        Request<?> request = queued; queued = null;
        if (!available() || request.cancelled || !request.credential.usable(loop.now())) { request.reject(); return; }
        active = request;
        session.open(request.credential, new DailySdkSession.Listener() {
            public void joined() { request.joined(); }
            public void failed() { terminal(request); }
            public void disconnected() { terminal(request); }
        });
    }
    private void terminal(Request<?> request) {
        if (active != request || request.ended) return;
        // DailySdkSession has already initiated bounded teardown. Do not race it
        // with another close/open, or treat uncertain media ownership as usable.
        active = null; poisoned = true; request.ended = true; request.credential.destroy();
        if (queued != null) { queued.reject(); queued = null; }
        if (!request.cancelled) {
            if (request.ready) request.result.disconnected(); else request.result.failed();
        }
    }
    private void retire(Request<?> request, DailySdkSession.Completion completed) {
        if (active != request || request.ended) {
            if (completed != null) completed.done(false);
            return;
        }
        active = null;
        request.reject();
        if (completed != null) closeResults.add(completed);
        closing = true;
        // The SDK receives mute immediately on its owner thread, before any
        // replacement can allocate another client. Completion includes release.
        session.close(acknowledged -> {
            closing = false;
            if (!acknowledged) poisoned = true;
            List<DailySdkSession.Completion> results = new ArrayList<>(closeResults);
            closeResults.clear();
            for (DailySdkSession.Completion result : results) result.done(acknowledged);
            if (!available()) {
                if (queued != null) { queued.reject(); queued = null; }
            } else startNext();
        });
    }
    @Override public void close() {
        dispatch(() -> {
            if (closed) return;
            closed = true;
            if (queued != null) { queued.reject(); queued = null; }
            if (active != null) retire(active, null);
        });
    }
}
