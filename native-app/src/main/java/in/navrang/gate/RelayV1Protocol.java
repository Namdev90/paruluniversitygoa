package in.navrang.gate;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Original implementation of the reviewed Navrang relay v1 framing contract. */
public final class RelayV1Protocol {
    private RelayV1Protocol() {}
    public static final int HEADER_BYTES = 40, MAX_PAYLOAD_BYTES = 2048;
    public static final long MAX_UINT32 = 0xffffffffL, MAX_SAFE_INTEGER = 9007199254740991L;
    public static boolean identifier(String value) { return value != null && value.matches("[A-Za-z0-9_-]{1,64}"); }
    private static void require(boolean valid) { if (!valid) throw new IllegalArgumentException("Invalid relay v1 message"); }
    private static void uint32(long value) { require(value > 0 && value <= MAX_UINT32); }
    public static final class Grant {
        public final String grantId, subject; public final long epoch, deadlineUnixMs;
        public Grant(String grantId, long epoch, String subject, long deadlineUnixMs) {
            require(grantId != null && grantId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"));
            uint32(epoch); require(identifier(subject) && deadlineUnixMs > 0 && deadlineUnixMs <= MAX_SAFE_INTEGER);
            this.grantId=grantId; this.epoch=epoch; this.subject=subject; this.deadlineUnixMs=deadlineUnixMs;
        }
        public boolean same(Grant other) {
            return other != null && epoch == other.epoch && deadlineUnixMs == other.deadlineUnixMs &&
                    grantId.equals(other.grantId) && subject.equals(other.subject);
        }
    }
    public static final class Frame {
        public final String grantId; public final long epoch, sequence, deadlineUnixMs; public final byte[] payload;
        private Frame(String id, long epoch, long sequence, long deadline, byte[] payload) {
            this.grantId=id; this.epoch=epoch; this.sequence=sequence; this.deadlineUnixMs=deadline; this.payload=payload;
        }
        public boolean matches(Grant grant) {
            return grant != null && grantId.equals(grant.grantId) && epoch == grant.epoch && deadlineUnixMs == grant.deadlineUnixMs;
        }
        public void destroy() { Arrays.fill(payload, (byte)0); }
    }
    public static final class Control {
        public final String type, role, subject; public final long epoch; public final Grant grant;
        private Control(String type, String role, String subject, long epoch, Grant grant) {
            this.type=type; this.role=role; this.subject=subject; this.epoch=epoch; this.grant=grant;
        }
    }
    public static byte[] encode(Grant grant, long sequence, byte[] payload) {
        require(grant != null && payload != null && payload.length > 0 && payload.length <= MAX_PAYLOAD_BYTES); uint32(sequence);
        UUID uuid = UUID.fromString(grant.grantId);
        return ByteBuffer.allocate(HEADER_BYTES + payload.length).order(ByteOrder.BIG_ENDIAN)
                .put(new byte[]{78,86,82,71,1,1,0,40}).putInt((int)grant.epoch).putInt((int)sequence)
                .putLong(grant.deadlineUnixMs).putLong(uuid.getMostSignificantBits()).putLong(uuid.getLeastSignificantBits()).put(payload).array();
    }
    public static Frame decode(byte[] bytes) {
        require(bytes != null && bytes.length > HEADER_BYTES && bytes.length <= HEADER_BYTES + MAX_PAYLOAD_BYTES);
        byte[] fixed = {78,86,82,71,1,1,0,40};
        for (int i=0; i<fixed.length; i++) require(bytes[i] == fixed[i]);
        ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN); buffer.position(8);
        long epoch = Integer.toUnsignedLong(buffer.getInt()), sequence = Integer.toUnsignedLong(buffer.getInt()), deadline = buffer.getLong();
        uint32(epoch); uint32(sequence); require(deadline > 0 && deadline <= MAX_SAFE_INTEGER);
        String id = new UUID(buffer.getLong(), buffer.getLong()).toString();
        return new Frame(id, epoch, sequence, deadline, Arrays.copyOfRange(bytes, HEADER_BYTES, bytes.length));
    }
    public static Control control(String text) {
        Map<String,Object> values = new Json(text).object();
        String type = string(values, "type");
        switch (type) {
            case "ready": {
                require(values.size() == 3); String role = string(values,"role"), subject = string(values,"subject");
                require((role.equals("speaker") || role.equals("listener")) && identifier(subject));
                return new Control(type,role,subject,0,null);
            }
            case "grant": {
                require(values.size() == 5);
                Grant grant = new Grant(string(values,"grantId"),number(values,"epoch"),string(values,"subject"),number(values,"deadline"));
                return new Control(type,null,grant.subject,grant.epoch,grant);
            }
            case "revoked": {
                require(values.size() == 3 && string(values,"reason").length() <= 128); long epoch = number(values,"epoch"); uint32(epoch);
                return new Control(type,null,null,epoch,null);
            }
            default: throw new IllegalArgumentException("Invalid relay v1 control");
        }
    }
    public static String ack(long epoch, long sequence) {
        uint32(epoch); uint32(sequence);
        return "{\"type\":\"ack\",\"epoch\":" + epoch + ",\"sequence\":" + sequence + "}";
    }
    private static String string(Map<String,Object> values, String key) {
        Object value = values.get(key); require(value instanceof String); return (String)value;
    }
    private static long number(Map<String,Object> values, String key) {
        Object value = values.get(key); require(value instanceof Long); return (Long)value;
    }
    /** Bounded flat JSON subset emitted by this server: strings and nonnegative safe integers. */
    private static final class Json {
        final String text; int at;
        Json(String text) { require(text != null && text.length() <= 512); this.text=text; }
        Map<String,Object> object() {
            Map<String,Object> values = new LinkedHashMap<>(); whitespace(); expect('{'); whitespace();
            if (peek('}')) at++;
            else while (true) {
                String key = quoted(); whitespace(); expect(':'); whitespace();
                Object value = peek('"') ? quoted() : integer();
                require(!values.containsKey(key) && values.size() < 5); values.put(key,value); whitespace();
                if (peek('}')) { at++; break; }
                expect(','); whitespace();
            }
            whitespace(); require(at == text.length()); return values;
        }
        boolean peek(char value) { return at < text.length() && text.charAt(at) == value; }
        void expect(char value) { require(peek(value)); at++; }
        void whitespace() { while (at < text.length() && " \t\r\n".indexOf(text.charAt(at)) >= 0) at++; }
        long integer() {
            int start = at; long value = 0;
            while (at < text.length() && text.charAt(at) >= '0' && text.charAt(at) <= '9') {
                int digit = text.charAt(at++) - '0'; require(value <= (MAX_SAFE_INTEGER - digit) / 10); value=value*10+digit;
            }
            require(at > start && (at-start == 1 || text.charAt(start) != '0')); return value;
        }
        String quoted() {
            expect('"'); StringBuilder value = new StringBuilder(); boolean done = false;
            while (at < text.length()) {
                char c = text.charAt(at++); if (c == '"') { done=true; break; } require(c >= 32);
                if (c == '\\') {
                    require(at < text.length()); c=text.charAt(at++);
                    switch (c) {
                        case '"': case '\\': case '/': break;
                        case 'b': c='\b'; break; case 'f': c='\f'; break; case 'n': c='\n'; break;
                        case 'r': c='\r'; break; case 't': c='\t'; break;
                        case 'u': {
                            require(at+4 <= text.length()); int code=0;
                            for (int i=0;i<4;i++) { int digit=Character.digit(text.charAt(at++),16); require(digit>=0); code=code*16+digit; }
                            c=(char)code; break;
                        }
                        default: throw new IllegalArgumentException("Invalid relay v1 JSON escape");
                    }
                }
                value.append(c); require(value.length() <= 128);
            }
            require(done); return value.toString();
        }
    }
}
