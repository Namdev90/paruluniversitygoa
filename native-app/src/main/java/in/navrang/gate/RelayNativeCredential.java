package in.navrang.gate;

import java.util.Arrays;

/** Native memory only. Construct solely from the existing authenticated authority response. */
public final class RelayNativeCredential implements RelayV1Driver.SessionAuthorization {
    private final String room,subject;private final WebSocketAudioRelayTransport.Role role;
    private final long elapsedDeadline,unixDeadline;private char[] bearer;private boolean consumed,claimed,destroyed;
    public RelayNativeCredential(String room,String subject,WebSocketAudioRelayTransport.Role role,long elapsedDeadline,long unixDeadline,char[] bearer){
        if(!RelayV1Protocol.identifier(room)||!RelayV1Protocol.identifier(subject)||role==null||elapsedDeadline<=0||unixDeadline<=0||
            bearer==null||bearer.length<16||bearer.length>4096)throw new IllegalArgumentException("Invalid relay authorization");
        // Only a bounded compact JWT, never arbitrary header bytes. No local JWT/credential is issued here.
        String value=new String(bearer);
        if(!value.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+"))throw new IllegalArgumentException("Invalid relay authorization");
        this.room=room;this.subject=subject;this.role=role;this.elapsedDeadline=elapsedDeadline;this.unixDeadline=unixDeadline;this.bearer=bearer.clone();
    }
    public String room(){return room;}public String subject(){return subject;}
    public WebSocketAudioRelayTransport.Role role(){return role;}
    public long deadlineElapsedMs(){return elapsedDeadline;}public long expiresAtMs(){return unixDeadline;}
    public synchronized boolean revoked(){return destroyed;}
    @Override public boolean sameBinding(VoiceMediaTransport.Credential other){
        if(!(other instanceof RelayNativeCredential))return false;
        RelayNativeCredential value=(RelayNativeCredential)other;
        // Retain the existing handle and its original immutable lifetime, never extend it
        // with a refreshed JWT or compare/log the bearer. Grant/epoch checks stay in driver.
        return room.equals(value.room)&&subject.equals(value.subject)&&role==value.role&&
            unixDeadline==value.unixDeadline&&!revoked()&&!value.revoked();
    }
    public synchronized boolean claimUpgrade(){if(claimed||destroyed)return false;claimed=true;return true;}
    /** Copy only for an authenticated same-room time probe before the one-use upgrade. */
    synchronized char[] probeBearer(){
        if(claimed||consumed||destroyed||bearer==null)throw new IllegalStateException("Relay authorization unavailable");
        return bearer.clone();
    }
    synchronized char[] consumeBearer(){if(!claimed||consumed||destroyed)throw new IllegalStateException("Relay authorization unavailable");
        consumed=true;char[] value=bearer;bearer=null;return value;}
    public synchronized void destroy(){destroyed=true;if(bearer!=null)Arrays.fill(bearer,'\0');bearer=null;}
    public String toString(){return "RelayNativeCredential[redacted]";}
}
