"""Behavioral tests of the optional native transport using fake SDK drivers only."""
from pathlib import Path
import subprocess
import tempfile

root=Path(__file__).resolve().parents[1]
harness=r'''
package in.navrang.gate;
import java.util.*;
public final class DailyTransportCheck {
 static int checks;
 static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
 static final String ID="00000000-0000-4000-8000-000000000001",ROOM="nv_0123456789abcdef0123456789abcdef";
 static DailyNativeCredential credential(Loop l,DailyNativeCredential.Role role,long duration){return new DailyNativeCredential("owner.daily.co","https://owner.daily.co/"+ROOM,ROOM,ID,ID,1,90000,l.time+duration,l.time,role,"a.b.c".toCharArray());}
 record Timer(long at,Runnable run){}
 static final class Loop implements DailySdkSession.Loop {
  long time=100;boolean owner=true;final Deque<Runnable> work=new ArrayDeque<>();final List<Timer> timers=new ArrayList<>();
  public boolean current(){return owner;}public long now(){return time;}public void post(Runnable r){work.add(r);}public void delay(Runnable r,long ms){timers.add(new Timer(time+Math.max(0,ms),r));}
  void drain(){int n=0;while(!work.isEmpty()){if(++n>10000)throw new AssertionError("unbounded queue");work.remove().run();}}
  void advance(long ms){long until=time+ms;for(;;){Timer next=timers.stream().filter(t->t.at<=until).min(Comparator.comparingLong(Timer::at)).orElse(null);if(next==null)break;timers.remove(next);time=next.at;next.run.run();drain();}time=until;drain();}
 }
 static final class Driver implements DailySdkSession.Driver {
  final List<Boolean> inputs=new ArrayList<>();final List<DailySdkSession.Completion> acknowledgements=new ArrayList<>();
  DailySdkSession.Completion join,left;Runnable disconnected;int releases;
  public void join(DailyNativeCredential c,DailySdkSession.Completion done,Runnable ended){c.consumeToken();join=done;disconnected=ended;}
  public void microphone(boolean enabled,DailySdkSession.Completion done){inputs.add(enabled);acknowledgements.add(done);}
  public void leave(DailySdkSession.Completion done){left=done;}
  public void release(){releases++;}
 }
 static final class Result<T> implements VoiceMediaTransport.Result<T> {
  T value;int ready,failed,disconnected;
  public void ready(T value){this.value=value;ready++;}public void failed(){failed++;}public void disconnected(){disconnected++;}
 }
 static final class Fixture {
  final Loop loop=new Loop();final List<Driver> drivers=new ArrayList<>();
  final DailyMediaTransport transport=new DailyMediaTransport(loop,()->{Driver d=new Driver();drivers.add(d);return d;});
  Driver driver(){return drivers.get(drivers.size()-1);}
  Result<VoiceMediaTransport.Receiver> receive(){Result<VoiceMediaTransport.Receiver> r=new Result<>();transport.receive(credential(loop,DailyNativeCredential.Role.LISTENER,15000),r);return r;}
  Result<VoiceMediaTransport.Publisher> publish(){Result<VoiceMediaTransport.Publisher> r=new Result<>();transport.preparePublisher(credential(loop,DailyNativeCredential.Role.PUBLISHER,15000),r);return r;}
  void join(){driver().join.done(true);loop.drain();}
  void closed(Driver d){d.acknowledgements.get(d.acknowledgements.size()-1).done(true);loop.drain();d.left.done(true);loop.drain();}
 }
 public static void main(String[] args){
  Fixture f=new Fixture();Result<VoiceMediaTransport.Receiver> receiver=f.receive();check(receiver.ready==0&&f.drivers.size()==1,"join acknowledgement required");f.join();check(receiver.ready==1&&f.driver().inputs.isEmpty(),"listener starts without microphone input");
  Driver old=f.driver();receiver.value.close();Result<VoiceMediaTransport.Publisher> publisher=f.publish();check(f.drivers.size()==1&&old.inputs.equals(List.of(false)),"publisher waits for old slot mute/leave/release");f.closed(old);check(old.releases==1&&f.drivers.size()==2,"new SDK client starts only after release");f.join();check(publisher.ready==1&&f.driver().inputs.isEmpty(),"prepared publisher starts muted");
  receiver.value.close();check(f.driver().inputs.isEmpty(),"stale receiver cannot close the new publisher");
  List<Boolean> inputs=new ArrayList<>();int[] failures={0};VoiceMediaTransport.InputResult input=new VoiceMediaTransport.InputResult(){public void applied(boolean enabled){inputs.add(enabled);}public void failed(){failures[0]++;}};
  publisher.value.microphone(true,input);Driver speaking=f.driver();check(speaking.inputs.equals(List.of(true))&&inputs.isEmpty(),"enable waits for matching SDK callback");speaking.acknowledgements.get(0).done(true);f.loop.drain();check(inputs.equals(List.of(true)),"acknowledged enable accepted");
  publisher.value.microphone(false,input);check(speaking.inputs.equals(List.of(true,false)),"disable reaches SDK immediately");Result<VoiceMediaTransport.Publisher> replacement=f.publish();check(f.drivers.size()==2,"replacement cannot race teardown");f.closed(speaking);check(inputs.equals(List.of(true,false))&&f.drivers.size()==3,"disable acknowledged before replacement");f.join();publisher.value.microphone(true,input);check(f.driver().inputs.isEmpty()&&failures[0]==1,"stale publisher cannot enable new slot");
  f.transport.close();check(f.driver().inputs.equals(List.of(false)),"transport close immediately disables");f.closed(f.driver());check(!f.transport.available(),"closed transport remains unavailable");

  f=new Fixture();receiver=f.receive();f.join();old=f.driver();Result<VoiceMediaTransport.Publisher> latest=new Result<>(),superseded=new Result<>();
  f.transport.preparePublisher(credential(f.loop,DailyNativeCredential.Role.PUBLISHER,15000),superseded);
  f.transport.preparePublisher(credential(f.loop,DailyNativeCredential.Role.PUBLISHER,15000),latest);
  f.closed(old);check(f.drivers.size()==2&&superseded.failed==1,"only newest replacement is joined");f.join();check(latest.ready==1,"newest replacement succeeds");

  f=new Fixture();receiver=f.receive();f.join();old=f.driver();Result<VoiceMediaTransport.Publisher> cancelled=new Result<>();DailyNativeCredential secret=credential(f.loop,DailyNativeCredential.Role.PUBLISHER,15000);
  VoiceAuthority.Pending pending=f.transport.preparePublisher(secret,cancelled);pending.cancel();f.loop.drain();f.closed(old);check(f.drivers.size()==1&&cancelled.ready==0&&!secret.usable(f.loop.time),"cancelled queued credential is destroyed and never joined");

  f=new Fixture();receiver=f.receive();f.join();old=f.driver();Result<VoiceMediaTransport.Publisher> expired=new Result<>();f.transport.preparePublisher(credential(f.loop,DailyNativeCredential.Role.PUBLISHER,100),expired);f.loop.advance(101);f.closed(old);check(f.drivers.size()==1&&expired.failed==1,"queued expiry cannot open a new client");

  f=new Fixture();receiver=f.receive();f.join();old=f.driver();Result<VoiceMediaTransport.Publisher> uncertain=f.publish();f.loop.advance(1500);check(old.releases==1&&!f.transport.available()&&uncertain.failed==1,"missing mute/leave acknowledgement poisons owner");Result<VoiceMediaTransport.Publisher> refused=f.publish();check(refused.failed==1&&f.drivers.size()==1,"uncertain owner cannot create another client");

  f=new Fixture();receiver=f.receive();f.join();old=f.driver();f.loop.advance(15000);check(receiver.disconnected==1&&old.inputs.equals(List.of(false)),"absolute lease expiry disables and disconnects listener");f.closed(old);check(old.releases==1,"expired slot is released");

  f=new Fixture();Result<VoiceMediaTransport.Receiver> wrongReceiver=new Result<>();DailyNativeCredential wrong=credential(f.loop,DailyNativeCredential.Role.PUBLISHER,15000);f.transport.receive(wrong,wrongReceiver);check(wrongReceiver.failed==1&&!wrong.usable(f.loop.time)&&f.drivers.isEmpty(),"publisher token cannot enter listener path");
  Result<VoiceMediaTransport.Publisher> wrongPublisher=new Result<>();f.transport.preparePublisher(credential(f.loop,DailyNativeCredential.Role.LISTENER,15000),wrongPublisher);check(wrongPublisher.failed==1&&f.drivers.isEmpty(),"listener token cannot publish");
  System.out.println("Daily transport: "+checks+" behavioral checks passed (fake SDK only; no audio/network).");
 }
}
'''
(root/'.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='navrang-daily-transport-',dir=root/'.build') as temp:
    work=Path(temp);test=work/'DailyTransportCheck.java';test.write_text(harness,encoding='utf-8')
    main=root/'native-app/src/main/java/in/navrang/gate';optional=root/'native-app/src/daily/java/in/navrang/gate'
    source=[main/'VoiceMediaTransport.java',main/'VoiceAuthority.java',main/'DailyNativeCredential.java',optional/'DailySdkSession.java',optional/'DailyMediaTransport.java',test]
    subprocess.run(['javac','--release','17','-Xlint:all','-Werror','-d',str(work),*map(str,source)],check=True)
    subprocess.run(['java','-cp',str(work),'in.navrang.gate.DailyTransportCheck'],check=True)
