package in.navrang.gate;

import java.util.concurrent.atomic.AtomicLong;

/** Rejects queued camera work from before a pause, ID/details transition or identity change. */
public final class ScannerFrameGate {
    public static final long MAX_AGE_MS = 1500;
    private final AtomicLong generation = new AtomicLong();
    private final ScanLatch delivered = new ScanLatch();
    public long capture() { return generation.get(); }
    public void invalidate() { generation.incrementAndGet(); }
    public boolean accepts(long captured, long started, long now, boolean active, boolean foreground, boolean held) {
        return active && foreground && !held && captured == generation.get()
            && now >= started && now - started <= MAX_AGE_MS;
    }
    /** Main-thread delivery only: stale work never consumes the still-visible QR latch. */
    public boolean observeRead(long captured, long started, long now, boolean active, boolean foreground, boolean held, String value) {
        return accepts(captured, started, now, active, foreground, held) && delivered.observe(value, now);
    }
}
