#!/usr/bin/env python3
"""Exercise optional Daily lifecycle source using fake drivers only; no SDK/network/audio."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
harness = r'''
package in.navrang.gate;
import java.util.*;

public final class DailySessionCheck {
  static int checks;
  static void check(boolean value, String detail) { checks++; if(!value)throw new AssertionError(detail); }
  static final String ROOM="nv_0123456789abcdef0123456789abcdef";
  static final String ID="00000000-0000-4000-8000-000000000001";
  static DailyNativeCredential credential(long now,long deadline,DailyNativeCredential.Role role) {
    return new DailyNativeCredential("owner.daily.co","https://owner.daily.co/"+ROOM,ROOM,ID,ID,1,90000,deadline,now,role,"a.b.c".toCharArray());
  }
  static final class Loop implements DailySdkSession.Loop {
    long time=100, sequence; boolean owner=true;
    record Work(long at,long order,Runnable body){}
    final PriorityQueue<Work> queue=new PriorityQueue<>(Comparator.comparingLong(Work::at).thenComparingLong(Work::order));
    public boolean current(){return owner;} public long now(){return time;}
    public void post(Runnable work){delay(work,0);}
    public void delay(Runnable work,long delay){queue.add(new Work(time+Math.max(0,delay),sequence++,work));}
    void drain(){advance(0);}
    void advance(long amount){long target=time+amount;while(!queue.isEmpty()&&queue.peek().at()<=target){Work next=queue.remove();time=next.at();next.body().run();}time=target;}
  }
  static final class Listener implements DailySdkSession.Listener {
    int joined,failed,disconnected;
    public void joined(){joined++;} public void failed(){failed++;} public void disconnected(){disconnected++;}
  }
  static final class Driver implements DailySdkSession.Driver {
    DailySdkSession.Completion join,leave; Runnable disconnected;
    final List<Boolean> inputs=new ArrayList<>(); final List<DailySdkSession.Completion> inputCallbacks=new ArrayList<>();
    int releases; boolean releaseThrows;
    public void join(DailyNativeCredential credential,DailySdkSession.Completion completed,Runnable ended){
      credential.consumeToken();join=completed;disconnected=ended;
    }
    public void microphone(boolean enabled,DailySdkSession.Completion completed){inputs.add(enabled);inputCallbacks.add(completed);}
    public void leave(DailySdkSession.Completion completed){leave=completed;}
    public void release(){releases++;if(releaseThrows)throw new IllegalStateException("synthetic");}
  }
  static final class Fixture {
    final Loop loop=new Loop(); final List<Driver> drivers=new ArrayList<>();
    final DailySdkSession session=new DailySdkSession(loop,()->{Driver d=new Driver();drivers.add(d);return d;});
    Driver driver(){return drivers.get(drivers.size()-1);}
    Listener open(DailyNativeCredential.Role role){Listener l=new Listener();session.open(credential(loop.time,loop.time+15000,role),l);return l;}
    Listener joined(DailyNativeCredential.Role role){Listener l=open(role);driver().join.done(true);loop.drain();return l;}
    void closed(Driver driver){driver.inputCallbacks.get(driver.inputCallbacks.size()-1).done(true);loop.drain();driver.leave.done(true);loop.drain();}
  }
  static void invalid(String host,String url,String room,String identity,String lease,long generation,long expiry,long deadline,long now,DailyNativeCredential.Role role,String token){
    boolean rejected=false;try{new DailyNativeCredential(host,url,room,identity,lease,generation,expiry,deadline,now,role,token==null?null:token.toCharArray());}catch(IllegalArgumentException expected){rejected=true;check(!expected.getMessage().contains("a.b.c"),"error is redacted");}
    check(rejected,"invalid native descriptor rejected");
  }
  public static void main(String[] ignored){
    String good="https://owner.daily.co/"+ROOM;
    for(String bad:List.of("https://other.daily.co/"+ROOM,good+"?secret=a.b.c",good+"#fragment","https://owner.daily.co:443/"+ROOM,"http://owner.daily.co/"+ROOM,"https://user@owner.daily.co/"+ROOM,good+"/extra","https://owner.daily.co/%6ev_0123456789abcdef0123456789abcdef"))
      invalid("owner.daily.co",bad,ROOM,ID,ID,1,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("daily.co","https://daily.co/"+ROOM,ROOM,ID,ID,1,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,"other",ID,1,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,"other",1,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,0,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,9007199254740992L,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,1,0,15100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,1,90000,15101,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,1,90000,100,100,DailyNativeCredential.Role.PUBLISHER,"a.b.c");
    invalid("owner.daily.co",good,ROOM,ID,ID,1,90000,15100,100,DailyNativeCredential.Role.PUBLISHER,"not-token");
    invalid("owner.daily.co",good,ROOM,ID,ID,1,90000,15100,100,null,"a.b.c");
    DailyNativeCredential c=credential(100,15100,DailyNativeCredential.Role.LISTENER);
    check(c.usable(100)&&!c.usable(15100),"monotonic credential boundary");
    check(c.toString().equals("DailyNativeCredential[redacted]"),"descriptor string has no identity/token");
    check(c.consumeToken().equals("a.b.c")&&!c.usable(100),"token consumed exactly once");
    boolean consumed=false;try{c.consumeToken();}catch(IllegalStateException expected){consumed=true;}check(consumed,"consumed token unavailable");
    c=credential(100,15100,DailyNativeCredential.Role.LISTENER);c.destroy();c.destroy();check(!c.usable(100),"destroy is idempotent");

    Fixture f=new Fixture();Listener listener=f.open(DailyNativeCredential.Role.LISTENER);Driver d=f.driver();
    check(d.inputs.isEmpty()&&listener.joined==0,"join does not request microphone and waits for acknowledgement");
    d.join.done(true);d.join.done(true);f.loop.drain();check(listener.joined==1,"duplicate join callback cannot announce readiness twice");
    List<Boolean> ack=new ArrayList<>();f.session.microphone(true,ack::add);check(ack.equals(List.of(false))&&d.inputs.isEmpty(),"listener cannot enable microphone");

    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();ack=new ArrayList<>();
    f.session.microphone(true,ack::add);check(d.inputs.equals(List.of(true))&&ack.isEmpty(),"enable awaits SDK acknowledgement");
    d.inputCallbacks.get(0).done(true);f.loop.drain();check(ack.equals(List.of(true)),"matching enable ACK succeeds");
    f.session.close(ack::add);check(d.inputs.equals(List.of(true,false))&&d.releases==0,"close immediately issues disable intent");
    check(d.leave==null,"leave waits for mute ACK");f.closed(d);check(d.releases==1&&!f.session.busy()&&ack.equals(List.of(true,true)),"acknowledged mute/leave releases once");

    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();ack=new ArrayList<>();
    f.session.microphone(true,ack::add);f.session.close(ignoredAck->{});d.inputCallbacks.get(0).done(true);f.loop.drain();
    check(ack.equals(List.of(false))&&d.inputs.equals(List.of(true,false)),"late enable ACK after close cannot reopen capture");
    f.closed(d);d.join.done(true);f.loop.drain();check(listener.joined==1&&d.releases==1,"late joined callback after release ignored");

    f=new Fixture();listener=new Listener();VoiceAuthority.Pending pending=f.session.open(credential(100,15100,DailyNativeCredential.Role.PUBLISHER),listener);d=f.driver();
    pending.cancel();f.loop.drain();d.join.done(true);f.loop.drain();check(listener.joined==0&&d.inputs.equals(List.of(false)),"cancel before join fences delayed join");f.closed(d);

    f=new Fixture();f.joined(DailyNativeCredential.Role.LISTENER);d=f.driver();Listener next=f.open(DailyNativeCredential.Role.PUBLISHER);
    check(f.drivers.size()==1&&d.inputs.equals(List.of(false)),"switch starts by disabling old slot");
    d.inputCallbacks.get(0).done(true);f.loop.drain();check(f.drivers.size()==1&&d.leave!=null,"switch waits for old leave ACK");
    d.leave.done(true);f.loop.drain();check(f.drivers.size()==2&&d.releases==1&&next.joined==0,"new client created only after acknowledged leave and release");
    f.driver().join.done(true);f.loop.drain();check(next.joined==1,"replacement receives its own join acknowledgement");

    f=new Fixture();listener=f.open(DailyNativeCredential.Role.PUBLISHER);d=f.driver();f.loop.advance(1500);
    check(listener.failed==1&&d.inputs.equals(List.of(false)),"join timeout disables and fails once");d.join.done(true);f.loop.drain();check(listener.joined==0,"late timed-out join never ready");
    f.loop.advance(1500);check(d.releases==1&&!f.session.busy(),"missing mute ACK forces release within bound");
    Listener refused=f.open(DailyNativeCredential.Role.LISTENER);check(refused.failed==1&&f.drivers.size()==1,"uncertain teardown poisons owner against replacement");

    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();ack=new ArrayList<>();f.session.microphone(true,ack::add);f.loop.advance(1500);
    check(ack.equals(List.of(false))&&listener.disconnected==1&&d.inputs.equals(List.of(true,false)),"unacknowledged enable fails and disables");
    d.inputCallbacks.get(0).done(true);f.loop.drain();check(ack.size()==1,"late enable ACK does not complete twice");

    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();List<Boolean> first=new ArrayList<>(),second=new ArrayList<>();
    f.session.microphone(true,first::add);f.session.microphone(true,second::add);d.inputCallbacks.get(0).done(false);d.inputCallbacks.get(1).done(true);f.loop.drain();
    check(first.equals(List.of(false))&&second.equals(List.of(true))&&listener.disconnected==0&&d.inputs.size()==2,"superseded enable failure cannot close newer enable");
    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();first=new ArrayList<>();second=new ArrayList<>();
    f.session.microphone(true,first::add);f.loop.advance(100);f.session.microphone(true,second::add);d.inputCallbacks.get(1).done(true);f.loop.drain();f.loop.advance(1400);
    check(first.equals(List.of(false))&&second.equals(List.of(true))&&listener.disconnected==0&&d.inputs.size()==2,"superseded enable timeout cannot close newer enable");

    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();ack=new ArrayList<>();f.session.close(ack::add);d.inputCallbacks.get(0).done(true);f.loop.drain();f.loop.advance(1500);
    check(ack.equals(List.of(false))&&d.releases==1,"missing leave ACK forces release within 1.5 seconds");d.leave.done(true);f.loop.drain();check(ack.size()==1&&d.releases==1,"late leave ACK cannot unpoison or complete twice");
    refused=f.open(DailyNativeCredential.Role.PUBLISHER);check(refused.failed==1&&f.drivers.size()==1,"late leave success cannot permit a new client");

    f=new Fixture();f.joined(DailyNativeCredential.Role.LISTENER);d=f.driver();d.releaseThrows=true;ack=new ArrayList<>();f.session.close(ack::add);f.closed(d);
    check(ack.equals(List.of(false))&&!f.session.busy(),"release exception reports uncertain cleanup");refused=f.open(DailyNativeCredential.Role.LISTENER);check(refused.failed==1&&f.drivers.size()==1,"release exception poisons owner");

    f=new Fixture();f.joined(DailyNativeCredential.Role.LISTENER);d=f.driver();next=new Listener();f.session.open(credential(100,200,DailyNativeCredential.Role.PUBLISHER),next);f.loop.advance(100);f.closed(d);
    check(next.failed==1&&f.drivers.size()==1,"queued credential expiring during old teardown is never joined");
    f=new Fixture();listener=f.joined(DailyNativeCredential.Role.PUBLISHER);d=f.driver();f.loop.advance(15000);
    check(listener.disconnected==1&&d.inputs.equals(List.of(false)),"absolute credential expiry disables without renewal");f.closed(d);check(f.drivers.size()==1,"expiry cannot reconnect automatically");

    f=new Fixture();f.loop.owner=false;boolean wrongThread=false;try{f.session.busy();}catch(IllegalStateException expected){wrongThread=true;}check(wrongThread,"session rejects wrong-thread access");
    System.out.println("Optional Daily session: "+checks+" behavioral checks passed (fake drivers; no SDK invocation, audio or network).");
  }
}
'''
(root / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='navrang-daily-session-', dir=root / '.build') as temp:
    work = Path(temp)
    harness_file = work / 'DailySessionCheck.java'
    harness_file.write_text(harness, encoding='utf-8')
    main = root / 'native-app/src/main/java/in/navrang/gate'
    optional = root / 'native-app/src/daily/java/in/navrang/gate'
    source = [main / 'VoiceMediaTransport.java', main / 'VoiceAuthority.java',
              main / 'DailyNativeCredential.java', optional / 'DailySdkSession.java', harness_file]
    subprocess.run(['javac', '--release', '17', '-Xlint:all', '-Werror', '-d', str(work), *map(str, source)], check=True)
    subprocess.run(['java', '-cp', str(work), 'in.navrang.gate.DailySessionCheck'], check=True)
