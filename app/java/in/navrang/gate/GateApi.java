package in.navrang.gate;
import android.content.Context;
import org.json.JSONObject;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
public final class GateApi {
 public final JSONObject config;
 private volatile boolean automaticRegion=false;
 public static final class Reply {public final int status;public final JSONObject body;Reply(int s,JSONObject b){status=s;body=b;}}
 public GateApi(Context context)throws Exception{try(InputStream in=context.getAssets().open("gate-config.json");ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1)out.write(b,0,n);config=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));}}
 public Reply call(String action,JSONObject payload,String token)throws Exception{
  String endpoint=config.getString("api")+(automaticRegion?"":"?forceFunctionRegion=ap-south-1");
  try{Reply reply=post(endpoint,new JSONObject().put("action",action).put("payload",payload),token,null);if(reply.status>=500)automaticRegion=!automaticRegion;return reply;}catch(IOException e){automaticRegion=!automaticRegion;throw e;}
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
