package in.navrang.gate;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** One process-wide owner. All HTTP work is serialized outside service callbacks/UI thread. */
public final class PushCoordinator implements GateRuntime.Listener {
    private static PushCoordinator instance;
    private static final String CHANNEL = "navrang-private-updates";
    private static final String TAG = "navrang-push-";
    // A process singleton may retain Application, never an Activity or Service.
    private final android.app.Application app;
    private final GateRuntime runtime;
    private final PushStore store;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Object lock = new Object();
    private boolean storageFailed;
    public interface Completion { void done(boolean retry); }
    public static synchronized PushCoordinator get(Context context) throws Exception {
        if (instance == null) instance = new PushCoordinator(context.getApplicationContext());
        return instance;
    }
    private PushCoordinator(Context context) throws Exception {
        app = (android.app.Application) context; runtime = GateRuntime.get(app); store = new PushStore(app); runtime.add(this);
    }
    private boolean enabled() { return BuildConfig.PUSH_ENABLED; }
    private boolean permission() {
        NotificationManager manager = app.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 33 && app.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
            if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return true;
    }
    static String hash(String value) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte b : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    private boolean current(JSONObject state) throws Exception {
        JSONObject auth = runtime.sessions.read();
        return auth != null && PushPolicy.current(state.optString("owner"), state.optLong("generation", -1),
            hash(PushPolicy.ownerMaterial(auth.optString("token"),auth.optString("refreshFamilyId"))), runtime.sessions.generation(), GateSession.canSync(auth));
    }
    private void save(JSONObject state) throws Exception {
        try { store.save(state); } catch (Exception failure) { storageFailed = true; throw failure; }
    }
    public void resume() {
        if (!enabled()) return;
        try {
            synchronized (lock) {
                JSONObject state = store.read();
                if (state.has("bindingId") && (!current(state) || !permission())) retire(state);
            }
            PushReconcileJob.schedule(app);
        } catch (Exception ignored) { storageFailed = true; cancelNotifications(); }
    }
    /** Called before local identity changes. The unlink proof survives offline logout/process death. */
    public void identityChanging() {
        if (!enabled()) return;
        try { synchronized (lock) { JSONObject state = store.read(); if (state.has("bindingId")) retire(state); } }
        catch (Exception ignored) { storageFailed = true; }
        cancelNotifications(); PushReconcileJob.schedule(app);
    }
    private void retire(JSONObject state) throws Exception {
        state.put("status", "retiring"); state.remove("pendingOpen"); state.remove("seen"); save(state); cancelNotifications();
    }
    @Override public void event(JSONObject event) {
        // GateRuntime may emit while holding its session monitor. Never acquire
        // the push lock synchronously there: receive() checks sessions under it.
        if ("auth".equals(event.optString("type")) || "profile".equals(event.optString("type"))) worker.execute(this::resume);
    }
    private boolean success(GateApi.Reply reply) { return reply.status == 200 && reply.body.optBoolean("ok"); }
    private boolean unlink(JSONObject state) throws Exception {
        String proof = state.optString("unlinkProof");
        if (!proof.matches("[a-f0-9]{64}")) return false; // Uncertain registration is never reported as unlinked.
        GateApi.Reply reply = runtime.api.call("notifications-unregister", new JSONObject()
            .put("installationId", state.getString("installationId")).put("bindingId", state.getString("bindingId"))
            .put("unlinkProof", proof).put("registrationRevision", state.getLong("registrationRevision")), "");
        return success(reply); // removed=false is idempotent: this exact proof/binding is already absent.
    }
    public void reconcile(java.util.function.BooleanSupplier cancelled, Completion completion) {
        worker.execute(() -> { boolean retry = false;
            try { if (enabled() && !storageFailed && !cancelled.getAsBoolean()) retry = reconcileOnce(cancelled); }
            catch (Exception ignored) { retry = true; }
            finally { completion.done(retry); }
        });
    }
    @SuppressWarnings("deprecation") // Existing server transport uses HTTP v1 registration tokens, not FIDs.
    private boolean reconcileOnce(java.util.function.BooleanSupplier cancelled) throws Exception {
        JSONObject state;
        synchronized (lock) {
            state = store.read();
            if (!state.has("installationId")) { state.put("installationId", UUID.randomUUID().toString()); save(state); }
            if (state.has("bindingId") && (!current(state) || !permission())) retire(state);
        }
        if (state.has("bindingId") && "retiring".equals(state.optString("status")) && state.has("unlinkProof")) {
            if (!unlink(state)) return true;
            synchronized (lock) { state = new JSONObject().put("installationId", state.getString("installationId")).put("registrationRevision", state.optLong("registrationRevision")); save(state); }
        }
        if (cancelled.getAsBoolean()) return true;
        JSONObject auth = runtime.sessions.read(); long generation = runtime.sessions.generation();
        if (!permission()) { removePublicReleaseTopic();return false; }
        if (!GateSession.canSync(auth)) return false;
        String token = auth.getString("token");
        long request = runtime.sessions.beginProfileRequest();
        GateApi.Reply me = runtime.api.call("me", new JSONObject(), token);
        if(!me.sessionToken.isEmpty())token=me.sessionToken;
        if (cancelled.getAsBoolean()) return true;
        if (!runtime.sessions.isCurrent(generation, token)) return true;
        if (me.status == 401 || me.status == 403 || success(me) && !me.body.optBoolean("active")) {
            identityChanging();
            if (me.status == 401 && runtime.sessions.clearIfCurrent(generation, token)) runtime.emit("auth", new JSONObject());
            else if (success(me)) {
                JSONObject inactive = new JSONObject(me.body.toString()); inactive.remove("ok");
                if (runtime.sessions.refreshIfCurrent(generation, token, request, inactive)) runtime.emit("profile", inactive);
            }
            return state.has("bindingId");
        }
        if (!success(me)) return true;
        JSONObject profile = new JSONObject(me.body.toString()); profile.remove("ok");
        if (!runtime.sessions.refreshIfCurrent(generation, token, request, profile)) return true;
        if (FirebaseApp.getApps(app).isEmpty() && FirebaseApp.initializeApp(app) == null) return false;
        FirebaseMessaging messaging = FirebaseMessaging.getInstance();
        messaging.setAutoInitEnabled(false); messaging.setDeliveryMetricsExportToBigQuery(false);
        Tasks.await(messaging.setNotificationDelegationEnabled(false), 15, TimeUnit.SECONDS);
        if (cancelled.getAsBoolean()) return true;
        String provider = Tasks.await(messaging.getToken(), 15, TimeUnit.SECONDS);
        if (cancelled.getAsBoolean()) return true;
        if (provider == null || !provider.matches("[A-Za-z0-9:_=-]{1,4096}")) return false;
        String providerHash = hash(provider);
        // One subscription per actual device token, separate from all private
        // event delivery. This public topic cannot contain staff/location data.
        boolean releaseRetry=false;
        android.content.SharedPreferences releases=app.getSharedPreferences("navrang-release-hints",0);
        if(!providerHash.equals(releases.getString("subscribedTokenHash","")))try {
            if(cancelled.getAsBoolean()||!runtime.sessions.isCurrent(generation,token)||!permission())return true;
            if(!releases.edit().putString("pendingTokenHash",providerHash).commit())throw new IllegalStateException("Could not save public subscription intent.");
            Tasks.await(messaging.subscribeToTopic(ReleaseHintPolicy.TOPIC),15,TimeUnit.SECONDS);
            if(!releases.edit().putString("subscribedTokenHash",providerHash).remove("pendingTokenHash").commit())releaseRetry=true;
        }catch(Exception unavailable){releaseRetry=true;}
        synchronized (lock) {
            if (!runtime.sessions.isCurrent(generation, token) || !permission()) return true;
            state = store.read();
            if ("active".equals(state.optString("status")) && current(state) && providerHash.equals(state.optString("providerHash")) &&
                System.currentTimeMillis() - state.optLong("registeredAt") < TimeUnit.DAYS.toMillis(1)) return releaseRetry;
        }
        // Unknown responses retry EXACTLY the same durable revision/binding/proof.
        boolean retryPending = "pending".equals(state.optString("status")) && current(state) && providerHash.equals(state.optString("providerHash"));
        if (!retryPending && state.has("unlinkProof")) {
            synchronized (lock) { retire(state); }
            if (!unlink(state)) return true;
        }
        if (cancelled.getAsBoolean()) return true;
        long nextRevision = state.optLong("registrationRevision") + 1;
        if (!retryPending && (nextRevision < 1 || nextRevision > PushPolicy.MAX_REVISION)) return false;
        JSONObject pending = retryPending ? state : new JSONObject().put("installationId", state.getString("installationId"))
            .put("bindingId", UUID.randomUUID().toString()).put("owner", hash(PushPolicy.ownerMaterial(token,auth.optString("refreshFamilyId")))).put("generation", generation)
            .put("providerHash", providerHash).put("status", "pending").put("registrationRevision", nextRevision)
            .put("unlinkProof", newProof());
        synchronized (lock) {
            if (cancelled.getAsBoolean() || !runtime.sessions.isCurrent(generation, token) || !permission()) return true;
            save(pending); // Must exist durably before the registration might reach the server.
        }
        GateApi.Reply registered = runtime.api.call("notifications-device", new JSONObject()
            .put("installationId", pending.getString("installationId")).put("bindingId", pending.getString("bindingId"))
            .put("registrationRevision", pending.getLong("registrationRevision")).put("unlinkProof", pending.getString("unlinkProof"))
            .put("providerTarget", new JSONObject().put("type", "legacyToken").put("value", provider)), token);
        if (registered.status == 409) { synchronized (lock) { retire(pending); } return true; }
        if (!success(registered) || !registered.body.optBoolean("registered") ||
            !pending.getString("bindingId").equals(registered.body.optString("bindingId")) ||
            pending.getLong("registrationRevision") != registered.body.optLong("registrationRevision") ||
            !pending.getString("unlinkProof").equals(registered.body.optString("unlinkProof"))) return true;
        synchronized (lock) {
            JSONObject persisted = store.read();
            boolean active = !cancelled.getAsBoolean() && current(pending) && permission() && "pending".equals(persisted.optString("status")) &&
                pending.getString("bindingId").equals(persisted.optString("bindingId"));
            pending.put("unlinkProof", registered.body.getString("unlinkProof")).put("registeredAt", System.currentTimeMillis())
                .put("status", active ? "active" : "retiring");
            save(pending);
            return !active||releaseRetry;
        }
    }
    private void removePublicReleaseTopic() throws Exception {
        android.content.SharedPreferences saved=app.getSharedPreferences("navrang-release-hints",0);
        if(saved.getString("subscribedTokenHash","").isEmpty()&&saved.getString("pendingTokenHash","").isEmpty())return;
        if(FirebaseApp.getApps(app).isEmpty()&&FirebaseApp.initializeApp(app)==null)throw new IllegalStateException("Public subscription unavailable.");
        Tasks.await(FirebaseMessaging.getInstance().unsubscribeFromTopic(ReleaseHintPolicy.TOPIC),15,TimeUnit.SECONDS);
        if(!saved.edit().remove("subscribedTokenHash").remove("pendingTokenHash").commit())throw new IllegalStateException("Could not save subscription removal.");
    }
    private static String newProof() {
        byte[] bytes = new byte[32]; new java.security.SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder();
        for (byte b : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return value.toString();
    }
    public void receive(Map<String, String> data) {
        if (!enabled() || storageFailed || !permission()) return;
        PushPolicy.Envelope envelope = PushPolicy.parse(data); if (envelope == null) return;
        try { synchronized (lock) {
            JSONObject state = store.read();
            if (!"active".equals(state.optString("status")) || !current(state) || !envelope.bindingId.equals(state.optString("bindingId"))) return;
            JSONArray retained = state.optJSONArray("lastPrunedIds"); boolean retainedByFeed = false;
            if (retained != null) for (int i = 0; i < retained.length(); i++)
                if ((TAG + envelope.eventId).equals(retained.optString(i))) retainedByFeed = true;
            if (!PushPolicy.canReceive(envelope, state.optLong("lastPrunedRevision", -1), retainedByFeed)) return;
            Map<String, Long> history = PushPolicy.history(); JSONObject seen = state.optJSONObject("seen");
            if (seen != null) { java.util.Iterator<String> keys = seen.keys(); while (keys.hasNext()) { String key = keys.next(); history.put(key, seen.optLong(key)); } }
            if (!PushPolicy.claim(history, envelope)) return;
            state.put("seen", new JSONObject(history));
            state.put("lastReceivedRevision", Math.max(state.optLong("lastReceivedRevision", -1), envelope.revision)); save(state);
            // A validated private hint only dirties an authorized foreground read;
            // it never performs a background fetch, unlock or permission change.
            runtime.invalidate(envelope.domain);
            NotificationManager manager = app.getSystemService(NotificationManager.class);
            if (manager != null) {
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(CHANNEL, "Private updates", NotificationManager.IMPORTANCE_DEFAULT);
                channel.setLockscreenVisibility(Notification.VISIBILITY_SECRET); manager.createNotificationChannel(channel);
            }
            Intent intent = new Intent(app, PushOpenActivity.class).setData(Uri.parse("navrang-push://" + envelope.bindingId + "/" + envelope.eventId))
                .putExtra("eventId", envelope.eventId).putExtra("bindingId", envelope.bindingId).putExtra("revision", Long.toString(envelope.revision));
            PendingIntent open = PendingIntent.getActivity(app, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(app, CHANNEL) : new Notification.Builder(app);
            Notification notification = builder.setSmallIcon(R.drawable.ic_push_notification).setContentTitle("Navrang update")
                .setContentText("Open Navrang to view your current notifications.").setVisibility(Notification.VISIBILITY_SECRET)
                .setContentIntent(open).setAutoCancel(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_STATUS).build();
            manager.notify(TAG + envelope.eventId, 1, notification);
            }
        }
        if(!envelope.domain.isEmpty())runtime.emit("data-invalidated",new JSONObject().put("domain",envelope.domain));
        runtime.emit("push", new JSONObject());
        } catch (Exception ignored) { /* Fail closed; never log transport data or private state. */ }
    }
    /** Called only by a non-exported PendingIntent target; no URL or supplied destination is used. */
    public void requestOpen(Map<String, String> data) {
        if (!enabled() || storageFailed) return;
        PushPolicy.Envelope envelope = PushPolicy.parse(data); if (envelope == null) return;
        try { synchronized (lock) {
            JSONObject state = store.read();
            if (!"active".equals(state.optString("status")) || !current(state) || !envelope.bindingId.equals(state.optString("bindingId"))) return;
            state.put("pendingOpen", new JSONObject().put("id", envelope.eventId).put("at", System.currentTimeMillis())); save(state);
        } } catch (Exception ignored) { }
    }
    /** A ready WebView receives an ID only after fresh server authorization. The UI rechecks too. */
    public void openWhenReady() {
        if (!enabled() || storageFailed) return;
        worker.execute(() -> { try {
            JSONObject state, pending;
            synchronized (lock) {
                state = store.read(); pending = state.optJSONObject("pendingOpen");
                if (pending == null) return;
                state.remove("pendingOpen"); save(state);
                if (!current(state) || System.currentTimeMillis() - pending.optLong("at") > TimeUnit.MINUTES.toMillis(5)) return;
            }
            JSONObject auth = runtime.sessions.read(); if (auth == null) return;
            String token = auth.getString("token"); long generation = runtime.sessions.generation();
            GateApi.Reply me = runtime.api.call("me", new JSONObject(), token);
            if (!success(me) || !me.body.optBoolean("active") || !runtime.sessions.isCurrent(generation, token)) return;
            GateApi.Reply feed = runtime.api.call("notifications-feed", new JSONObject().put("afterRevision", 0), token);
            if (!success(feed) || !runtime.sessions.isCurrent(generation, token)) return;
            JSONArray items = feed.body.optJSONArray("items"); boolean found = false;
            if (items != null) for (int i = 0; i < items.length(); i++) if (pending.getString("id").equals(items.getJSONObject(i).optString("id"))) found = true;
            JSONObject dashboard = feed.body.optJSONObject("dashboard");
            JSONObject pinned = dashboard == null ? null : dashboard.optJSONObject("announcement");
            if (pinned != null && pending.getString("id").equals(pinned.optString("id"))) found = true;
            synchronized (lock) {
                if (found && current(state) && state.optString("bindingId").equals(store.read().optString("bindingId")))
                    runtime.emit("push-open", new JSONObject().put("id", pending.getString("id")));
            }
        } catch (Exception ignored) { /* A later manual refresh remains available; never replay cached content. */ } });
    }
    public void cancelNotifications() {
        NotificationManager manager = app.getSystemService(NotificationManager.class); if (manager == null) return;
        for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications())
            if (item.getTag() != null && item.getTag().startsWith(TAG)) manager.cancel(item.getTag(), item.getId());
    }
    public void pruneNotifications(JSONObject feed, long generation, String token) {
        if (!enabled() || storageFailed) return;
        try { synchronized (lock) {
            JSONObject state = store.read();
            if (!runtime.sessions.isCurrent(generation, token) || !current(state)) return;
            Object revisionValue = feed.opt("revision");
            long revision = revisionValue instanceof Number ? PushPolicy.revision(revisionValue.toString()) : -1;
            if (!PushPolicy.canPrune(revision, state.optLong("lastPrunedRevision", -1), state.optLong("lastReceivedRevision", -1))) return;
            JSONArray ids = feed.optJSONArray("activeIds"); if (ids == null || ids.length() > 5) return;
            java.util.Set<String> keep = new java.util.HashSet<>();
            for (int i = 0; i < ids.length(); i++) { String id = ids.getString(i); if (!PushPolicy.id(id)) return; keep.add(TAG + id); }
            JSONObject dashboard = feed.optJSONObject("dashboard");
            JSONObject pinned = dashboard == null ? null : dashboard.optJSONObject("announcement");
            if (pinned != null && PushPolicy.id(pinned.optString("id"))) keep.add(TAG + pinned.getString("id"));
            NotificationManager manager = app.getSystemService(NotificationManager.class); if (manager == null) return;
            // Receive uses the same lock, so a newer alert cannot appear between
            // this durable watermark and cancellation. The receive watermark is
            // independent of the bounded dedup map and survives its eviction.
            state.put("lastPrunedRevision", revision).put("lastPrunedIds", new JSONArray(keep)); save(state);
            for (android.service.notification.StatusBarNotification item : manager.getActiveNotifications())
                if (item.getTag() != null && item.getTag().startsWith(TAG) && !keep.contains(item.getTag())) manager.cancel(item.getTag(), item.getId());
        } } catch (Exception ignored) { }
    }
}
