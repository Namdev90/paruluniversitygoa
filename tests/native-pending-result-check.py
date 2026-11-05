#!/usr/bin/env python3
"""Execute the real scanner result handler with deterministic UI and monotonic time fakes."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'app/java/in/navrang/gate/ScanActivity.java').read_text()
start = source.index(' private void showResult(JSONObject r){')
end = source.index('\n private void paintReceipt', start)
method = source[start:end]
harness = r'''
import java.util.*;
import in.navrang.gate.ScanTimeouts;
public class PendingResultCheck {
 static class JSONObject {
  final String id,code;JSONObject(String id,String code){this.id=id;this.code=code;}
  String optString(String key){return "id".equals(key)?id:code;}
 }
 static class SystemClock {static long now;static long elapsedRealtime(){return now;}}
 static class GateFeedback {static void play(Object c,String sound){}}
 static class Card {Card animate(){return this;}void cancel(){}void setTranslationY(int n){}void setAlpha(float f){}Card translationY(int n){return this;}Card alpha(int n){return this;}Card setDuration(int n){return this;}void start(){}}
 static class Text {void setText(String value){}}
 static class Dialog {void setTitle(String value){}void setMessage(String value){}}
 boolean active=true,issueHeld;JSONObject heldResult;Dialog issueDialog;
 final ArrayDeque<JSONObject> backgroundResults=new ArrayDeque<>(),deferred=new ArrayDeque<>();
 final Set<String> acknowledgedPending=new HashSet<>();final Map<String,JSONObject> pendingResults=new HashMap<>();
 final ScanTimeouts pendingTimes=new ScanTimeouts(2500);final Card resultCard=new Card();final Text quality=new Text();String lastPaint="",painted="";long lastRead;
 int dp(int n){return n;}boolean isFinishing(){return false;}boolean isDestroyed(){return false;}
 void schedulePending(){}String resultSound(String code){return code;}String message(JSONObject r){return r.id;}
 void paintReceipt(JSONObject r){painted=r.id+":"+r.code;}void holdIssue(JSONObject r){issueHeld=true;heldResult=r;}
 __METHOD__
 static int checks;static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 public static void main(String[] args){
  PendingResultCheck q=new PendingResultCheck();SystemClock.now=1000;
  q.showResult(new JSONObject("TICKET01","pending"));SystemClock.now=1100;
  q.showResult(new JSONObject("","pending"));
  check(q.pendingResults.size()==1&&!q.pendingResults.containsKey(""),"anonymous connection status must not create a pending scanner ticket");
  check("TICKET01:pending".equals(q.painted),"anonymous connection status must not replace the identified receipt");
  q.showResult(new JSONObject("TICKET01","admitted"));SystemClock.now=4000;
  check(q.pendingResults.isEmpty()&&q.pendingTimes.expired(SystemClock.now)==null&&q.pendingTimes.nextDelay(SystemClock.now)==-1,"confirmation clears every deadline belonging to the interrupted ticket");
  q.pendingTimes.start("",SystemClock.now);q.pendingTimes.start(null,SystemClock.now);
  check(q.pendingTimes.nextDelay(SystemClock.now)==-1,"deadline helper independently rejects null and empty ticket IDs");
  q.showResult(new JSONObject("","invalid"));check(q.issueHeld,"invalid QR without ticket ID still requires acknowledgement");
  System.out.println("PASS actual scanner pending result handler: "+checks+" checks for unidentified statuses and receipt reconciliation.");
 }
}
'''.replace('__METHOD__', method)
with tempfile.TemporaryDirectory(prefix='navrang-pending-result-') as temp:
    folder = Path(temp)
    java = folder / 'PendingResultCheck.java'
    java.write_text(harness)
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), str(java), str(root / 'app/java/in/navrang/gate/ScanTimeouts.java')], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'PendingResultCheck'], check=True, timeout=10)
