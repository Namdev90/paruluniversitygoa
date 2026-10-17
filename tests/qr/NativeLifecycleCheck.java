import in.navrang.gate.ScanTimeouts;
import in.navrang.gate.ResponseOrder;
public final class NativeLifecycleCheck {
 private static int count;
 private static void check(boolean value,String why){count++;if(!value)throw new AssertionError(why);}
 public static void main(String[] args){
  ScanTimeouts pending=new ScanTimeouts(2500);
  check(pending.nextDelay(1000)==-1,"idle scanner must not schedule timers");
  pending.start("TICKET01",1000);check(pending.nextDelay(1000)==2500,"first pending receipt starts its deadline");
  pending.start("TICKET01",3000);check(pending.nextDelay(3000)==500,"retry must not postpone a slow ticket");
  pending.start("TICKET02",3100);check(pending.expired(3499)==null,"do not hold before deadline");
  check("TICKET01".equals(pending.expired(3500)),"new QR must not suppress an earlier unresolved ticket");
  check(pending.nextDelay(12000)==0,"camera pause must not erase or restart expired deadline");
  pending.finish("TICKET01");check("TICKET02".equals(pending.expired(12000)),"each unresolved ticket needs its own acknowledgement");
  pending.finish("TICKET02");check(pending.expired(12000)==null&&pending.nextDelay(12000)==-1,"server confirmation or acknowledgement clears the timer");
  pending.start("TICKET03",15000);pending.finish("TICKET03");check(pending.expired(20000)==null,"completed background receipt must not later show pending warning");
  ResponseOrder profiles=new ResponseOrder();long old=profiles.begin(),fresh=profiles.begin();
  check(profiles.accept(fresh),"newest permissions response is accepted");
  check(!profiles.accept(old),"late earlier permissions cannot restore revoked scanner access");
  check(!profiles.accept(fresh+1),"response without an issued request cannot update a profile");
  long next=profiles.begin();check(profiles.accept(next),"future valid refresh remains usable");
  System.out.println("PASS native lifecycle: "+count+" checks for multiple pending tickets, pause/resume deadlines and out-of-order permission refreshes.");
 }
}
