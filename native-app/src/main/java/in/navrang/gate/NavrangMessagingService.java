package in.navrang.gate;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/** HTTP v1 data-only transport. No payload text is ever displayed or spoken. */
public final class NavrangMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String ignored) { if (BuildConfig.PUSH_ENABLED) PushReconcileJob.schedule(this); }
    @Override public void onMessageReceived(RemoteMessage message) {
        if (!BuildConfig.PUSH_ENABLED || message.getNotification() != null) return;
        long age = System.currentTimeMillis() - message.getSentTime();
        int releaseVersion=ReleaseHintPolicy.parse(message.getData());
        if(releaseVersion>0) {
            // This topic contains only already-public release version/hash.
            // Delayed/missed delivery is recovered by the persisted fallback.
            android.app.NotificationManager notices=getSystemService(android.app.NotificationManager.class);
            boolean permitted=notices!=null&&notices.areNotificationsEnabled()&&
                (android.os.Build.VERSION.SDK_INT<33||checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==android.content.pm.PackageManager.PERMISSION_GRANTED);
            if(permitted&&message.getSentTime()>0&&age>=-60000&&age<=3600000)
                GateUpdater.invalidate(this,releaseVersion);
            return;
        }
        if (message.getSentTime() <= 0 || age < -60000 || age > 60000) return;
        try { PushCoordinator.get(this).receive(message.getData()); } catch (Exception ignored) { }
    }
    @Override public void onDeletedMessages() {
        if (!BuildConfig.PUSH_ENABLED) return;
        try { GateRuntime.get(this).emit("push", new org.json.JSONObject()); PushReconcileJob.schedule(this); }
        catch (Exception ignored) { }
    }
}
