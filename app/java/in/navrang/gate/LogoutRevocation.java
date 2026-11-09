package in.navrang.gate;

import java.util.HashMap;
import java.util.Map;
import java.util.function.LongSupplier;
import org.json.JSONObject;

/** Revocation-only retries. Never renews, restores auth, emits private data, or clears a newer login. */
public final class LogoutRevocation {
 public interface Transport {GateApi.Reply revoke(JSONObject payload,String access)throws Exception;}
 private final GateSession sessions;private final Transport transport;private final LongSupplier clock;
 private final Map<String,String> retained=new HashMap<>();
 private final Map<String,Long> due=new HashMap<>();private final Map<String,Integer> failures=new HashMap<>();
 public LogoutRevocation(GateSession sessions,Transport transport,LongSupplier clock){this.sessions=sessions;this.transport=transport;this.clock=clock;}
 // The runtime calls this only while foregrounded, including its locked/public screen.
 // Retention also handles SharedPreferences updating memory before a failed disk commit.
 public synchronized void tick(){
  retained.putAll(sessions.pendingRevocations());int budget=4;
  java.util.List<Map.Entry<String,String>> work=new java.util.ArrayList<>(retained.entrySet());
  work.sort(java.util.Comparator.<Map.Entry<String,String>>comparingLong(entry->due.getOrDefault(entry.getKey(),0L)).thenComparing(Map.Entry::getKey));
  for(Map.Entry<String,String> entry:work){
   String id=entry.getKey(),encoded=entry.getValue();long now=clock.getAsLong();
   if(now<due.getOrDefault(id,0L))continue;
   if(budget--<=0)break;
   try{
    JSONObject credential=sessions.revocationCredential(encoded),payload=new JSONObject();
    String refresh=credential.optString("refreshToken"),token=credential.optString("token");
    if(!refresh.isEmpty())payload.put("refreshToken",refresh);
    if(token.isEmpty()&&refresh.isEmpty())throw new IllegalStateException("Revocation credential unavailable.");
    GateApi.Reply reply=transport.revoke(payload,token);
    // A gateway/authorization error is not proof that this family was revoked.
    if(reply.status==200&&reply.body.optBoolean("ok")&&reply.body.optBoolean("signedOut")&&sessions.acknowledgeRevocation(id,encoded)){
     retained.remove(id);due.remove(id);failures.remove(id);continue;
    }
   }catch(Exception unavailable){/* Keep the encrypted item; no secrets or transport errors enter logs/UI. */}
   int count=Math.min(7,failures.getOrDefault(id,0)+1);failures.put(id,count);
   due.put(id,clock.getAsLong()+Math.min(60000L,1000L<<(count-1)));
  }
 }
}
