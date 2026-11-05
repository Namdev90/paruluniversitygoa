package in.navrang.gate;
import android.content.Context;
import org.json.JSONObject;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.CopyOnWriteArrayList;
public final class GateRuntime {
 public interface Listener {void event(JSONObject event);}
 private static GateRuntime instance;
 private final Context app;
 public final GateDb db; public final GateSession sessions; public final GateApi api;
 private final ScheduledExecutorService sync=Executors.newSingleThreadScheduledExecutor();
 private final ExecutorService entries=Executors.newSingleThreadExecutor();
 public final ExecutorService requests=Executors.newFixedThreadPool(2);
 private final CopyOnWriteArrayList<Listener> listeners=new CopyOnWriteArrayList<>();
 private final AtomicBoolean draining=new AtomicBoolean();
 private volatile java.util.function.BooleanSupplier privateAccess=()->true;
 public void setPrivateAccess(java.util.function.BooleanSupplier allowed){privateAccess=allowed==null?()->false:allowed;}
 public boolean privateAccessAllowed(){try{return privateAccess.getAsBoolean();}catch(Exception unavailable){return false;}}
 private int foreground=0;private volatile boolean online=false;
 private static final long START_NANOS=System.nanoTime();
 private java.util.function.LongSupplier elapsed=()->TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-START_NANOS);
 private final ReconcilePolicy reconciliation=new ReconcilePolicy();private String reconcileOwner="";
 private long clock(){return Math.max(0,elapsed.getAsLong());}
 private static String scope(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");if(p==null)return "";return GateSession.actor(session)+"|"+p.optString("role")+"|"+p.optBoolean("active")+"|"+p.optBoolean("scanner")+"|"+p.optBoolean("helpdesk")+"|"+p.optString("station")+"|"+p.optString("accessExpiresAt")+"|"+p.optBoolean("nameConfirmed",true);}
 private boolean prepareReconciliation(long generation){synchronized(sessions){if(generation!=sessions.generation())return false;String owner=generation+":"+scope(sessions.read());synchronized(reconciliation){if(!owner.equals(reconcileOwner)){reconcileOwner=owner;reconciliation.reset();}}return true;}}
 private void failed(int kind,long claim){reconciliation.failure(kind,claim,clock(),ThreadLocalRandom.current().nextLong());}
 private GateRuntime(Context c)throws Exception{app=c.getApplicationContext();db=new GateDb(c);sessions=new GateSession(c);api=new GateApi(c,sessions,this::renewalAllowed);sync.scheduleWithFixedDelay(()->tick(),500,2000,TimeUnit.MILLISECONDS);}
 private synchronized boolean renewalAllowed(){return foreground>0&&privateAccessAllowed();}
 public synchronized boolean foregroundAdministrator(){return foreground>0&&privateAccessAllowed()&&GateSession.canSync(sessions.read())&&"admin".equals(GateSession.actor(sessions.read()));}
 public static synchronized GateRuntime get(Context c)throws Exception{if(instance==null)instance=new GateRuntime(c.getApplicationContext());return instance;}
 public void add(Listener l){listeners.addIfAbsent(l);}public void remove(Listener l){listeners.remove(l);}
 public synchronized void resume(){foreground++;}public synchronized void pause(){foreground=Math.max(0,foreground-1);}
 private void clearInactiveIfCurrent(long generation,String token){synchronized(sessions){if(sessions.isCurrent(generation,token)&&!GateSession.canSync(sessions.read()))db.clearTemporary();}}
 private boolean expireIfCurrent(long generation,String token){synchronized(sessions){if(!sessions.clearIfCurrent(generation,token))return false;db.clearTemporary();emit("auth",new JSONObject());return true;}}
 public void emit(String type,JSONObject data){try{JSONObject e=new JSONObject().put("type",type).put("data",data);for(Listener l:listeners)l.event(e);}catch(Exception ignored){}}
 private void tick(){synchronized(this){if(foreground<=0||!privateAccessAllowed())return;}try{
  GateUpdater.check(app,false,false);
  long generation=sessions.generation();JSONObject session=sessions.read();if(session==null)return;String token=session.optString("token");if(!sessions.isCurrent(generation,token))return;
  if(!prepareReconciliation(generation))return;
  long profileClaim=reconciliation.begin(ReconcilePolicy.PROFILE,clock());
  if(profileClaim!=0){boolean profileSaved=false;try{
   long profileRequest=sessions.beginProfileRequest();GateApi.Reply me=api.call("me",new JSONObject(),token);
   if(!privateAccessAllowed())return;
   if(!me.sessionToken.isEmpty())token=me.sessionToken;
   if(!sessions.isCurrent(generation,token))return;
   if(me.status==200&&me.body.optBoolean("ok")){JSONObject profile=new JSONObject(me.body.toString());profile.remove("ok");if(!sessions.refreshIfCurrent(generation,token,profileRequest,profile))return;session=sessions.read();profileSaved=true;reconciliation.success(ReconcilePolicy.PROFILE,profileClaim,clock(),false);emit("profile",profile);}
   if(me.status==401){expireIfCurrent(generation,token);return;}
   if(!sessions.isCurrent(generation,token))return;session=sessions.read();
   if(session==null||!session.getJSONObject("profile").optBoolean("active")){clearInactiveIfCurrent(generation,token);return;}
  }finally{if(!profileSaved)failed(ReconcilePolicy.PROFILE,profileClaim);}}
  if(!sessions.isCurrent(generation,token))return;
  if(!GateSession.canSync(session)){clearInactiveIfCurrent(generation,token);return;}
  long dataClaim=reconciliation.begin(ReconcilePolicy.DATA,clock());
  if(dataClaim!=0){boolean dataSaved=false;try{String requestedScope=scope(session);JSONObject local=db.snapshot();GateApi.Reply r=api.call("sync",new JSONObject().put("dataRevision",local.getLong("dataRevision")).put("afterSeq",local.getLong("cursor")),session.optString("token"));
   if(!privateAccessAllowed())return;
   if(r.status==200&&r.body.optBoolean("ok")){synchronized(sessions){JSONObject current=sessions.read();if(generation!=sessions.generation()||!GateSession.canSync(current)||!requestedScope.equals(scope(current))||!"admin".equals(GateSession.actor(current))&&!r.body.optBoolean("staffSummary"))return;if(r.body.optBoolean("hasMore")&&r.body.getLong("cursor")<=local.getLong("cursor"))throw new IllegalStateException("Sync cursor did not advance.");db.applySync(r.body);}online=true;dataSaved=true;reconciliation.success(ReconcilePolicy.DATA,dataClaim,clock(),r.body.optBoolean("hasMore"));emit("sync",db.snapshot());}
   else {if(generation!=sessions.generation())return;online=false;if(r.status==401){expireIfCurrent(generation,r.sessionToken.isEmpty()?token:r.sessionToken);return;}if(r.status==403)reconciliation.invalidate(ReconcilePolicy.PROFILE);emit("connection",new JSONObject().put("online",false).put("status",r.status).put("message",r.body.optString("error","Waiting for server.")));}
  }finally{if(!dataSaved)failed(ReconcilePolicy.DATA,dataClaim);}}drain();
 }catch(Exception e){online=false;emit("connection",safe("message","Connection interrupted. Unconfirmed requests stay only in memory while the app is open."));}}
 private static JSONObject message(String code,String text){try{return new JSONObject().put("code",code).put("message",text);}catch(Exception e){return new JSONObject();}}
 private static JSONObject safe(String k,String v){try{return new JSONObject().put(k,v);}catch(Exception e){return new JSONObject();}}
 public void submit(String id){
  if(!privateAccessAllowed()){emit("result",message("locked","Unlock Navrang before scanning. Entry is NOT confirmed."));return;}
  try{JSONObject auth=sessions.read();if(!GateSession.canScan(auth)||("google".equals(auth.getJSONObject("profile").optString("method"))&&!auth.getJSONObject("profile").optBoolean("nameConfirmed",true))){emit("result",safe("code","signed_out").put("message","Sign in with an approved checker account."));return;}
   JSONObject job=db.queue(id,GateSession.actor(auth));GateFeedback.play(app,"scan");JSONObject local=db.lookup(id);emit("result",new JSONObject().put("code","pending").put("id",id).put("record",local.opt("record")).put("message","Awaiting server confirmation. Temporary request stays in memory while this app is open."));drain();
  }catch(GateDb.UpdateInProgressException e){
   JSONObject blocked=message("update_in_progress","Finish or cancel the Android app update before scanning another ticket. Entry is NOT confirmed. Retry the same ticket afterward.");try{blocked.put("id",id);}catch(Exception ignored){}emit("result",blocked);
  }catch(Exception e){emit("result",message("storage_error","Could not queue the scan in memory. Entry is NOT confirmed. Retry with the same ticket."));}
 }
 public void drain(){
  if(!draining.compareAndSet(false,true))return;
  entries.execute(()->{long drainGeneration=sessions.generation(),queueClaim=0;JSONObject job=null;try{
   for(int n=0;n<20;n++){long generation=sessions.generation();JSONObject auth=sessions.read();if(!privateAccessAllowed()||!GateSession.canScan(auth))break;String actor=GateSession.actor(auth);job=db.pending(actor);if(job==null)break;
    if(!prepareReconciliation(generation))break;queueClaim=reconciliation.begin(ReconcilePolicy.QUEUE,clock());if(queueClaim==0)break;
    GateApi.Reply r=api.call("checkin",job,auth.optString("token"));
    if(!privateAccessAllowed())break;
    if(generation!=sessions.generation()||!GateSession.canScan(sessions.read()))break;
    if(r.status==200&&r.body.optBoolean("ok")){if(generation!=sessions.generation()||!GateSession.canScan(sessions.read()))break;db.finish(job,r.body);job=null;online=true;reconciliation.success(ReconcilePolicy.QUEUE,queueClaim,clock(),false);queueClaim=0;reconciliation.invalidate(ReconcilePolicy.DATA);emit("result",r.body);emit("sync",db.snapshot());}
    else{online=false;if(r.status==401){expireIfCurrent(generation,r.sessionToken.isEmpty()?auth.optString("token"):r.sessionToken);break;}if(r.status==403)refresh();emit("result",new JSONObject().put("code","pending").put("id",job.optString("ticketId")).put("message",r.body.optString("error","Waiting for server. Your request is saved.")));break;}
   }
  }catch(Exception e){
   online=false;if(drainGeneration==sessions.generation()&&GateSession.canScan(sessions.read())){
    String text="Connection or device storage interrupted. Temporary request kept in memory for retry; entry is not confirmed.";
    if(job!=null&&!job.optString("ticketId").isEmpty()){
     JSONObject pending=message("pending",text);try{pending.put("id",job.optString("ticketId"));}catch(Exception ignored){}emit("result",pending);
    }else emit("connection",safe("message","Connection or device storage interrupted. Keep this app open while pending requests retry."));
   }
  }
  finally{if(queueClaim!=0)failed(ReconcilePolicy.QUEUE,queueClaim);draining.set(false);}});
 }
 public boolean online(){return online;}
 /** Private, already authorized hints invalidate only the relevant cached read. */
 public void invalidate(String domain){if("access".equals(domain)||"all".equals(domain))reconciliation.invalidate(ReconcilePolicy.PROFILE);if("records".equals(domain)||"staff".equals(domain)||"access".equals(domain)||"all".equals(domain))reconciliation.invalidate(ReconcilePolicy.DATA);}
 public void refresh(){invalidate("all");try{sync.execute(()->tick());}catch(RejectedExecutionException stopped){/* The regular owner has stopped; never create another timer. */}}
}
