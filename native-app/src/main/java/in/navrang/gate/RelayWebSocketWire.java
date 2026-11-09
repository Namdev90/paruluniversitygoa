package in.navrang.gate;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.*;

/** Small RFC6455 client framing boundary. No extensions, compression, or unbounded messages. */
final class RelayWebSocketWire {
    static final int MAX_MESSAGE=2088;
    static final class Frame {final boolean fin;final int opcode;final byte[] bytes;
        Frame(boolean fin,int opcode,byte[] bytes){this.fin=fin;this.opcode=opcode;this.bytes=bytes;}}
    private RelayWebSocketWire(){}
    static Frame read(InputStream input)throws IOException {
        int first=input.read();if(first<0)throw new EOFException();int second=readByte(input);
        boolean fin=(first&128)!=0;int opcode=first&15;
        if((first&112)!=0||(second&128)!=0||!(opcode==0||opcode==1||opcode==2||opcode==8||opcode==9||opcode==10))throw invalid();
        int length=second&127;
        if(length==126){length=(readByte(input)<<8)|readByte(input);if(length<126)throw invalid();}
        else if(length==127)throw invalid(); // All legal relay messages fit uint16.
        if(length>MAX_MESSAGE||opcode>=8&&(!fin||length>125)||opcode==8&&length==1)throw invalid();
        byte[] bytes=new byte[length];int at=0;
        try{while(at<length){int count=input.read(bytes,at,length-at);if(count<0)throw new EOFException();at+=count;}
            return new Frame(fin,opcode,bytes);
        }catch(IOException failure){Arrays.fill(bytes,(byte)0);throw failure;}
    }
    static void write(OutputStream output,int opcode,byte[] payload,byte[] mask)throws IOException {
        if(payload==null||payload.length>MAX_MESSAGE||mask==null||mask.length!=4||!(opcode==1||opcode==2||opcode==10)||opcode>=8&&payload.length>125)throw invalid();
        // One bounded encoded packet. Wipe it after the blocking native write completes/fails.
        byte[] packet=new byte[payload.length+(payload.length<126?6:8)];int at=0;packet[at++]=(byte)(128|opcode);
        if(payload.length<126)packet[at++]=(byte)(128|payload.length);
        else{packet[at++]=(byte)254;packet[at++]=(byte)(payload.length>>>8);packet[at++]=(byte)payload.length;}
        for(byte value:mask)packet[at++]=value;
        for(int i=0;i<payload.length;i++)packet[at++]=(byte)(payload[i]^mask[i&3]);
        try{output.write(packet);output.flush();}finally{Arrays.fill(packet,(byte)0);}
    }
    static void acceptUpgrade(InputStream input,String key)throws IOException {
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();int matched=0;
        while(matched<4){int next=readByte(input);if(next>127||next==0||bytes.size()>=8192)throw invalid();bytes.write(next);
            if(next==new int[]{13,10,13,10}[matched])matched++;else matched=next==13?1:0;}
        String[] lines=new String(bytes.toByteArray(),StandardCharsets.US_ASCII).split("\r\n");
        if(lines.length<4||!lines[0].matches("HTTP/1\\.[01] 101(?: .*)?"))throw invalid();
        Map<String,String> headers=new HashMap<>();
        for(int i=1;i<lines.length;i++){
            int colon=lines[i].indexOf(':');if(colon<1||Character.isWhitespace(lines[i].charAt(0)))throw invalid();
            String name=lines[i].substring(0,colon).toLowerCase(Locale.ROOT),value=lines[i].substring(colon+1).trim();
            if(!name.matches("[a-z0-9-]+")||headers.put(name,value)!=null)throw invalid();
        }
        if(!"websocket".equalsIgnoreCase(headers.get("upgrade"))||!tokens(headers.get("connection")).contains("upgrade")||
            !accept(key).equals(headers.get("sec-websocket-accept"))||headers.containsKey("sec-websocket-extensions")||headers.containsKey("sec-websocket-protocol"))throw invalid();
    }
    private static Set<String> tokens(String value){return value==null?Collections.emptySet():new HashSet<>(Arrays.asList(value.toLowerCase(Locale.ROOT).split("\\s*,\\s*")));}
    static String text(byte[] bytes)throws CharacterCodingException {
        return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    }
    static String accept(String key)throws IOException {
        try{return base64(MessageDigest.getInstance("SHA-1").digest((key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").getBytes(StandardCharsets.US_ASCII)));}
        catch(NoSuchAlgorithmException failure){throw new IOException("WebSocket digest unavailable");}
    }
    static String base64(byte[] bytes){String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";StringBuilder out=new StringBuilder();
        for(int at=0;at<bytes.length;at+=3){int left=bytes.length-at,value=(bytes[at]&255)<<16;if(left>1)value|=(bytes[at+1]&255)<<8;if(left>2)value|=bytes[at+2]&255;
            out.append(alphabet.charAt(value>>>18)).append(alphabet.charAt(value>>>12&63)).append(left>1?alphabet.charAt(value>>>6&63):'=').append(left>2?alphabet.charAt(value&63):'=');}
        return out.toString();}
    private static int readByte(InputStream input)throws IOException {int value=input.read();if(value<0)throw new EOFException();return value;}
    private static IOException invalid(){return new IOException("Invalid relay WebSocket protocol");}
}
