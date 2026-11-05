package in.navrang.gate;

import java.io.DataOutputStream;
import java.io.FileOutputStream;
import java.util.Random;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicReference;

public final class BundledRelayEncoderHostTest {
    private static void check(boolean ok, String what) {
        if (!ok) throw new AssertionError(what);
    }
    private static void invalid(BundledRelayEncoder e, byte[] pcm, byte[] out, String what) {
        check(e.encode(pcm, out) == -1, what);
    }
    public static void main(String[] args) throws Exception {
        check(BundledRelayEncoder.available(), "native library available");
        byte[] pcm = new byte[1920], out = new byte[2048];
        Random noise = new Random(7);
        BundledRelayEncoder e = new BundledRelayEncoder();
        invalid(e, null, out, "null PCM");
        invalid(e, pcm, null, "null output");
        invalid(e, new byte[1919], out, "short PCM");
        invalid(e, new byte[1921], out, "long PCM");
        invalid(e, pcm, new byte[59], "short output");
        invalid(e, pcm, new byte[2047], "2047-byte output");
        invalid(e, pcm, new byte[2049], "2049-byte output");
        int packets = 0;
        try (DataOutputStream packetFile = new DataOutputStream(new FileOutputStream(args[0]))) {
            for (int mode = 0; mode < 3; mode++) {
                for (int frame = 0; frame < 100; frame++) {
                    for (int sample = 0; sample < 960; sample++) {
                        short value = mode == 0 ? 0 : mode == 1
                            ? (short) (10000 * Math.sin((frame * 960 + sample) * 2 * Math.PI * 440 / 48000))
                            : (short) noise.nextInt();
                        pcm[2 * sample] = (byte) value;
                        pcm[2 * sample + 1] = (byte) (value >>> 8);
                    }
                    int n = e.encode(pcm, out);
                    check(n == 60, "24kbps CBR 20ms payload length");
                    byte[] packet = java.util.Arrays.copyOf(out, n);
                    check(RelayOpusPacket.twentyMsMono(packet), "app TOC duration/channel gate");
                    packetFile.writeInt(n);
                    packetFile.write(packet);
                    packets++;
                }
            }
        } finally {
            e.close();
            e.close();
        }
        invalid(e, pcm, out, "encode after close");
        for (int round = 0; round < 100; round++) {
            BundledRelayEncoder racing = new BundledRelayEncoder();
            CountDownLatch start = new CountDownLatch(1);
            AtomicReference<Throwable> failure = new AtomicReference<>();
            Thread encode = new Thread(() -> {
                try {
                    start.await();
                    byte[] localPcm = new byte[1920], localOut = new byte[2048];
                    for (int i = 0; i < 100; i++) {
                        int n = racing.encode(localPcm, localOut);
                        check(n == -1 || n == 60, "race encode result");
                    }
                } catch (Throwable t) { failure.compareAndSet(null, t); }
            });
            Thread close = new Thread(() -> {
                try { start.await(); racing.close(); racing.close(); }
                catch (Throwable t) { failure.compareAndSet(null, t); }
            });
            encode.start(); close.start(); start.countDown();
            encode.join(); close.join();
            if (failure.get() != null) throw new AssertionError("race failed", failure.get());
            invalid(racing, pcm, out, "race closed encoder");
        }
        System.out.println("PASS JNI: " + packets + " mono 20ms CBR packets; invalid inputs; close/idempotence; 100 two-thread encode/close rounds");
    }
}
