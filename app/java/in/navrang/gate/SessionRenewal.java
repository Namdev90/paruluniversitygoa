package in.navrang.gate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.BooleanSupplier;
import java.util.function.LongSupplier;
import org.json.JSONObject;

/** Serializes rotations; HTTP and Android lifecycle remain at their boundaries. */
public final class SessionRenewal {
 public interface Transport {Result call(String action,JSONObject payload,String access)throws Exception;}
 public static final class Result {
  public final int status;public final JSONObject body;public final String accessToken;
  public Result(int status,JSONObject body,String access){this.status=status;this.body=body;this.accessToken=access;}
 }
 private final GateSession sessions;private final String installationId;
 private final BooleanSupplier mayRenew;private final Transport transport;private final LongSupplier elapsedMillis;
 private final Object rotation=new Object();private long nextAttempt;private int failures;
 public SessionRenewal(GateSession sessions,String installationId,BooleanSupplier mayRenew,Transport transport,LongSupplier elapsedMillis){
  this.sessions=sessions;this.installationId=installationId;this.mayRenew=mayRenew;this.transport=transport;this.elapsedMillis=elapsedMillis;
 }
 public Result call(String action,JSONObject payload,String captured)throws Exception{
  if("session-refresh".equals(action)||"session-revoke".equals(action))throw new IllegalArgumentException("Session renewal is native only.");
  // Revocation never substitutes another identity's access token or attempts renewal.
  if("logout".equals(action))return transport.call(action,payload.has("refreshToken")?new JSONObject(payload.toString()).put("installationId",installationId):payload,captured);
  if("login".equals(action)||"checker-login".equals(action)||"google-login".equals(action)){
   JSONObject login=new JSONObject(payload.toString()).put("authProtocol",1).put("installationId",installationId);
   return transport.call(action,login,"");
  }
  final long generation=sessions.generation();String access=sessions.accessTokenFor(captured);
  if(access!=null&&!access.isEmpty()&&!"logout".equals(action)&&!sessions.isCurrent(generation,access))return changed();
  Result original=normalize(transport.call(action,payload,access),access);
  if(original.status!=401||access==null||access.isEmpty()||"logout".equals(action))return original;
  synchronized(rotation){
   if(generation!=sessions.generation())return changed();
   String currentAccess=sessions.accessTokenFor(access);
   if(!access.equals(currentAccess)){
    if(!sessions.isCurrent(generation,currentAccess))return changed();
    return normalize(transport.call(action,payload,currentAccess),currentAccess);
   }
   JSONObject current=sessions.read();
   if(current==null||!sessions.isCurrent(generation,access))return changed();
   if(current.optString("refreshToken").isEmpty())return original;
   // Background notifications must not keep a seven-day idle session alive.
   if(!mayRenew.getAsBoolean()||elapsedMillis.getAsLong()<nextAttempt)return waiting();
   JSONObject pending=sessions.prepareRenewal(generation,access);if(pending==null)return changed();
   JSONObject request=new JSONObject().put("refreshToken",current.optString("refreshToken"))
    .put("nextRefreshHash",sha256(pending.optString("nextRefreshToken")))
    .put("requestId",pending.optString("requestId")).put("installationId",installationId);
   Result refreshed;
   try{refreshed=normalize(transport.call("session-refresh",request,""),access);}
   catch(Exception unavailable){backoff();return waiting();}
   if(generation!=sessions.generation())return changed();
   if(refreshed.status==401&&AuthResponsePolicy.sessionRejected(refreshed.body))return refreshed;
   if(refreshed.status!=200||!refreshed.body.optBoolean("ok")){backoff();return waiting();}
   try{if(!sessions.completeRenewalIfCurrent(generation,access,pending.optString("requestId"),refreshed.body)){backoff();return waiting();}}
   catch(Exception storageUnavailable){backoff();return waiting();}
   failures=0;nextAttempt=0;
   String renewed=sessions.read().optString("token");
   // Commit a consumed rotation even if the screen locked during HTTP, but do
   // not replay private work until the app is foregrounded and unlocked.
   if(!mayRenew.getAsBoolean())return waiting();
   return normalize(transport.call(action,payload,renewed),renewed);
  }
 }
 private void backoff(){failures=Math.min(failures+1,6);long delay=Math.min(60000L,1000L<<(failures-1));nextAttempt=elapsedMillis.getAsLong()+delay+ThreadLocalRandom.current().nextLong(501);}
 private static String sha256(String value)throws Exception{
  byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder text=new StringBuilder(64);
  for(byte b:digest){text.append(Character.forDigit((b&255)>>>4,16));text.append(Character.forDigit(b&15,16));}return text.toString();
 }
 private static Result normalize(Result result,String access)throws Exception{
  if(result.status==401&&!AuthResponsePolicy.sessionRejected(result.body))return waiting();
  return new Result(result.status,result.body,access);
 }
 private static Result waiting()throws Exception{return new Result(503,new JSONObject().put("ok",false).put("error","Sign-in verification is unavailable. Your saved session is retained; open and unlock Navrang with a connection, then retry."),"");}
 private static Result changed()throws Exception{return new Result(409,new JSONObject().put("ok",false).put("error","Sign-in changed while this request was running."),"");}
}
