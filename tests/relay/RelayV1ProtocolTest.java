package in.navrang.gate;

import java.util.Arrays;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;

/** Hand-derived protocol vectors; synthetic payloads, never Opus/device acceptance. */
public final class RelayV1ProtocolTest {
    private static int passed;
    private static final String ID = "00112233-4455-6677-8899-aabbccddeeff";
    private static final byte[] GOLD = {
        78,86,82,71,1,1,0,40, 1,2,3,4, 5,6,7,8,
        0,0,1,2,3,4,5,6, 0,17,34,51,68,85,102,119,
        (byte)136,(byte)153,(byte)170,(byte)187,(byte)204,(byte)221,(byte)238,(byte)255, 17,34
    };
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static void reject(Runnable work) {
        try { work.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("malformed protocol accepted");
    }
    private static void test(String name, Runnable work) { work.run(); passed++; System.out.println("PASS " + name); }
    public static void main(String[] args) throws IOException {
        test("wire encoder matches hand-derived big endian vector", () -> {
            byte[] encoded = RelayV1Protocol.encode(new RelayV1Protocol.Grant(ID, 0x01020304L, "speaker", 0x0000010203040506L),
                    0x05060708L, new byte[]{17,34});
            check(Arrays.equals(GOLD, encoded), "exact 40-byte header/raw UUID/payload");
        });
        test("wire decoder reads independent golden fixture", () -> {
            RelayV1Protocol.Frame frame = RelayV1Protocol.decode(GOLD);
            check(frame.epoch == 0x01020304L && frame.sequence == 0x05060708L && frame.deadlineUnixMs == 0x0000010203040506L &&
                    frame.grantId.equals(ID) && Arrays.equals(frame.payload, new byte[]{17,34}), "gold decode");
        });
        test("unsigned epoch and sequence retain full uint32 range", () -> {
            byte[] bytes = GOLD.clone(); Arrays.fill(bytes, 8, 16, (byte)255);
            RelayV1Protocol.Frame frame = RelayV1Protocol.decode(bytes);
            check(frame.epoch == 4294967295L && frame.sequence == 4294967295L, "unsigned range");
        });
        test("all fixed header fields and zero counters reject", () -> {
            for (int offset : new int[]{0,1,2,3,4,5,6,7}) { byte[] bytes = GOLD.clone(); bytes[offset] ^= 1; reject(() -> RelayV1Protocol.decode(bytes)); }
            for (int offset : new int[]{8,12}) { byte[] bytes = GOLD.clone(); Arrays.fill(bytes, offset, offset + 4, (byte)0); reject(() -> RelayV1Protocol.decode(bytes)); }
        });
        test("frame length and payload bounds reject", () -> {
            for (int length : new int[]{0,39,40,2089}) reject(() -> RelayV1Protocol.decode(new byte[length]));
            RelayV1Protocol.Grant grant = new RelayV1Protocol.Grant(ID, 1, "speaker", 1000);
            reject(() -> RelayV1Protocol.encode(grant, 1, new byte[0])); reject(() -> RelayV1Protocol.encode(grant, 1, new byte[2049]));
            check(RelayV1Protocol.encode(grant, 1, new byte[2048]).length == 2088, "maximum payload");
        });
        test("unsafe uint64 deadline and noncanonical UUID reject", () -> {
            byte[] bytes = GOLD.clone(); bytes[16] = (byte)128; reject(() -> RelayV1Protocol.decode(bytes));
            reject(() -> new RelayV1Protocol.Grant("1-1-1-1-1", 1, "speaker", 1000));
            reject(() -> new RelayV1Protocol.Grant(ID, 0, "speaker", 1000));
            reject(() -> new RelayV1Protocol.Grant(ID, 1, "bad/subject", 1000));
        });
        test("ready and immutable grant controls accept reordered fields", () -> {
            RelayV1Protocol.Control ready = RelayV1Protocol.control(" { \"subject\":\"listener_1\", \"role\":\"listener\", \"type\":\"ready\" } ");
            RelayV1Protocol.Control grant = RelayV1Protocol.control("{\"type\":\"grant\",\"grantId\":\"" + ID + "\",\"epoch\":1,\"subject\":\"speaker\",\"deadline\":1000}");
            check(ready.type.equals("ready") && ready.subject.equals("listener_1") && grant.grant.deadlineUnixMs == 1000, "control schema");
        });
        test("revoked epoch parses without reflecting reason", () -> {
            RelayV1Protocol.Control control = RelayV1Protocol.control("{\"type\":\"revoked\",\"epoch\":7,\"reason\":\"controller revoked\"}");
            check(control.epoch == 7 && control.type.equals("revoked"), "revoked schema");
        });
        test("duplicate unknown nested and malformed controls reject", () -> {
            for (String text : new String[]{
                "{\"type\":\"ready\",\"type\":\"ready\",\"role\":\"listener\",\"subject\":\"s\"}",
                "{\"type\":\"ready\",\"role\":\"listener\",\"subject\":\"s\",\"extra\":1}",
                "{\"type\":\"ready\",\"role\":\"controller\",\"subject\":\"s\"}",
                "{\"type\":\"ack\",\"epoch\":1,\"sequence\":1}", "[]", "{}", "{\"type\":{}}", "{} trailing",
                "{\"type\":\"revoked\",\"epoch\":01,\"reason\":\"r\"}",
                "{\"type\":\"revoked\",\"epoch\":9007199254740992,\"reason\":\"r\"}",
                "{\"type\":\"revoked\",\"epoch\":1,\"reason\":\"r\",}", " ".repeat(513)
            }) reject(() -> RelayV1Protocol.control(text));
        });
        test("ack names exact received unsigned epoch and sequence", () -> {
            check(RelayV1Protocol.ack(4294967295L, 2147483648L).equals("{\"type\":\"ack\",\"epoch\":4294967295,\"sequence\":2147483648}"), "ACK wire JSON");
        });
        System.out.println("PASS " + passed + " protocol contract tests");
        if (args.length==1) Files.write(Path.of(args[0]),RelayV1Protocol.encode(
                new RelayV1Protocol.Grant(ID,0x01020304L,"speaker",0x0000010203040506L),0x05060708L,new byte[]{17,34}));
    }
}
