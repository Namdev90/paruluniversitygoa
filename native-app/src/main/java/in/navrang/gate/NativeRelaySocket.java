package in.navrang.gate;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import javax.net.ssl.*;

/** Platform TLS + bounded RFC6455 I/O. Never logs a URL, bearer, packet, or remote close reason. */
public final class NativeRelaySocket implements RelayV1Driver.Connector {
    private final String host;private final RelayV1Driver.Time time;
    private final SecureRandom random=new SecureRandom();
    public NativeRelaySocket(String approvedHttpsOrigin,RelayV1Driver.Time time){
        URI origin=URI.create(approvedHttpsOrigin);
        if(!"https".equals(origin.getScheme())||origin.getHost()==null||!origin.getHost().matches("[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?")||
            !origin.getHost().contains(".")||origin.getHost().matches("[0-9.]+")||origin.getPort()!=-1||origin.getRawUserInfo()!=null||origin.getRawQuery()!=null||origin.getRawFragment()!=null||
            !(origin.getRawPath().isEmpty()||origin.getRawPath().equals("/")))throw new IllegalArgumentException("Approved TLS origin required");
        this.host=origin.getHost();this.time=Objects.requireNonNull(time);
    }
    public boolean configured(){return true;}
    public RelayV1Driver.Socket upgrade(RelayV1Driver.Upgrade request,RelayV1Driver.SocketEvents events){
        if(!(request.authorization() instanceof RelayNativeCredential))return null;
        Session session=new Session(request,(RelayNativeCredential)request.authorization(),events);session.start();return session;
    }
    private final class Session implements RelayV1Driver.Socket {
        final Object lock=new Object();final RelayV1Driver.Upgrade request;final RelayNativeCredential auth;final RelayV1Driver.SocketEvents events;
        final List<WebSocketAudioRelayTransport.Completion> releaseCallbacks=new ArrayList<>();
        volatile boolean stopping;volatile Socket network;
        OutputStream output;boolean readerDone,writerDone,closeDone,ready,released,releaseSuccess=true;
        int sentBytes;Outgoing outgoing;boolean writing;
        Session(RelayV1Driver.Upgrade request,RelayNativeCredential auth,RelayV1Driver.SocketEvents events){this.request=request;this.auth=auth;this.events=events;}
        final class Outgoing {final byte[] bytes;final int opcode;final long elapsed,unix;final WebSocketAudioRelayTransport.Completion completion;VoiceAuthority.Pending expiry;
            Outgoing(int opcode,byte[] bytes,long elapsed,long unix,WebSocketAudioRelayTransport.Completion completion){this.opcode=opcode;this.bytes=bytes.clone();this.elapsed=elapsed;this.unix=unix;this.completion=completion;}}
        void start(){Thread reader=new Thread(this::readLoop,"Navrang relay input"),writer=new Thread(this::writeLoop,"Navrang relay output");reader.setDaemon(true);writer.setDaemon(true);reader.start();writer.start();}
        boolean valid(long elapsed,long unix){long now=time.now(),upper=time.serverUpperBoundUnixMs();return !stopping&&!auth.revoked()&&now>=0&&upper>=0&&now<elapsed&&now<auth.deadlineElapsedMs()&&upper<unix;}
        void readLoop(){
            char[] bearer=null;byte[] secret=null;Socket plain=null;SSLSocket tls=null;
            try{
                if(!valid(auth.deadlineElapsedMs(),auth.expiresAtMs()))throw new IOException();
                plain=new Socket();network=plain;if(stopping)throw new IOException();plain.connect(new InetSocketAddress(host,443),5000);plain.setSoTimeout(5000);
                tls=(SSLSocket)((SSLSocketFactory)SSLSocketFactory.getDefault()).createSocket(plain,host,443,true);network=tls;
                SSLParameters parameters=tls.getSSLParameters();parameters.setEndpointIdentificationAlgorithm("HTTPS");tls.setSSLParameters(parameters);
                if(stopping)throw new IOException();tls.startHandshake();
                byte[] nonce=new byte[16];random.nextBytes(nonce);String key=RelayWebSocketWire.base64(nonce);Arrays.fill(nonce,(byte)0);
                bearer=auth.consumeBearer();secret=new byte[bearer.length];for(int i=0;i<bearer.length;i++)secret[i]=(byte)bearer[i];
                OutputStream stream=tls.getOutputStream();
                if(!valid(auth.deadlineElapsedMs(),auth.expiresAtMs()))throw new IOException();
                stream.write(("GET "+request.path+" HTTP/1.1\r\nHost: "+host+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key+"\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer ").getBytes(StandardCharsets.US_ASCII));
                stream.write(secret);stream.write(new byte[]{13,10,13,10});stream.flush();Arrays.fill(secret,(byte)0);Arrays.fill(bearer,'\0');
                InputStream input=tls.getInputStream();RelayWebSocketWire.acceptUpgrade(input,key);
                synchronized(lock){if(stopping)throw new IOException();output=stream;ready=true;lock.notifyAll();}
                // Quiet connections have no read deadline; the independently scheduled authority/lease abort closes I/O.
                tls.setSoTimeout(0);int fragmented=-1;ByteArrayOutputStream fragments=null;int controls=0;long second=-1;
                while(!stopping){
                    RelayWebSocketWire.Frame frame=RelayWebSocketWire.read(input);
                    try{
                        if(!valid(auth.deadlineElapsedMs(),auth.expiresAtMs()))throw new IOException();
                        if(frame.opcode>=8){long sec=time.now()/1000;if(sec!=second){second=sec;controls=0;}if(++controls>100)throw new IOException();
                            if(frame.opcode==8)break;if(frame.opcode==9&&!admit(10,frame.bytes,auth.deadlineElapsedMs(),auth.expiresAtMs(),null))throw new IOException();continue;}
                        if(frame.opcode==0){if(fragmented<0||fragments.size()+frame.bytes.length>RelayWebSocketWire.MAX_MESSAGE)throw new IOException();fragments.write(frame.bytes);
                            if(frame.fin){byte[] message=fragments.toByteArray();try{deliver(fragmented,message);}finally{Arrays.fill(message,(byte)0);}fragmented=-1;fragments=null;}}
                        else{if(fragmented>=0)throw new IOException();if(frame.fin)deliver(frame.opcode,frame.bytes);
                            else{fragmented=frame.opcode;fragments=new ByteArrayOutputStream();fragments.write(frame.bytes);}}
                    }finally{Arrays.fill(frame.bytes,(byte)0);}
                }
            }catch(IOException|RuntimeException ignored){}
            finally{
                if(secret!=null)Arrays.fill(secret,(byte)0);if(bearer!=null)Arrays.fill(bearer,'\0');stop();
                try{if(tls!=null)tls.close();else if(plain!=null)plain.close();}catch(IOException ignored){releaseSuccess=false;}
                synchronized(lock){readerDone=true;}finish();
            }
        }
        void deliver(int opcode,byte[] bytes)throws IOException {if(stopping)return;if(opcode==1){if(bytes.length>512)throw new IOException();events.text(RelayWebSocketWire.text(bytes));}else events.binary(bytes);}
        void writeLoop(){
            try{while(true){Outgoing packet;
                synchronized(lock){while(!stopping&&(!ready||outgoing==null))lock.wait();if(stopping)break;packet=outgoing;writing=true;}
                boolean success=false;try{if(!valid(packet.elapsed,packet.unix))throw new IOException();byte[] mask=new byte[4];random.nextBytes(mask);
                    try{RelayWebSocketWire.write(output,packet.opcode,packet.bytes,mask);}finally{Arrays.fill(mask,(byte)0);}success=valid(packet.elapsed,packet.unix);
                }catch(IOException|RuntimeException ignored){}finally{Arrays.fill(packet.bytes,(byte)0);if(packet.expiry!=null)packet.expiry.cancel();}
                synchronized(lock){outgoing=null;writing=false;}
                if(packet.completion!=null)packet.completion.complete(success);if(!success)break;
            }}catch(InterruptedException ignored){Thread.currentThread().interrupt();}
            finally{stop();Outgoing dropped;synchronized(lock){dropped=outgoing;outgoing=null;writerDone=true;}
                if(dropped!=null){Arrays.fill(dropped.bytes,(byte)0);if(dropped.expiry!=null)dropped.expiry.cancel();if(dropped.completion!=null)dropped.completion.complete(false);}finish();}
        }
        boolean admit(int opcode,byte[] bytes,long elapsed,long unix,WebSocketAudioRelayTransport.Completion completion){
            synchronized(lock){if(!ready||outgoing!=null||bytes==null||bytes.length>2088||!valid(elapsed,unix)||sentBytes>262144-bytes.length)return false;
                Outgoing packet=new Outgoing(opcode,bytes,elapsed,unix,completion);outgoing=packet;sentBytes+=bytes.length;
                try{packet.expiry=time.delay(this::stop,Math.max(1,elapsed-time.now()));}catch(RuntimeException failure){outgoing=null;Arrays.fill(packet.bytes,(byte)0);return false;}
                if(packet.expiry==null){outgoing=null;Arrays.fill(packet.bytes,(byte)0);return false;}lock.notifyAll();return true;}
        }
        public boolean binary(byte[] bytes,long elapsed,long unix,WebSocketAudioRelayTransport.Completion completion){return admit(2,bytes,elapsed,unix,completion);}
        public boolean text(String text){return text!=null&&text.length()<=512&&admit(1,text.getBytes(StandardCharsets.UTF_8),auth.deadlineElapsedMs(),auth.expiresAtMs(),null);}
        public void abort(int code,String reason,WebSocketAudioRelayTransport.Completion completion){boolean done;
            synchronized(lock){done=released;if(!done)releaseCallbacks.add(completion);}if(done)completion.complete(releaseSuccess);else stop();}
        void stop(){synchronized(lock){if(stopping)return;stopping=true;lock.notifyAll();}
            Thread closer=new Thread(()->{try{Socket socket=network;if(socket!=null)socket.close();}catch(IOException ignored){releaseSuccess=false;}
                finally{synchronized(lock){closeDone=true;}finish();}},"Navrang relay cancel");closer.setDaemon(true);closer.start();}
        void finish(){List<WebSocketAudioRelayTransport.Completion> callbacks;
            synchronized(lock){if(released||!readerDone||!writerDone||!closeDone)return;released=true;callbacks=new ArrayList<>(releaseCallbacks);releaseCallbacks.clear();}
            for(WebSocketAudioRelayTransport.Completion done:callbacks)try{done.complete(releaseSuccess);}catch(RuntimeException ignored){}
            try{events.closed();}catch(RuntimeException ignored){}
        }
    }
}
