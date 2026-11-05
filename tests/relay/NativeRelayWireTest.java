package in.navrang.gate;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public final class NativeRelayWireTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    interface Work {void run()throws Exception;}
    static void rejects(Work work,String message)throws Exception {boolean failed=false;try{work.run();}catch(IOException|IllegalArgumentException failure){failed=true;}check(failed,message);}
    static byte[] ascii(String value){return value.getBytes(StandardCharsets.US_ASCII);}
    static void headers()throws Exception {
        String key="dGhlIHNhbXBsZSBub25jZQ==",response="HTTP/1.1 101 Switching Protocols\r\nUpgrade: WebSocket\r\nConnection: keep-alive, Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n";
        check(RelayWebSocketWire.accept(key).equals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="),"RFC6455 handshake digest vector");
        RelayWebSocketWire.acceptUpgrade(new ByteArrayInputStream(ascii(response)),key);checks++;
        for(String changed:new String[]{response.replace("101","302"),response.replace("s3pP","z3pP"),response.replace("Upgrade: WebSocket","Upgrade: h2c"),
            response.replace("keep-alive, Upgrade","keep-alive"),response.replace("\r\n\r\n","\r\nSec-WebSocket-Extensions: permessage-deflate\r\n\r\n"),
            response.replace("\r\n\r\n","\r\nUpgrade: websocket\r\n\r\n"),response.replace("Upgrade:"," Upgrade:")})
            rejects(()->RelayWebSocketWire.acceptUpgrade(new ByteArrayInputStream(ascii(changed)),key),"reject invalid/downgraded/unrequested handshake");
        rejects(()->RelayWebSocketWire.acceptUpgrade(new ByteArrayInputStream(new byte[8193]),key),"bounded response header");
    }
    static void framing()throws Exception {
        ByteArrayOutputStream out=new ByteArrayOutputStream();RelayWebSocketWire.write(out,1,ascii("Hello"),new byte[]{0x37,(byte)0xfa,0x21,0x3d});
        check(Arrays.equals(out.toByteArray(),new byte[]{(byte)0x81,(byte)0x85,0x37,(byte)0xfa,0x21,0x3d,0x7f,(byte)0x9f,0x4d,0x51,0x58}),"RFC6455 masked client hello vector");
        RelayWebSocketWire.Frame hello=RelayWebSocketWire.read(new ByteArrayInputStream(new byte[]{(byte)0x81,5,'H','e','l','l','o'}));
        check(hello.fin&&hello.opcode==1&&RelayWebSocketWire.text(hello.bytes).equals("Hello"),"server unmasked text frame");
        byte[] payload=new byte[2088];Arrays.fill(payload,(byte)7);out.reset();RelayWebSocketWire.write(out,2,payload,new byte[]{1,2,3,4});
        byte[] packet=out.toByteArray();check(packet.length==2096&&(packet[1]&255)==254&&packet[2]==8&&(packet[3]&255)==40,"maximum bounded client frame");
        for(byte[] invalid:new byte[][]{{(byte)0xc2,1,1},{(byte)0x82,(byte)0x81,0,0,0,0,0},{(byte)0x83,0},{9,0},{(byte)0x89,126,0,126},
            {(byte)0x82,126,0,1,1},{(byte)0x82,127},{(byte)0x82,126,8,41},{(byte)0x88,1,0},{(byte)0x82,2,1}})
            rejects(()->RelayWebSocketWire.read(new ByteArrayInputStream(invalid)),"reject reserved/masked/oversize/noncanonical/truncated frames");
        rejects(()->RelayWebSocketWire.text(new byte[]{(byte)0xc0,(byte)0x80}),"reject noncanonical UTF8");
        for(int n=0;n<40;n++){byte[] bytes=new byte[n];new Random(n).nextBytes(bytes);check(RelayWebSocketWire.base64(bytes).equals(Base64.getEncoder().encodeToString(bytes)),"API24-compatible base64 vector "+n);}
    }
    static void media(){
        check(RelayOpusPacket.twentyMsMono(new byte[]{(byte)0x98,1}),"20ms CELT mono");
        check(RelayOpusPacket.twentyMsMono(new byte[]{8,1}),"20ms SILK mono");
        check(!RelayOpusPacket.twentyMsMono(new byte[]{(byte)0x9c,1}),"reject stereo");
        check(!RelayOpusPacket.twentyMsMono(new byte[]{(byte)0x80,1}),"reject 2.5ms packet");
        check(!RelayOpusPacket.twentyMsMono(new byte[]{24,1}),"reject 60ms packet");
        check(!RelayOpusPacket.twentyMsMono(new byte[]{(byte)0x9b,0}),"reject zero-frame packet");
    }
    public static void main(String[] args)throws Exception {headers();framing();media();System.out.println("Native TLS/wire/Opus profile checks passed: "+checks);}
}
