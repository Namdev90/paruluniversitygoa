#!/usr/bin/env python3
"""Real vault + revocation coordinator, synthetic HTTP and Android disk/keystore failures only."""
from pathlib import Path
import runpy
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
sources = runpy.run_path(str(root / 'tests/native-session-cache-check.py'))['sources'].copy()
sources['android/content/SharedPreferences.java'] = '''package android.content;import java.util.*;
public class SharedPreferences {
 public final Map<String,Object> values=new HashMap<>(),disk=new HashMap<>();public boolean fail,failAfterMemory;
 public void restart(){values.clear();values.putAll(disk);fail=failAfterMemory=false;}
 public Map<String,?> getAll(){return new HashMap<>(values);}
 public String getString(String key,String fallback){return (String)values.getOrDefault(key,fallback);}public long getLong(String key,long fallback){return (Long)values.getOrDefault(key,fallback);}
 public Editor edit(){return new Editor();}public class Editor {Map<String,Object> changes=new HashMap<>();public Editor putString(String k,String v){changes.put(k,v);return this;}public Editor putLong(String k,long v){changes.put(k,v);return this;}public Editor remove(String k){changes.put(k,null);return this;}public boolean commit(){if(fail&&!failAfterMemory)return false;for(String k:changes.keySet())if(changes.get(k)==null)values.remove(k);else values.put(k,changes.get(k));if(fail)return false;disk.clear();disk.putAll(values);return true;}}
}'''
sources['in/navrang/gate/GateApi.java'] = '''package in.navrang.gate;import org.json.JSONObject;public class GateApi {public static class Reply {public final int status;public final JSONObject body;public Reply(int s,JSONObject b){status=s;body=b;}}}'''
sources['LogoutCheck.java'] = r'''
import in.navrang.gate.*;import android.content.Context;import org.json.JSONObject;import java.security.*;import java.util.*;import java.util.concurrent.atomic.*;
public class LogoutCheck {
 static int checks;static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 static JSONObject profile(){return new JSONObject().put("role","admin").put("active",true);}
 static void save(GateSession s,String access,String refresh)throws Exception{s.saveBundleIfCurrent(s.generation(),new JSONObject().put("token",access).put("refreshToken",refresh).put("profile",profile()).put("refreshFamilyId","12345678-1234-4234-9234-123456789abc").put("refreshExpiresAt","2027-01-01").put("absoluteExpiresAt","2027-01-02"));}
 static GateApi.Reply ok(){return new GateApi.Reply(200,new JSONObject().put("ok",true).put("signedOut",true));}
 static final String A="a".repeat(64),R="b".repeat(64),B="c".repeat(64),S="d".repeat(64);
 public static void main(String[] args)throws Exception{
  Provider provider=new Provider("TestAndroidKeyStore","1.0","Test-only"){};provider.put("KeyStore.AndroidKeyStore",SessionCacheCheck.TestStore.class.getName());Security.addProvider(provider);
  Context context=new Context();GateSession session=new GateSession(context);save(session,A,R);long old=session.generation();JSONObject pending=session.prepareRenewal(old,A);
  session.beginSignOut();check(session.read()==null&&!session.isCurrent(old,A),"sign-out blocks access and callbacks before disk or HTTP");
  check(!session.saveBundleIfCurrent(old,new JSONObject()),"late login cannot revive old identity");
  check(!session.completeRenewalIfCurrent(old,A,pending.optString("requestId"),new JSONObject()),"in-flight rotation cannot revive cleared auth");
  context.prefs.fail=true;context.prefs.failAfterMemory=true;
  check(!session.finishSignOut()&&session.read()==null,"failed commit after preferences memory change remains blocked");
  check(session.pendingRevocations().isEmpty(),"uncommitted queue entry cannot be acknowledged prematurely");
  try{session.save(B,profile());throw new AssertionError("new login bypassed unfinished sign-out");}catch(java.io.IOException expected){checks++;}
  context.prefs.fail=false;check(session.finishSignOut(),"same captured ciphertext can be retried after failed write");
  check(session.pendingRevocations().size()==1,"retry enqueues exactly one item");
  check(!context.prefs.getString("encrypted","").contains(A)&&context.prefs.getString("encrypted","").isEmpty(),"active credential removed");
  for(String value:session.pendingRevocations().values())check(!value.contains(A)&&!value.contains(R),"queue stores only existing encrypted envelope");
  AtomicLong clock=new AtomicLong(1000);AtomicInteger requests=new AtomicInteger();
  LogoutRevocation offline=new LogoutRevocation(session,(payload,token)->{requests.incrementAndGet();throw new java.io.IOException("offline");},clock::get,()->true);
  offline.tick();offline.tick();check(requests.get()==1&&session.pendingRevocations().size()==1,"offline failure survives and immediate retry backs off");
  context.prefs.restart();GateSession restarted=new GateSession(context);check(restarted.read()==null&&restarted.pendingRevocations().size()==1,"process restart restores queue but never active auth");
  save(restarted,B,S);List<String> revoked=new ArrayList<>();AtomicBoolean online=new AtomicBoolean(false);
  LogoutRevocation retry=new LogoutRevocation(restarted,(payload,token)->{revoked.add(token+":"+payload.optString("refreshToken"));return online.get()?ok():new GateApi.Reply(401,new JSONObject().put("error","gateway"));},clock::get,()->true);
  retry.tick();check(restarted.pendingRevocations().size()==1,"401 is not proof of successful family revocation");
  check(B.equals(restarted.read().optString("token")),"failed old revocation cannot clear current login");
  online.set(true);clock.addAndGet(2000);retry.tick();check(restarted.pendingRevocations().isEmpty(),"reconnection acknowledged revocation is removed durably");
  check(revoked.equals(Arrays.asList(A+":"+R,A+":"+R)),"retry always targets captured old identity, including consumed refresh token");
  check(B.equals(restarted.read().optString("token")),"successful stale callback preserves newer sign-in");
  // A queue containing several identities must survive repeated offline account switches.
  restarted.beginSignOut();check(restarted.finishSignOut(),"second account clears");save(restarted,A,R);restarted.beginSignOut();check(restarted.finishSignOut(),"third account clears");
  check(restarted.pendingRevocations().size()==2,"accounts queue separately instead of overwriting");
  save(restarted,"e".repeat(64),"f".repeat(64));AtomicInteger calls=new AtomicInteger();
  LogoutRevocation multiple=new LogoutRevocation(restarted,(payload,token)->{calls.incrementAndGet();check(token.equals(A)||token.equals(B),"never sends new active token");return ok();},clock::get,()->true);
  multiple.tick();check(calls.get()==2&&restarted.pendingRevocations().isEmpty()&&restarted.read()!=null,"all old accounts revoked without affecting latest account");
  // Locked keystore cannot prevent moving ciphertext out of the login slot.
  SessionCacheCheck.TestStore.locked=true;restarted.beginSignOut();check(restarted.finishSignOut(),"locked-state sign-out does not need to decrypt credentials");
  AtomicInteger lockedCalls=new AtomicInteger();LogoutRevocation locked=new LogoutRevocation(restarted,(payload,token)->{lockedCalls.incrementAndGet();return ok();},clock::get,()->true);
  locked.tick();check(lockedCalls.get()==0&&restarted.pendingRevocations().size()==1,"keystore failure retains queue without sending empty identity");
  SessionCacheCheck.TestStore.locked=false;clock.addAndGet(2000);locked.tick();check(lockedCalls.get()==1&&restarted.pendingRevocations().isEmpty(),"keystore recovery retries revocation only");
  // Lost acknowledgement persistence: Android changes preference memory even on failed disk commit.
  save(restarted,A,R);restarted.beginSignOut();restarted.finishSignOut();context.prefs.fail=true;context.prefs.failAfterMemory=true;
  AtomicInteger acks=new AtomicInteger();LogoutRevocation ack=new LogoutRevocation(restarted,(payload,token)->{acks.incrementAndGet();return ok();},clock::get,()->true);
  ack.tick();check(restarted.pendingRevocations().isEmpty(),"fixture simulates failed removal already disappearing from preference memory");
  context.prefs.fail=false;clock.addAndGet(2000);ack.tick();check(acks.get()==2,"coordinator retains failed acknowledgement and retries idempotently");
  context.prefs.restart();check(new GateSession(context).pendingRevocations().isEmpty()&&new GateSession(context).read()==null,"ack retry durably removes only queued credential");
  // An ambiguous 200 does not acknowledge revocation.
  save(restarted,A,R);restarted.beginSignOut();restarted.finishSignOut();
  new LogoutRevocation(restarted,(payload,token)->new GateApi.Reply(200,new JSONObject().put("ok",true)),clock::get,()->true).tick();
  check(restarted.pendingRevocations().size()==1,"200 without signedOut keeps evidence");
  Context manyContext=new Context();GateSession many=new GateSession(manyContext);
  for(int i=1;i<=9;i++){many.save("synthetic-legacy-"+i,profile());many.beginSignOut();check(many.finishSignOut(),"many-account queue persists");}
  Set<String> attempted=new HashSet<>();AtomicLong slowClock=new AtomicLong(1000);
  LogoutRevocation fair=new LogoutRevocation(many,(payload,token)->{attempted.add(token);slowClock.addAndGet(20000);throw new java.io.IOException("synthetic full HTTP timeout");},slowClock::get,()->true);
  for(int i=0;i<12;i++)fair.tick();
  check(attempted.size()==9&&many.pendingRevocations().size()==9,"slow timed-out entries cannot starve later accounts beyond the four-entry budget");
  AtomicBoolean visible=new AtomicBoolean(true);AtomicInteger foregroundCalls=new AtomicInteger();
  LogoutRevocation lifecycle=new LogoutRevocation(many,(payload,token)->{foregroundCalls.incrementAndGet();visible.set(false);return ok();},slowClock::get,visible::get);
  lifecycle.tick();check(foregroundCalls.get()==1&&many.pendingRevocations().size()==8,"leaving during first response stops the remaining batch");
  lifecycle.tick();check(foregroundCalls.get()==1,"background ticks never deliver queued credentials");
  visible.set(true);lifecycle.tick();check(foregroundCalls.get()==2,"returning foreground resumes bounded revocation");
  System.out.println("PASS native durable logout: "+checks+" checks.");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-logout-') as temp:
    folder = Path(temp)
    files = []
    for name, source in sources.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        files.append(str(path))
    real = [root / 'app/java/in/navrang/gate' / name for name in ('GateSession.java', 'LogoutRevocation.java', 'ResponseOrder.java')]
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), *files, *map(str, real)], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'LogoutCheck'], check=True, timeout=20)
# Lifecycle and bridge wiring are deliberately not a second revocation implementation.
main = (root / 'app/java/in/navrang/gate/MainActivity.java').read_text()
assert 'sessions.beginSignOut()' in main and 'sessions.finishSignOut()' in main
assert 'pendingLogoutToken' not in main and 'pendingLogoutRefresh' not in main
runtime = (root / 'app/java/in/navrang/gate/GateRuntime.java').read_text()
assert 'if(foreground<=0)return;}try{retryRevocations();if(!privateAccessAllowed())return;' in runtime
