#!/usr/bin/env python3
"""Execute the shipped Bridge.api method with synthetic session/network/UI boundaries."""
import ast
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
host = (ROOT / 'app/java/in/navrang/gate/MainActivity.java').read_text()
start = host.index('  @JavascriptInterface public void api(')
end = host.index('  @JavascriptInterface public String update(', start)
method = host[start:end]

# Reuse the existing isolated JSON fixture without executing its vault tests.
tree = ast.parse((ROOT / 'tests/native-session-cache-check.py').read_text())
fixtures = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'sources' for t in n.targets))

HARNESS = r'''
import org.json.JSONObject;
import java.util.*;
public class NativeLoginAckCheck {
 static int checks;
 static void check(boolean value,String reason){checks++;if(!value)throw new AssertionError(reason);}
 @interface JavascriptInterface {}
 static class Queue implements java.util.concurrent.Executor {
  final ArrayDeque<Runnable> pending=new ArrayDeque<>();
  public void execute(Runnable work){pending.add(work);}
  void drain(){while(!pending.isEmpty())pending.remove().run();}
 }
 static class GateSession {
  long generation;JSONObject current;boolean rejectSave;
  long beginChange(){return ++generation;}long generation(){return generation;}
  long beginProfileRequest(){return 1;}JSONObject read(){return current;}
  boolean isCurrent(long expected,String token){return generation==expected&&current!=null&&token.equals(current.optString("token"));}
  boolean clearIfCurrent(long expected,String token){if(!isCurrent(expected,token))return false;generation++;current=null;return true;}
  boolean saveBundleIfCurrent(long expected,JSONObject bundle){if(rejectSave||expected!=generation)return false;current=new JSONObject(bundle.toString());return true;}
  boolean refreshIfCurrent(long expected,String token,long request,JSONObject profile){return isCurrent(expected,token);}
  static boolean canSync(JSONObject value){return value!=null;}static String actor(JSONObject value){return "admin";}
 }
 static class GateApi {
  static class Reply {final int status;final JSONObject body;final String sessionToken="";Reply(int status,JSONObject body){this.status=status;this.body=body;}}
  Reply result;Runnable beforeReply=()->{};
  Reply call(String action,JSONObject payload,String token){beforeReply.run();return result;}
  static JSONObject publicBody(JSONObject value){JSONObject result=new JSONObject(value.toString());result.remove("token");result.remove("refreshToken");return result;}
 }
 static class Db {void clearTemporary(){}void applySync(JSONObject value){}}
 static class Runtime {
  final GateSession sessions=new GateSession();final GateApi api=new GateApi();final Db db=new Db();final Queue requests=new Queue();
  final List<String> events=new ArrayList<>();Runnable afterAuth=()->{};
  boolean privateAccessAllowed(){return true;}
  void emit(String type,JSONObject data){events.add(type);if(type.equals("auth"))afterAuth.run();}
  void refresh(){}
 }
 static class Host {
  final Runtime runtime=new Runtime();final List<JSONObject> responses=new ArrayList<>();
  void call(String name,String value){check(name.equals("onApiResponse"),"expected bridge reply");runtime.events.add("reply");responses.add(new JSONObject(value));}
  void apiResponse(String id,int status,JSONObject body){throw new AssertionError("unexpected immediate response in sign-in fixture");}
  void durableSignOut(String id){throw new AssertionError("logout persistence belongs to its existing native fixture");}
  void nativeIdentityChanging(){}void runOnUiThread(Runnable work){work.run();}void clearExport(){}void clearReport(){}
  long nativeLocatorRequest(String action){return 0;}void nativeNotificationFeed(JSONObject body,long generation,String token){}
  void nativeLocatorResponse(String action,JSONObject payload,JSONObject body,long generation,String token,long fence,long elapsed){}
  class Bridge {
__REAL_BRIDGE_API__
  }
 }
 static JSONObject bundle(){return new JSONObject().put("ok",true).put("token","synthetic-only-token").put("profile",new JSONObject().put("role","checker").put("active",true));}
 static Host start(String action,GateApi.Reply reply){Host h=new Host();h.runtime.api.result=reply;h.new Bridge().api(action,new JSONObject().toString(),"synthetic-operation");return h;}
 static JSONObject finish(Host h){h.runtime.requests.drain();check(h.responses.size()==1,"one acknowledgement per request");return h.responses.get(0);}
 public static void main(String[] args){
  for(String action:new String[]{"login","checker-login","google-login"}){
   Host h=start(action,new GateApi.Reply(200,bundle()));JSONObject response=finish(h);
   check(((Number)response.opt("identityGeneration")).longValue()==1,"receipt identifies the generation committed by "+action);
   check(h.runtime.events.equals(Arrays.asList("auth","reply")),"existing native notifications retain their delivery order");
   check(!response.getJSONObject("body").has("identityGeneration"),"receipt is transport metadata, not public API data");
   check(!response.getJSONObject("body").has("token"),"response body remains sanitized");
  }
  Host rejected=start("checker-login",new GateApi.Reply(200,bundle()));rejected.runtime.sessions.rejectSave=true;
  JSONObject failed=finish(rejected);check(!failed.has("identityGeneration")&&!failed.getJSONObject("body").optBoolean("ok"),"failed persistence must not issue a commit receipt");
  Host replaced=start("login",new GateApi.Reply(200,bundle()));replaced.runtime.api.beforeReply=()->replaced.runtime.sessions.beginChange();
  check(!finish(replaced).has("identityGeneration"),"a superseded session cannot issue a receipt");
  Host afterCommit=start("login",new GateApi.Reply(200,bundle()));afterCommit.runtime.afterAuth=()->afterCommit.runtime.sessions.beginChange();
  JSONObject stale=finish(afterCommit);check(((Number)stale.opt("identityGeneration")).longValue()==1&&afterCommit.runtime.sessions.generation()==2,"queued receipt retains its committed generation, never a later identity");
  Host incomplete=start("login",new GateApi.Reply(200,new JSONObject().put("ok",true)));
  check(!finish(incomplete).has("identityGeneration"),"success without a saved identity must not issue a receipt");
  Host denied=start("checker-login",new GateApi.Reply(403,new JSONObject().put("ok",false).put("error","Synthetic denied")));
  check(!finish(denied).has("identityGeneration"),"server rejection must not issue a receipt");
  Host ordinary=start("config",new GateApi.Reply(200,new JSONObject().put("ok",true)));
  check(!finish(ordinary).has("identityGeneration"),"ordinary responses cannot use the sign-in acknowledgement contract");
  System.out.println("PASS shipped Bridge.api method: "+checks+" synthetic acknowledgement checks.");
 }
}
'''

with tempfile.TemporaryDirectory(prefix='navrang-login-ack-') as temp:
    work = Path(temp)
    files = {
        'org/json/JSONObject.java': fixtures['org/json/JSONObject.java'],
        'android/os/SystemClock.java': 'package android.os; public class SystemClock {public static long elapsedRealtime(){return 0;}}',
        'NativeLoginAckCheck.java': HARNESS.replace('__REAL_BRIDGE_API__', method),
    }
    for name, content in files.items():
        path = work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(work / 'classes'),
                    *[str(work / name) for name in files]], check=True)
    subprocess.run(['java', '-cp', str(work / 'classes'), 'NativeLoginAckCheck'], check=True, timeout=10)
