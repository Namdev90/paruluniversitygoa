package in.navrang.gate;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
public final class GateSession {
 private final SharedPreferences prefs;
 private String cachedEncrypted,cachedSession;
 private long generation=0;private final ResponseOrder profiles=new ResponseOrder();
 public synchronized long beginProfileRequest(){return profiles.begin();}
 public synchronized long generation(){return generation;}
 public synchronized boolean isCurrent(long expected,String token){JSONObject current=read();return expected==generation&&current!=null&&token.equals(current.optString("token"));}
 public synchronized long beginChange(){generation++;prefs.edit().putLong("generation",generation).commit();return generation;}
 public synchronized boolean saveIfCurrent(long expected,String token,JSONObject profile)throws Exception{if(expected!=generation)return false;save(token,profile);return true;}
 public synchronized boolean refreshIfCurrent(long expected,String token,long request,JSONObject profile)throws Exception{JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token"))||!profiles.accept(request))return false;save(token,profile);return true;}
 public synchronized boolean clearIfCurrent(long expected,String token){JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token")))return false;clear();return true;}
 public GateSession(Context context){prefs=context.getSharedPreferences("navrang-live-auth",Context.MODE_PRIVATE);generation=prefs.getLong("generation",0);}
 private SecretKey key() throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias("navrang-session-v2")){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("navrang-session-v2",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
  return (SecretKey)store.getKey("navrang-session-v2",null);
 }
 public synchronized void save(String token,JSONObject profile)throws Exception{
  String value=new JSONObject().put("token",token).put("profile",profile).toString();
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!prefs.edit().putString("encrypted",encoded).commit())throw new java.io.IOException("Could not save sign-in securely.");
  cachedEncrypted=encoded;cachedSession=value;
 }
 public synchronized JSONObject read(){
  String raw=prefs.getString("encrypted","");
  // Preferences are memory-backed. Decrypt only when their encrypted value changes,
  // and return an isolated snapshot so callers cannot edit cached permissions.
  if(!raw.equals(cachedEncrypted)){
   cachedEncrypted=raw;cachedSession=null;
   if(!raw.isEmpty())try{String[] parts=raw.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cachedSession=new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
   catch(Exception ignored){cachedEncrypted=null;}
  }
  try{return cachedSession==null?null:new JSONObject(cachedSession);}catch(Exception e){cachedEncrypted=null;cachedSession=null;return null;}
 }
 public synchronized void clear(){beginChange();prefs.edit().remove("encrypted").commit();cachedEncrypted=null;cachedSession=null;}
 public static boolean canSync(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active");}
 public static boolean canScan(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active")&&("admin".equals(p.optString("role"))||p.optBoolean("scanner",false)&&"checker".equals(p.optString("station")));}
 public static String actor(JSONObject session){if(session==null)return "";JSONObject p=session.optJSONObject("profile");if(p==null)return "";return "admin".equals(p.optString("role"))?"admin":p.optString("checkerId","");}
}
