"""Prove bounded/coalesced read reconciliation and pending-write retry without Android."""
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
harness=r'''
package in.navrang.gate;
public final class ReconcilePolicyCheck {
 static int checks;static void check(boolean value,String why){checks++;if(!value)throw new AssertionError(why);}
 public static void main(String[] args){
  ReconcilePolicy p=new ReconcilePolicy();long claim=p.begin(ReconcilePolicy.PROFILE,0);
  check(claim>0,"initial profile validation");check(p.begin(ReconcilePolicy.PROFILE,0)==0,"one in-flight profile request");
  p.success(ReconcilePolicy.PROFILE,claim,0,false);
  check(p.begin(ReconcilePolicy.PROFILE,29999)==0,"idle profile calls stay cached");check(p.begin(ReconcilePolicy.PROFILE,30000)>0,"bounded profile fallback");
  p=new ReconcilePolicy();claim=p.begin(ReconcilePolicy.DATA,0);p.invalidate(ReconcilePolicy.DATA);p.success(ReconcilePolicy.DATA,claim,50,false);
  check(p.begin(ReconcilePolicy.DATA,999)==0,"hints coalesce under one second");long fresh=p.begin(ReconcilePolicy.DATA,1000);check(fresh>0,"an in-flight hint is not lost by success");
  p.success(ReconcilePolicy.DATA,fresh,1000,false);check(p.begin(ReconcilePolicy.DATA,30999)==0,"successful reads do not run again without reason");check(p.begin(ReconcilePolicy.DATA,31000)>0,"data fallback remains reachable");
  p=new ReconcilePolicy();claim=p.begin(ReconcilePolicy.DATA,0);p.success(ReconcilePolicy.DATA,claim,0,true);check(p.begin(ReconcilePolicy.DATA,1000)>0,"a bounded delta can continue while hasMore is true");
  p=new ReconcilePolicy();claim=p.begin(ReconcilePolicy.PROFILE,0);p.failure(ReconcilePolicy.PROFILE,claim,100,0);
  check(p.begin(ReconcilePolicy.PROFILE,2099)==0,"failed read waits for retry deadline");fresh=p.begin(ReconcilePolicy.PROFILE,2100);check(fresh>0,"retry is eligible at deadline");
  p.success(ReconcilePolicy.PROFILE,fresh,2100,false);p.invalidate(ReconcilePolicy.PROFILE);check(p.begin(ReconcilePolicy.PROFILE,3099)==0,"hint cannot bypass burst throttle");check(p.begin(ReconcilePolicy.PROFILE,3100)>0,"fresh scope hint can validate promptly");
  p=new ReconcilePolicy();claim=p.begin(ReconcilePolicy.DATA,0);p.reset();fresh=p.begin(ReconcilePolicy.DATA,0);check(fresh>claim,"new identity gets a distinct claim");
  p.success(ReconcilePolicy.DATA,claim,0,false);check(p.begin(ReconcilePolicy.DATA,1)==0,"old response cannot complete a new identity request");
  p.success(ReconcilePolicy.DATA,fresh,1,false);check(p.begin(ReconcilePolicy.DATA,30001)>0,"current identity still completes normally");
  p=new ReconcilePolicy();claim=p.begin(ReconcilePolicy.QUEUE,0);p.success(ReconcilePolicy.QUEUE,claim,0,false);fresh=p.begin(ReconcilePolicy.QUEUE,0);check(fresh>0,"separate legitimate pending writes can drain sequentially");
  p.failure(ReconcilePolicy.QUEUE,fresh,0,0);check(p.begin(ReconcilePolicy.QUEUE,1999)==0,"failed pending work is retained without a retry storm");check(p.begin(ReconcilePolicy.QUEUE,2000)>0,"pending work is retried rather than stranded");
  p=new ReconcilePolicy();long at=0;
  for(int i=0;i<12;i++){claim=p.begin(ReconcilePolicy.DATA,at);check(claim>0,"next bounded failure attempt");p.failure(ReconcilePolicy.DATA,claim,at,0);check(p.begin(ReconcilePolicy.DATA,at+1999)==0,"no immediate repeated call after failure");at+=60000;}
  check(p.begin(ReconcilePolicy.DATA,-1)==0,"clock rollback cannot create immediate repeated work");
  System.out.println("Native reconciliation: "+checks+" behavioral checks passed (no network).");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-reconcile-') as temp:
    work=Path(temp); source=work/'ReconcilePolicyCheck.java'; source.write_text(harness,encoding='utf-8')
    subprocess.run(['javac','--release','17','-Xlint:all','-Werror','-d',str(work),str(root/'app/java/in/navrang/gate/ReconcilePolicy.java'),str(source)],check=True)
    subprocess.run(['java','-cp',str(work),'in.navrang.gate.ReconcilePolicyCheck'],check=True)
