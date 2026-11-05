package in.navrang.gate;

/** Actual driver state-machine tests using the existing synthetic socket/audio ports. */
public final class RelayPreparedDriverTest {
    static int checks;
    static void check(boolean value,String message){checks++;if(!value)throw new AssertionError(message);}
    static final class Events implements RelayV1Driver.PreparedEvents {
        int admitted,granted,opened,disconnected,captured;
        RelayV1Protocol.Grant grant;
        public void admitted(){admitted++;}
        public void granted(RelayV1Protocol.Grant grant){granted++;this.grant=grant;}
        public void opened(){opened++;}
        public void disconnected(){disconnected++;}
        public void captured(byte[] bytes,long elapsed){captured++;}
        public void received(byte[] bytes,Runnable consumed){consumed.run();}
    }
    static final class Fixture {
        final AsyncRelayTest.Fixture ports=new AsyncRelayTest.Fixture();
        final AsyncRelayTest.Auth auth=new AsyncRelayTest.Auth(WebSocketAudioRelayTransport.Role.PUBLISHER);
        final Events events=new Events();
        final RelayV1Driver.PreparedConnection connection=ports.driver.openPrepared(auth,events);
        void ready(){ports.socket().ready(auth);}
        void grant(){ports.grant();}
        void revoke(){ports.socket().events.text("{\"type\":\"revoked\",\"epoch\":1,\"reason\":\"cancelled\"}");}
    }
    static void ordering(){
        Fixture f=new Fixture();check(f.connection!=null&&f.ports.audios.isEmpty(),"opening prepared speaker creates no audio");
        f.connection.activateMedia();check(f.ports.audios.isEmpty(),"activate before admission/grant cannot initialize audio");
        f.ready();check(f.events.admitted==1&&f.events.opened==0&&f.ports.audios.isEmpty(),"ready means admission only");
        f.connection.activateMedia();check(f.ports.audios.isEmpty(),"admission alone cannot initialize audio");
        f.grant();check(f.events.granted==1&&f.events.grant.same(f.ports.grant)&&f.ports.audios.isEmpty(),"grant exposed exactly without audio initialization");
        f.connection.activateMedia();check(f.ports.audios.size()==1&&f.events.opened==0,"explicit post-grant activation starts async initialization");
        f.connection.activateMedia();check(f.ports.audios.size()==1,"repeated activation never creates second codec");
        f.ports.audio().initialized();check(f.events.opened==1&&f.ports.audio().microphone==null,"opened remains muted until coordinator requests input");
        f.ports.audio().capture.opus(new byte[]{1},f.ports.time.elapsed);check(f.events.captured==0,"unconfirmed capture remains fenced");
        final int[] enabled={0};f.connection.microphone(true,new VoiceMediaTransport.InputResult(){public void applied(boolean value){if(value)enabled[0]++;}public void failed(){}});
        f.ports.audio().microphone.applied(true);f.ports.audio().capture.opus(new byte[]{1},f.ports.time.elapsed);
        check(enabled[0]==1&&f.events.captured==1,"only confirmed input after activation exposes captured frame");
    }
    static void cancelBeforeGrant(){
        Fixture f=new Fixture();f.ready();final int[] released={0};f.connection.abort(ok->{if(ok)released[0]++;});
        f.grant();f.connection.activateMedia();check(f.events.granted==0&&f.ports.audios.isEmpty(),"late grant after cancellation cannot create audio");
        check(released[0]==0,"abort does not claim release before native socket acknowledgement");
        f.ports.socket().release();check(released[0]==1,"socket acknowledgement completes preparation release");
    }
    static void cancellationDuringInitialization(){
        Fixture f=new Fixture();f.ready();f.grant();f.connection.activateMedia();
        final int[] released={0};f.connection.abort(ok->{if(ok)released[0]++;});f.ports.audio().initialized();
        check(f.events.opened==0&&f.ports.audio().ended,"late initialized callback cannot restore cancelled preparation");
        f.ports.socket().release();check(released[0]==0,"socket alone cannot release owned audio");
        f.ports.audio().release();check(released[0]==1,"release waits for both socket and audio");
    }
    static void revoked(){
        Fixture f=new Fixture();f.ready();f.grant();f.revoke();f.connection.activateMedia();
        check(f.events.disconnected==1&&f.ports.audios.isEmpty(),"revoked grant cannot initialize prepared audio");
        f.grant();check(f.events.granted==1,"revocation fences later duplicate grant metadata");
    }
    static void expired(){
        Fixture f=new Fixture();f.ready();f.grant();f.ports.time.advance(15000);f.connection.activateMedia();
        check(f.events.disconnected==1&&f.ports.audios.isEmpty(),"immutable expiry cancels unclaimed preparation");
        Fixture boundary=new Fixture();boundary.ready();boundary.ports.time.advance(15000);boundary.grant();
        check(boundary.events.granted==0&&boundary.events.disconnected==1,"grant at exact deadline rejected before callback");
    }
    static void badOrderingAndRole(){
        Fixture f=new Fixture();f.grant();f.ready();check(f.events.granted==0&&f.events.admitted==0&&f.events.disconnected==1,"grant before authenticated ready fails closed");
        AsyncRelayTest.Fixture ports=new AsyncRelayTest.Fixture();Events events=new Events();
        RelayV1Driver.PreparedConnection connection=ports.driver.openPrepared(new AsyncRelayTest.Auth(WebSocketAudioRelayTransport.Role.RECEIVER),events);
        check(connection==null&&events.disconnected==1&&ports.sockets.isEmpty(),"prepared flow cannot admit listener credential");
    }
    static void changedGrant(){
        Fixture f=new Fixture();f.ready();f.grant();f.grant();
        check(f.events.granted==1&&f.events.disconnected==0,"exact duplicate grant neither renews nor repeats callback");
        f.ports.socket().events.text("{\"type\":\"grant\",\"grantId\":\"12345678-1234-1234-1234-123456789abc\",\"epoch\":2,\"subject\":\"speaker1\",\"deadline\":1015000}");
        f.connection.activateMedia();check(f.events.disconnected==1&&f.ports.audios.isEmpty(),"changed immutable grant ends prepared admission");
    }
    public static void main(String[] args){ordering();cancelBeforeGrant();cancellationDuringInitialization();revoked();expired();badOrderingAndRole();changedGrant();
        System.out.println("Prepared relay driver checks passed: "+checks);}
}
