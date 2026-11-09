#!/usr/bin/env python3
"""Execute production push validation/dedup logic on the JVM, without Firebase or devices."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
harness = r'''
import in.navrang.gate.PushPolicy;
import java.util.*;
public class PushPolicyCheck {
  static int checks;
  static void check(boolean value, String detail) { checks++; if (!value) throw new AssertionError(detail); }
  static String id(int value) { return String.format("00000000-0000-4000-8000-%012d", value); }
  static Map<String,String> data(int event, String revision) {
    return new HashMap<>(Map.of("eventId",id(event),"bindingId",id(99),"revision",revision));
  }
  public static void main(String[] ignored) {
    check(PushPolicy.parse(data(1,"0")) != null,"revision zero accepted");
    check(PushPolicy.parse(data(1,"9007199254740991")) != null,"JS-safe maximum accepted");
    for(String domain:new String[]{"records","staff","access","helpdesk"}){
      Map<String,String> hint=data(1,"2");hint.put("domain",domain);
      check(PushPolicy.parse(hint)!=null,"known private invalidation domain accepted: "+domain);
    }
    for(String domain:new String[]{"","all","location","latitude","https://example.invalid"}){
      Map<String,String> hint=data(1,"2");hint.put("domain",domain);
      check(PushPolicy.parse(hint)==null,"unknown or private payload domain rejected");
    }
    Map<String,String> excessive=data(1,"2");excessive.put("domain","records");excessive.put("latitude","15.0");
    check(PushPolicy.parse(excessive)==null,"coordinates cannot accompany a domain hint");
    for (String invalid : new String[]{"-1","1.0","01","1e2"," 1","9007199254740992","999999999999999999999"})
      check(PushPolicy.parse(data(1,invalid)) == null,"invalid revision rejected: "+invalid);
    Map<String,String> extra=data(1,"2"); extra.put("url","https://example.invalid");
    check(PushPolicy.parse(extra)==null,"unknown routing payload rejected");
    Map<String,String> malformed=data(1,"2"); malformed.put("eventId","javascript:alert(1)");
    check(PushPolicy.parse(malformed)==null,"malformed ID rejected");
    malformed.remove("eventId");check(PushPolicy.parse(malformed)==null,"missing ID rejected");
    check(!PushPolicy.current("a",1,"a",1,false),"inactive identity rejected");
    check(!PushPolicy.current("a",1,"b",1,true),"account switch rejected");
    check(!PushPolicy.current("a",1,"a",2,true),"old generation rejected");
    check(!PushPolicy.current("",1,"",1,true),"empty identity rejected");
    check(PushPolicy.current("a",1,"a",1,true),"matching active snapshot accepted");
    check(PushPolicy.ownerMaterial("old-access",id(11)).equals(PushPolicy.ownerMaterial("new-access",id(11))),"access rotation retains one push owner");
    check(!PushPolicy.ownerMaterial("same-access",id(11)).equals(PushPolicy.ownerMaterial("same-access",id(12))),"a different family cannot inherit the private binding");
    check(PushPolicy.ownerMaterial("legacy-access","").equals("legacy-access"),"legacy sessions retain their exact token fence");
    check(PushPolicy.ownerMaterial("legacy-access","malformed").equals("legacy-access"),"malformed family cannot bypass a token fence");
    Map<String,Long> seen=PushPolicy.history();
    check(PushPolicy.claim(seen,PushPolicy.parse(data(1,"3"))),"first delivery");
    check(!PushPolicy.claim(seen,PushPolicy.parse(data(1,"3"))),"duplicate delivery");
    check(!PushPolicy.claim(seen,PushPolicy.parse(data(1,"2"))),"stale same-event revision");
    check(PushPolicy.claim(seen,PushPolicy.parse(data(2,"1"))),"out-of-order distinct event retained");
    check(PushPolicy.claim(seen,PushPolicy.parse(data(1,"4"))),"new aggregate revision accepted");
    for(int i=3;i<90;i++)PushPolicy.claim(seen,PushPolicy.parse(data(i,"1")));
    check(seen.size()==64,"dedup storage bounded");
    check(!seen.containsKey(id(1)),"oldest key pruned");
    check(PushPolicy.claim(PushPolicy.history(),PushPolicy.parse(data(89,"1"))),"new binding has independent history");
    check(!PushPolicy.canPrune(-1,-1,-1),"missing feed revision rejected");
    check(!PushPolicy.canPrune(PushPolicy.MAX_REVISION+1,0,0),"unsafe feed revision rejected");
    check(PushPolicy.canPrune(0,-1,-1),"initial empty feed can prune");
    check(!PushPolicy.canPrune(10,11,9),"out-of-order feed cannot undo newer pruning");
    check(!PushPolicy.canPrune(10,9,11),"push R+1 before delayed feed R preserves alerts");
    check(!PushPolicy.canPrune(10,9,100),"receive watermark protects alerts after dedup eviction");
    check(PushPolicy.canPrune(11,9,11),"equally fresh feed can remove pruned sixth item");
    check(PushPolicy.canPrune(12,11,11),"newer authoritative feed can prune");
    check(!PushPolicy.canReceive(PushPolicy.parse(data(1,"10")),11,false),"late old push cannot repost removed alert");
    check(!PushPolicy.canReceive(PushPolicy.parse(data(1,"11")),11,false),"same-revision removed alert stays absent");
    check(PushPolicy.canReceive(PushPolicy.parse(data(1,"10")),11,true),"retained older event remains eligible");
    check(PushPolicy.canReceive(PushPolicy.parse(data(1,"12")),11,false),"newer push is not excluded by older feed");
    System.out.println("Native push policy: "+checks+" behavioral checks passed (JVM; no device/provider claims).");
  }
}
'''
(root / '.build').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='navrang-push-policy-', dir=root / '.build') as temp:
    work = Path(temp)
    (work / 'PushPolicyCheck.java').write_text(harness, encoding='utf-8')
    source = root / 'native-app/src/main/java/in/navrang/gate/PushPolicy.java'
    subprocess.run(['javac', '-d', str(work), str(source), str(work / 'PushPolicyCheck.java')], check=True)
    subprocess.run(['java', '-cp', str(work), 'PushPolicyCheck'], check=True)
