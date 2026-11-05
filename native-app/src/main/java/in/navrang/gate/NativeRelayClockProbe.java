package in.navrang.gate;

import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;

/** A bounded authenticated sample from the exact relay actor. No redirects or wall clock fallback. */
public final class NativeRelayClockProbe {
    private static final Pattern BODY=Pattern.compile("\\{\\\"version\\\":1,\\\"nonce\\\":\\\"([a-f0-9]{32})\\\",\\\"serverTime\\\":([0-9]{1,16})\\}");
    private final String origin;private final WebSocketAudioRelayTransport.Scheduler elapsed;
    private final SecureRandom random=new SecureRandom();
    public static final class Sample {
        public final long serverUnixMs,sentElapsedMs,receivedElapsedMs;
        Sample(long server,long sent,long received){serverUnixMs=server;sentElapsedMs=sent;receivedElapsedMs=received;}
    }
    public NativeRelayClockProbe(String origin,WebSocketAudioRelayTransport.Scheduler elapsed){
        // Reuse the exact native TLS-origin validation, with no connection opened.
        new NativeRelaySocket(origin,new RelayClock(elapsed,0,0));
        this.origin=origin.endsWith("/")?origin.substring(0,origin.length()-1):origin;this.elapsed=elapsed;
    }
    private static boolean hasCapability(String value,String capability){
        if(value==null)return false;for(String token:value.split(","))if(token.trim().equals(capability))return true;return false;
    }
    static Sample parse(String text,String nonce,long sent,long received){
        Matcher match=BODY.matcher(text);
        if(!match.matches()||!match.group(1).equals(nonce)||sent<0||received<sent||received-sent>2000)
            throw new IllegalArgumentException("Relay time unavailable");
        long server=Long.parseLong(match.group(2));
        if(server>RelayV1Protocol.MAX_SAFE_INTEGER)throw new IllegalArgumentException("Relay time unavailable");
        return new Sample(server,sent,received);
    }
    /** Blocking, on the bounded authority worker only; cancellation checks interrupt before/after I/O. */
    public Sample sample(RelayNativeCredential credential)throws Exception{
        if(credential==null||credential.revoked()||Thread.currentThread().isInterrupted())throw new IllegalStateException("Relay time unavailable");
        byte[] bytes=new byte[16];random.nextBytes(bytes);StringBuilder hex=new StringBuilder(32);
        for(byte value:bytes)hex.append(Character.forDigit((value>>>4)&15,16)).append(Character.forDigit(value&15,16));Arrays.fill(bytes,(byte)0);
        String nonce=hex.toString();char[] bearer=credential.probeBearer();HttpsURLConnection connection=null;
        try{
            connection=(HttpsURLConnection)new URL(origin+"/v1/rooms/"+credential.room()+"/socket").openConnection();
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(900);connection.setReadTimeout(900);
            connection.setRequestMethod("GET");connection.setRequestProperty("Authorization","Bearer "+new String(bearer));
            connection.setRequestProperty("X-Navrang-Time-Nonce",nonce);connection.setRequestProperty("Cache-Control","no-store");
            long sent=elapsed.now();
            if(sent<0||sent>=credential.deadlineElapsedMs())throw new IllegalStateException("Relay time unavailable");
            if(connection.getResponseCode()!=200||!"application/json".equals(connection.getContentType())&&
                    !"application/json; charset=utf-8".equals(connection.getContentType())||
                    connection.getHeaderField("Cache-Control")==null||!connection.getHeaderField("Cache-Control").contains("no-store")||
                    connection.getHeaderField("X-Navrang-Relay-Capabilities")==null||
                    !hasCapability(connection.getHeaderField("X-Navrang-Relay-Capabilities"),"staged-grant-v1")||
                    !hasCapability(connection.getHeaderField("X-Navrang-Relay-Capabilities"),"scoped-control-v1"))
                throw new IllegalStateException("Relay time unavailable");
            byte[] body=new byte[257];int size=0;
            try(InputStream input=connection.getInputStream()){
                while(size<body.length){
                    long now=elapsed.now();
                    if(now<sent||now-sent>=2000||credential.revoked()||Thread.currentThread().isInterrupted())throw new IllegalStateException("Relay time unavailable");
                    connection.setReadTimeout((int)Math.max(1,Math.min(900,2000-(now-sent))));
                    int n=input.read(body,size,body.length-size);if(n<0)break;size+=n;
                }
            }
            long received=elapsed.now();
            if(size==body.length||credential.revoked()||Thread.currentThread().isInterrupted()||received>=credential.deadlineElapsedMs())
                throw new IllegalStateException("Relay time unavailable");
            try{return parse(new String(body,0,size,StandardCharsets.UTF_8),nonce,sent,received);}finally{Arrays.fill(body,(byte)0);}
        }finally{Arrays.fill(bearer,'\0');if(connection!=null)connection.disconnect();}
    }
}
