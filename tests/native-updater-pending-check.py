#!/usr/bin/env python3
"""Exercise the production updater's install boundaries with deterministic Android fakes.

The real GateUpdater and UpdatePolicy are compiled, including verification, install,
callback, and notification code. Platform effects are observed rather than performed.
No APK is built/installed and no server or device is contacted.
"""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
db_source = (root / "app/java/in/navrang/gate/GateDb.java").read_text()
count_start = db_source.index(" public synchronized int pendingCount(){")
count_end = db_source.index(" public synchronized JSONObject snapshot()", count_start)
pending_count = db_source[count_start:count_end]
constructor_start = db_source.index(" public GateDb(Context c)")
constructor_end = db_source.index("\n", constructor_start)
db_constructor = db_source[constructor_start:constructor_end].replace("super(c,null,null,1);", "")
queue_start = db_source.index(" public synchronized JSONObject queue(")
queue_end = db_source.index(" public synchronized JSONObject pending(", queue_start)
queue_method = db_source[queue_start:queue_end]
sources = {
"org/json/JSONException.java": "package org.json;public class JSONException extends Exception {}",
"org/json/JSONObject.java": '''package org.json;import java.util.*;
public class JSONObject {
 private static final Map<String,Map<String,Object>> saved=new HashMap<>();private final Map<String,Object> values=new HashMap<>();
 public JSONObject(){}public JSONObject(String text){if(saved.containsKey(text))values.putAll(saved.get(text));}
 public JSONObject put(String key,Object value){values.put(key,value);return this;}
 public String optString(String key){return optString(key,"");}public String optString(String key,String fallback){Object v=values.get(key);return v==null?fallback:v.toString();}
 public String getString(String key){return optString(key);}public int optInt(String key){return values.containsKey(key)?((Number)values.get(key)).intValue():0;}
 public int getInt(String key){return optInt(key);}public long getLong(String key){return ((Number)values.get(key)).longValue();}
 public boolean optBoolean(String key){return Boolean.TRUE.equals(values.get(key));}
 public String toString(){String id="json-"+saved.size();saved.put(id,new HashMap<>(values));return id;}
}''',
"android/Manifest.java": "package android;public class Manifest {}",
"android/R.java": "package android;public class R {public static class drawable {public static final int stat_sys_download_done=1;}}",
"android/net/Uri.java": "package android.net;public class Uri {public static Uri parse(String value){return new Uri();}}",
"android/provider/Settings.java": 'package android.provider;public class Settings {public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES="settings";}',
"android/os/Build.java": "package android.os;public class Build {public static class VERSION {public static int SDK_INT=35;}}",
"android/os/Looper.java": "package android.os;public class Looper {public static Looper getMainLooper(){return new Looper();}}",
"android/os/Handler.java": '''package android.os;import java.util.*;public class Handler {
 private static final Queue<Runnable> tasks=new ArrayDeque<>();public Handler(Looper looper){}
 public boolean post(Runnable task){synchronized(tasks){tasks.add(task);}return true;}
 public static void drain(){while(true){Runnable task;synchronized(tasks){task=tasks.poll();}if(task==null)return;task.run();}}
}''',
"android/content/SharedPreferences.java": '''package android.content;import java.util.*;public class SharedPreferences {
 private final Map<String,Object> values=new HashMap<>();public String getString(String key,String fallback){return (String)values.getOrDefault(key,fallback);}
 public int getInt(String key,int fallback){return (Integer)values.getOrDefault(key,fallback);}public long getLong(String key,long fallback){return (Long)values.getOrDefault(key,fallback);}
 public boolean getBoolean(String key,boolean fallback){return (Boolean)values.getOrDefault(key,fallback);}public Editor edit(){return new Editor();}
 public class Editor {public Editor putString(String key,String value){values.put(key,value);return this;}public Editor putLong(String key,long value){values.put(key,value);return this;}
 public Editor putInt(String key,int value){values.put(key,value);return this;}public Editor putBoolean(String key,boolean value){values.put(key,value);return this;}public void apply(){}}
}''',
"android/content/Context.java": '''package android.content;import java.io.*;import android.app.*;import android.app.job.*;import android.content.pm.*;
public class Context {public static final String NOTIFICATION_SERVICE="notification",JOB_SCHEDULER_SERVICE="jobs";
 public final PackageManager packages=new PackageManager();public final NotificationManager notifications=new NotificationManager();private final SharedPreferences prefs=new SharedPreferences();public File files;
 public Context getApplicationContext(){return this;}public PackageManager getPackageManager(){return packages;}public String getPackageName(){return "in.navrang.gate";}
 public File getFilesDir(){return files;}public SharedPreferences getSharedPreferences(String name,int mode){return prefs;}
 public Object getSystemService(String name){return NOTIFICATION_SERVICE.equals(name)?notifications:new JobScheduler();}
}''',
"android/content/ComponentName.java": "package android.content;public class ComponentName {public ComponentName(Context context,Class<?> type){}}",
"android/content/IntentSender.java": "package android.content;public class IntentSender {}",
"android/content/Intent.java": '''package android.content;import java.util.*;public class Intent {
 public static final String EXTRA_INTENT="intent";public static final int FLAG_ACTIVITY_NEW_TASK=1;public Class<?> target;public String action;private final Map<String,Object> extras=new HashMap<>();
 public Intent(){}public Intent(Intent other){target=other.target;action=other.action;extras.putAll(other.extras);}public Intent(Context c,Class<?> type){target=type;}
 public Intent(String name,android.net.Uri uri){action=name;}public Intent addFlags(int flags){return this;}
 public Intent putExtra(String key,Object value){extras.put(key,value);return this;}public int getIntExtra(String key,int fallback){return (Integer)extras.getOrDefault(key,fallback);}
 @SuppressWarnings("unchecked") public <T>T getParcelableExtra(String key){return (T)extras.get(key);}
}''',
"android/content/pm/Signature.java": "package android.content.pm;public class Signature {public byte value=1;public byte[] toByteArray(){return new byte[]{value};}}",
"android/content/pm/SigningInfo.java": "package android.content.pm;public class SigningInfo {public Signature[] getApkContentsSigners(){return new Signature[]{new Signature()};}}",
"android/content/pm/PackageInfo.java": '''package android.content.pm;public class PackageInfo {public int versionCode;public String versionName="1.0.0",packageName="in.navrang.gate";
 public SigningInfo signingInfo;public Signature[] signatures={new Signature()};}''',
"android/content/pm/PackageManager.java": '''package android.content.pm;public class PackageManager {
 public static final int GET_SIGNING_CERTIFICATES=1,GET_SIGNATURES=2;public final PackageInstaller installer=new PackageInstaller();public final PackageInfo installed=new PackageInfo(),archive=new PackageInfo();public boolean allowed=true;
 public PackageManager(){installed.versionCode=1;archive.versionCode=2;}public PackageInfo getPackageInfo(String name,int flags){return installed;}
 public PackageInfo getPackageArchiveInfo(String path,int flags){return archive;}public boolean canRequestPackageInstalls(){return allowed;}public PackageInstaller getPackageInstaller(){return installer;}
}''',
"android/content/pm/PackageInstaller.java": '''package android.content.pm;import java.io.*;import java.util.*;import android.content.IntentSender;
public class PackageInstaller {
 public static final String EXTRA_STATUS="status",EXTRA_SESSION_ID="session";public static final int STATUS_FAILURE=1,STATUS_PENDING_USER_ACTION=-1,STATUS_SUCCESS=0;
 public int created;public boolean failList,failQuery,failOpen;public SessionParams params;public final Session session=new Session(this);private final Map<Integer,Session> sessions=new HashMap<>();
 public int createSession(SessionParams p){created++;params=p;Session next=created==1?session:new Session(this);next.id=created;next.packageName=p.packageName;sessions.put(created,next);return created;}
 public Session openSession(int id){if(failOpen)throw new IllegalStateException("storage unavailable");Session found=sessions.get(id);if(found==null)throw new IllegalStateException("missing session");return found;}
 public List<SessionInfo> getMySessions(){if(failList)throw new IllegalStateException("installer unavailable");List<SessionInfo> out=new ArrayList<>();for(Session value:sessions.values())out.add(new SessionInfo(value));return out;}
 public SessionInfo getSessionInfo(int id){if(failQuery)throw new IllegalStateException("installer unavailable");return sessions.containsKey(id)?new SessionInfo(sessions.get(id)):null;}
 public void abandonSession(int id){Session found=sessions.get(id);if(found==null)throw new IllegalStateException("missing session");found.abandon();}public void finish(int id){sessions.remove(id);}
 public static class SessionInfo {private final Session session;public SessionInfo(Session value){session=value;}public int getSessionId(){return session.id;}public String getAppPackageName(){return session.packageName;}public boolean isActive(){return false;}public boolean isSealed(){return session.committed>0;}}
 public static class SessionParams {public static final int MODE_FULL_INSTALL=1,USER_ACTION_REQUIRED=1;public String packageName;public int requireUserAction;
  public SessionParams(int mode){}public void setAppPackageName(String name){packageName=name;}public void setSize(long size){}public void setRequireUserAction(int value){requireUserAction=value;}}
 public static class Session implements AutoCloseable {private final PackageInstaller installer;public int id,committed,abandoned,closed;public String packageName;public boolean failCommit,failAbandon,deferAbandon;public Runnable afterWrite=()->{};
  public Session(PackageInstaller value){installer=value;}public OutputStream openWrite(String name,long offset,long length){return new ByteArrayOutputStream();}
  public void fsync(OutputStream out){afterWrite.run();}public void commit(IntentSender sender){if(failCommit)throw new IllegalStateException("commit failed");committed++;}
  public void abandon(){abandoned++;if(failAbandon)throw new IllegalStateException("abandon failed");if(!deferAbandon)installer.finish(id);}public void close(){closed++;}}
}''',
"android/app/Activity.java": '''package android.app;import java.util.*;import android.content.*;public class Activity extends Context {
 public Runnable bridgeSubmission;public Thread bridgeThread;public boolean finishing,destroyed,focused=true,failLaunch;public final List<Intent> launched=new ArrayList<>();public boolean isFinishing(){return finishing;}public boolean isDestroyed(){return destroyed;}public boolean hasWindowFocus(){return focused;}public void startActivity(Intent intent){if(failLaunch)throw new IllegalStateException("launch failed");launched.add(intent);if(bridgeSubmission!=null){bridgeThread=new Thread(bridgeSubmission);bridgeThread.start();long deadline=System.nanoTime()+2000000000L;while(bridgeThread.getState()!=Thread.State.BLOCKED&&System.nanoTime()<deadline)Thread.yield();if(bridgeThread.getState()!=Thread.State.BLOCKED)throw new AssertionError("bridge submission must overlap the held DB monitor");}}
}''',
"android/app/AlertDialog.java": '''package android.app;public class AlertDialog {public interface Click {void clicked(Object dialog,int which);}public static class Builder {
 public Builder(Activity a){}public Builder setTitle(String s){return this;}public Builder setMessage(String s){return this;}public Builder setNegativeButton(String s,Click c){return this;}public Builder setPositiveButton(String s,Click c){return this;}public void show(){}}
}''',
"android/app/PendingIntent.java": '''package android.app;import android.content.*;public class PendingIntent {
 public static final int FLAG_UPDATE_CURRENT=1,FLAG_MUTABLE=2,FLAG_IMMUTABLE=4;public Intent intent;
 public static PendingIntent getActivity(Context c,int id,Intent intent,int flags){PendingIntent p=new PendingIntent();p.intent=intent;return p;}
 public static PendingIntent getBroadcast(Context c,int id,Intent intent,int flags){return getActivity(c,id,intent,flags);}public IntentSender getIntentSender(){return new IntentSender();}
}''',
"android/app/Notification.java": '''package android.app;import android.content.Context;public class Notification {
 public PendingIntent tap;public static class Builder {private final Notification n=new Notification();public Builder(Context c){}public Builder(Context c,String channel){}
 public Builder setSmallIcon(int icon){return this;}public Builder setContentTitle(String s){return this;}public Builder setContentText(String s){return this;}
 public Builder setContentIntent(PendingIntent p){n.tap=p;return this;}public Builder setAutoCancel(boolean value){return this;}public Notification build(){return n;}}
}''',
"android/app/NotificationChannel.java": "package android.app;public class NotificationChannel {public NotificationChannel(String id,String name,int importance){}}",
"android/app/NotificationManager.java": '''package android.app;public class NotificationManager {public static final int IMPORTANCE_DEFAULT=1;public Notification last;
 public boolean areNotificationsEnabled(){return true;}public void createNotificationChannel(NotificationChannel channel){}public void notify(int id,Notification value){last=value;}}
''',
"android/app/job/JobInfo.java": '''package android.app.job;import android.content.ComponentName;public class JobInfo {public static final int NETWORK_TYPE_ANY=1;
 public static class Builder {public Builder(int id,ComponentName c){}public Builder setRequiredNetworkType(int value){return this;}public Builder setPeriodic(long period,long flex){return this;}
 public Builder setPersisted(boolean value){return this;}public JobInfo build(){return new JobInfo();}}
}''',
"android/app/job/JobScheduler.java": "package android.app.job;public class JobScheduler {public void cancel(int id){}public void schedule(JobInfo job){}}",
"in/navrang/gate/MainActivity.java": "package in.navrang.gate;public class MainActivity {}",
"in/navrang/gate/UpdateJob.java": "package in.navrang.gate;public class UpdateJob {}",
"in/navrang/gate/UpdateReceiver.java": "package in.navrang.gate;public class UpdateReceiver {}",
"in/navrang/gate/GateDb.java": '''package in.navrang.gate;import org.json.*;import java.util.*;import android.content.Context;import android.content.pm.PackageInstaller;public class GateDb {
 private final Context context;
 __CONSTRUCTOR__
 private void retireDiskCache(){}
 public int pending;public boolean unreadable;private int count(String table){if(!"outbox".equals(table))throw new AssertionError("pending guard must count the whole outbox");if(unreadable)throw new IllegalStateException("cannot read outbox");return pending;}
 __PENDING_COUNT__
 private String meta(String key,String fallback){return "test-device";}public static String now(){return "test-time";}
 private final SQLiteDatabase storage=new SQLiteDatabase();private SQLiteDatabase getWritableDatabase(){return storage;}
 static class ContentValues {final Map<String,String> values=new HashMap<>();void put(String key,String value){values.put(key,value);}}
 static class Cursor implements AutoCloseable {public boolean moveToFirst(){return false;}public String getString(int column){throw new AssertionError("unexpected duplicate");}public void close(){}}
 class SQLiteDatabase {void beginTransaction(){}void setTransactionSuccessful(){}void endTransaction(){}Cursor rawQuery(String query,String[] arguments){return new Cursor();}void insertOrThrow(String table,String nullable,ContentValues values){pending++;}}
 __QUEUE_METHOD__
 public synchronized JSONObject snapshot(){return new JSONObject().put("pending",pendingCount());}
}'''.replace("__CONSTRUCTOR__", db_constructor).replace("__PENDING_COUNT__", pending_count).replace("__QUEUE_METHOD__", queue_method),
"in/navrang/gate/GateRuntime.java": '''package in.navrang.gate;import android.content.Context;public class GateRuntime {
 public static GateRuntime instance;public static boolean unavailable;public final GateDb db;public GateRuntime(Context c){db=new GateDb(c);}
 public static GateRuntime get(Context c)throws Exception{if(unavailable)throw new Exception("cannot open runtime");return instance;}
}''',
"NativeUpdaterPendingCheck.java": r'''import in.navrang.gate.*;import android.app.*;import android.content.*;import android.content.pm.*;import android.os.Handler;
import org.json.JSONObject;import java.io.*;import java.nio.file.*;import java.lang.reflect.*;import java.util.*;import java.util.concurrent.*;
public class NativeUpdaterPendingCheck {
 static int checks;static final List<String> failures=new ArrayList<>();
 static void check(boolean ok,String reason){checks++;if(!ok)failures.add(reason);}
 static Field field(String name)throws Exception{Field f=GateUpdater.class.getDeclaredField(name);f.setAccessible(true);return f;}
 static ExecutorService worker()throws Exception{return (ExecutorService)field("work").get(null);}
 static void settle()throws Exception{worker().submit(()->{}).get(3,TimeUnit.SECONDS);Handler.drain();}
 static Activity fixture()throws Exception {
  settle();GateRuntime.instance=null;GateRuntime.unavailable=false;GateUpdater.scanActive=false;field("confirmation").set(null,null);field("confirmationSession").set(null,-1);field("message").set(null,"");field("installationMessage").set(null,"");field("installerActivity").set(null,new java.lang.ref.WeakReference<Activity>(null));
  Activity a=new Activity();a.files=Files.createTempDirectory("updater-fixture-").toFile();a.files.deleteOnExit();File apk=new File(a.files,"navrang-update.apk");Files.write(apk.toPath(),new byte[100000]);apk.deleteOnExit();
  JSONObject release=new JSONObject().put("packageName",UpdatePolicy.APP_ID).put("versionCode",2).put("versionName","1.0.1").put("apkUrl",UpdatePolicy.ROOT+"downloads/Navrang-Gate-1.0.1.apk").put("size",100000L).put("sha256",UpdatePolicy.hash(apk));
  a.getSharedPreferences("navrang-updates",0).edit().putString("release",release.toString()).putInt("readyCode",2).apply();GateRuntime.instance=new GateRuntime(a);return a;
 }
 static void restart(Activity a)throws Exception{settle();field("message").set(null,"");field("installationMessage").set(null,"");GateRuntime.instance=new GateRuntime(a);GateUpdater.scanActive=false;field("confirmation").set(null,null);field("confirmationSession").set(null,-1);field("installerActivity").set(null,new java.lang.ref.WeakReference<Activity>(null));}
 static int staged(Activity a,String target)throws Exception{PackageInstaller.SessionParams p=new PackageInstaller.SessionParams(1);p.setAppPackageName(target);return a.packages.installer.createSession(p);}
 static String message(Activity a){return GateUpdater.status(a).optString("message");}
 static Intent confirmation(){Intent i=new Intent();i.action="android-install-confirmation";return i;}
 static Intent callback(){return new Intent().putExtra(PackageInstaller.EXTRA_SESSION_ID,1).putExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_PENDING_USER_ACTION).putExtra(Intent.EXTRA_INTENT,confirmation());}
 static Intent terminal(int id,int state){return new Intent().putExtra(PackageInstaller.EXTRA_SESSION_ID,id).putExtra(PackageInstaller.EXTRA_STATUS,state);}
 static boolean queueRejected(){try{GateRuntime.instance.db.queue("RACE0001","checker");return false;}catch(Exception e){return e.getClass().getSimpleName().equals("UpdateInProgressException")&&e.getMessage().contains("Finish or cancel");}}
 static void remember(Activity a)throws Exception{field("installerActivity").set(null,new java.lang.ref.WeakReference<Activity>(a));}
 public static void main(String[] args)throws Exception {try{
  Activity a=fixture();GateRuntime.instance.db.pending=2;GateUpdater.install(a);settle();check(a.packages.installer.created==0,"existing pending requests must block installation before a session is created");check(message(a).contains("unconfirmed"),"blocked pending entries need an actionable explanation");check(GateRuntime.instance.db.pending==2,"deferring installation must retain every pending request");
  a=fixture();GateUpdater.scanActive=true;GateUpdater.install(a);settle();check(a.packages.installer.created==0,"active scanner still blocks installation");
  a=fixture();GateRuntime.unavailable=true;GateUpdater.install(a);settle();check(a.packages.installer.created==0,"unavailable runtime must fail closed before installation");
  a=fixture();GateRuntime.instance.db.unreadable=true;GateUpdater.install(a);settle();check(a.packages.installer.created==0,"unreadable pending count must fail closed before installation");
  for(String race:new String[]{"pending","scanner","unreadable"}){
   a=fixture();a.packages.installer.session.afterWrite=()->{if("pending".equals(race))GateRuntime.instance.db.pending=1;else if("scanner".equals(race))GateUpdater.scanActive=true;else GateRuntime.instance.db.unreadable=true;};
   GateUpdater.install(a);settle();check(a.packages.installer.created==1,"race fixture must reach the real session write for "+race);check(a.packages.installer.session.committed==0,"new "+race+" state during APK write must block session commit");check(a.packages.installer.session.abandoned==1&&a.packages.installer.session.closed==1,"blocked "+race+" session must be abandoned and closed");
  }
  a=fixture();GateUpdater.install(a);settle();check(a.packages.installer.session.committed==1,"empty outbox and idle scanner still permit verified install");check(a.packages.installer.params.requireUserAction==PackageInstaller.SessionParams.USER_ACTION_REQUIRED,"install must retain required Android user confirmation");check(UpdatePolicy.APP_ID.equals(a.packages.installer.params.packageName),"install must remain scoped to this app");
  for(String invalid:new String[]{"package","version","signature","checksum"}){
   a=fixture();if("package".equals(invalid))a.packages.archive.packageName="other.app";else if("version".equals(invalid))a.packages.archive.versionCode=1;else if("signature".equals(invalid))a.packages.archive.signatures[0].value=2;else Files.write(new File(a.files,"navrang-update.apk").toPath(),new byte[]{1});
   GateUpdater.install(a);settle();check(a.packages.installer.created==0,"invalid "+invalid+" update must remain rejected by real verification");
  }
  a=fixture();GateUpdater.install(a);settle();a.focused=false;GateUpdater.installationResult(a,callback());Handler.drain();a.focused=true;GateRuntime.instance.db.pending=1;GateUpdater.install(a);settle();check(a.launched.isEmpty(),"saved confirmation must not bypass pending protection");check(field("confirmation").get(null)!=null,"blocked confirmation remains available for retry");GateRuntime.instance.db.pending=0;GateUpdater.install(a);settle();check(a.launched.size()==1,"confirmation can resume once pending requests resolve");check(message(a).contains("Confirm the update"),"resuming confirmation must clear the earlier pending-block explanation");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateRuntime.instance.db.pending=1;GateUpdater.installationResult(a,callback());Handler.drain();check(a.launched.isEmpty(),"pending-user-action callback must not launch while requests are pending");check(field("confirmation").get(null)!=null,"deferred callback retains its confirmation");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateUpdater.installationResult(a,callback());GateRuntime.instance.db.pending=1;Handler.drain();check(a.launched.isEmpty(),"new request between callback and UI dispatch must block confirmation launch");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateUpdater.installationResult(a,callback());GateRuntime.instance.db.unreadable=true;Handler.drain();check(a.launched.isEmpty(),"unreadable outbox at UI dispatch must block confirmation launch");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateUpdater.installationResult(a,callback());GateUpdater.scanActive=true;Handler.drain();check(a.launched.isEmpty(),"scanner opening before UI dispatch must block confirmation launch");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateUpdater.installationResult(a,callback());a.focused=false;Handler.drain();check(a.launched.isEmpty(),"backgrounded activity must not launch delayed confirmation");
  a=fixture();GateUpdater.install(a);settle();remember(a);GateUpdater.installationResult(a,callback());Handler.drain();check(a.launched.size()==1,"safe foreground callback still launches Android confirmation once");
  a=fixture();GateUpdater.install(a);settle();a.focused=false;GateUpdater.installationResult(a,callback());Handler.drain();check(a.notifications.last!=null,"background confirmation should retain an update notification");check(a.notifications.last!=null&&a.notifications.last.tap.intent.target==MainActivity.class,"notification must open the guarded app flow instead of bypassing it with Android confirmation");
  a=fixture();GateUpdater.install(a);settle();check(queueRejected()&&GateRuntime.instance.db.pending==0,"committed install must atomically fence new admissions");
  a=fixture();GateUpdater.install(a);settle();final boolean[] bridgeRejected={false};a.bridgeSubmission=()->bridgeRejected[0]=queueRejected();GateUpdater.installationResult(a,callback());Handler.drain();a.bridgeThread.join(2000);check(!a.bridgeThread.isAlive(),"overlapping bridge thread must complete");check(bridgeRejected[0]&&GateRuntime.instance.db.pending==0,"bridge submission waiting on confirmation launch must be explicitly rejected after the monitor releases");
  for(int outcome:new int[]{PackageInstaller.STATUS_SUCCESS,PackageInstaller.STATUS_FAILURE}){
   a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,terminal(1,outcome));Handler.drain();check(!queueRejected()&&GateRuntime.instance.db.pending==1,"terminal installation outcome "+outcome+" must resume normal admissions");
  }
  a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,terminal(99,PackageInstaller.STATUS_FAILURE));Handler.drain();check(queueRejected(),"unrelated terminal callback must not release this install's fence");
  a=fixture();GateUpdater.install(a);settle();GateUpdater.install(a);settle();check(a.packages.installer.session.committed==1,"double-tap must not commit a second install while one is pending");check(queueRejected(),"abandoning a second staged install must not unpause the first install");
  a=fixture();a.packages.installer.session.failCommit=true;GateUpdater.install(a);settle();check(!queueRejected()&&GateRuntime.instance.db.pending==1,"failed commit must release its admission fence");
  a=fixture();GateUpdater.install(a);settle();a.failLaunch=true;GateUpdater.installationResult(a,callback());Handler.drain();check(queueRejected()&&field("confirmation").get(null)!=null,"failed confirmation launch must keep the committed session fenced and retryable");a.failLaunch=false;GateUpdater.install(a);settle();check(a.launched.size()==1,"Android confirmation can be retried after launch failure");
  a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,callback());Handler.drain();check(field("confirmation").get(null)!=null,"keep active Android confirmation available until a terminal result");GateUpdater.install(a);settle();check(a.launched.size()==2,"returning without finishing must allow reopening the same confirmation");
  // Android owns durable installer state. Each restart discards GateDb and updater statics only.
  for(int sdk:new int[]{24,26,28,29,35}){
   android.os.Build.VERSION.SDK_INT=sdk;
   a=fixture();GateUpdater.install(a);settle();restart(a);
   check(queueRejected()&&GateRuntime.instance.db.pending==0,"API "+sdk+" process recreation must fence new RAM-only admissions while Android retains the committed session");
   GateUpdater.installationResult(a,callback());Handler.drain();check(field("confirmation").get(null)!=null,"API "+sdk+" callback must match the recovered session");
   GateUpdater.install(a);settle();check(a.launched.size()==1&&a.packages.installer.session.committed==1,"API "+sdk+" recovered callback reopens Android confirmation without recommitting");
   a.packages.installer.finish(1);GateUpdater.installationResult(a,terminal(1,PackageInstaller.STATUS_FAILURE));Handler.drain();check(!queueRejected(),"API "+sdk+" recovered cancellation must resume admissions");
  }
  android.os.Build.VERSION.SDK_INT=35;
  a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,callback());Handler.drain();restart(a);
  check(queueRejected(),"recreation while Android confirmation is open must remain fenced");GateUpdater.install(a);settle();check(a.packages.installer.session.abandoned==1&&a.packages.installer.session.committed==1,"lost confirmation must cancel the recovered attempt without duplicate commit");check(a.packages.installer.created==1&&!queueRejected(),"removed recovered attempt permits scanning without implicitly starting another update");
  a=fixture();GateUpdater.install(a);settle();restart(a);a.packages.installer.session.deferAbandon=true;GateUpdater.install(a);settle();
  check(queueRejected()&&a.packages.installer.created==1,"asynchronous or ignored abandonment must retain recovered fence");check(message(a).contains("still finishing"),"unfinished abandonment needs an honest wait message");
  a.packages.installer.finish(1);check(!queueRejected(),"dropped terminal callback must recover once Android reports actual absence");GateUpdater.install(a);settle();check(a.packages.installer.created==1,"a queued request after cancellation still blocks fresh installation");
  a=fixture();GateUpdater.install(a);settle();restart(a);a.packages.installer.session.failAbandon=true;GateUpdater.install(a);settle();check(queueRejected(),"failed cancellation must never release a recovered fence");
  a=fixture();GateUpdater.install(a);settle();restart(a);a.packages.installer.failQuery=true;check(queueRejected(),"session query failure must fail closed");GateUpdater.install(a);settle();check(a.packages.installer.created==1,"query failure must not start another installer session");a.packages.installer.failQuery=false;check(queueRejected(),"query recovery must keep an extant idle session fenced");
  a=fixture();GateUpdater.install(a);settle();a.packages.installer.failList=true;restart(a);check(queueRejected(),"initial session enumeration failure must block admissions");a.packages.installer.failList=false;check(queueRejected(),"retrying enumeration must recover existing sessions");
  a=fixture();a.packages.installer.failList=true;restart(a);check(queueRejected(),"unknown installer state must block even without a known session id");a.packages.installer.failList=false;check(!queueRejected(),"successful empty enumeration must reopen admissions");
  a=fixture();staged(a,UpdatePolicy.APP_ID);restart(a);check(queueRejected(),"legacy unsealed staging session without app metadata must be recovered");GateUpdater.install(a);settle();check(a.packages.installer.session.committed==0&&a.packages.installer.session.abandoned==1,"incomplete staged bytes must be abandoned, never committed");GateUpdater.install(a);settle();check(a.packages.installer.created==2&&a.packages.installer.openSession(2).committed==1,"explicit retry after removed staging session must freshly verify and commit");
  GateUpdater.installationResult(a,terminal(1,PackageInstaller.STATUS_FAILURE));Handler.drain();check(queueRejected(),"stale callback from cleared staging must not release a newer session");
  a=fixture();staged(a,null);restart(a);check(queueRejected(),"owned session with unknown target must conservatively fence admissions");
  a=fixture();staged(a,"other.app");restart(a);check(!queueRejected(),"owned session for a different target must not fence this app");
  a=fixture();staged(a,UpdatePolicy.APP_ID);staged(a,UpdatePolicy.APP_ID);restart(a);check(queueRejected(),"all recovered self-update sessions must be tracked");a.packages.installer.finish(1);GateUpdater.installationResult(a,terminal(1,PackageInstaller.STATUS_FAILURE));Handler.drain();check(queueRejected(),"finishing one recovered session must not release another session's fence");a.packages.installer.finish(2);check(!queueRejected(),"last recovered session disappearing must reopen admissions");
  a=fixture();GateUpdater.install(a);settle();a.packages.installer.finish(1);a.packages.installed.versionCode=2;restart(a);check(!queueRejected(),"successful replacement/reboot with no remaining sessions must not strand the scanner");
  a=fixture();a.packages.installer.session.failCommit=true;a.packages.installer.session.deferAbandon=true;GateUpdater.install(a);settle();check(queueRejected(),"commit exception plus nonterminal abandonment must retain fence");a.packages.installer.finish(1);check(!queueRejected(),"failed commit recovery requires actual session disappearance");
  a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,callback());Handler.drain();a.packages.installer.finish(1);a.launched.clear();GateUpdater.install(a);settle();check(a.launched.isEmpty()&&a.packages.installer.created==2,"stale cached confirmation must not relaunch after session disappearance");
  a=fixture();staged(a,UpdatePolicy.APP_ID);staged(a,UpdatePolicy.APP_ID);restart(a);GateUpdater.installationResult(a,callback().putExtra(PackageInstaller.EXTRA_SESSION_ID,2));Handler.drain();a.packages.installer.finish(1);GateUpdater.installationResult(a,terminal(1,PackageInstaller.STATUS_FAILURE));Handler.drain();check(field("confirmation").get(null)!=null&&(Integer)field("confirmationSession").get(null)==2,"terminal callback for A must preserve still-pending confirmation for B");GateUpdater.install(a);settle();check(a.launched.size()==1&&queueRejected(),"remaining session B must keep a usable confirmation and admission fence");
  a=fixture();GateUpdater.install(a);settle();restart(a);new File(a.files,"navrang-update.apk").delete();a.packages.installed.versionCode=2;check(GateUpdater.status(a).optBoolean("installing")&&!GateUpdater.status(a).optBoolean("available")&&!GateUpdater.status(a).optBoolean("ready"),"recovery status must survive missing APK and obsolete release metadata");GateUpdater.install(a);settle();check(a.packages.installer.session.abandoned==1&&!queueRejected(),"explicit recovery must work without a cached APK or available update");
  for(int outcome:new int[]{PackageInstaller.STATUS_SUCCESS,PackageInstaller.STATUS_FAILURE}){
   a=fixture();GateUpdater.install(a);settle();GateUpdater.installationResult(a,callback());Handler.drain();a.packages.installer.finish(1);
   check(!GateUpdater.status(a).optBoolean("installing"),"status can reconcile session removal before terminal callback "+outcome);
   GateUpdater.installationResult(a,terminal(1,outcome));Handler.drain();
   check(field("confirmation").get(null)==null&&(Integer)field("confirmationSession").get(null)==-1,"late matching terminal callback clears confirmation after reconciliation "+outcome);
   check(message(a).contains(outcome==PackageInstaller.STATUS_SUCCESS?"Update installed":"Installation was not completed"),"late matching terminal callback reports its outcome "+outcome);
   check(!queueRejected(),"late matching terminal callback leaves reconciled admissions usable "+outcome);
  }
  a=fixture();staged(a,UpdatePolicy.APP_ID);staged(a,UpdatePolicy.APP_ID);restart(a);GateUpdater.installationResult(a,callback().putExtra(PackageInstaller.EXTRA_SESSION_ID,2));Handler.drain();a.packages.installer.finish(1);GateUpdater.status(a);String activeMessage=message(a);GateUpdater.installationResult(a,terminal(1,PackageInstaller.STATUS_FAILURE));Handler.drain();
  check(field("confirmation").get(null)!=null&&(Integer)field("confirmationSession").get(null)==2&&message(a).equals(activeMessage),"reconciled old terminal callback cannot replace another session's confirmation or message");check(queueRejected(),"reconciled old terminal callback cannot release another session's admission fence");
  a=fixture();String idleMessage=message(a);GateUpdater.installationResult(a,terminal(-1,PackageInstaller.STATUS_SUCCESS));Handler.drain();check(message(a).equals(idleMessage)&&field("confirmation").get(null)==null,"missing session id must not match an empty confirmation sentinel");
  a=fixture();GateUpdater.install(a);settle();restart(a);a.packages.installer.session.deferAbandon=true;GateUpdater.install(a);settle();check(message(a).contains("still finishing"),"deferred recovery explains the active fence");a.packages.installer.finish(1);check(!GateUpdater.status(a).optBoolean("installing")&&!message(a).contains("before scanning")&&!message(a).contains("still finishing"),"missing final callback must not leave a stale recovery warning once Android reports absence");
  a=fixture();a.packages.installer.failOpen=true;GateUpdater.install(a);settle();check(a.packages.installer.session.abandoned==1&&a.packages.installer.getMySessions().isEmpty(),"created session must be abandoned even if opening its handle fails");restart(a);check(!queueRejected(),"failed open cleanup must not orphan a recovery fence on restart");
  a=fixture();a.packages.installer.failOpen=true;a.packages.installer.session.failAbandon=true;GateUpdater.install(a);settle();check(queueRejected(),"failed open plus failed cleanup must fence the known orphan in this process");GateUpdater.install(a);settle();check(a.packages.installer.created==1,"failed open retries must not accumulate orphan sessions");a.packages.installer.failOpen=false;a.packages.installer.session.failAbandon=false;GateUpdater.install(a);settle();check(a.packages.installer.created==1&&a.packages.installer.getMySessions().isEmpty()&&!queueRejected(),"explicit recovery can clear the failed-open orphan without implicitly creating another install");
  if(!failures.isEmpty())throw new AssertionError(failures.size()+" of "+checks+" checks failed:\n - "+String.join("\n - ",failures));
  System.out.println("PASS actual GateUpdater: "+checks+" checks for pending safety, process/reboot recovery, cancellation/query failures, commit/confirmation races, notification routing, and unchanged APK authorization.");
 }finally{worker().shutdownNow();}}
}''',
}
with tempfile.TemporaryDirectory(prefix="navrang-updater-check-") as temp:
    folder = Path(temp)
    files = []
    for name, source in sources.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        files.append(str(path))
    production = [root / "app/java/in/navrang/gate/GateUpdater.java", root / "app/java/in/navrang/gate/UpdatePolicy.java"]
    subprocess.run(["java", "--module", "jdk.compiler/com.sun.tools.javac.Main", "-d", str(folder / "classes"), *files, *map(str, production)], check=True)
    subprocess.run(["java", "-cp", str(folder / "classes"), "NativeUpdaterPendingCheck"], check=True, timeout=20)
