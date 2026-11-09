#!/usr/bin/env python3
"""Run ScanActivity's actual acknowledgement method with deterministic receipt/UI fakes."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'app/java/in/navrang/gate/ScanActivity.java').read_text()
start = source.index(' private void acknowledgeIssue(){')
end = source.index('\n private void schedulePending()', start)
method = source[start:end]
assert method.count('private void ') == 1
harness = r'''
import java.util.*;
import in.navrang.gate.ScanTimeouts;
public class ScannerQueueCheck {
 static class JSONObject {
  final String id,code;JSONObject(String id,String code){this.id=id;this.code=code;}
  String optString(String key){return "id".equals(key)?id:code;}
 }
 static class Text {void setText(String text){}}
 boolean active=true,issueHeld=true;JSONObject heldResult;Object issueDialog=new Object();
 final Text quality=new Text();final Set<String> acknowledgedPending=new HashSet<>();
 final Map<String,JSONObject> pendingResults=new HashMap<>();final ScanTimeouts pendingTimes=new ScanTimeouts(2500);
 final ArrayDeque<JSONObject> deferred=new ArrayDeque<>();final List<String> seen=new ArrayList<>();String painted;int schedules;
 void paintReceipt(JSONObject r){painted=r.id+":"+r.code;}
 void showResult(JSONObject r){seen.add(r.id);paintReceipt(r);if(!"admitted".equals(r.code)){issueHeld=true;heldResult=r;issueDialog=new Object();}}
 void schedulePending(){schedules++;}
 __METHOD__
 static int checks;static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 static JSONObject result(String id,String code){return new JSONObject(id,code);}
 public static void main(String[] args){
  ScannerQueueCheck q=new ScannerQueueCheck();q.heldResult=result("FIRST001","admitted");q.painted="FIRST001:pending";
  q.pendingResults.put("FIRST001",q.heldResult);q.pendingTimes.start("FIRST001",0);
  q.acknowledgeIssue();check("FIRST001:admitted".equals(q.painted),"late server confirmation must replace the pending card after acknowledgement");
  check(!q.issueHeld&&q.heldResult==null&&q.issueDialog==null,"acknowledged result releases the scanner");
  check(q.pendingResults.isEmpty()&&q.pendingTimes.nextDelay(10000)==-1,"confirmed held result must clear its deadline");
  q.issueHeld=true;q.heldResult=result("FIRST002","blocked");
  q.deferred.add(result("NEXT0001","admitted"));q.deferred.add(result("NEXT0002","blocked"));q.deferred.add(result("NEXT0003","duplicate"));
  q.acknowledgeIssue();check(q.seen.equals(Arrays.asList("NEXT0001","NEXT0002")),"a successful queued scan cannot conceal the following rejected scan");
  check(q.issueHeld&&"NEXT0002".equals(q.heldResult.id),"queued issue must require its own acknowledgement");
  check(q.deferred.size()==1,"later issue must wait behind the visible issue");
  q.acknowledgeIssue();check(q.issueHeld&&"NEXT0003".equals(q.heldResult.id)&&q.deferred.isEmpty(),"each queued issue is shown in turn");
  q.acknowledgeIssue();check(!q.issueHeld,"queue drains after all issues have been acknowledged");
  q.issueHeld=true;q.heldResult=result("WAIT0001","pending");q.pendingResults.put("WAIT0001",q.heldResult);q.pendingTimes.start("WAIT0001",0);
  q.acknowledgeIssue();check(q.acknowledgedPending.contains("WAIT0001"),"acknowledged pending retries remain suppressed");
  check(q.pendingResults.isEmpty()&&q.pendingTimes.nextDelay(10000)==-1,"acknowledged pending deadline is cleared");
  q.active=false;q.issueHeld=true;q.heldResult=result("WAIT0002","blocked");q.deferred.add(result("WAIT0003","blocked"));q.acknowledgeIssue();
  check(q.deferred.size()==1&&!q.issueHeld,"background scanner must not launch another issue dialog");
  System.out.println("PASS actual scanner acknowledgement: "+checks+" checks for queued outcomes, late confirmation, and pause behavior.");
 }
}
'''.replace('__METHOD__', method)
with tempfile.TemporaryDirectory(prefix='navrang-scanner-queue-') as temp:
    folder = Path(temp)
    java = folder / 'ScannerQueueCheck.java'
    java.write_text(harness)
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), str(java), str(root / 'app/java/in/navrang/gate/ScanTimeouts.java')], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'ScannerQueueCheck'], check=True, timeout=10)
