package in.navrang.gate;
import android.Manifest;
import android.app.*;
import android.app.job.*;
import android.content.*;
import android.content.pm.*;
import android.os.*;
import android.provider.Settings;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** APK checks/downloads are independent of entry processing; install requires a safe user action. */
public final class GateUpdater {
 public interface Listener {void updated(JSONObject state);}
 private static final int JOB=3404,NOTICE=3405;private static final String CHANNEL="navrang-updates";
 private static final ExecutorService work=Executors.newSingleThreadExecutor();private static final AtomicBoolean running=new AtomicBoolean();
 private static final CopyOnWriteArrayList<Listener> listeners=new CopyOnWriteArrayList<>();private static final Handler ui=new Handler(Looper.getMainLooper());
 public static volatile boolean scanActive=false;private static volatile boolean downloading=false;private static volatile int progress=0;private static volatile String message="";private static volatile Intent confirmation;private static volatile int confirmationSession=-1;private static java.lang.ref.WeakReference<Activity> installerActivity=new java.lang.ref.WeakReference<>(null);
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences("navrang-updates",0);}
 public static void add(Listener l){listeners.addIfAbsent(l);}public static void remove(Listener l){listeners.remove(l);}
 public static int current(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionCode;}catch(Exception e){return 0;}}
 public static String version(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionName;}catch(Exception e){return "0.4.0";}}
 private static File file(Context c){return new File(c.getFilesDir(),"navrang-update.apk");}
 private static JSONObject release(Context c){try{return new JSONObject(prefs(c).getString("release","{}"));}catch(Exception e){return new JSONObject();}}
 public static boolean automatic(Context c){return prefs(c).getBoolean("automatic",true);}
 public static JSONObject status(Context c){int installing;try{installing=GateRuntime.get(c).db.updateSession()<0?0:1;}catch(Exception e){installing=-1;}JSONObject r=release(c);boolean available=r.optInt("versionCode")>current(c),ready=available&&prefs(c).getInt("readyCode",0)==r.optInt("versionCode")&&file(c).isFile();try{return new JSONObject().put("currentVersion",version(c)).put("available",available).put("ready",ready).put("installing",installing!=0).put("versionName",r.optString("versionName")).put("downloading",downloading).put("progress",progress).put("automatic",automatic(c)).put("notifications",((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled()).put("message",message.isEmpty()?(installing<0?"Could not check Android installation. Tap Finish app update before scanning.":installing>0?"An Android app update is unfinished. Tap Finish app update to resume or safely clear it before scanning.":ready?"Update ready. Install when your station is idle.":available?"A new version is available.":"Your app is up to date."):message);}catch(Exception e){return new JSONObject();}}
 public static void publish(Context c){JSONObject state=status(c);ui.post(()->{for(Listener l:listeners)l.updated(state);});}
 public static void init(Context c){schedule(c);if(automatic(c))check(c,false,false);}
 public static void setAutomatic(Context c,boolean enabled){prefs(c).edit().putBoolean("automatic",enabled).apply();schedule(c);publish(c);if(enabled)check(c,true,false);}
 private static void schedule(Context c){try{JobScheduler jobs=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(!automatic(c)){jobs.cancel(JOB);return;}JobInfo job=new JobInfo.Builder(JOB,new ComponentName(c,UpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15*60*1000L,5*60*1000L).setPersisted(true).build();jobs.schedule(job);}catch(Exception ignored){}}
 public static void check(Context context,boolean force,boolean download){final Context c=context.getApplicationContext();if(scanActive){message="Updates wait while the live scanner is active.";publish(c);return;}if(!force&&System.currentTimeMillis()-prefs(c).getLong("checked",0)<300000){publish(c);return;}if(!running.compareAndSet(false,true))return;work.execute(()->{try{perform(c,download); }catch(Exception e){message="Update check interrupted. Your current app keeps working.";}finally{running.set(false);downloading=false;publish(c);}});}
 public static void background(Context c){if(!automatic(c)||scanActive||!running.compareAndSet(false,true))return;try{perform(c,true);}catch(Exception e){message="Update check will retry when connected.";}finally{running.set(false);downloading=false;publish(c);}}
 private static HttpURLConnection connect(String url)throws Exception{HttpURLConnection h=(HttpURLConnection)new URL(url).openConnection();h.setInstanceFollowRedirects(false);h.setConnectTimeout(7000);h.setReadTimeout(20000);h.setRequestProperty("Cache-Control","no-cache");h.setRequestProperty("Accept","application/octet-stream, application/json");if(h.getResponseCode()!=200){h.disconnect();throw new IOException("Update unavailable.");}return h;}
 private static void validate(JSONObject r)throws Exception{if(!UpdatePolicy.APP_ID.equals(r.optString("packageName")))throw new IOException("Wrong app.");UpdatePolicy.validate(r.getInt("versionCode"),r.getString("versionName"),r.getString("apkUrl"),r.getLong("size"),r.getString("sha256"));}
 private static void perform(Context c,boolean requestedDownload)throws Exception{
  HttpURLConnection h=connect(UpdatePolicy.MANIFEST);JSONObject r;try(InputStream in=h.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException("Update metadata too large.");out.write(b,0,n);}r=new JSONObject(out.toString("UTF-8"));}finally{h.disconnect();}
  validate(r);prefs(c).edit().putString("release",r.toString()).putLong("checked",System.currentTimeMillis()).apply();message="";if(r.getInt("versionCode")<=current(c))return;
  if(status(c).optBoolean("ready")){notifyReady(c);return;}publish(c);if(!(requestedDownload||automatic(c))||scanActive)return;
  downloading=true;progress=0;message="Downloading app update…";publish(c);File part=new File(c.getFilesDir(),"navrang-update.part.apk");h=connect(r.getString("apkUrl"));
  try{long total=0,next=0;try(InputStream in=h.getInputStream();FileOutputStream out=new FileOutputStream(part)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){if(scanActive)throw new IOException("Scanner has priority.");total+=n;if(total>r.getLong("size")||total>UpdatePolicy.MAX_APK)throw new IOException("Wrong update size.");out.write(b,0,n);progress=(int)(100*total/r.getLong("size"));if(System.currentTimeMillis()>next){publish(c);next=System.currentTimeMillis()+750;}}out.getFD().sync();}if(total!=r.getLong("size"))throw new IOException("Incomplete update.");verify(c,part,r);if(!part.renameTo(file(c)))throw new IOException("Could not save verified update.");prefs(c).edit().putInt("readyCode",r.getInt("versionCode")).apply();message="Update ready. Install when your station is idle.";notifyReady(c);}finally{h.disconnect();if(part.exists())part.delete();}
 }
 private static android.content.pm.Signature[] signatures(PackageInfo p){return Build.VERSION.SDK_INT>=28&&p.signingInfo!=null?p.signingInfo.getApkContentsSigners():p.signatures;}
 private static void verify(Context c,File apk,JSONObject r)throws Exception{validate(r);if(!UpdatePolicy.hash(apk).equals(r.getString("sha256")))throw new IOException("Update checksum mismatch.");int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;PackageManager pm=c.getPackageManager();PackageInfo remote=pm.getPackageArchiveInfo(apk.getPath(),flags),installed=pm.getPackageInfo(c.getPackageName(),flags);if(remote==null||!c.getPackageName().equals(remote.packageName)||remote.versionCode!=r.getInt("versionCode")||remote.versionCode<=installed.versionCode)throw new IOException("Unexpected app update.");android.content.pm.Signature[] a=signatures(remote),b=signatures(installed);if(a==null||b==null||a.length!=1||b.length!=1||!Arrays.equals(a[0].toByteArray(),b[0].toByteArray()))throw new IOException("Update signing certificate differs.");}
 // Recheck at each install boundary; the pending outbox exists only for this process.
 private static boolean installationBlocked(Context c){
  if(scanActive){message="Close the scanner before installing.";return true;}
  try{if(GateRuntime.get(c).db.pendingCount()!=0){message="Wait for unconfirmed entries before installing. Keep this app open and connected.";return true;}}
  catch(Exception e){message="Could not check unconfirmed entries. Keep this app open and retry before installing.";return true;}
  return false;
 }
 private static boolean launchConfirmation(Context c,Activity activity)throws Exception{
  GateDb db=GateRuntime.get(c).db;
  synchronized(db){
   if(db.updateSession()<0||!db.isUpdateSession(confirmationSession)||installationBlocked(c)||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus()||confirmation==null)return false;
   Intent next=confirmation;activity.startActivity(new Intent(next));message="Confirm the update in Android to finish.";return true;
  }
 }
 private static IntentSender installerResult(Context c,int id){
  Intent callback=new Intent(c,UpdateReceiver.class);int flags=PendingIntent.FLAG_UPDATE_CURRENT|(Build.VERSION.SDK_INT>=31?PendingIntent.FLAG_MUTABLE:0);
  return PendingIntent.getBroadcast(c,id,callback,flags).getIntentSender();
 }
 private static void recoverInstallation(Context c,GateDb db,int id){
  work.execute(()->{
   try{
    synchronized(db){
     if(installationBlocked(c)||!db.isUpdateSession(id))return;
     PackageInstaller pi=c.getPackageManager().getPackageInstaller();PackageInstaller.SessionInfo info=pi.getSessionInfo(id);
     if(info==null){db.updateSession();message="Installation has finished. Tap Install update to check again.";return;}
     // Old Android releases cannot safely recommit a session already handed to PackageManager.
     // Cancel the interrupted attempt, and retain its fence until Android proves it is gone.
     pi.abandonSession(id);
     message=db.updateSession()<0?"Interrupted update cleared. Tap Install update to retry.":"Android is still finishing the previous update. Finish or cancel it before scanning.";
    }
   }catch(Exception e){message="Finish or cancel the current Android app update before scanning. Tap Install update to retry confirmation.";}
   finally{publish(c);}
  });
 }
 public static void install(Activity activity){
  final Context c=activity.getApplicationContext();installerActivity=new java.lang.ref.WeakReference<>(activity);
  if(installationBlocked(c)){publish(c);return;}
  try{
   GateDb activeDb=GateRuntime.get(c).db;int activeSession=activeDb.updateSession();
   if(confirmation!=null&&activeDb.isUpdateSession(confirmationSession)){launchConfirmation(c,activity);publish(c);return;}
   confirmation=null;confirmationSession=-1;
   if(activeSession>=0){
    if(activeDb.isRecoveredUpdateSession(activeSession))recoverInstallation(c,activeDb,activeSession);
    else{message="Finish or cancel the current Android app update before starting another.";publish(c);}
    return;
   }
   if(!status(c).optBoolean("ready"))throw new IOException();
   if(Build.VERSION.SDK_INT>=26&&!c.getPackageManager().canRequestPackageInstalls()){
    new AlertDialog.Builder(activity).setTitle("Allow Navrang Gate updates").setMessage("Allow this app to install its signed updates, then return and tap Install update.").setNegativeButton("Later",null).setPositiveButton("Open Android settings",(d,w)->activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,android.net.Uri.parse("package:"+c.getPackageName())))).show();return;
   }
   message="Verifying update…";publish(c);
   work.execute(()->{
    PackageInstaller.Session session=null;GateDb installDb=null;int id=-1;
    try{
     JSONObject r=release(c);verify(c,file(c),r);PackageInstaller pi=c.getPackageManager().getPackageInstaller();
     PackageInstaller.SessionParams p=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);p.setAppPackageName(c.getPackageName());p.setSize(file(c).length());if(Build.VERSION.SDK_INT>=31)p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
     id=pi.createSession(p);session=pi.openSession(id);
     try(InputStream in=new FileInputStream(file(c));OutputStream out=session.openWrite("Navrang.apk",0,file(c).length())){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)out.write(b,0,n);session.fsync(out);}
     GateDb db=GateRuntime.get(c).db;installDb=db;
     synchronized(db){
      // queue() uses this same lock, so a request cannot appear between this check and commit.
      if(installationBlocked(c)){session.abandon();return;}
      // Keep admissions fenced after releasing this lock: Android may replace the process later.
      if(!db.pauseForUpdate(id)){message="Finish or cancel the current Android app update before starting another.";session.abandon();return;}
      session.commit(installerResult(c,id));
     }
     message="Confirm the update in Android to finish.";
    }catch(Exception e){
     message="Could not install this update. Retry from your account.";
     if(session!=null)try{session.abandon();}catch(Exception ignored){}
     // Some Android versions cannot abandon an install already handed to PackageManager.
     // Reconcile actual absence; never release the fence merely because abandon() returned.
     if(installDb!=null)try{installDb.updateSession();}catch(Exception ignored){}
    }
    finally{if(session!=null)session.close();publish(c);}
   });
  }catch(GateDb.UpdateInProgressException e){message="Could not check the Android app update. Finish or cancel it before scanning.";publish(c);}
  catch(Exception e){message="No verified update is ready yet.";publish(c);}
 }
 public static void installationResult(Context c,Intent intent){
  int state=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,Integer.MIN_VALUE),id=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
  if(state!=PackageInstaller.STATUS_PENDING_USER_ACTION&&state<0)return;
  try{
   GateDb db=GateRuntime.get(c).db;
   synchronized(db){
    // A delayed result from an older session cannot release a newer admission fence.
    if(!db.isUpdateSession(id))return;
    if(state!=PackageInstaller.STATUS_PENDING_USER_ACTION)db.resumeAfterUpdate(id);
   }
  }catch(Exception e){message="Could not check the Android app update. Finish or cancel it before scanning.";publish(c);return;}
  if(state==PackageInstaller.STATUS_PENDING_USER_ACTION){
   confirmationSession=id;confirmation=intent.getParcelableExtra(Intent.EXTRA_INTENT);message="Tap Install update to open Android confirmation.";
   final Activity foreground=installerActivity.get();
   if(foreground!=null&&!foreground.isFinishing()&&!foreground.isDestroyed()&&foreground.hasWindowFocus()&&confirmation!=null){
    ui.post(()->{try{if(!launchConfirmation(c,foreground))notifyReady(c,true);}catch(Exception e){notifyReady(c,true);}finally{publish(c);}});
   }else notifyReady(c,true);
  }else{
   if(id==confirmationSession){confirmation=null;confirmationSession=-1;}
   message=state==PackageInstaller.STATUS_SUCCESS?"Update installed. Reopen Navrang Gate.":"Installation was not completed. Confirmed entries remain safely on the server.";
  }
  publish(c);
 }
 private static void notifyReady(Context c){notifyReady(c,false);}
 private static void notifyReady(Context c,boolean confirm){try{NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(!nm.areNotificationsEnabled())return;JSONObject r=release(c);if(!confirm&&prefs(c).getInt("notified",0)==r.optInt("versionCode"))return;if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel(CHANNEL,"Navrang app updates",NotificationManager.IMPORTANCE_DEFAULT));Intent open=new Intent(c,MainActivity.class);open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);PendingIntent tap=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CHANNEL):new Notification.Builder(c);b.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Navrang Gate "+r.optString("versionName")+" is ready").setContentText("Tap to install the verified update when your station is idle.").setContentIntent(tap).setAutoCancel(true);nm.notify(NOTICE,b.build());prefs(c).edit().putInt("notified",r.optInt("versionCode")).apply();}catch(Exception ignored){}}
}
