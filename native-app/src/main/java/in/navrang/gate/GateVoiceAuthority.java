package in.navrang.gate;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.util.Calendar;
import java.util.GregorianCalendar;
import java.util.HashMap;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Existing Navrang HTTPS authority protocol. Instantiation does not contact any service. */
public final class GateVoiceAuthority implements VoiceAuthority,AutoCloseable {
    interface Server { JSONObject call(String action,JSONObject payload,Identity owner) throws Exception; }
    interface Guard { boolean current(Identity owner); }
    private interface Work<T> { T run(Task task) throws Exception; }
    private interface Discard<T> { void value(T value); }
    private static final long LIMIT=9_007_199_254_740_991L;
    private static final Pattern DATE=Pattern.compile("(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})(?:\\.(\\d{1,6}))?(Z|[+-]\\d{2}:\\d{2})");
    private final Server server;
    private final Guard guard;
    private final String host,installation;
    private final boolean enabled;
    private final ExecutorService worker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<String,String> bases=new HashMap<>();
    private volatile boolean closed;
    private static final class Task {
        final AtomicBoolean settled=new AtomicBoolean();volatile Future<?> future;
        boolean stopped(){return settled.get()||Thread.currentThread().isInterrupted();}
    }

    GateVoiceAuthority(Server server,Guard guard,String host,String installation,boolean enabled,ExecutorService worker) {
        if(server==null||guard==null||worker==null||installation==null||!installation.matches("[A-Za-z0-9-]{8,128}"))throw new IllegalArgumentException("Native voice dependencies required.");
        if(host==null||!host.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.daily\\.co"))throw new IllegalArgumentException("Approved voice host required.");
        this.server=server;this.guard=guard;this.host=host;this.installation=installation;this.enabled=enabled;this.worker=worker;
    }
    static GateVoiceAuthority forRuntime(GateRuntime runtime,String approvedHost,boolean configured) {
        ExecutorService executor=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(16),task->{Thread thread=new Thread(task,"navrang-voice-authority");thread.setDaemon(true);return thread;});
        return new GateVoiceAuthority((action,payload,owner)->{
            String token;
            try { token=currentToken(runtime,owner); }
            catch(IllegalStateException changed) {
                // Revocation cleanup may use only the captured owner's credential;
                // the server still checks ownership. It cannot acquire new media.
                if(!"voice-release".equals(action)&&!"duty-leave".equals(action))throw changed;
                token=owner.token;
            }
            GateApi.Reply reply=runtime.api.call(action,payload,token);
            if(reply.status!=200||!Boolean.TRUE.equals(reply.body.opt("ok")))throw new IllegalStateException("Voice request unavailable.");
            return reply.body;
        },owner->{
            try { currentToken(runtime,owner);return true; } catch(IllegalStateException changed) { return false; }
        },approvedHost,"voice-"+UUID.randomUUID(),configured,executor);
    }
    static String currentToken(GateRuntime runtime,Identity owner) {
        synchronized(runtime.sessions) {
            JSONObject current=runtime.sessions.read();
            if(owner==null||!runtime.privateAccessAllowed()||!GateSession.canSync(current)||
                !runtime.sessions.sameIdentity(owner.generation,owner.token,owner.family)||
                !owner.scope.equals(VoiceCoordinator.scope(current.optJSONObject("profile"))))
                throw new IllegalStateException("Voice identity changed.");
            return current.optString("token");
        }
    }
    @Override public boolean configured(){return enabled&&!closed;}
    @Override public boolean supportsRefresh(){return configured();}
    private JSONObject call(Task task,String action,JSONObject payload,Identity owner)throws Exception {
        if(task.stopped()||!configured()||!guard.current(owner))throw new IllegalStateException("Voice authority changed.");
        JSONObject result=server.call(action,payload,owner);
        if(result==null||!Boolean.TRUE.equals(result.opt("ok")))throw new IllegalStateException("Voice request unavailable.");
        return result;
    }
    private <T> Pending submit(Identity owner,Result<T> result,Work<T> work,Discard<T> discard) {
        Task task=new Task();
        Runnable timeout=()->{if(task.settled.compareAndSet(false,true)){if(task.future!=null)task.future.cancel(true);result.failure();}};
        if(!configured()||owner==null||!guard.current(owner)){result.failure();return ()->{};}
        main.postDelayed(timeout,6000);
        try {
            task.future=worker.submit(()->{
                T value=null;
                try {
                    value=work.run(task);
                    if(!closed&&guard.current(owner)&&task.settled.compareAndSet(false,true)){result.success(value);value=null;}
                    else if(task.settled.compareAndSet(false,true))result.failure();
                }catch(Exception ignored){if(task.settled.compareAndSet(false,true))result.failure();}
                finally{main.removeCallbacks(timeout);if(value!=null)discard.value(value);}
            });
        }catch(Exception ignored){main.removeCallbacks(timeout);if(task.settled.compareAndSet(false,true))result.failure();}
        return ()->{task.settled.set(true);main.removeCallbacks(timeout);if(task.future!=null)task.future.cancel(true);};
    }
    private void cleanup(String action,JSONObject payload,Identity owner) {
        if(owner==null||closed)return;
        try{worker.execute(()->{try{server.call(action,payload,owner);}catch(Exception ignored){}});}catch(Exception ignored){}
    }
    @Override public Pending join(Identity owner,String requested,Result<Join> result) {
        return submit(owner,result,task->{
            if(!"channel".equals(requested)&&!PushPolicy.id(requested))throw new IllegalArgumentException("Opaque voice session required.");
            JSONObject duty=call(task,"duty-join",new JSONObject().put("installationId",installation),owner);
            String dutyId=id(duty,"dutyId"),base="channel".equals(requested)?id(duty,"sessionId"):requested;
            try{
                synchronized(bases){if(!bases.containsKey(dutyId)&&bases.size()>=4)throw new IllegalStateException("Voice memberships full.");bases.put(dutyId,base);}
                return discover(task,owner,dutyId,base);
            }
            catch(Exception failure){leave(owner,dutyId);throw failure;}
        },value->{if(value.receive!=null)value.receive.destroy();leave(owner,value.dutyId);});
    }
    @Override public Pending refresh(Identity owner,Join current,Result<Join> result) {
        return submit(owner,result,task->{
            String base;synchronized(bases){base=bases.get(current.dutyId);}
            if(base==null)throw new IllegalStateException("Voice membership ended.");
            call(task,"duty-heartbeat",new JSONObject().put("dutyId",current.dutyId),owner);
            return discover(task,owner,current.dutyId,base);
        },value->{if(value.receive!=null)value.receive.destroy();});
    }
    private Join discover(Task task,Identity owner,String dutyId,String base)throws Exception {
        long started=SystemClock.elapsedRealtime();
        JSONObject value=call(task,"voice-join",new JSONObject().put("dutyId",dutyId).put("sessionId",base),owner);
        String sessionId=id(value,"sessionId");
        if(!dutyId.equals(id(value,"dutyId")))throw new IllegalArgumentException("Voice membership mismatch.");
        long serverTime=number(value,"serverTime"),expiry=millis(value.getString("dutyExpiresAt"));
        if(VoiceCoordinator.deadline(serverTime,expiry,started,SystemClock.elapsedRealtime(),60000)<0)throw new IllegalArgumentException("Voice authority expired.");
        String state=value.getString("state");
        if(!java.util.Arrays.asList("idle","listening","speaking").contains(state))throw new IllegalArgumentException("Voice state unavailable.");
        DailyNativeCredential credential=null;String lease="";long generation=-1;
        if("listening".equals(state))credential=credential(value.getJSONObject("receive"),serverTime,started,DailyNativeCredential.Role.LISTENER);
        else if(!value.isNull("receive"))throw new IllegalArgumentException("Unexpected receive credential.");
        if("speaking".equals(state)){lease=id(value,"leaseId");generation=number(value,"generation");}
        return new Join(sessionId,dutyId,serverTime,expiry,credential,"speaking".equals(state),lease,generation);
    }
    @Override public Pending floor(Identity owner,String sessionId,Result<Floor> result) {
        return floorRequest(owner,"voice-floor",sessionId,null,result);
    }
    @Override public Pending renew(Identity owner,String sessionId,String leaseId,long generation,Result<Floor> result) {
        return floorRequest(owner,"voice-renew",sessionId,leaseId,result);
    }
    private Pending floorRequest(Identity owner,String action,String sessionId,String leaseId,Result<Floor> result) {
        return submit(owner,result,task->{
            if(!PushPolicy.id(sessionId)||leaseId!=null&&!PushPolicy.id(leaseId))throw new IllegalArgumentException("Opaque voice lease required.");
            JSONObject payload=new JSONObject().put("sessionId",sessionId);
            if(leaseId==null)payload.put("requestId",UUID.randomUUID().toString());else payload.put("leaseId",leaseId);
            long started=SystemClock.elapsedRealtime();JSONObject value=call(task,action,payload,owner);
            if(!"active".equals(value.optString("state"))||!sessionId.equals(id(value,"sessionId")))throw new IllegalArgumentException("Uncommitted voice floor.");
            String returnedLease=id(value,"leaseId");
            try {
                long serverTime=number(value,"serverTime"),generation=number(value,"generation"),expiry=millis(value.getString("expiresAt"));
                DailyNativeCredential credential=credential(value.getJSONObject("transmit"),serverTime,started,DailyNativeCredential.Role.PUBLISHER);
                if(!returnedLease.equals(credential.leaseId)||generation!=credential.generation||expiry!=credential.expiresAtMs()) {
                    credential.destroy();throw new IllegalArgumentException("Voice lease mismatch.");
                }
                return new Floor(sessionId,returnedLease,generation,serverTime,expiry,credential);
            } catch(Exception failure) { release(owner,sessionId,returnedLease);throw failure; }
        },value->{value.transmit.destroy();release(owner,value.sessionId,value.leaseId);});
    }
    private DailyNativeCredential credential(JSONObject value,long serverTime,long started,DailyNativeCredential.Role role)throws Exception {
        if(!"daily".equals(value.getString("provider")))throw new IllegalArgumentException("Unexpected voice provider.");
        long expiry=millis(value.getString("expiresAt")),finished=SystemClock.elapsedRealtime();
        long deadline=VoiceCoordinator.deadline(serverTime,expiry,started,finished,15000);
        return new DailyNativeCredential(host,value.getString("roomUrl"),value.getString("roomId"),id(value,"identity"),
            id(value,"leaseId"),number(value,"generation"),expiry,deadline,finished,role,value.getString("token").toCharArray());
    }
    @Override public void release(Identity owner,String sessionId,String leaseId) {
        if(!PushPolicy.id(sessionId)||!PushPolicy.id(leaseId))return;
        try{cleanup("voice-release",new JSONObject().put("sessionId",sessionId).put("leaseId",leaseId),owner);}catch(Exception ignored){}
    }
    @Override public void leave(Identity owner,String dutyId) {
        if(!PushPolicy.id(dutyId))return;synchronized(bases){bases.remove(dutyId);}
        try{cleanup("duty-leave",new JSONObject().put("dutyId",dutyId),owner);}catch(Exception ignored){}
    }
    @Override public void close(){closed=true;synchronized(bases){bases.clear();}worker.shutdownNow();}
    private static String id(JSONObject value,String key)throws Exception {
        Object raw=value.get(key);if(!(raw instanceof String)||!PushPolicy.id((String)raw))throw new IllegalArgumentException("Opaque voice identifier required.");return (String)raw;
    }
    private static long number(JSONObject value,String key)throws Exception {
        Object raw=value.get(key);if(!(raw instanceof Number))throw new IllegalArgumentException("Numeric voice timing required.");
        double number=((Number)raw).doubleValue();if(!Double.isFinite(number)||number<0||number>LIMIT||number!=Math.floor(number))throw new IllegalArgumentException("Invalid voice timing.");return (long)number;
    }
    static long millis(String value) {
        Matcher match=DATE.matcher(value==null?"":value);if(!match.matches())throw new IllegalArgumentException("ISO voice expiry required.");
        Calendar date=new GregorianCalendar(TimeZone.getTimeZone("UTC"));date.clear();date.setLenient(false);
        int year=Integer.parseInt(match.group(1));if(year<1970)throw new IllegalArgumentException("Voice expiry out of range.");
        date.set(year,Integer.parseInt(match.group(2))-1,Integer.parseInt(match.group(3)),Integer.parseInt(match.group(4)),Integer.parseInt(match.group(5)),Integer.parseInt(match.group(6)));
        String fraction=match.group(7);if(fraction!=null)date.set(Calendar.MILLISECOND,Integer.parseInt((fraction+"000").substring(0,3)));
        String zone=match.group(8);int offset=0;
        if(!"Z".equals(zone)){int hours=Integer.parseInt(zone.substring(1,3)),minutes=Integer.parseInt(zone.substring(4,6));
            if(hours>14||minutes>59||hours==14&&minutes!=0)throw new IllegalArgumentException("Invalid voice time zone.");
            offset=(hours*60+minutes)*(zone.charAt(0)=='-'?-1:1);}
        return date.getTimeInMillis()-offset*60_000L;
    }
}
