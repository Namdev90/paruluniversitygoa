package in.navrang.gate;
import android.content.Context;
import org.json.JSONObject;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CopyOnWriteArrayList;
public final class GateRuntime {
 public interface Listener {void event(JSONObject event);}
 private static GateRuntime instance;
 public final GateDb db; public final GateSession sessions; public final GateApi api;
 private final ScheduledExecutorService sync=Executors.newSingleThreadScheduledExecutor();
 private final ExecutorService entries=Executors.newSingleThreadExecutor();
 public final ExecutorService requests=Executors.newFixedThreadPool(2);
 private final CopyOnWriteArrayList<Listener> listeners=new CopyOnWriteArrayList<>();
 private final AtomicBoolean draining=new AtomicBoolean();
 private int foreground=0;private volatile long lastSync=0;private volatile boolean online=false;
 private GateRuntime(Context c)throws Exception{db=new GateDb(c);sessions=new GateSession(c);api=new GateApi(c);sync.scheduleWithFixedDelay(()->tick(),500,2000,TimeUnit.MILLISECONDS);}
 public static synchronized GateRuntime get(Context c)throws Exception{if(instance==null)instance=new GateRuntime(c.getApplicationContext());return instance;}
 public void add(Listener l){listeners.addIfAbsent(l);}public void remove(Listener l){listeners.remove(l);}
 public synchronized void resume(){foreground++;lastSync=0;}public synchronized void pause(){foreground=Math.max(0,foreground-1);}
 public void emit(String type,JSONObject data){try{JSONObject e=new JSONObject().put("type",type).put("data",data);for(Listener l:listeners)l.event(e);}catch(Exception ignored){}}
 private void tick(){synchronized(this){if(foreground<=0)return;}try{
  long generation=sessions.generation();JSONObject session=sessions.read();if(session==null)return;
  if(!session.getJSONObject("profile").optBoolean("active")){
   GateApi.Reply me=api.call("me",new JSONObject(),session.optString("token"));
   if(me.status==200&&me.body.optBoolean("ok")){JSONObject profile=new JSONObject(me.body.toString());profile.remove("ok");if(!sessions.refreshIfCurrent(generation,session.optString("token"),profile))return;session=sessions.read();emit("auth",profile);}
   if(session==null||!session.getJSONObject("profile").optBoolean("active"))return;
  }
  if(System.currentTimeMillis()-lastSync>=1900){JSONObject local=db.snapshot();GateApi.Reply r=api.call("sync",new JSONObject().put("dataRevision",local.getLong("dataRevision")).put("afterSeq",local.getLong("cursor")),session.optString("token"));
   if(r.status==200&&r.body.optBoolean("ok")){db.applySync(r.body);online=true;lastSync=System.currentTimeMillis();emit("sync",db.snapshot());}
   else {online=false;if(r.status==403){GateApi.Reply me=api.call("me",new JSONObject(),session.optString("token"));if(me.status==200){JSONObject profile=new JSONObject(me.body.toString());profile.remove("ok");if(sessions.refreshIfCurrent(generation,session.optString("token"),profile))emit("auth",profile);}}emit("connection",new JSONObject().put("online",false).put("status",r.status).put("message",r.body.optString("error","Waiting for server.")));}
  }drain();
 }catch(Exception e){online=false;emit("connection",safe("message","Connection interrupted. Pending requests are saved."));}}
 private static JSONObject message(String code,String text){try{return new JSONObject().put("code",code).put("message",text);}catch(Exception e){return new JSONObject();}}
 private static JSONObject safe(String k,String v){try{return new JSONObject().put(k,v);}catch(Exception e){return new JSONObject();}}
 public void submit(String id){
  try{JSONObject auth=sessions.read();if(auth==null||!auth.getJSONObject("profile").optBoolean("active")){emit("result",safe("code","signed_out").put("message","Sign in with an approved checker account."));return;}
   JSONObject job=db.queue(id,GateSession.actor(auth));JSONObject local=db.lookup(id);emit("result",new JSONObject().put("code","pending").put("id",id).put("record",local.opt("record")).put("message","Awaiting server confirmation. Request saved on this phone."));drain();
  }catch(Exception e){emit("result",message("storage_error","Could not save the scan. Entry is NOT confirmed. Free storage or reopen the app."));}
 }
 public void drain(){
  if(!draining.compareAndSet(false,true))return;
  entries.execute(()->{try{
   for(int n=0;n<20;n++){JSONObject auth=sessions.read();if(auth==null)break;String actor=GateSession.actor(auth);JSONObject job=db.pending(actor);if(job==null)break;
    GateApi.Reply r=api.call("checkin",job,auth.optString("token"));
    if(r.status==200&&r.body.optBoolean("ok")){db.finish(job,r.body);online=true;emit("result",r.body);emit("sync",db.snapshot());}
    else{online=false;emit("result",new JSONObject().put("code","pending").put("id",job.optString("ticketId")).put("message",r.body.optString("error","Waiting for server. Your request is saved.")));break;}
   }
  }catch(Exception e){online=false;emit("result",message("pending","Connection or device storage interrupted. Request kept for retry; entry is not confirmed."));}
  finally{draining.set(false);}});
 }
 public boolean online(){return online;}
 public void refresh(){lastSync=0;sync.execute(()->tick());}
}
