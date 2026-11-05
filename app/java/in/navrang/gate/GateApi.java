package in.navrang.gate;
import android.content.Context;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
public final class GateApi {
 public final JSONObject config;
 private volatile boolean automaticRegion=false;
 private final SessionRenewal renewal;
 // This token is native-only callback fencing, never part of body/JS replies.
 public static final class Reply {public final int status;public final JSONObject body;public final String sessionToken;Reply(int s,JSONObject b){this(s,b,"");}Reply(int s,JSONObject b,String token){status=s;body=b;sessionToken=token;}}
 public GateApi(Context context)throws Exception{this(context,new GateSession(context),()->false);}
 public GateApi(Context context,GateSession sessions,java.util.function.BooleanSupplier mayRenew)throws Exception{
  try(InputStream in=context.getAssets().open("gate-config.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);config=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}
  android.content.SharedPreferences prefs=context.getSharedPreferences("navrang-live-auth",Context.MODE_PRIVATE);String id;
  synchronized(GateApi.class){id=prefs.getString("installationId","");if(id.isEmpty()){id=java.util.UUID.randomUUID().toString();if(!prefs.edit().putString("installationId",id).commit())throw new IOException("Could not save this installation identifier.");}}
  renewal=new SessionRenewal(sessions,id,mayRenew,(action,payload,token)->{Reply r=callRaw(action,payload,token);return new SessionRenewal.Result(r.status,r.body,token);},()->java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()));
 }
 public Reply call(String action,JSONObject payload,String token)throws Exception{
  SessionRenewal.Result r=renewal.call(action,payload,token);return new Reply(r.status,r.body,r.accessToken);
 }
 public static JSONObject publicBody(JSONObject body)throws Exception{
  JSONObject safe=new JSONObject(body.toString());
  for(String field:new String[]{"token","refreshToken","nextRefreshToken","pendingRefresh","refreshFamilyId","refreshExpiresAt","absoluteExpiresAt"})safe.remove(field);
  return safe;
 }
 private Reply callRaw(String action,JSONObject payload,String token)throws Exception{
  String endpoint=config.getString("api")+(automaticRegion?"":"?forceFunctionRegion=ap-south-1");
  try{Reply reply=post(endpoint,new JSONObject().put("action",action).put("payload",payload),token,null);if(reply.status==401&&token!=null&&!token.isEmpty()&&!AuthResponsePolicy.sessionRejected(reply.body))reply=new Reply(503,new JSONObject().put("ok",false).put("error","Sign-in verification is unavailable. Your saved session is retained; reconnect and retry."));if(reply.status>=500)automaticRegion=!automaticRegion;return reply;}catch(IOException e){automaticRegion=!automaticRegion;throw e;}
 }
 public Reply exchange(String code,String verifier)throws Exception{return post(config.getString("project")+"/auth/v1/token?grant_type=pkce",new JSONObject().put("auth_code",code).put("code_verifier",verifier),"",config.getString("publishableKey"));}
 public Reply exchangeGoogleIdToken(String idToken,String rawNonce)throws Exception{return post(config.getString("project")+"/auth/v1/token?grant_type=id_token",new JSONObject().put("provider","google").put("id_token",idToken).put("nonce",rawNonce),"",config.getString("publishableKey"));}
 private Reply post(String endpoint,JSONObject body,String token,String key)throws Exception{
  URL url=new URL(endpoint);if(!"https".equals(url.getProtocol()))throw new IOException("HTTPS is required.");
  HttpURLConnection con=(HttpURLConnection)url.openConnection();con.setInstanceFollowRedirects(false);con.setUseCaches(false);con.setRequestProperty("Cache-Control","no-store");con.setConnectTimeout(5000);con.setReadTimeout(15000);con.setRequestMethod("POST");con.setDoOutput(true);con.setRequestProperty("Content-Type","application/json");con.setRequestProperty("Accept","application/json");if(token!=null&&!token.isEmpty())con.setRequestProperty("Authorization","Bearer "+token);if(key!=null)con.setRequestProperty("apikey",key);
  try{byte[] data=body.toString().getBytes(StandardCharsets.UTF_8);con.setFixedLengthStreamingMode(data.length);try(OutputStream out=con.getOutputStream()){out.write(data);}
   int status=con.getResponseCode();InputStream stream=status>=400?con.getErrorStream():con.getInputStream();if(stream==null)throw new IOException("No server response.");
   try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1){if(out.size()+n>20*1024*1024)throw new IOException("Server response is too large.");out.write(b,0,n);}return new Reply(status,new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8)));}
  }finally{con.disconnect();}
 }
}
