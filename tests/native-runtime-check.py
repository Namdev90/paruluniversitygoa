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
 private static final Map<String,Map<String,Object>> snapshots=new HashMap<>();private final Map<String,Object> values=new HashMap<>();public JSONObject(){} public JSONObject(String text){Map<String,Object> prior=snapshots.get(text);if(prior!=null)values.putAll(prior);}
 public JSONObject put(String k,Object v){values.put(k,v);return this;}public Object opt(String k){return values.get(k);}
 public JSONObject getJSONObject(String k){return (JSONObject)values.get(k);}public JSONObject optJSONObject(String k){return (JSONObject)values.get(k);}
 public String optString(String k){return optString(k,"");}public String optString(String k,String fallback){Object v=values.get(k);return v==null?fallback:v.toString();}
 public boolean optBoolean(String k){return optBoolean(k,false);}public boolean optBoolean(String k,boolean fallback){Object v=values.get(k);return v instanceof Boolean?(Boolean)v:fallback;}
 public long getLong(String k){return ((Number)values.get(k)).longValue();}public boolean has(String k){return values.containsKey(k);}public void remove(String k){values.remove(k);}
 public String toString(){String text=new TreeMap<>(values).toString();snapshots.put(text,new HashMap<>(values));return text;}
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
 public static class UpdateInProgressException extends IllegalStateException {public UpdateInProgressException(){super("Finish or cancel the Android app update before scanning another ticket.");}}
 public boolean failQueueUpdate;public int clears,queues;public JSONObject job;public boolean failFinish,failPending;public String pendingMarker="new-account-pending";public GateDb(Context c){}
 public synchronized void clearTemporary(){clears++;pendingMarker="";}public JSONObject snapshot(){return new JSONObject().put("dataRevision",0L).put("cursor",0L);}
 public void applySync(JSONObject p){}public JSONObject queue(String id,String actor){queues++;if(failQueueUpdate)throw new UpdateInProgressException();return new JSONObject();}public JSONObject lookup(String id){return new JSONObject();}public JSONObject pending(String actor){if(failPending)throw new IllegalStateException("Queue read failed");return job;}public void finish(JSONObject job,JSONObject result){if(failFinish)throw new IllegalStateException("Memory write failed");this.job=null;}
}''',
    "in/navrang/gate/GateApi.java": '''package in.navrang.gate;import android.content.Context;import org.json.JSONObject;import java.util.concurrent.CountDownLatch;
public class GateApi {
 public final CountDownLatch started=new CountDownLatch(1),release=new CountDownLatch(1);public int response=503,meCalls,syncCalls,checkinCalls;public boolean failCheckin,rotateAccess;public JSONObject meBody;private GateSession sessions;public GateApi(Context c){}public GateApi(Context c,GateSession s,java.util.function.BooleanSupplier mayRenew){sessions=s;}
 public static class Reply {public final int status;public final JSONObject body;public final String sessionToken;public Reply(int s,JSONObject b){this(s,b,"");}public Reply(int s,JSONObject b,String t){status=s;body=b;sessionToken=t;}}
 public Reply call(String action,JSONObject payload,String token)throws Exception{if("me".equals(action)){meCalls++;started.countDown();release.await();if(rotateAccess){sessions.replace(sessions.generation(),"rotated-token",false);token="rotated-token";}if(meBody!=null)return new Reply(response,meBody,token);}if("sync".equals(action)){syncCalls++;return new Reply(response,new JSONObject().put("ok",response==200).put("staffSummary",true).put("cursor",0L),token);}if("checkin".equals(action)){checkinCalls++;if(failCheckin)throw new java.io.IOException("Connection interrupted");return new Reply(200,new JSONObject().put("ok",true).put("code","admitted").put("id",payload.optString("ticketId")));}return new Reply(response,new JSONObject().put("ok",false),token);}
}''',
    "in/navrang/gate/GateFeedback.java": '''package in.navrang.gate;import android.content.Context;public class GateFeedback {public static void play(Context c,String sound){}}''',
    "in/navrang/gate/GateUpdater.java": '''package in.navrang.gate;import android.content.Context;public class GateUpdater {public static void check(Context c,boolean force,boolean download){}}''',
    "NativeRuntimeRaceCheck.java": '''import in.navrang.gate.*;import android.content.Context;import java.lang.reflect.*;import java.util.concurrent.*;import java.util.*;import org.json.JSONObject;
public class NativeRuntimeRaceCheck {
 static int checks;static void check(boolean ok,String reason){checks++;if(!ok)throw new AssertionError(reason);}
 static Field field(String name)throws Exception{Field f=GateRuntime.class.getDeclaredField(name);f.setAccessible(true);return f;}
 static final java.util.Map<GateRuntime,java.util.concurrent.atomic.AtomicLong> clocks=new java.util.IdentityHashMap<>();
 static GateRuntime runtime()throws Exception{Constructor<GateRuntime> c=GateRuntime.class.getDeclaredConstructor(Context.class);c.setAccessible(true);GateRuntime r=c.newInstance(new Context());((ScheduledExecutorService)field("sync").get(r)).shutdownNow();field("foreground").set(r,1);java.util.concurrent.atomic.AtomicLong clock=new java.util.concurrent.atomic.AtomicLong(10000);clocks.put(r,clock);try{field("elapsed").set(r,(java.util.function.LongSupplier)clock::get);}catch(NoSuchFieldException absent){}return r;}
 static void advance(GateRuntime r,long ms){clocks.get(r).addAndGet(ms);}
 static void stop(GateRuntime r)throws Exception{((ExecutorService)field("entries").get(r)).shutdownNow();r.requests.shutdownNow();}
 static void delayedOldReply(int status)throws Exception {
  GateRuntime r=runtime();try{r.api.response=status;Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);
   Thread request=new Thread(()->{try{tick.invoke(r);}catch(Exception e){throw new RuntimeException(e);}});request.start();check(r.api.started.await(2,TimeUnit.SECONDS),"old me request started");
   r.sessions.replace(2,"new-token",true);r.api.release.countDown();request.join(2000);check(!request.isAlive(),"old request finishes");
   check(r.db.clears==0&&"new-account-pending".equals(r.db.pendingMarker),"old inactive account HTTP "+status+" must not erase the new account's pending scans");
   check(r.sessions.isCurrent(2,"new-token"),"old failed reply must not sign out newer identity");
  }finally{stop(r);}
 }
 static void drainAndWait(GateRuntime r)throws Exception{r.drain();((ExecutorService)field("entries").get(r)).submit(()->{}).get(2,TimeUnit.SECONDS);}
 static void pendingFailure(boolean network)throws Exception{
  GateRuntime r=runtime();try{
   r.sessions.replace(2,"checker-token",true);r.db.job=new JSONObject().put("ticketId","TICKET01");r.api.failCheckin=network;r.db.failFinish=!network;
   List<JSONObject> events=new CopyOnWriteArrayList<>();r.add(e->{if("result".equals(e.optString("type")))events.add(e.getJSONObject("data"));});
   drainAndWait(r);check(events.size()==1,"an interrupted check-in emits one pending result");
   check("pending".equals(events.get(0).optString("code"))&&"TICKET01".equals(events.get(0).optString("id")),"network or storage exception must retain the pending ticket ID");
   check(r.db.job!=null,"interrupted request remains queued for recovery");
   r.api.failCheckin=false;r.db.failFinish=false;drainAndWait(r);
   check(events.size()==1&&r.db.job!=null,"failed pending request backs off instead of retrying every caller");
   advance(r,70000);drainAndWait(r);
   check(events.size()==2&&"admitted".equals(events.get(1).optString("code"))&&"TICKET01".equals(events.get(1).optString("id")),"retry reconciles the same ticket with its server receipt");
   check(r.db.job==null,"confirmed retry clears the recovery queue");
  }finally{stop(r);}
 }
 static void unidentifiedFailure()throws Exception{
  GateRuntime r=runtime();try{
   r.sessions.replace(2,"checker-token",true);r.db.failPending=true;List<JSONObject> events=new CopyOnWriteArrayList<>();r.add(events::add);drainAndWait(r);
   check(events.stream().noneMatch(e->"result".equals(e.optString("type"))&&"pending".equals(e.getJSONObject("data").optString("code"))),"queue-read failure must not invent an anonymous pending ticket");
   check(events.stream().anyMatch(e->"connection".equals(e.optString("type"))),"unidentified interruption still reports connection state");
  }finally{stop(r);}
 }
 static void updateFenceFeedback()throws Exception{
  GateRuntime r=runtime();try{
   r.sessions.replace(2,"checker-token",true);r.db.failQueueUpdate=true;List<JSONObject> events=new CopyOnWriteArrayList<>();r.add(events::add);r.submit("TICKET01");
   check(events.size()==1&&"result".equals(events.get(0).optString("type")),"update fence returns one explicit scan result");
   JSONObject result=events.get(0).getJSONObject("data");
   check("update_in_progress".equals(result.optString("code"))&&"TICKET01".equals(result.optString("id")),"blocked scan identifies its ticket and update blocker");
   check(result.optString("message").contains("Finish or cancel")&&result.optString("message").contains("NOT confirmed"),"update-paused scan explains how to retry without claiming admission");
  }finally{stop(r);}
 }
 static void quotaAndInvalidation()throws Exception{
  GateRuntime r=runtime();try{
   r.sessions.replace(2,"checker-token",true);r.api.response=200;r.api.meBody=new JSONObject().put("ok",true).put("active",true).put("scanner",true);r.api.release.countDown();
   Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);tick.invoke(r);
   for(int i=0;i<10;i++){advance(r,1000);tick.invoke(r);}
   check(r.api.meCalls==1&&r.api.syncCalls==1,"foreground ticks reuse a successful profile/data read for thirty seconds");
   advance(r,20000);tick.invoke(r);check(r.api.meCalls==2&&r.api.syncCalls==2,"thirty-second fallback reconciles both domains");
   Method invalidate=GateRuntime.class.getMethod("invalidate",String.class);invalidate.invoke(r,"records");
   tick.invoke(r);check(r.api.syncCalls==2,"push burst is coalesced before another read");advance(r,1000);tick.invoke(r);
   check(r.api.syncCalls==3&&r.api.meCalls==2,"record hint invalidates data without unnecessary identity request");
   r.sessions.replace(3,"new-checker-token",true);tick.invoke(r);check(r.api.meCalls==3&&r.api.syncCalls==4,"a genuinely new identity does not inherit an old read cache");
  }finally{stop(r);}
 }
 public static void main(String[] args)throws Exception {
  quotaAndInvalidation();
  GateRuntime restored=runtime();try{
   restored.sessions.replace(2,"restored-token",false);
   JSONObject stable=restored.sessions.read().getJSONObject("profile");restored.api.meBody=new JSONObject(stable.toString()).put("ok",true);restored.api.response=200;restored.api.release.countDown();
   List<JSONObject> recovered=new CopyOnWriteArrayList<>();restored.add(recovered::add);
   Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);tick.invoke(restored);
   check(recovered.stream().anyMatch(e->"profile".equals(e.optString("type"))),"successful unchanged server validation republishes canonical session to recover a renderer");
   check(restored.sessions.isCurrent(2,"restored-token"),"validation recovery does not create or discard a credential");
  }finally{stop(restored);}
  GateRuntime rotated=runtime();try{
   rotated.api.rotateAccess=true;rotated.api.response=200;rotated.api.meBody=new JSONObject().put("ok",true).put("active",false).put("scanner",false);rotated.api.release.countDown();
   List<JSONObject> refreshed=new CopyOnWriteArrayList<>();rotated.add(refreshed::add);
   Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);tick.invoke(rotated);
   check(refreshed.stream().anyMatch(e->"profile".equals(e.optString("type"))),"same-family rotation must publish the renewed profile using the effective token");
   check(rotated.sessions.isCurrent(1,"rotated-token"),"access rotation preserves the current identity generation");
  }finally{stop(rotated);}
  GateRuntime locked=runtime();try{
   locked.sessions.replace(2,"locked-token",true);locked.setPrivateAccess(()->false);
   locked.db.job=new JSONObject().put("ticketId","PENDING01");List<JSONObject> blocked=new CopyOnWriteArrayList<>();locked.add(blocked::add);
   locked.submit("NEW01");drainAndWait(locked);
   check(locked.db.queues==0&&locked.db.job!=null,"locked scanner cannot queue or submit and preserves its pending work");
   check(blocked.stream().anyMatch(e->"result".equals(e.optString("type"))&&"locked".equals(e.getJSONObject("data").optString("code"))),"locked actions explain the unlock requirement");
   Method tick=GateRuntime.class.getDeclaredMethod("tick");tick.setAccessible(true);tick.invoke(locked);
   check(locked.api.started.getCount()==1,"locked foreground cannot perform private profile/sync work");
  }finally{stop(locked);}
  updateFenceFeedback();pendingFailure(true);pendingFailure(false);unidentifiedFailure();
  for(int status:new int[]{401,403,503})delayedOldReply(status);
  GateRuntime r=runtime();try{Method clear=GateRuntime.class.getDeclaredMethod("clearInactiveIfCurrent",long.class,String.class);clear.setAccessible(true);
   r.sessions.replace(2,"new-token",true);clear.invoke(r,1L,"old-token");check(r.db.clears==0,"inactive cleanup validates epoch and token");
   clear.invoke(r,2L,"new-token");check(r.db.clears==0,"inactive cleanup rereads current active status");
   r.sessions.replace(2,"new-token",false);clear.invoke(r,2L,"new-token");check(r.db.clears==1,"current inactive identity still clears temporary data");
  }finally{stop(r);}
  System.out.println("PASS actual GateRuntime: "+checks+" checks for identified pending recovery, stale 401/403/503 replies and guarded cleanup.");
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
    subprocess.run(["java", "--module", "jdk.compiler/com.sun.tools.javac.Main", "-d", str(folder / "classes"), *files, str(root / "app/java/in/navrang/gate/GateRuntime.java"), str(root / "app/java/in/navrang/gate/ReconcilePolicy.java")], check=True)
    subprocess.run(["java", "-cp", str(folder / "classes"), "NativeRuntimeRaceCheck"], check=True, timeout=20)
