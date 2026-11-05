package in.navrang.gate;

public final class RelayNativeCredentialTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static RelayNativeCredential credential(String room,String subject,WebSocketAudioRelayTransport.Role role,long expires){
        return new RelayNativeCredential(room,subject,role,15000,expires,"synthetic.jwt.signature".toCharArray());
    }
    public static void main(String[] args){
        RelayNativeCredential a=credential("room1","listener1",WebSocketAudioRelayTransport.Role.RECEIVER,1000000);
        RelayNativeCredential b=credential("room1","listener1",WebSocketAudioRelayTransport.Role.RECEIVER,1000000);
        check(a.sameBinding(b),"equivalent refreshed authorization retains active native handle");
        check(!a.sameBinding(credential("room2","listener1",WebSocketAudioRelayTransport.Role.RECEIVER,1000000)),"room change is replacement");
        check(!a.sameBinding(credential("room1","listener2",WebSocketAudioRelayTransport.Role.RECEIVER,1000000)),"principal change is replacement");
        check(!a.sameBinding(credential("room1","listener1",WebSocketAudioRelayTransport.Role.PUBLISHER,1000000)),"role change is replacement");
        check(!a.sameBinding(credential("room1","listener1",WebSocketAudioRelayTransport.Role.RECEIVER,1000001)),"expiry extension cannot prolong existing handle");
        check(a.claimUpgrade()&&!a.claimUpgrade(),"one upgrade authorization only");
        char[] secret=a.consumeBearer();java.util.Arrays.fill(secret,'\0');
        check(a.sameBinding(b),"consumed upgrade secret is separate from live authorization");
        b.destroy();check(!a.sameBinding(b),"revoked replacement cannot match");
        a.destroy();check(a.revoked(),"explicit revoke ends active authorization");
        System.out.println("Relay credential checks passed: "+checks);
    }
}
