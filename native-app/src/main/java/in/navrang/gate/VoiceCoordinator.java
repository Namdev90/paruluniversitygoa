package in.navrang.gate;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/** Serialized voice boundary; background reception requires a foreground-service host. */
public final class VoiceCoordinator implements GateRuntime.Listener {
    public static final int MICROPHONE_PERMISSION = 730;
    private final Context context;
    private final VoiceHost host;
    private final GateRuntime runtime;
    private final VoiceAuthority authority;
    private final VoiceMediaTransport media;
    private final VoiceSafetyState safety;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AudioManager audio;
    private final ConnectivityManager connectivity;
    private final boolean available;
    private final List<VoiceAuthority.Pending> pending = new ArrayList<>();
    private final java.util.concurrent.atomic.AtomicBoolean authorityInvalidated = new java.util.concurrent.atomic.AtomicBoolean(true);
    private VoiceAuthority.Identity identity;
    private VoiceAuthority.Join membership;
    private VoiceAuthority.Floor floor;
    private VoiceMediaTransport.Receiver receiver;
    private VoiceMediaTransport.Publisher publisher;
    private AudioFocusRequest focusRequest;
    private boolean focused, foreground, destroyed, registered, voiceIntent, permissionPending, microphoneEnabled, microphoneRequested;
    private long callbackEpoch, nextRenew, microphoneOperation;
    private boolean renewalPending;
    private long publisherRevision;
    private volatile String publicStatus = "{\"available\":false,\"ready\":false,\"state\":\"unavailable\",\"microphone\":false,\"canTalk\":false,\"message\":\"Voice is not available yet.\"}";
    private String message = "Voice is not available yet.";
    private final AudioManager.OnAudioFocusChangeListener focusListener = value -> {
        if (value != AudioManager.AUDIOFOCUS_GAIN) main.post(() -> stop("Audio focus changed. Join again when ready."));
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) { stop("Audio route changed. Join again when ready."); }
    };
    private final ConnectivityManager.NetworkCallback network = new ConnectivityManager.NetworkCallback() {
        @Override public void onLost(Network lost) { main.post(() -> stop("Connection changed. Join again when ready.")); }
    };
    private final Runnable pulse = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            try {
            refreshIdentity();
            VoiceSafetyState.Snapshot state = safety.snapshot(now());
            if (voiceIntent && !state.connected && !"joining".equals(state.state)) { stop("Voice authorization expired. Join again when ready."); return; }
            applyMicrophone();
            if (floor != null && state.leaseId.isEmpty()) releaseFloor();
            if (publisher != null && state.micAllowed && now() >= nextRenew && !renewalPending) renew();
            if (receiver != null && now() >= receiveUntil) closeReceiver();
            if (refreshPending && now() >= refreshUntil) { stop("Voice refresh timed out. Join again when ready."); return; }
            if (state.connected && authority.supportsRefresh() && !refreshPending && now() >= nextRefresh) refresh();
            publish();
            if (state.connected || "joining".equals(state.state)) main.postDelayed(this, 100);
            } catch (Exception ignored) { stop("Voice stopped after a device interruption."); }
        }
    };

    public VoiceCoordinator(Activity activity) throws Exception {
        this(activity, GateRuntime.get(activity), VoiceAuthority.unavailable(), VoiceMediaTransport.unavailable(), BuildConfig.VOICE_ENABLED);
    }
    VoiceCoordinator(Activity activity, GateRuntime runtime, VoiceAuthority authority, VoiceMediaTransport media, boolean buildEnabled) {
        this(activity, runtime, authority, media, buildEnabled, new VoiceHost() {
            public boolean prepareReceiving() { return true; }
            public boolean prepareTransmitting() { return true; }
            public boolean backgroundReceptionAllowed() { return false; }
            public boolean requestMicrophonePermission() {
                activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MICROPHONE_PERMISSION); return true;
            }
            public void transmissionStopped() {}
            public void statusChanged(JSONObject status) {}
            public void stopped() {}
        });
    }
    VoiceCoordinator(Context context, GateRuntime runtime, VoiceAuthority authority, VoiceMediaTransport media, boolean buildEnabled, VoiceHost host) {
        this.context = context.getApplicationContext(); this.host = host;
        this.runtime = runtime; this.authority = authority; this.media = media;
        available = buildEnabled && authority.configured() && media.configured();
        safety = new VoiceSafetyState(available);
        audio = context.getSystemService(AudioManager.class);
        connectivity = context.getSystemService(ConnectivityManager.class);
        runtime.add(this);
    }
    private static long now() { return SystemClock.elapsedRealtime(); }
    private long receiveUntil=-1,nextRefresh,receiveRevision,refreshUntil;
    private boolean refreshPending;
    private VoiceAuthority.Pending refreshRequest;
    private void post(Runnable action) { main.post(() -> { try { action.run(); } catch (Exception ignored) { stop("Voice stopped after a device interruption."); } }); }
    private static void cleanup(Runnable action) { try { action.run(); } catch (Exception ignored) { } }
    private boolean permission() { return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED; }
    private void environment() { safety.environment(foreground, host.backgroundReceptionAllowed(), permission(), focused, now()); }
    /** Conservative monotonic expiry. Wall-clock changes cannot extend authorization. */
    static long deadline(long serverTime, long expiresAt, long started, long finished, long maximum) {
        if (serverTime < 0 || expiresAt <= serverTime || finished < started || expiresAt - serverTime > maximum) return -1;
        long remaining = expiresAt - serverTime - (finished - started);
        return remaining <= 0 || finished > Long.MAX_VALUE - remaining ? -1 : finished + remaining;
    }
    private VoiceAuthority.Identity readIdentity() {
        try {
            JSONObject auth = runtime.sessions.read();
            if (!GateSession.canSync(auth)) return null;
            JSONObject p = auth.getJSONObject("profile");
            return new VoiceAuthority.Identity(auth.getString("token"), scope(p), runtime.sessions.generation(),auth.optString("refreshFamilyId"));
        } catch (Exception ignored) { return null; }
    }
    static String scope(JSONObject p) {
        if(p==null)return "";
        // Access expiry changes during routine renewal; the volunteer's access
        // deadline and every authorization grant remain part of the identity fence.
        return new org.json.JSONArray(java.util.Arrays.asList(p.optString("role"),p.optString("checkerId"),
            p.optBoolean("active"),p.optBoolean("scanner"),p.optBoolean("helpdesk"),p.optBoolean("reports"),
            p.optString("station"),p.optString("accessExpiresAt"),p.optBoolean("nameConfirmed",true))).toString();
    }
    private boolean same(VoiceAuthority.Identity value) {
        VoiceAuthority.Identity current = readIdentity();
        return value != null && value.samePrincipal(current);
    }
    private void refreshIdentity() {
        VoiceAuthority.Identity current = readIdentity();
        if (identity != null && !same(identity)) stop("Sign-in or staff access changed. Join again when ready.");
        identity = current;
        safety.identity(current == null ? "" : current.scope, current == null ? -1 : current.generation, current != null, now());
        environment();
    }
    public String command(String action, String value) {
        try {
            JSONObject p = value == null || value.isEmpty() ? new JSONObject() : new JSONObject(value);
            if (p.length() > ("join".equals(action) ? 1 : 0) || "join".equals(action) && p.length() == 1 && (!p.has("sessionId") || !PushPolicy.id(p.optString("sessionId")))) return publicStatus;
            if (!java.util.Arrays.asList("status", "join", "leave", "press", "release", "cancel").contains(action)) return publicStatus;
            if (!"status".equals(action)) post(() -> execute(action, p.optString("sessionId", "channel")));
        } catch (Exception ignored) { }
        return publicStatus;
    }
    private void execute(String action, String sessionId) {
        if (destroyed) return;
        if ("leave".equals(action) || "cancel".equals(action) && !host.backgroundReceptionAllowed()) { stop("Voice stopped. Join when ready."); return; }
        if ("cancel".equals(action)) { safety.release(now()); applyMicrophone(); releaseFloor(); publish(); return; }
        if ("release".equals(action)) { safety.release(now()); applyMicrophone(); releaseFloor(); publish(); return; }
        if (!available) { publish(); return; }
        refreshIdentity();
        if (!foreground || identity == null) { stop("Open Navrang and sign in before joining voice."); return; }
        if ("join".equals(action)) join(sessionId);
        else if ("press".equals(action)) press();
    }
    private boolean requestFocus() {
        if (audio == null || !foreground) return false;
        int result;
        if (Build.VERSION.SDK_INT >= 26) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                .setAcceptsDelayedFocusGain(false).setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(focusListener, main).build();
            result = audio.requestAudioFocus(focusRequest);
        } else result = audio.requestAudioFocus(focusListener, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
        focused = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        return focused;
    }
    private void join(String sessionId) {
        if (safety.snapshot(now()).connected || "joining".equals(safety.snapshot(now()).state)) return;
        if (!host.prepareReceiving()) { stop("Voice service could not start. Open Navrang and try again."); return; }
        if (!requestFocus()) { message = "Audio is busy. Try joining again."; publish(); return; }
        environment();
        long operation = safety.beginJoin(sessionId, now()); if (operation < 0) { stop("Voice could not join."); return; }
        authorityInvalidated.set(false);
        voiceIntent = true;
        final long epoch = ++callbackEpoch, started = now(); final VoiceAuthority.Identity owner = identity;
        message = "Joining voice."; publish(); main.removeCallbacks(pulse); main.post(pulse);
        track(authority.join(owner, sessionId, new VoiceAuthority.Result<VoiceAuthority.Join>() {
            public void success(VoiceAuthority.Join joined) { post(() -> {
                if (!valid(epoch, owner) || joined == null || !PushPolicy.id(joined.sessionId) || !PushPolicy.id(joined.dutyId) || !"channel".equals(sessionId) && !sessionId.equals(joined.sessionId)) { discardJoin(owner, joined); return; }
                long until = deadline(joined.serverTimeMs, joined.expiresAtMs, started, now(), 60000);
                if (until < 0) { discardJoin(owner, joined); stop("Voice authorization expired."); return; }
                membership = joined;
                receive(epoch,owner,joined,started,()->safety.joined(operation,until,now()));
            }); }
            public void failure() { failedJoin(epoch); }
        }));
    }
    private interface AcceptReceive { boolean accept(); }
    private void receive(long epoch,VoiceAuthority.Identity owner,VoiceAuthority.Join joined,long started,AcceptReceive accepted) {
        if(joined.receive==null) {
            if(!accepted.accept()){discardJoin(owner,joined);return;}
            nextRefresh=now()+5000;message="On duty. Waiting for a speaker.";publish();return;
        }
        long until=deadline(joined.serverTimeMs,joined.receive.expiresAtMs(),started,now(),60000);
        if(until<0){discardJoin(owner,joined);stop("Voice room expired. Join again when ready.");return;}
        final long revision=++receiveRevision;receiveUntil=until;
        track(media.receive(joined.receive,new VoiceMediaTransport.Result<VoiceMediaTransport.Receiver>() {
            public void ready(VoiceMediaTransport.Receiver connection){post(()->{
                if(!valid(epoch,owner)||revision!=receiveRevision||now()>=until||!accepted.accept()) {
                    connection.close();discardJoin(owner,joined);return;
                }
                receiver=connection;nextRefresh=now()+5000;message="Listening. Hold Talk to speak.";publish();
            });}
            public void failed(){post(()->{if(revision==receiveRevision)failedJoin(epoch);});}
            public void disconnected(){post(()->{
                if(revision!=receiveRevision)return;
                if(authority.supportsRefresh()&&now()>=until){closeReceiver();message="On duty. Waiting for a speaker.";publish();}
                else failedJoin(epoch);
            });}
        }));
    }
    private void closeReceiver() {
        receiveRevision++;receiveUntil=-1;
        if(receiver!=null){cleanup(receiver::close);receiver=null;}
    }
    private void refresh() {
        if(membership==null)return;
        refreshPending=true;nextRefresh=now()+5000;refreshUntil=now()+5000;
        final long epoch=callbackEpoch,started=now(),authorityEpoch=safety.snapshot(now()).epoch;
        final VoiceAuthority.Identity owner=identity;
        final VoiceAuthority.Join previous=membership;
        refreshRequest=authority.refresh(owner,previous,new VoiceAuthority.Result<VoiceAuthority.Join>() {
            public void success(VoiceAuthority.Join joined){post(()->{
                if(!valid(epoch,owner)||membership!=previous){discardJoin(owner,joined);return;}
                refreshPending=false;refreshRequest=null;
                long until=joined==null?-1:deadline(joined.serverTimeMs,joined.expiresAtMs,started,now(),60000);
                if(joined==null||!PushPolicy.id(joined.sessionId)||!previous.dutyId.equals(joined.dutyId)||until<0||
                    !safety.extendAuthority(authorityEpoch,until,now())) {
                    discardJoin(owner,joined);stop("Voice access changed. Join again when ready.");return;
                }
                boolean sameSession=previous.sessionId.equals(joined.sessionId);
                boolean sameRoom=sameSession&&receiver!=null&&previous.receive!=null&&joined.receive!=null&&
                    previous.receive.sameBinding(joined.receive);
                boolean ownFloor=sameSession&&joined.speaking&&floor!=null&&floor.leaseId.equals(joined.leaseId)&&floor.generation==joined.leaseGeneration;
                if(!sameSession||floor!=null&&!ownFloor) {
                    safety.release(now());applyMicrophone();releaseFloor();
                }
                if(!sameSession||!sameRoom&&joined.receive!=null||joined.receive==null&&receiver!=null) {
                    if(!ownFloor){safety.release(now());applyMicrophone();releaseFloor();}
                    closeReceiver();
                }
                // The active receiver still owns previous.receive. Equivalent discovery
                // must neither revoke it nor replace it with an unused fresh secret.
                membership=sameRoom?new VoiceAuthority.Join(joined.sessionId,joined.dutyId,joined.serverTimeMs,
                    joined.expiresAtMs,previous.receive,joined.speaking,joined.leaseId,joined.leaseGeneration):joined;
                if(sameRoom){if(joined.receive!=previous.receive)cleanup(joined.receive::destroy);publish();}
                else receive(epoch,owner,joined,started,()->safety.snapshot(now()).connected);
                if(previous.receive!=null&&previous.receive!=membership.receive)cleanup(previous.receive::destroy);
            });}
            public void failure(){post(()->{if(valid(epoch,owner)&&membership==previous){refreshPending=false;refreshRequest=null;stop("Voice access could not be refreshed. Join again when ready.");}});}
        });
    }
    private boolean valid(long epoch, VoiceAuthority.Identity owner) { return !destroyed && !authorityInvalidated.get() && (foreground || host.backgroundReceptionAllowed()) && epoch == callbackEpoch && same(owner); }
    private void failedJoin(long epoch) { post(() -> { if (epoch == callbackEpoch) stop("Voice connection unavailable. Join again when ready."); }); }
    private void press() {
        if (!safety.snapshot(now()).connected) return;
        if (!media.canPublish()) { safety.release(now()); applyMicrophone(); message = "Speaking is unavailable on this device."; publish(); return; }
        if (!permission()) {
            if (permissionPending) return;
            safety.release(now()); applyMicrophone(); message = "Allow microphone access, then hold Talk again."; publish();
            permissionPending = host.requestMicrophonePermission(); return;
        }
        if (!foreground || !host.prepareTransmitting()) { safety.release(now()); applyMicrophone(); message = "Open Navrang and hold Talk again."; publish(); return; }
        environment();
        long operation = safety.press(now()); if (operation < 0 || membership == null) return;
        final long epoch = callbackEpoch, started = now(); final VoiceAuthority.Identity owner = identity;
        message = "Requesting permission to speak."; publish();
        track(authority.floor(owner, membership.sessionId, new VoiceAuthority.Result<VoiceAuthority.Floor>() {
            public void success(VoiceAuthority.Floor result) { post(() -> acceptFloor(epoch, owner, operation, started, result, false)); }
            public void failure() { post(() -> { if (valid(epoch, owner) && safety.snapshot(now()).floorOperation == operation) { safety.failed(operation, now()); applyMicrophone(); message = "Speaking is unavailable. Hold Talk to retry."; publish(); } }); }
        }));
    }
    private void acceptFloor(long epoch, VoiceAuthority.Identity owner, long operation, long started, VoiceAuthority.Floor result, boolean renewing) {
        VoiceSafetyState.Snapshot before = safety.snapshot(now());
        if ((renewing ? before.renewOperation : before.floorOperation) != operation) { discardFloor(owner, result); return; }
        long until = result == null || result.transmit == null ? -1 : deadline(result.serverTimeMs, Math.min(result.expiresAtMs, result.transmit.expiresAtMs()), started, now(), 15000);
        if (!valid(epoch, owner) || membership == null || result == null || !membership.sessionId.equals(result.sessionId) || !PushPolicy.id(result.leaseId) || result.transmit == null || until < 0) {
            discardFloor(owner, result); if (valid(epoch, owner)) { safety.failed(operation, now()); applyMicrophone(); } return;
        }
        boolean accepted = renewing ? (before.leaseId.equals(result.leaseId)
            ? safety.renewed(operation, result.leaseId, result.generation, until, now())
            : safety.rotated(operation, result.leaseId, result.generation, until, now()))
            : safety.granted(operation, result.leaseId, result.generation, until, now());
        renewalPending = false;
        if (!accepted) { discardFloor(owner, result); applyMicrophone(); return; }
        // Every credential replacement starts muted. The old publisher is closed
        // before the new one can begin, including separate provider identities.
        mutePublisher(); closePublisher();
        if (floor != null && floor.transmit != result.transmit) cleanup(floor.transmit::destroy);
        floor = result; nextRenew = now() + 5000;
        final long revision=publisherRevision;
        track(media.preparePublisher(result.transmit, new VoiceMediaTransport.Result<VoiceMediaTransport.Publisher>() {
            public void ready(VoiceMediaTransport.Publisher connection) { post(() -> {
                VoiceSafetyState.Snapshot state = safety.snapshot(now());
                if (!valid(epoch, owner) || revision!=publisherRevision || floor != result || !state.micAllowed || !result.leaseId.equals(state.leaseId)) { connection.microphone(false); connection.close(); return; }
                publisher = connection; applyMicrophone(); message = "Talking. Release to stop."; publish();
            }); }
            public void failed() { post(() -> { if (revision==publisherRevision && floor == result) { safety.release(now()); applyMicrophone(); releaseFloor(); message = "Microphone connection unavailable."; publish(); } }); }
            public void disconnected() { failed(); }
        }));
    }
    private void renew() {
        long operation = safety.beginRenew(now()); if (operation < 0 || floor == null) return;
        renewalPending = true; final long epoch = callbackEpoch, started = now(); final VoiceAuthority.Identity owner = identity; final VoiceAuthority.Floor current = floor;
        if(authority.rotatesTransportOnRenew()){mutePublisher();closePublisher();}
        track(authority.renew(owner, current.sessionId, current.leaseId, current.generation, new VoiceAuthority.Result<VoiceAuthority.Floor>() {
            public void success(VoiceAuthority.Floor result) { post(() -> acceptFloor(epoch, owner, operation, started, result, true)); }
            public void failure() { post(() -> { if (valid(epoch, owner) && floor == current && safety.snapshot(now()).renewOperation == operation) { renewalPending = false; safety.failed(operation, now()); applyMicrophone(); releaseFloor(); publish(); } }); }
        }));
    }
    private void track(VoiceAuthority.Pending request) {
        if(request==null)return;
        if(pending.size()>=64){VoiceAuthority.Pending oldest=pending.remove(0);cleanup(oldest::cancel);}
        pending.add(request);
    }
    private void applyMicrophone() {
        VoiceSafetyState.Snapshot state = safety.snapshot(now());
        boolean desired = !authorityInvalidated.get() && state.micAllowed && permission() && foreground && focused && same(identity);
        if (publisher != null && microphoneRequested != desired) {
            final VoiceMediaTransport.Publisher target = publisher;
            final long operation = ++microphoneOperation;
            microphoneRequested = desired;
            target.microphone(desired, new VoiceMediaTransport.InputResult() {
                public void applied(boolean enabled) { post(() -> {
                    if (publisher != target || operation != microphoneOperation) { if (enabled) cleanup(() -> target.microphone(false)); return; }
                    if (enabled != desired || enabled && (authorityInvalidated.get() || !safety.snapshot(now()).micAllowed || !permission() || !foreground || !focused || !same(identity))) {
                        stop("Microphone authorization changed."); return;
                    }
                    microphoneEnabled = enabled; publish();
                }); }
                public void failed() { post(() -> { if (publisher == target && operation == microphoneOperation) stop("Microphone input could not be confirmed."); }); }
            });
        }
    }
    private void mutePublisher() { microphoneOperation++; microphoneRequested = false; if (publisher != null) cleanup(() -> publisher.microphone(false)); microphoneEnabled = false; }
    private void closePublisher() { publisherRevision++; if (publisher != null) { cleanup(publisher::close); publisher = null; } microphoneEnabled = false; microphoneRequested = false; }
    private void releaseFloor() {
        mutePublisher(); closePublisher(); renewalPending = false;
        VoiceAuthority.Floor previous = floor; floor = null;
        cleanup(host::transmissionStopped);
        if (previous != null) { cleanup(previous.transmit::destroy); cleanup(() -> authority.release(identity, previous.sessionId, previous.leaseId)); }
    }
    private void discardFloor(VoiceAuthority.Identity owner, VoiceAuthority.Floor value) {
        if (value != null) {
            boolean currentLease = floor != null && floor.sessionId.equals(value.sessionId) && floor.leaseId.equals(value.leaseId) && floor.generation == value.generation && safety.snapshot(now()).micAllowed;
            if (value.transmit != null && (floor == null || floor.transmit != value.transmit)) cleanup(value.transmit::destroy);
            if (!currentLease && PushPolicy.id(value.sessionId) && PushPolicy.id(value.leaseId)) cleanup(() -> authority.release(owner, value.sessionId, value.leaseId));
        }
    }
    private void discardJoin(VoiceAuthority.Identity owner, VoiceAuthority.Join value) {
        if (value != null) {
            if (value.receive != null && (membership == null || membership.receive != value.receive)) cleanup(value.receive::destroy);
            if ((membership == null || !membership.dutyId.equals(value.dutyId)) && PushPolicy.id(value.dutyId)) cleanup(() -> authority.leave(owner, value.dutyId));
        }
    }
    private void stop(String reason) {
        // Synchronous local mute/close precedes cancellation and server cleanup.
        authorityInvalidated.set(true); safety.disconnect(now()); mutePublisher(); closePublisher(); cleanup(media::stop); callbackEpoch++; voiceIntent = false;
        main.removeCallbacks(pulse); for (VoiceAuthority.Pending request : pending) try { request.cancel(); } catch (Exception ignored) { } pending.clear();
        if(refreshRequest!=null){cleanup(refreshRequest::cancel);refreshRequest=null;}refreshPending=false;
        releaseFloor();closeReceiver();
        VoiceAuthority.Join previous = membership; membership = null; if (previous != null) discardJoin(identity, previous);
        if (audio != null && focused) cleanup(() -> { if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest); else audio.abandonAudioFocus(focusListener); });
        focused = false; message = available ? reason : "Voice is not available yet."; publish();
        cleanup(host::stopped);
    }
    private void publish() {
        try {
            VoiceSafetyState.Snapshot state = safety.snapshot(now());
            String phase = available ? state.micAllowed && !microphoneEnabled ? "requesting" : state.state : "unavailable";
            boolean microphone = !authorityInvalidated.get() && microphoneEnabled && publisher != null && state.micAllowed && foreground && focused && permission() && same(identity);
            JSONObject value = new JSONObject().put("available", available).put("ready", available && state.connected).put("state", phase)
                .put("microphone", microphone).put("canTalk", available && state.connected && foreground && focused && media.canPublish()).put("message", message);
            String serialized = value.toString(); if (!serialized.equals(publicStatus)) { publicStatus = serialized; runtime.emit("voice", value); host.statusChanged(value); }
        } catch (Exception ignored) { }
    }
    public void resume() {
        foreground = true; media.foreground(true); refreshIdentity(); publish();
        if (!registered && available) {
            if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), Context.RECEIVER_NOT_EXPORTED);
            else context.registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
            if (connectivity != null) connectivity.registerDefaultNetworkCallback(network); registered = true;
        }
    }
    public void pause() {
        foreground = false;
        media.foreground(host.backgroundReceptionAllowed());
        if (!host.backgroundReceptionAllowed()) { stop("Voice stopped when Navrang left the foreground."); return; }
        environment(); releaseFloor(); publish();
    }
    public void permissionResult() { post(() -> { permissionPending = false; environment(); applyMicrophone(); publish(); }); }
    public void identityChanging() {
        // A bridge-thread logout fences queued enables before the main-thread
        // SDK stop can run. SDK calls remain on their required owner thread.
        authorityInvalidated.set(true);
        cleanup(media::authorizationChanged);
        if (Looper.myLooper() == main.getLooper()) stop("Sign-in changed. Join again when ready.");
        else post(() -> stop("Sign-in changed. Join again when ready."));
    }
    public void windowFocusLost() {
        if (!host.backgroundReceptionAllowed()) { stop("Voice stopped while another window is active."); return; }
        safety.release(now()); applyMicrophone(); releaseFloor(); publish();
    }
    @Override public void event(JSONObject event) {
        if ("auth".equals(event.optString("type")) || "profile".equals(event.optString("type"))) post(() -> { refreshIdentity(); applyMicrophone(); publish(); });
    }
    public void close() {
        destroyed = true; stop("Voice stopped."); runtime.remove(this);
        cleanup(authority::close);
        if (registered) { cleanup(() -> context.unregisterReceiver(noisy)); if (connectivity != null) cleanup(() -> connectivity.unregisterNetworkCallback(network)); registered = false; }
    }
}
