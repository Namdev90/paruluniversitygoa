"""Public release hints contain no private routing and cannot authorize downloads."""
from pathlib import Path
import subprocess
import tempfile
root=Path(__file__).resolve().parents[1]
harness=r'''
import in.navrang.gate.ReleaseHintPolicy;import java.util.*;
public final class ReleaseHintCheck {
 static int checks;static void check(boolean value){checks++;if(!value)throw new AssertionError("release hint "+checks);}
 public static void main(String[] args){
  Map<String,String> value=new HashMap<>(Map.of("kind","app-release","versionCode","19","sha256","a".repeat(64)));
  check(ReleaseHintPolicy.parse(value)==19);
  for(String bad:new String[]{"0","-1","019","19.0","1e2","2147483648"," 19"}){value.put("versionCode",bad);check(ReleaseHintPolicy.parse(value)==0);}
  value.put("versionCode","19");value.put("latitude","1.2");check(ReleaseHintPolicy.parse(value)==0);value.remove("latitude");
  value.put("sha256","bad");check(ReleaseHintPolicy.parse(value)==0);value.put("sha256","a".repeat(64));
  value.put("kind","find-me");check(ReleaseHintPolicy.parse(value)==0);check(ReleaseHintPolicy.parse(null)==0);
  check(ReleaseHintPolicy.TOPIC.equals("navrang-public-releases-v1"));
  System.out.println("Public release hint: "+checks+" checks passed (no Firebase).");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-release-hint-') as temp:
    work=Path(temp); source=work/'ReleaseHintCheck.java'; source.write_text(harness,encoding='utf-8')
    subprocess.run(['javac','--release','17','-Xlint:all','-Werror','-d',str(work),str(root/'native-app/src/main/java/in/navrang/gate/ReleaseHintPolicy.java'),str(source)],check=True)
    subprocess.run(['java','-cp',str(work),'ReleaseHintCheck'],check=True)
