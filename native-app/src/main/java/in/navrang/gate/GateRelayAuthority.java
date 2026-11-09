package in.navrang.gate;

import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Actor-bound native relay authority. Construction never enables or contacts a provider. */
public final class GateRelayAuthority implements VoiceAuthority,AutoCloseable {
    interface Server { JSONObject call(String action,JSONObject payload,Identity owner) throws Exception; }
    interface Guard { boolean current(Identity owner); }
    /** Probe must authenticate a fresh nonce against this credential's exact room/origin and
     * update that room's owner clock. It must not consume the subsequent socket-upgrade bearer. */
    public interface Admission {
        Pending probe(Identity owner,RelayNativeCredential credential,Result<Boolean> result);
        Pending prepare(Identity owner,RelayMediaOwner.Admission admission,RelayMediaOwner.PreparedResult result);
    }
    private interface Work<T> { T run(Task task) throws Exception; }
    private interface Start<T> { Pending run(Result<T> result) throws Exception; }
    private static final long LIMIT=9_007_199_254_740_991L;
    private final Server server;private final Guard guard;private final Admission admission;
    private final String origin,installation;private final boolean enabled;private final ExecutorService worker;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final Map<String,Membership> memberships=new HashMap<>();private final Set<Task> tasks=new HashSet<>();
    private volatile boolean closed;
    private static final class Membership { final Identity owner;final String base;
        Membership(Identity owner,String base){this.owner=owner;this.base=base;} }
    private static final class Task {
        final AtomicBoolean settled=new AtomicBoolean();final ArrayList<Runnable> cleanup=new ArrayList<>();
        volatile Future<?> future;volatile boolean aborted;
        boolean stopped(){return aborted||Thread.currentThread().isInterrupted();}
        void own(Runnable action){boolean run;synchronized(this){run=aborted;if(!run)cleanup.add(action);}if(run)safe(action);}
        void abort(){ArrayList<Runnable> actions;synchronized(this){aborted=true;actions=new ArrayList<>(cleanup);cleanup.clear();}
            for(Runnable action:actions)safe(action);Future<?> pending=future;if(pending!=null)pending.cancel(true);}
        synchronized void transfer(){cleanup.clear();}
    }
    GateRelayAuthority(Server server,Guard guard,Admission admission,String approvedOrigin,String installation,boolean enabled,ExecutorService worker){
        if(server==null||guard==null||admission==null||worker==null||installation==null||!installation.matches("[A-Za-z0-9-]{8,128}")||!validOrigin(approvedOrigin))
            throw new IllegalArgumentException("Configured native relay dependencies required");
        this.server=server;this.guard=guard;this.admission=admission;this.origin=approvedOrigin;this.installation=installation;this.enabled=enabled;this.worker=worker;
    }
    static GateRelayAuthority forRuntime(GateRuntime runtime,String approvedOrigin,boolean configured,Admission admission){
        ExecutorService executor=new ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(16),task->{Thread t=new Thread(task,"navrang-relay-authority");t.setDaemon(true);return t;});
        return new GateRelayAuthority((action,payload,owner)->{
            String token;
            try{token=GateVoiceAuthority.currentToken(runtime,owner);}catch(IllegalStateException changed){
                if(!"voice-release".equals(action)&&!"duty-leave".equals(action))throw changed;token=owner.token;}
            GateApi.Reply reply=runtime.api.call(action,payload,token);
            if(reply.status!=200||!Boolean.TRUE.equals(reply.body.opt("ok")))throw new IllegalStateException("Relay request unavailable");return reply.body;
        },owner->{try{GateVoiceAuthority.currentToken(runtime,owner);return true;}catch(IllegalStateException changed){return false;}},
            admission,approvedOrigin,"relay-"+UUID.randomUUID(),configured,executor);
    }
    @Override public boolean configured(){return enabled&&!closed;}
    @Override public boolean supportsRefresh(){return configured();}
    @Override public boolean rotatesTransportOnRenew(){return true;}
    private void check(Task task,Identity owner){if(task.stopped()||!configured()||!guard.current(owner))throw new IllegalStateException("Relay identity changed");}
    /** Caller registers cleanup identifiers before the mandatory post-network identity check. */
    private JSONObject call(Task task,String action,JSONObject payload,Identity owner)throws Exception{
        check(task,owner);JSONObject value=server.call(action,payload,owner);
        if(value==null||!Boolean.TRUE.equals(value.opt("ok")))throw new IllegalStateException("Relay request unavailable");return value;
    }
    private <T> Pending submit(Identity owner,Result<T> result,Work<T> work){
        Task task=new Task();
        if(owner==null||!configured()||!guard.current(owner)){result.failure();return ()->{};}
        synchronized(tasks){tasks.add(task);}
        Runnable timeout=()->{if(task.settled.compareAndSet(false,true)){task.abort();safe(result::failure);}};
        main.postDelayed(timeout,6000);
        try{task.future=worker.submit(()->{try{
            T value=work.run(task);check(task,owner);
            if(task.settled.compareAndSet(false,true)){result.success(value);task.transfer();}else task.abort();
        }catch(Exception failure){task.abort();if(task.settled.compareAndSet(false,true))safe(result::failure);}
        finally{main.removeCallbacks(timeout);synchronized(tasks){tasks.remove(task);}}});
        if(task.stopped())task.future.cancel(true);
        }catch(RuntimeException failure){task.abort();main.removeCallbacks(timeout);synchronized(tasks){tasks.remove(task);}if(task.settled.compareAndSet(false,true))safe(result::failure);}
        return ()->{task.settled.set(true);task.abort();main.removeCallbacks(timeout);synchronized(tasks){tasks.remove(task);}};
    }
    private <T> T await(Task task,Identity owner,Start<T> start)throws Exception{
        check(task,owner);CountDownLatch done=new CountDownLatch(1);AtomicBoolean completed=new AtomicBoolean();
        Object[] value=new Object[1];boolean[] success={false};
        Pending pending=start.run(new Result<T>(){
            public void success(T result){if(completed.compareAndSet(false,true)){value[0]=result;success[0]=true;done.countDown();}}
            public void failure(){if(completed.compareAndSet(false,true))done.countDown();}
        });
        if(pending==null)throw new IllegalStateException("Relay admission unavailable");task.own(pending::cancel);
        if(!done.await(4000,TimeUnit.MILLISECONDS)||!success[0])throw new IllegalStateException("Relay admission unavailable");
        check(task,owner);@SuppressWarnings("unchecked") T result=(T)value[0];return result;
    }
    private void probe(Task task,Identity owner,RelayNativeCredential credential)throws Exception{
        if(!Boolean.TRUE.equals(this.<Boolean>await(task,owner,result->admission.probe(owner,credential,result))))throw new IllegalStateException("Relay room clock unavailable");
    }
    @Override public Pending join(Identity owner,String requested,Result<Join> result){
        return submit(owner,result,task->{
            if(!"channel".equals(requested)&&!PushPolicy.id(requested))throw new IllegalArgumentException("Opaque session required");
            JSONObject duty=call(task,"duty-join",new JSONObject().put("installationId",installation),owner);
            String dutyId=id(duty,"dutyId");task.own(()->leave(owner,dutyId));check(task,owner);
            String base="channel".equals(requested)?id(duty,"sessionId"):requested;
            synchronized(memberships){if(memberships.size()>=4)throw new IllegalStateException("Membership limit");memberships.put(dutyId,new Membership(owner,base));}
            return discover(task,owner,dutyId,base);
        });
    }
    @Override public Pending refresh(Identity owner,Join current,Result<Join> result){
        return submit(owner,result,task->{
            if(current==null)throw new IllegalArgumentException("Membership required");Membership membership;
            synchronized(memberships){membership=memberships.get(current.dutyId);}
            if(membership==null||!membership.owner.samePrincipal(owner))throw new IllegalStateException("Membership ended");
            call(task,"duty-heartbeat",new JSONObject().put("dutyId",current.dutyId),owner);check(task,owner);
            return discover(task,owner,current.dutyId,membership.base);
        });
    }
    private Join discover(Task task,Identity owner,String dutyId,String base)throws Exception{
        long started=SystemClock.elapsedRealtime();JSONObject value=call(task,"voice-join",new JSONObject().put("dutyId",dutyId).put("sessionId",base),owner);check(task,owner);
        if(!dutyId.equals(id(value,"dutyId")))throw new IllegalArgumentException("Membership changed");
        String session=id(value,"sessionId"),state=value.getString("state");long serverTime=number(value,"serverTime"),expiry=GateVoiceAuthority.millis(value.getString("dutyExpiresAt"));
        if(VoiceCoordinator.deadline(serverTime,expiry,started,SystemClock.elapsedRealtime(),60000)<0)throw new IllegalArgumentException("Membership expired");
        RelayNativeCredential credential=null;boolean speaking="speaking".equals(state);String lease="";long generation=-1;
        if("listening".equals(state)){
            lease=id(value,"leaseId");generation=positive(value,"generation");
            credential=credential(value.getJSONObject("receive"),serverTime,started,WebSocketAudioRelayTransport.Role.RECEIVER,lease,generation,null);
            RelayNativeCredential owned=credential;task.own(owned::destroy);probe(task,owner,credential);
        }else if(!"idle".equals(state)&&!speaking||!value.isNull("receive"))throw new IllegalArgumentException("Unexpected relay state");
        if(speaking){lease=id(value,"leaseId");generation=positive(value,"generation");}
        check(task,owner);return new Join(session,dutyId,serverTime,expiry,credential,speaking,lease,generation);
    }
    @Override public Pending floor(Identity owner,String session,Result<Floor> result){return floorRequest(owner,"voice-floor",session,null,-1,result);}
    @Override public Pending renew(Identity owner,String session,String lease,long generation,Result<Floor> result){return floorRequest(owner,"voice-renew",session,lease,generation,result);}
    private Pending floorRequest(Identity owner,String action,String session,String oldLease,long oldGeneration,Result<Floor> result){
        return submit(owner,result,task->{
            if(!PushPolicy.id(session)||oldLease!=null&&(!PushPolicy.id(oldLease)||oldGeneration<=0))throw new IllegalArgumentException("Opaque floor required");
            JSONObject original=new JSONObject().put("sessionId",session);
            if(oldLease==null)original.put("requestId",UUID.randomUUID().toString());
            else original.put("leaseId",oldLease);
            long started=SystemClock.elapsedRealtime();JSONObject prepared=call(task,action,new JSONObject(original.toString()).put("phase","prepare"),owner);
            String lease=id(prepared,"leaseId");task.own(()->release(owner,session,lease));check(task,owner);
            if(!"prepared".equals(prepared.getString("state"))||!session.equals(id(prepared,"sessionId")))throw new IllegalArgumentException("Unprepared floor");
            String operation=id(prepared,"operationId"),duty=id(prepared,"dutyId");long generation=positive(prepared,"generation");
            if(oldLease!=null&&generation<=oldGeneration)throw new IllegalArgumentException("Stale floor generation");
            long serverTime=number(prepared,"serverTime"),expiry=GateVoiceAuthority.millis(prepared.getString("expiresAt"));
            RelayNativeCredential credential=credential(prepared.getJSONObject("transmit"),serverTime,started,WebSocketAudioRelayTransport.Role.PUBLISHER,lease,generation,expiry);
            task.own(credential::destroy);probe(task,owner,credential);
            RelayMediaOwner.Prepared nativePrepared=await(task,owner,reply->admission.prepare(owner,new RelayMediaOwner.Admission(lease,generation,credential),new RelayMediaOwner.PreparedResult(){
                public void admitted(RelayMediaOwner.Prepared value){if(value==null){reply.failure();return;}task.own(value::cancel);reply.success(value);}
                public void failed(){task.abort();reply.failure();}
            }));
            JSONObject active=call(task,action,new JSONObject(original.toString()).put("phase","commit").put("operationId",operation).put("generation",generation),owner);
            // A canceled request may finish committing remotely after its first cleanup. Revoke again after the late reply.
            task.own(()->release(owner,session,lease));check(task,owner);
            if(!"active".equals(active.getString("state"))||!session.equals(id(active,"sessionId"))||!duty.equals(id(active,"dutyId"))||
                !operation.equals(id(active,"operationId"))||!lease.equals(id(active,"leaseId"))||generation!=positive(active,"generation")||
                expiry!=GateVoiceAuthority.millis(active.getString("expiresAt")))throw new IllegalArgumentException("Committed floor changed");
            long committedTime=number(active,"serverTime");
            if(VoiceCoordinator.deadline(committedTime,expiry,started,SystemClock.elapsedRealtime(),15000)<0)throw new IllegalArgumentException("Committed floor expired");
            JSONObject grant=active.getJSONObject("grant");
            if(grant.length()!=3||!active.isNull("transmit"))throw new IllegalArgumentException("Unexpected committed grant descriptor");
            long deadline=positive(grant,"deadline");
            if(deadline!=expiry)throw new IllegalArgumentException("Grant deadline changed");
            RelayMediaOwner.Binding binding=new RelayMediaOwner.Binding(credential.room(),credential.subject(),lease,generation,id(grant,"grantId"),positive(grant,"epoch"),deadline);
            VoiceMediaTransport.Credential ticket=await(task,owner,reply->{
                nativePrepared.committed(binding,new VoiceMediaTransport.Result<VoiceMediaTransport.Credential>(){
                    public void ready(VoiceMediaTransport.Credential value){if(value==null){reply.failure();return;}task.own(value::destroy);reply.success(value);}
                    public void failed(){reply.failure();}public void disconnected(){reply.failure();}
                });return nativePrepared;
            });
            if(ticket.expiresAtMs()!=expiry)throw new IllegalArgumentException("Prepared handoff changed");check(task,owner);
            return new Floor(session,lease,generation,committedTime,expiry,ticket);
        });
    }
    private RelayNativeCredential credential(JSONObject value,long serverTime,long started,WebSocketAudioRelayTransport.Role role,String lease,long generation,Long expectedExpiry)throws Exception{
        Set<String> expected=new HashSet<>(java.util.Arrays.asList("provider","identity","role","token","roomId","origin","leaseId","generation","expiresAt"));
        if(value.length()!=expected.size())throw new IllegalArgumentException("Unexpected relay descriptor");
        for(java.util.Iterator<String> it=value.keys();it.hasNext();)if(!expected.contains(it.next()))throw new IllegalArgumentException("Unexpected relay descriptor");
        if(!"navrang-relay-v1".equals(value.getString("provider"))||!origin.equals(value.getString("origin"))||
            !(role==WebSocketAudioRelayTransport.Role.PUBLISHER?"speaker":"listener").equals(value.getString("role"))||
            !lease.equals(id(value,"leaseId"))||generation!=positive(value,"generation"))throw new IllegalArgumentException("Relay binding changed");
        String room=value.getString("roomId");if(!("nr_"+lease.replace("-","")).equals(room))throw new IllegalArgumentException("Relay room changed");
        long expiry=GateVoiceAuthority.millis(value.getString("expiresAt")),finished=SystemClock.elapsedRealtime();
        long deadline=VoiceCoordinator.deadline(serverTime,expiry,started,finished,15000);
        if(deadline<0||expectedExpiry!=null&&expiry!=expectedExpiry)throw new IllegalArgumentException("Relay expiry changed");
        char[] bearer=value.getString("token").toCharArray();
        try{return new RelayNativeCredential(room,id(value,"identity"),role,deadline,expiry,bearer);}finally{java.util.Arrays.fill(bearer,'\0');}
    }
    private void cleanup(String action,JSONObject payload,Identity owner){if(owner==null)return;
        try{worker.execute(()->{try{server.call(action,payload,owner);}catch(Exception ignored){}});}catch(RuntimeException ignored){}}
    @Override public void release(Identity owner,String session,String lease){if(!PushPolicy.id(session)||!PushPolicy.id(lease))return;
        try{cleanup("voice-release",new JSONObject().put("sessionId",session).put("leaseId",lease),owner);}catch(Exception ignored){}}
    @Override public void leave(Identity owner,String duty){if(!PushPolicy.id(duty))return;
        synchronized(memberships){Membership value=memberships.get(duty);if(value!=null&&value.owner.samePrincipal(owner))memberships.remove(duty);}
        try{cleanup("duty-leave",new JSONObject().put("dutyId",duty),owner);}catch(Exception ignored){}}
    @Override public void close(){closed=true;ArrayList<Task> pending;synchronized(tasks){pending=new ArrayList<>(tasks);tasks.clear();}
        for(Task task:pending){task.settled.set(true);task.abort();}
        Map<String,Membership> joined;synchronized(memberships){joined=new HashMap<>(memberships);memberships.clear();}
        for(Map.Entry<String,Membership> entry:joined.entrySet())leave(entry.getValue().owner,entry.getKey());worker.shutdown();}
    private static long number(JSONObject value,String key)throws Exception{Object raw=value.get(key);if(!(raw instanceof Number))throw new IllegalArgumentException("Numeric relay field required");
        double n=((Number)raw).doubleValue();if(!Double.isFinite(n)||n<0||n>LIMIT||n!=Math.floor(n))throw new IllegalArgumentException("Invalid relay number");return (long)n;}
    private static long positive(JSONObject value,String key)throws Exception{long n=number(value,key);if(n<=0)throw new IllegalArgumentException("Positive relay number required");return n;}
    private static String id(JSONObject value,String key)throws Exception{Object raw=value.get(key);if(!(raw instanceof String)||!PushPolicy.id((String)raw))throw new IllegalArgumentException("Opaque relay identifier required");return (String)raw;}
    private static boolean validOrigin(String value){try{URI uri=new URI(value);String host=uri.getHost();return "https".equals(uri.getScheme())&&host!=null&&host.equals(host.toLowerCase(java.util.Locale.ROOT))&&host.contains(".")&&host.matches("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")&&!host.matches("[0-9.]+")&&
        uri.getPort()==-1&&uri.getRawUserInfo()==null&&uri.getRawQuery()==null&&uri.getRawFragment()==null&&"".equals(uri.getRawPath())&&value.equals("https://"+host);}catch(Exception failure){return false;}}
    private static void safe(Runnable work){try{work.run();}catch(RuntimeException ignored){}}
}
