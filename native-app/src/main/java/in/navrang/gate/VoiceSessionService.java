package in.navrang.gate;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import java.lang.ref.WeakReference;
import org.json.JSONObject;

/** One explicitly started, non-exported audio owner. Never restores a previous session. */
public class VoiceSessionService extends Service implements VoiceHost {
    static final String START="in.navrang.gate.voice.START", STOP="in.navrang.gate.voice.STOP";
    static final String USER_STARTED="userStarted";
    private static final String CHANNEL="navrang_voice";
    private static final int NOTIFICATION=731;
    private final LocalBinder binder=new LocalBinder();
    private WeakReference<Activity> activity=new WeakReference<>(null);
    private VoiceCoordinator coordinator;
    private AutoCloseable mediaOwner;
    private boolean uiActive,uiFocused,ongoing,closing;

    protected boolean enabled() { return BuildConfig.VOICE_ENABLED; }
    protected VoiceCoordinator createCoordinator() throws Exception {
        if(!enabled())throw new IllegalStateException("Voice is not enabled in this build.");
        GateRuntime runtime=GateRuntime.get(this);
        NativeRelayOwnerRuntime media=new NativeRelayOwnerRuntime(this,BuildConfig.RELAY_ORIGIN,
            BuildConfig.RELAY_REFERENCE_ADVANCE_PPM,true);
        mediaOwner=media;
        GateRelayAuthority authority=null;
        try {
            authority=GateRelayAuthority.forRuntime(runtime,BuildConfig.RELAY_ORIGIN,true,media);
            return new VoiceCoordinator(this,runtime,authority,media,true,this);
        } catch(Exception failure) {
            if(authority!=null)authority.close();closeMedia();throw failure;
        }
    }
    @Override public void onCreate() {
        super.onCreate();
        if(enabled())try { coordinator=createCoordinator(); } catch(Exception|LinkageError ignored) { closeMedia();stopSelf(); }
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        if(intent!=null&&STOP.equals(intent.getAction())) { closeSession(); return START_NOT_STICKY; }
        if(!enabled()||coordinator==null||intent==null||!START.equals(intent.getAction())||!intent.getBooleanExtra(USER_STARTED,false)) {
            closeSession(); return START_NOT_STICKY;
        }
        try { if(!new JSONObject(coordinator.command("status",null)).optBoolean("available")){closeSession();return START_NOT_STICKY;} }
        catch(Exception ignored){closeSession();return START_NOT_STICKY;}
        if(!foreground(false))closeSession();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return binder; }
    final class LocalBinder extends Binder {
        VoiceSessionService service() { return VoiceSessionService.this; }
    }
    void attach(Activity value,boolean focused) {
        activity=new WeakReference<>(value);uiActive=true;uiFocused=focused;
        if(coordinator!=null)coordinator.resume();
    }
    void background(Activity owner) {
        if(activity.get()!=owner)return;
        uiActive=false;uiFocused=false;activity.clear();
        if(coordinator!=null)coordinator.pause();
    }
    void focus(boolean value) {
        uiFocused=value;
        if(!value&&coordinator!=null)coordinator.windowFocusLost();
    }
    String command(String action,String payload) {
        if(coordinator==null)return VoiceSessionClient.UNAVAILABLE;
        if("press".equals(action)&&(!uiActive||!uiFocused))return coordinator.command("status",null);
        return coordinator.command(action,payload);
    }
    void permissionResult() { if(coordinator!=null)coordinator.permissionResult(); }
    void identityChanging() { if(coordinator!=null)coordinator.identityChanging(); }
    private Notification notification(String state) {
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26&&manager!=null) {
            NotificationChannel channel=new NotificationChannel(CHANNEL,"Voice session",NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Controls for an explicitly joined voice session");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);manager.createNotificationChannel(channel);
        }
        PendingIntent stop=PendingIntent.getService(this,731,new Intent(this,VoiceSessionService.class).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        PendingIntent open=PendingIntent.getActivity(this,732,new Intent(this,MainActivity.class),
            PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder builder=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        return builder.setSmallIcon(R.drawable.ic_push_notification).setContentTitle("Navrang voice")
            .setContentText(state).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setCategory(Notification.CATEGORY_SERVICE)
            .addAction(new Notification.Action.Builder(null,"Stop voice",stop).build()).build();
    }
    private boolean foreground(boolean microphone) {
        if(!enabled()||closing)return false;
        try {
            Notification notice=notification(microphone?"Talking — release Talk to stop":"Voice session active — microphone off");
            if(Build.VERSION.SDK_INT>=29) {
                int type=ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
                if(microphone&&Build.VERSION.SDK_INT>=30)type|=ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                startForeground(NOTIFICATION,notice,type);
            } else startForeground(NOTIFICATION,notice);
            ongoing=true;return true;
        } catch(Exception ignored) { ongoing=false;return false; }
    }
    @Override public boolean prepareReceiving() { return uiActive&&!closing&&(ongoing||foreground(false)); }
    @Override public boolean prepareTransmitting() {
        Activity owner=activity.get();
        return uiActive&&uiFocused&&owner!=null&&!owner.isFinishing()&&!owner.isDestroyed()&&
            checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED&&foreground(true);
    }
    @Override public boolean backgroundReceptionAllowed() { return ongoing&&!closing; }
    @Override public boolean requestMicrophonePermission() {
        Activity owner=activity.get();if(!uiActive||!uiFocused||owner==null||owner.isFinishing()||owner.isDestroyed())return false;
        owner.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},VoiceCoordinator.MICROPHONE_PERMISSION);return true;
    }
    @Override public void transmissionStopped() { if(ongoing&&!closing)foreground(false); }
    @Override public void statusChanged(JSONObject status) {
        if(!ongoing||closing)return;
        NotificationManager manager=getSystemService(NotificationManager.class);
        if(manager!=null)manager.notify(NOTIFICATION,notification(status.optBoolean("microphone")?
            "Talking — release Talk to stop":"Voice session active — microphone off"));
    }
    @Override public void stopped() {
        ongoing=false;stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();
    }
    private void closeSession() {
        if(closing)return;closing=true;
        if(coordinator!=null){coordinator.close();coordinator=null;}
        closeMedia();
        activity.clear();uiActive=false;uiFocused=false;stopped();
    }
    private void closeMedia() {
        AutoCloseable owner=mediaOwner;mediaOwner=null;
        if(owner!=null)try{owner.close();}catch(Exception ignored){}
    }
    @Override public void onTaskRemoved(Intent rootIntent) { closeSession();super.onTaskRemoved(rootIntent); }
    @Override public void onDestroy() { closeSession();super.onDestroy(); }
}
