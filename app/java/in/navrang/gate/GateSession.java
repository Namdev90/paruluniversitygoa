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
 private long generation=0;
 public synchronized long generation(){return generation;}
 public synchronized long beginChange(){generation++;prefs.edit().putLong("generation",generation).commit();return generation;}
 public synchronized boolean saveIfCurrent(long expected,String token,JSONObject profile)throws Exception{if(expected!=generation)return false;save(token,profile);return true;}
 public synchronized boolean refreshIfCurrent(long expected,String token,JSONObject profile)throws Exception{JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token")))return false;save(token,profile);return true;}
 public synchronized boolean clearIfCurrent(long expected,String token){JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token")))return false;clear();return true;}
 public GateSession(Context context){prefs=context.getSharedPreferences("navrang-live-auth",Context.MODE_PRIVATE);generation=prefs.getLong("generation",0);}
 private SecretKey key() throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias("navrang-session-v2")){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("navrang-session-v2",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
  return (SecretKey)store.getKey("navrang-session-v2",null);
 }
 public synchronized void save(String token,JSONObject profile)throws Exception{
  JSONObject value=new JSONObject().put("token",token).put("profile",profile);
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!prefs.edit().putString("encrypted",encoded).commit())throw new java.io.IOException("Could not save sign-in securely.");
 }
 public synchronized JSONObject read(){
  String raw=prefs.getString("encrypted","");if(raw.isEmpty())return null;
  try{String[] parts=raw.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return new JSONObject(new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));}
  catch(Exception e){return null;}
 }
 public synchronized void clear(){beginChange();prefs.edit().remove("encrypted").commit();}
 public static boolean canScan(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active")&&("admin".equals(p.optString("role"))||p.optBoolean("scanner",false));}
 public static String actor(JSONObject session){if(session==null)return "";JSONObject p=session.optJSONObject("profile");if(p==null)return "";return "admin".equals(p.optString("role"))?"admin":p.optString("checkerId","");}
}
