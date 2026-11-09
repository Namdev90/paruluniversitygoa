"""Deterministic APK metadata cadence, coalescing and failure-backoff policy."""
from pathlib import Path
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
harness = r'''
package in.navrang.gate;
public final class UpdateCheckPolicyCheck {
 static int checks;
 static void check(boolean value,String reason){checks++;if(!value)throw new AssertionError(reason);}
 public static void main(String[] args){
  long start=10000000;
  check(UpdateCheckPolicy.interval(false,true)==1800000,"background admin is ordinary cadence");
  check(UpdateCheckPolicy.interval(true,false)==1800000,"foreground volunteer is ordinary cadence");
  check(UpdateCheckPolicy.interval(true,true)==300000,"only active authenticated admin uses five minutes");
  check(UpdateCheckPolicy.due(start,0,0,false,false,false,false),"first check is eligible");
  check(!UpdateCheckPolicy.due(start+1799999,start,0,false,false,false,false),"ordinary 29:59.999 is cached");
  check(UpdateCheckPolicy.due(start+1800000,start,0,false,false,false,false),"ordinary 30-minute boundary");
  check(!UpdateCheckPolicy.due(start+299999,start,0,true,true,false,false),"admin 4:59.999 is cached");
  check(UpdateCheckPolicy.due(start+300000,start,0,true,true,false,false),"active admin five-minute boundary");
  for(boolean hint:new boolean[]{false,true}){
   check(!UpdateCheckPolicy.due(start+29999,start,0,false,false,!hint,hint),"manual/push burst coalesces");
   check(UpdateCheckPolicy.due(start+30000,start,0,false,false,!hint,hint),"manual/push can revalidate after throttle");
   check(!UpdateCheckPolicy.due(start+30000,start,start+60000,false,false,!hint,hint),"manual/push respects failure backoff");
  }
  check(!UpdateCheckPolicy.due(start-1,start,0,true,true,true,true),"clock rollback cannot cause a request storm");
  check(!UpdateCheckPolicy.due(-1,0,0,false,false,true,true),"invalid clock is not an immediate loop");
  check(!UpdateCheckPolicy.due(start+31000,start,start+32000,false,false,false,false),"failed ordinary request waits for jittered retry");
  check(UpdateCheckPolicy.due(start+32000,start,start+32000,false,false,false,false),"failed ordinary request resumes at its bounded retry deadline");
  long previous=0;
  for(int failures=1;failures<=12;failures++){
   long retry=UpdateCheckPolicy.backoff(failures,12345);
   check(retry>=30000&&retry<=1800000&&retry>=previous,"bounded increasing retry with jitter");previous=retry;
  }
  check(UpdateCheckPolicy.backoff(1,1)!=UpdateCheckPolicy.backoff(1,2000),"retry jitter desynchronizes devices");
  System.out.println("APK metadata policy: "+checks+" checks passed.");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-update-policy-') as temp:
    work=Path(temp); source=work/'UpdateCheckPolicyCheck.java'; source.write_text(harness,encoding='utf-8')
    subprocess.run(['javac','--release','17','-Xlint:all','-Werror','-d',str(work),str(root/'app/java/in/navrang/gate/UpdateCheckPolicy.java'),str(source)],check=True)
    subprocess.run(['java','-cp',str(work),'in.navrang.gate.UpdateCheckPolicyCheck'],check=True)
