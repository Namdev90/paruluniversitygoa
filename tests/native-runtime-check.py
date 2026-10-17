#!/usr/bin/env python3
"""Execute the real native runtime against controlled in-memory Android/network fakes."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
sources = {
    "android/content/Context.java": '''package android.content; public class Context {public Context getApplicationContext(){return this;}}''',
    "org/json/JSONObject.java": '''package org.json;import java.util.*;
public class JSONObject {
 private final Map<String,Object> values=new HashMap<>();public JSONObject(){} public JSONObject(String ignored){}
 public JSONObject put(String k,Object v){values.put(k,v);return this;}public Object opt(String k){return values.get(k);}
 public JSONObject getJSONObject(String k){return (JSONObject)values.get(k);}public JSONObject optJSONObject(String k){return (JSONObject)values.get(k);}
 public String optString(String k){return optString(k,"");}public String optString(String k,String fallback){Object v=values.get(k);return v==null?fallback:v.toString();}
 public boolean optBoolean(String k){return optBoolean(k,false);}public boolean optBoolean(String k,boolean fallback){Object v=values.get(k);return v instanceof Boolean?(Boolean)v:fallback;}
 public long getLong(String k){return ((Number)values.get(k)).longValue();}public boolean has(String k){return values.containsKey(k);}public void remove(String k){values.remove(k);}
 public String toString(){return values.toString();}
}''',
    "in/navrang/gate/GateSession.java": '''package in.navrang.gate;import android.content.Context;import org.json.JSONObject;
public class GateSession {
 private long generation=1;private JSONObject auth;public GateSession(Context c){replace(1,"old-token",false);}
 public synchronized void replace(long gen,String token,boolean active){generation=gen;auth=new JSONObject().put("token",token).put("profile",new JSONObject().put("active",active).put("scanner",active));}
 public synchronized long generation(){return generation;}public synchronized JSONObject read(){return auth;}
 public synchronized boolean isCurrent(long gen,String token){return gen==generation&&auth!=null&&token.equals(auth.optString("token"));}
 public synchronized boolean clearIfCurrent(long gen,String token){if(!isCurrent(gen,token))return false;generation++;auth=null;return true;}
 public long beginProfileRequest(){return 1;}public synchronized boolean refreshIfCurrent(long gen,String token,long request,JSONObject profile){if(!isCurrent(gen,token))return false;auth.put("profile",profile);return true;}
 public static boolean canSync(JSONObject s){return s!=null&&s.getJSONObject("profile").optBoolean("active");}public static boolean canScan(JSONObject s){return canSync(s);}public static String actor(JSONObject s){return "checker";}
}''',
    "in/navrang/gate/GateDb.java": '''package in.navrang.gate;import android.content.Context;import org.json.JSONObject;
public class GateDb {
 public int clears;public String pendingMarker="new-account-pending";public GateDb(Context c){}
 public synchronized void clearTemporary(){clears++;pendingMarker="";}public JSONObject snapshot(){return new JSONObject().put("dataRevision",0L).put("cursor",0L);}
 public void applySync(JSONObject p){}public JSONObject queue(String id,String actor){return new JSONObject();}public JSONObject lookup(String id){return new JSONObject();}public JSONObject pending(String actor){return null;}public void finish(JSONObject job,JSONObject result){}
}''',
    "in/navrang/gate/GateApi.java": '''package in.navrang.gate;import android.content.Context;import org.json.JSONObject;import java.util.concurrent.CountDownLatch;
public class GateApi {
 public final CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);public int response=503;public GateApi(Context c){}
 public static class Reply {public final int status;public final JSONObject body;public Reply(int s,JSONObject b){status=s;body=b;}}
 public Reply call(String action,JSONObject payload,String token)throws Exception{if("me".equals(action)){started.countDown();release.await();}return new Reply(response,new JSONObject().put("ok",false));}
}''',
    "in/navrang/gate/GateFeedback.java": '''package in.navrang.gate;import android.content.Context;public class GateFeedback {public static void play(Context c,String sound){}}''',
    "NativeRuntimeRaceCheck.java": '''import in.navrang.gate.*;import android.content.Context;import java.lang.reflect.*;import java.util.concurrent.*;
public class NativeRuntimeRaceCheck {
 static int checks;static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 static Field field(String name)throws Exception{Field f=GateRuntime.class.getDeclaredField(name);f.setAccessible(true);return f;}
 static GateRuntime runtime()throws Exception{Constructor<GateRuntime> c=GateRuntime.class.getDeclaredConstructor(Context.class);c.setAccessible(true);GateRuntime r=c.newInstance(new Context());((ScheduledExecutorService)field("sync").get(r)).shutdownNow();field("foreground").set(r,1);return r;}
 static void stop(GateRuntime r)throws Exception{((ExecutorService)field("entries").get(r)).shutdownNow();r.requests.shutdownNow();}
 static void delayedOldReply(int status)throws Exception {
  GateRuntime r=runtime();try{r.api.response=status;Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);
   Thread request=new Thread(()->{try{tick.invoke(r);}catch(Exception e){throw new RuntimeException(e);}});request.start();check(r.api.started.await(2,TimeUnit.SECONDS),"old me request started");
   r.sessions.replace(2,"new-token",true);r.api.release.countDown();request.join(2000);check(!request.isAlive(),"old request finishes");
   check(r.db.clears==0&&"new-account-pending".equals(r.db.pendingMarker),"old inactive account HTTP "+status+" must not erase the new account's pending scans");
   check(r.sessions.isCurrent(2,"new-token"),"old failed reply must not sign out newer identity");
  }finally{stop(r);}
 }
 public static void main(String[] args)throws Exception {
  for(int status:new int[]{401,403,503})delayedOldReply(status);
  GateRuntime r=runtime();try{Method clear=GateRuntime.class.getDeclaredMethod("clearInactiveIfCurrent",long.class,String.class);clear.setAccessible(true);
   r.sessions.replace(2,"new-token",true);clear.invoke(r,1L,"old-token");check(r.db.clears==0,"inactive cleanup validates epoch and token");
   clear.invoke(r,2L,"new-token");check(r.db.clears==0,"inactive cleanup rereads current active status");
   r.sessions.replace(2,"new-token",false);clear.invoke(r,2L,"new-token");check(r.db.clears==1,"current inactive identity still clears temporary data");
  }finally{stop(r);}
  System.out.println("PASS actual GateRuntime: "+checks+" checks for stale 401/403/503 replies and guarded pending-data cleanup.");
 }
}''',
}
with tempfile.TemporaryDirectory(prefix="navrang-runtime-check-") as temp:
    folder = Path(temp)
    files = []
    for name, source in sources.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        files.append(str(path))
    subprocess.run(["java", "--module", "jdk.compiler/com.sun.tools.javac.Main", "-d", str(folder / "classes"), *files, str(root / "app/java/in/navrang/gate/GateRuntime.java")], check=True)
    subprocess.run(["java", "-cp", str(folder / "classes"), "NativeRuntimeRaceCheck"], check=True, timeout=20)
