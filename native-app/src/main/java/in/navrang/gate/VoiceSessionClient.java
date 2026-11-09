package in.navrang.gate;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONObject;

/** Activity attachment only. Credentials and the audio owner remain outside the WebView. */
public final class VoiceSessionClient {
    static final String UNAVAILABLE="{\"available\":false,\"ready\":false,\"state\":\"unavailable\",\"microphone\":false,\"canTalk\":false,\"message\":\"Voice is not available yet.\"}";
    private static final String IDLE="{\"available\":true,\"ready\":false,\"state\":\"idle\",\"microphone\":false,\"canTalk\":false,\"message\":\"Join when ready.\"}";
    private static final String JOINING="{\"available\":true,\"ready\":false,\"state\":\"joining\",\"microphone\":false,\"canTalk\":false,\"message\":\"Joining voice.\"}";
    private final Activity activity;
    private final Handler main=new Handler(Looper.getMainLooper());
    private volatile VoiceSessionService service;
    private boolean active,focused,bound,closed;
    private volatile String pendingJoin;
    private final ServiceConnection connection=new ServiceConnection() {
        @Override public void onServiceConnected(ComponentName name,IBinder binder) {
            if(!(binder instanceof VoiceSessionService.LocalBinder)||closed)return;
            service=((VoiceSessionService.LocalBinder)binder).service();
            if(!active){pendingJoin=null;service.command("cancel",null);return;}
            service.attach(activity,focused);
            if(pendingJoin!=null){String payload=pendingJoin;pendingJoin=null;service.command("join",payload);}
        }
        @Override public void onServiceDisconnected(ComponentName name) { service=null;pendingJoin=null; }
        @Override public void onBindingDied(ComponentName name) { service=null;pendingJoin=null;unbind(); }
    };
    public VoiceSessionClient(Activity activity) { this.activity=activity; }
    public String command(String action,String payload) {
        if(!BuildConfig.VOICE_ENABLED||closed)return UNAVAILABLE;
        if(!java.util.Arrays.asList("status","join","press","release","cancel","leave").contains(action))return status();
        if(!"status".equals(action))main.post(()->execute(action,payload));
        return status();
    }
    private String status() {
        VoiceSessionService current=service;
        if(current!=null)return current.command("status",null);
        // A cold start can offer Join without creating the audio service.
        return pendingJoin==null?IDLE:JOINING;
    }
    private void execute(String action,String payload) {
        if(closed)return;
        if("join".equals(action)) {
            if(!active||pendingJoin!=null)return;
            try {
                JSONObject input=new JSONObject(payload==null?"{}":payload);
                if(input.length()>1||input.length()==1&&(!input.has("sessionId")||!PushPolicy.id(input.optString("sessionId"))))return;
                pendingJoin=input.toString();
                Intent start=new Intent(activity,VoiceSessionService.class).setAction(VoiceSessionService.START)
                    .putExtra(VoiceSessionService.USER_STARTED,true);
                if(Build.VERSION.SDK_INT>=26)activity.startForegroundService(start);else activity.startService(start);
                if(service!=null){service.attach(activity,focused);String joined=pendingJoin;pendingJoin=null;service.command("join",joined);}
                else bind(true);
            } catch(Exception ignored) { pendingJoin=null;activity.stopService(new Intent(activity,VoiceSessionService.class)); }
        } else {
            if("cancel".equals(action)||"leave".equals(action))pendingJoin=null;
            VoiceSessionService current=service;
            if(current!=null)current.command(action,payload);
            else if("leave".equals(action)||"cancel".equals(action))activity.stopService(new Intent(activity,VoiceSessionService.class));
        }
    }
    private void bind(boolean create) {
        if(bound)return;
        try { bound=activity.bindService(new Intent(activity,VoiceSessionService.class),connection,create?Context.BIND_AUTO_CREATE:0); }
        catch(Exception ignored){bound=false;pendingJoin=null;}
    }
    private void unbind() { if(bound){try{activity.unbindService(connection);}catch(Exception ignored){}bound=false;}service=null; }
    public void resume() { active=true;focused=activity.hasWindowFocus();if(BuildConfig.VOICE_ENABLED){bind(false);if(service!=null)service.attach(activity,focused);} }
    public void pause() { active=false;focused=false;pendingJoin=null;if(service!=null)service.background(activity); }
    public void focusChanged(boolean value) { focused=value;if(service!=null)service.focus(value); }
    public void permissionResult() { if(service!=null)service.permissionResult(); }
    public void identityChanging() { pendingJoin=null;if(service!=null)service.identityChanging(); }
    public void close() { if(closed)return;pause();closed=true;unbind(); }
}
