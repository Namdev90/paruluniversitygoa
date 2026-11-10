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
 public static volatile boolean scanActive=false;private static volatile boolean downloading=false;private static volatile int progress=0;private static volatile String message="",installationMessage="";private static volatile Intent confirmation;private static volatile int confirmationSession=-1;private static java.lang.ref.WeakReference<Activity> installerActivity=new java.lang.ref.WeakReference<>(null);
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences("navrang-updates",0);}
 public static void add(Listener l){listeners.addIfAbsent(l);}public static void remove(Listener l){listeners.remove(l);}
 public static int current(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionCode;}catch(Exception e){return 0;}}
 public static String version(Context c){try{return c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionName;}catch(Exception e){return "0.4.0";}}
 private static File file(Context c){return new File(c.getFilesDir(),"navrang-update.apk");}
 private static JSONObject release(Context c){try{return new JSONObject(prefs(c).getString("release","{}"));}catch(Exception e){return new JSONObject();}}
 // Release policy is fixed on, including upgrades that saved the old opt-out.
 // Check identity here as well as in UI hosts: Android can start a persisted job directly.
 public static boolean automatic(Context c){return UpdatePolicy.APP_ID.equals(c.getPackageName())&&(c.getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)==0;}
 private static void pendingInstallationMessage(String value){message="";installationMessage=value;}
 public static JSONObject status(Context c){if(!automatic(c)){try{return new JSONObject().put("currentVersion",version(c)).put("automatic",false).put("available",false).put("ready",false).put("installing",false).put("notifications",true).put("message","Updates are disabled in the internal build.");}catch(Exception e){return new JSONObject();}}int installing;try{installing=GateRuntime.get(c).db.updateSession()<0?0:1;}catch(Exception e){installing=-1;}if(installing==0)installationMessage="";JSONObject r=release(c);boolean available=r.optInt("versionCode")>current(c),ready=available&&prefs(c).getInt("readyCode",0)==r.optInt("versionCode")&&file(c).isFile();try{return new JSONObject().put("currentVersion",version(c)).put("available",available).put("ready",ready).put("installing",installing!=0).put("versionName",r.optString("versionName")).put("downloading",downloading).put("progress",progress).put("automatic",automatic(c)).put("notifications",((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled()).put("message",message.isEmpty()?(installing>0&&!installationMessage.isEmpty()?installationMessage:installing<0?"Could not check Android installation. Tap Finish app update before scanning.":installing>0?"An Android app update is unfinished. Tap Finish app update to resume or safely clear it before scanning.":ready?"Update ready. Install when your station is idle.":available?"A new version is available.":"Your app is up to date."):message);}catch(Exception e){return new JSONObject();}}
 public static void publish(Context c){JSONObject state=status(c);ui.post(()->{for(Listener l:listeners)l.updated(state);});}
 public static void init(Context c){prefs(c).edit().putBoolean("automatic",automatic(c)).apply();schedule(c);if(automatic(c))check(c,false,false);}
 // Retain compatibility with older hosts without letting a stale toggle disable release checks.
 public static void setAutomatic(Context c,boolean ignored){init(c);publish(c);}
 // Android may defer this persisted job for Doze, network and system health.
 // Five-minute admin checks run only through the existing foreground runtime.
 private static void schedule(Context c){try{JobScheduler jobs=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);if(!automatic(c)){jobs.cancel(JOB);return;}JobInfo job=new JobInfo.Builder(JOB,new ComponentName(c,UpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(UpdateCheckPolicy.ORDINARY_MS,5*60*1000L).setPersisted(true).build();jobs.schedule(job);}catch(Exception ignored){}}
 private static boolean activeAdmin(Context c){try{return GateRuntime.get(c).foregroundAdministrator();}catch(Exception unavailable){return false;}}
 /** Shared persisted throttle for Activity, job, manual and push entry points. */
 private static synchronized int claim(Context c,boolean manual,boolean download){
  if(!automatic(c)||scanActive||running.get())return 0;
  SharedPreferences p=prefs(c);long now=System.currentTimeMillis(),attempt=p.getLong("attempt",p.getLong("checked",0));
  long checked=p.getLong("checked",0),retry=p.getLong("retry",0);
  SharedPreferences.Editor state=p.edit();
  // A changed wall clock must neither loop nor retain a far-future throttle.
  if(attempt>now){attempt=now;state.putLong("attempt",now);}
  if(checked>now){checked=now;state.putLong("checked",now);}
  if(retry>now+UpdateCheckPolicy.ORDINARY_MS){retry=now+UpdateCheckPolicy.ORDINARY_MS;state.putLong("retry",retry);}
  JSONObject cached=release(c);boolean admin=activeAdmin(c),fresh=false;
  if(download)try{validateMetadata(c,cached);fresh=checked>0&&now-checked<UpdateCheckPolicy.interval(admin,admin);}catch(Exception invalid){}
  boolean metadata=!(download&&fresh);
  boolean hint=p.getInt("hintCode",0)>cached.optInt("versionCode");
  if(metadata&&!UpdateCheckPolicy.due(now,attempt,retry,admin,admin,manual,hint)){state.apply();return 0;}
  long lastDownload=p.getLong("downloadAttempt",0);
  if(download&&(now<retry||lastDownload>0&&now-lastDownload<UpdateCheckPolicy.MINIMUM_MS)){state.apply();return 0;}
  if(!running.compareAndSet(false,true))return 0;
  if(metadata)state.putLong("attempt",now);
  if(download)state.putLong("downloadAttempt",now);
  if(!state.commit()){running.set(false);message="Could not save the update check. Retry later.";return 0;}
  return metadata?1:2;
 }
 private static void failed(Context c){SharedPreferences p=prefs(c);int failures=Math.min(12,p.getInt("failures",0)+1);p.edit().putInt("failures",failures).putLong("retry",System.currentTimeMillis()+UpdateCheckPolicy.backoff(failures,java.util.concurrent.ThreadLocalRandom.current().nextLong())).apply();}
 public static void check(Context context,boolean force,boolean download){final Context c=context.getApplicationContext();int plan=claim(c,force,download);if(plan==0){if(force)publish(c);return;}work.execute(()->{try{perform(c,download,plan==1);}catch(Exception e){failed(c);message="Update check interrupted. Your current app keeps working.";}finally{running.set(false);downloading=false;publish(c);}});}
 public static void background(Context c){int plan=claim(c,false,false);if(plan==0)return;try{perform(c,false,true);}catch(Exception e){failed(c);message="Update check will retry when connected.";}finally{running.set(false);downloading=false;publish(c);}}
 /** A hint is not release authority and never starts an APK download. */
 public static void invalidate(Context c,int versionCode){if(versionCode<=current(c)||versionCode<=release(c).optInt("versionCode"))return;synchronized(GateUpdater.class){SharedPreferences p=prefs(c);if(versionCode>p.getInt("hintCode",0))p.edit().putInt("hintCode",versionCode).apply();}check(c,false,false);}
 private static HttpURLConnection connection(String url)throws Exception{HttpURLConnection h=(HttpURLConnection)new URL(url).openConnection();h.setInstanceFollowRedirects(false);h.setConnectTimeout(7000);h.setReadTimeout(20000);h.setRequestProperty("Cache-Control","no-cache");h.setRequestProperty("Accept","application/octet-stream, application/json");return h;}
 private static HttpURLConnection connect(String url)throws Exception{HttpURLConnection h=connection(url);if(h.getResponseCode()!=200){h.disconnect();throw new IOException("Update unavailable.");}return h;}
 private static void validate(JSONObject r)throws Exception{if(!UpdatePolicy.APP_ID.equals(r.optString("packageName")))throw new IOException("Wrong app.");UpdatePolicy.validate(r.getInt("versionCode"),r.getString("versionName"),r.getString("apkUrl"),r.getLong("size"),r.getString("sha256"));}
 private static void validateMetadata(Context c,JSONObject r)throws Exception{
  validate(r);String proof=r.optString("signature");if(!proof.matches("[A-Za-z0-9+/]{40,3000}={0,2}"))throw new IOException("Release metadata signature missing.");
  int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
  android.content.pm.Signature[] installed=signatures(c.getPackageManager().getPackageInfo(c.getPackageName(),flags));
  if(installed==null||installed.length!=1||!UpdatePolicy.authentic(installed[0].toByteArray(),r.getInt("versionCode"),r.getString("versionName"),r.getString("apkUrl"),r.getLong("size"),r.getString("sha256"),android.util.Base64.decode(proof,android.util.Base64.DEFAULT)))throw new IOException("Release metadata signature differs from the installed app.");
 }
 /** Each self-contained APK has its own original-key proof. Never trust routing labels alone. */
 private static JSONObject selectArtifact(Context c,JSONObject channel)throws Exception{
  validateMetadata(c,channel);
  UpdatePolicy.validateArtifact(channel.getInt("versionCode"),channel.getString("versionName"),channel.getString("apkUrl"),channel.getLong("size"),channel.getString("sha256"),null);
  JSONObject artifacts=channel.optJSONObject("artifacts");if(artifacts==null)return channel;
  java.util.Set<String> available=new java.util.HashSet<>();for(String abi:UpdatePolicy.ABIS)if(artifacts.optJSONObject(abi)!=null)available.add(abi);
  String abi=UpdatePolicy.preferredAbi(Build.SUPPORTED_ABIS,available);if(abi==null)return channel;
  JSONObject selected=artifacts.getJSONObject(abi);validateMetadata(c,selected);
  if(selected.getInt("versionCode")!=channel.getInt("versionCode")||!selected.getString("versionName").equals(channel.getString("versionName")))throw new IOException("APK release differs from its channel.");
  UpdatePolicy.validateArtifact(selected.getInt("versionCode"),selected.getString("versionName"),selected.getString("apkUrl"),selected.getLong("size"),selected.getString("sha256"),abi);
  return selected;
 }
 private static void perform(Context c,boolean requestedDownload,boolean fetchMetadata)throws Exception{
  JSONObject r=release(c);HttpURLConnection h;
  if(fetchMetadata){
   h=connection(UpdatePolicy.MANIFEST);String etag=prefs(c).getString("etag","");if(etag.matches("[\\x21-\\x7E]{1,200}"))h.setRequestProperty("If-None-Match",etag);
   try{int response=h.getResponseCode();if(response==200){try(InputStream in=h.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>32768)throw new IOException("Update metadata too large.");out.write(b,0,n);}r=selectArtifact(c,new JSONObject(out.toString("UTF-8")));}}else if(response!=304)throw new IOException("Update unavailable.");
    validateMetadata(c,r);JSONObject previous=release(c);if(previous.optInt("versionCode")>r.getInt("versionCode")){boolean trusted=false;try{validateMetadata(c,previous);trusted=true;}catch(Exception invalid){}if(trusted)throw new IOException("Older release metadata rejected.");}
    String received=h.getHeaderField("ETag");SharedPreferences p=prefs(c);SharedPreferences.Editor state=p.edit().putString("release",r.toString()).putLong("checked",System.currentTimeMillis());
    if(!previous.optString("sha256").equals(r.getString("sha256")))state.putInt("readyCode",0);
    if(response==200)state.putString("etag",received!=null&&received.matches("[\\x21-\\x7E]{1,200}")?received:"");
    if(p.getInt("hintCode",0)>r.getInt("versionCode")){int count=Math.min(12,p.getInt("failures",0)+1);state.putInt("failures",count).putLong("retry",System.currentTimeMillis()+UpdateCheckPolicy.backoff(count,System.nanoTime()));}
    else state.putInt("hintCode",0).putInt("failures",0).putLong("retry",0);
    state.apply();
   }finally{h.disconnect();}
  }
  validateMetadata(c,r);message="";if(r.getInt("versionCode")<=current(c))return;
  if(status(c).optBoolean("ready")){notifyReady(c);return;}publish(c);if(!requestedDownload||scanActive)return;
  downloading=true;progress=0;message="Downloading app update…";publish(c);File part=new File(c.getFilesDir(),"navrang-update.part.apk");h=connect(r.getString("apkUrl"));
  try{long total=0,next=0;try(InputStream in=h.getInputStream();FileOutputStream out=new FileOutputStream(part)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1){if(scanActive)throw new IOException("Scanner has priority.");total+=n;if(total>r.getLong("size")||total>UpdatePolicy.MAX_APK)throw new IOException("Wrong update size.");out.write(b,0,n);progress=(int)(100*total/r.getLong("size"));if(System.currentTimeMillis()>next){publish(c);next=System.currentTimeMillis()+750;}}out.getFD().sync();}if(total!=r.getLong("size"))throw new IOException("Incomplete update.");verify(c,part,r);if(!part.renameTo(file(c)))throw new IOException("Could not save verified update.");prefs(c).edit().putInt("readyCode",r.getInt("versionCode")).apply();message="Update ready. Install when your station is idle.";notifyReady(c);}finally{h.disconnect();if(part.exists())part.delete();}
 }
 private static android.content.pm.Signature[] signatures(PackageInfo p){return Build.VERSION.SDK_INT>=28&&p.signingInfo!=null?p.signingInfo.getApkContentsSigners():p.signatures;}
 private static void verify(Context c,File apk,JSONObject r)throws Exception{validateMetadata(c,r);if(!UpdatePolicy.hash(apk).equals(r.getString("sha256")))throw new IOException("Update checksum mismatch.");int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;PackageManager pm=c.getPackageManager();PackageInfo remote=pm.getPackageArchiveInfo(apk.getPath(),flags),installed=pm.getPackageInfo(c.getPackageName(),flags);if(remote==null||!c.getPackageName().equals(remote.packageName)||remote.versionCode!=r.getInt("versionCode")||remote.versionCode<=installed.versionCode)throw new IOException("Unexpected app update.");android.content.pm.Signature[] a=signatures(remote),b=signatures(installed);if(a==null||b==null||a.length!=1||b.length!=1||!Arrays.equals(a[0].toByteArray(),b[0].toByteArray()))throw new IOException("Update signing certificate differs.");}
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
   Intent next=confirmation;activity.startActivity(new Intent(next));pendingInstallationMessage("Confirm the update in Android to finish.");return true;
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
     if(db.updateSession()<0)message="Interrupted update cleared. Tap Install update to retry.";else pendingInstallationMessage("Android is still finishing the previous update. Finish or cancel it before scanning.");
    }
   }catch(Exception e){pendingInstallationMessage("Finish or cancel the current Android app update before scanning. Tap Install update to retry confirmation.");}
   finally{publish(c);}
  });
 }
 public static void install(Activity activity){
  final Context c=activity.getApplicationContext();if(!automatic(c)){publish(c);return;}installerActivity=new java.lang.ref.WeakReference<>(activity);
  if(installationBlocked(c)){publish(c);return;}
  try{
   GateDb activeDb=GateRuntime.get(c).db;int activeSession=activeDb.updateSession();
   if(confirmation!=null&&activeDb.isUpdateSession(confirmationSession)){launchConfirmation(c,activity);publish(c);return;}
   confirmation=null;confirmationSession=-1;
   if(activeSession>=0){
    if(activeDb.isRecoveredUpdateSession(activeSession))recoverInstallation(c,activeDb,activeSession);
    else{pendingInstallationMessage("Finish or cancel the current Android app update before starting another.");publish(c);}
    return;
   }
   if(!status(c).optBoolean("ready"))throw new IOException();
   if(Build.VERSION.SDK_INT>=26&&!c.getPackageManager().canRequestPackageInstalls()){
    new AlertDialog.Builder(activity).setTitle("Allow Navrang Gate updates").setMessage("Allow this app to install its signed updates, then return and tap Install update.").setNegativeButton("Later",null).setPositiveButton("Open Android settings",(d,w)->activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,android.net.Uri.parse("package:"+c.getPackageName())))).show();return;
   }
   message="Verifying update…";publish(c);
   work.execute(()->{
    PackageInstaller.Session session=null;PackageInstaller pi=null;GateDb installDb=null;int id=-1;
    try{
     JSONObject r=release(c);verify(c,file(c),r);installDb=GateRuntime.get(c).db;pi=c.getPackageManager().getPackageInstaller();
     PackageInstaller.SessionParams p=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);p.setAppPackageName(c.getPackageName());p.setSize(file(c).length());if(Build.VERSION.SDK_INT>=31)p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
     id=pi.createSession(p);session=pi.openSession(id);
     try(InputStream in=new FileInputStream(file(c));OutputStream out=session.openWrite("Navrang.apk",0,file(c).length())){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)out.write(b,0,n);session.fsync(out);}
     GateDb db=installDb;
     synchronized(db){
      // queue() uses this same lock, so a request cannot appear between this check and commit.
      if(installationBlocked(c)){session.abandon();return;}
      // Keep admissions fenced after releasing this lock: Android may replace the process later.
      if(!db.pauseForUpdate(id)){pendingInstallationMessage("Finish or cancel the current Android app update before starting another.");session.abandon();return;}
      session.commit(installerResult(c,id));
     }
     pendingInstallationMessage("Confirm the update in Android to finish.");
    }catch(Exception e){
     message="Could not install this update. Retry from your account.";
     // createSession() can succeed even when storage failure prevents opening a handle.
     if(installDb!=null)installDb.recoverInterruptedUpdate(id);
     if(pi!=null&&id>=0)try{pi.abandonSession(id);}catch(Exception ignored){}
     // Some Android versions cannot abandon an install already handed to PackageManager.
     // Reconcile actual absence; never release the fence merely because abandon() returned.
     if(installDb!=null)try{installDb.updateSession();}catch(Exception ignored){}
    }
    finally{if(session!=null)session.close();publish(c);}
   });
  }catch(GateDb.UpdateInProgressException e){pendingInstallationMessage("Could not check the Android app update. Finish or cancel it before scanning.");publish(c);}
  catch(Exception e){message="No verified update is ready yet.";publish(c);}
 }
 public static void installationResult(Context c,Intent intent){
  if(!automatic(c))return;
  int state=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,Integer.MIN_VALUE),id=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);
  if(state!=PackageInstaller.STATUS_PENDING_USER_ACTION&&state<0)return;
  try{
   GateDb db=GateRuntime.get(c).db;
   synchronized(db){
    // A delayed result from an older session cannot release a newer admission fence.
    boolean tracked=db.isUpdateSession(id);
    // A status refresh may already have removed a completed session before its broadcast arrives.
    if(!tracked&&(id<0||state==PackageInstaller.STATUS_PENDING_USER_ACTION||id!=confirmationSession))return;
    if(tracked&&state!=PackageInstaller.STATUS_PENDING_USER_ACTION)db.resumeAfterUpdate(id);
   }
  }catch(Exception e){pendingInstallationMessage("Could not check the Android app update. Finish or cancel it before scanning.");publish(c);return;}
  if(state==PackageInstaller.STATUS_PENDING_USER_ACTION){
   confirmationSession=id;confirmation=intent.getParcelableExtra(Intent.EXTRA_INTENT);pendingInstallationMessage("Tap Install update to open Android confirmation.");
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
 private static void notifyReady(Context c,boolean confirm){try{NotificationManager nm=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(!nm.areNotificationsEnabled())return;JSONObject r=release(c);if(!confirm&&prefs(c).getInt("notified",0)==r.optInt("versionCode"))return;if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(new NotificationChannel(CHANNEL,"Navrang app updates",NotificationManager.IMPORTANCE_DEFAULT));Intent open=new Intent(c,MainActivity.class);open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);PendingIntent tap=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(c,CHANNEL):new Notification.Builder(c);b.setSmallIcon(android.R.drawable.stat_sys_download_done).setContentTitle("Navrang Gate "+r.optString("versionName")+" is ready").setContentText("Install the verified update from Account → Settings when your station is idle.").setContentIntent(tap).setAutoCancel(true);nm.notify(NOTICE,b.build());prefs(c).edit().putInt("notified",r.optInt("versionCode")).apply();}catch(Exception ignored){}}
}
