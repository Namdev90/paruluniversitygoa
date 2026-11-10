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
 private boolean clearedInMemory;
 private String signOutCiphertext,signOutId;
 private static final String REVOCATION_PREFIX="logout-pending-";
 private long validationNanos,validationWall;
 private String previousAccess="",rotatedAccess="";
 private long rotationNanos;
 public synchronized long validatedAtWall(){return validationWall;}
 public synchronized long validationAgeMillis(){if(validationNanos==0)return Long.MAX_VALUE;long elapsed=System.nanoTime()-validationNanos;return elapsed<0?Long.MAX_VALUE:java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(elapsed);}
 private long generation=0;private final ResponseOrder profiles=new ResponseOrder();
 public synchronized long beginProfileRequest(){return profiles.begin();}
 public synchronized long generation(){return generation;}
 public synchronized boolean isCurrent(long expected,String token){JSONObject current=read();return expected==generation&&current!=null&&token.equals(current.optString("token"));}
 /** For a queued native operation, not for authorizing HTTP with an old access token. */
 public synchronized boolean sameIdentity(long expected,String token,String family){JSONObject current=read();if(expected!=generation||current==null)return false;return family!=null&&!family.isEmpty()?family.equals(current.optString("refreshFamilyId")):token.equals(current.optString("token"));}
 public synchronized long beginChange(){generation++;validationNanos=validationWall=0;forgetRotation();prefs.edit().putLong("generation",generation).commit();return generation;}
 public synchronized boolean saveIfCurrent(long expected,String token,JSONObject profile)throws Exception{if(expected!=generation)return false;save(token,profile);return true;}
 public synchronized boolean refreshIfCurrent(long expected,String token,long request,JSONObject profile)throws Exception{JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token"))||!profiles.accept(request))return false;current.put("profile",profile);persist(current,true);return true;}
 public synchronized boolean clearIfCurrent(long expected,String token){JSONObject current=read();if(expected!=generation||current==null||!token.equals(current.optString("token")))return false;clear();return true;}
 public GateSession(Context context){prefs=context.getSharedPreferences("navrang-live-auth",Context.MODE_PRIVATE);generation=prefs.getLong("generation",0);}
 public synchronized boolean hasSavedCredential(){return !clearedInMemory&&!prefs.getString("encrypted","").isEmpty();}
 private SecretKey key() throws Exception{
  KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
  if(!store.containsAlias("navrang-session-v2")){KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder("navrang-session-v2",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
  return (SecretKey)store.getKey("navrang-session-v2",null);
 }
 public synchronized void save(String token,JSONObject profile)throws Exception{
  persist(new JSONObject().put("token",token).put("profile",profile),true);forgetRotation();
 }
 // Only native callers receive this bundle. The refresh secret and pending
 // successor use the existing AndroidKeyStore envelope, never web storage.
 public synchronized boolean saveBundleIfCurrent(long expected,JSONObject bundle)throws Exception{
  if(expected!=generation)return false;
  JSONObject value=bundleForStorage(bundle);
  persist(value,true);forgetRotation();return true;
 }
 private static JSONObject bundleForStorage(JSONObject bundle)throws Exception{
  if(bundle==null||bundle.optString("token").isEmpty()||bundle.optJSONObject("profile")==null)throw new java.io.IOException("Incomplete sign-in response.");
  JSONObject value=new JSONObject().put("token",bundle.optString("token")).put("profile",bundle.optJSONObject("profile"));
  if(bundle.has("refreshToken")){
   if(!hexSecret(bundle.optString("token"))||!hexSecret(bundle.optString("refreshToken"))||!bundle.optString("refreshFamilyId").matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")||bundle.optString("refreshExpiresAt").isEmpty()||bundle.optString("absoluteExpiresAt").isEmpty())throw new java.io.IOException("Incomplete renewable sign-in response.");
   value.put("refreshToken",bundle.optString("refreshToken")).put("refreshFamilyId",bundle.optString("refreshFamilyId")).put("refreshExpiresAt",bundle.optString("refreshExpiresAt")).put("absoluteExpiresAt",bundle.optString("absoluteExpiresAt"));
  }
  return value;
 }
 private static boolean hexSecret(String value){return value!=null&&value.matches("[a-f0-9]{64}");}
 private static String newSecret(){byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);StringBuilder text=new StringBuilder(64);for(byte b:bytes){text.append(Character.forDigit((b&255)>>>4,16));text.append(Character.forDigit(b&15,16));}return text.toString();}
 public synchronized String staffDeviceSecret()throws Exception{
  String saved=prefs.getString("staff-device-v1","");
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
  if(!saved.isEmpty()){
   String[] parts=saved.split(":",2);
   cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
   String value=new String(cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
   if(!hexSecret(value))throw new java.io.IOException("Invalid device credential.");
   return value;
  }
  String value=newSecret();cipher.init(Cipher.ENCRYPT_MODE,key());
  String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!prefs.edit().putString("staff-device-v1",encoded).commit())throw new java.io.IOException("Could not save device verification.");
  return value;
 }
 public synchronized JSONObject prepareRenewal(long expected,String access)throws Exception{
  JSONObject value=read();if(expected!=generation||value==null||!access.equals(value.optString("token"))||!hexSecret(value.optString("refreshToken")))return null;
  JSONObject pending=value.optJSONObject("pendingRefresh");
  if(pending==null){pending=new JSONObject().put("nextRefreshToken",newSecret()).put("requestId",java.util.UUID.randomUUID().toString());value.put("pendingRefresh",pending);persist(value,false);}
  if(!hexSecret(pending.optString("nextRefreshToken"))||!pending.optString("requestId").matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))throw new java.io.IOException("Saved renewal cannot be verified.");
  return new JSONObject(pending.toString());
 }
 public synchronized boolean completeRenewalIfCurrent(long expected,String access,String requestId,JSONObject reply)throws Exception{
  JSONObject current=read();if(expected!=generation||current==null||!access.equals(current.optString("token")))return false;
  JSONObject pending=current.optJSONObject("pendingRefresh");
  if(pending==null||!requestId.equals(pending.optString("requestId"))||reply==null||!current.optString("refreshFamilyId").equals(reply.optString("refreshFamilyId"))||!current.optString("absoluteExpiresAt").equals(reply.optString("absoluteExpiresAt")))return false;
  JSONObject next=new JSONObject(reply.toString()).put("refreshToken",pending.optString("nextRefreshToken"));
  next=bundleForStorage(next);persist(next,true);
  previousAccess=access;rotatedAccess=next.optString("token");rotationNanos=System.nanoTime();return true;
 }
 // A request already queued by this same identity may use its newly rotated
 // access token. This is not a server-side grace period or a new login.
 public synchronized String accessTokenFor(String captured){
  if(captured==null||!captured.equals(previousAccess)||rotationNanos==0)return captured;
  long elapsed=System.nanoTime()-rotationNanos;JSONObject current=read();
  if(elapsed<0||elapsed>=java.util.concurrent.TimeUnit.SECONDS.toNanos(30)||current==null||!rotatedAccess.equals(current.optString("token"))){forgetRotation();return captured;}
  return rotatedAccess;
 }
 private void forgetRotation(){previousAccess=rotatedAccess="";rotationNanos=0;}
 private void persist(JSONObject session,boolean validated)throws Exception{
  if(signOutId!=null)throw new java.io.IOException("Finish saving sign-out before signing in.");
  String value=session.toString();
  Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
  String encoded=Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
  if(!prefs.edit().putString("encrypted",encoded).commit())throw new java.io.IOException("Could not save sign-in securely.");
  cachedEncrypted=encoded;cachedSession=value;clearedInMemory=false;if(validated){validationWall=System.currentTimeMillis();validationNanos=System.nanoTime();}
 }
 public synchronized JSONObject read(){
  if(clearedInMemory)return null;
  String raw=prefs.getString("encrypted","");
  // Preferences are memory-backed. Decrypt only when their encrypted value changes,
  // and return an isolated snapshot so callers cannot edit cached permissions.
  if(!raw.equals(cachedEncrypted)){
   cachedEncrypted=raw;cachedSession=null;validationNanos=validationWall=0;
   if(!raw.isEmpty())try{String[] parts=raw.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));cachedSession=new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
   catch(Exception ignored){cachedEncrypted=null;}
  }
  try{return cachedSession==null?null:new JSONObject(cachedSession);}catch(Exception e){cachedEncrypted=null;cachedSession=null;return null;}
 }
 /** Immediately fence callbacks and private access; retain ciphertext even if the keystore is locked. */
 public synchronized void beginSignOut(){
  if(signOutId==null){signOutCiphertext=prefs.getString("encrypted","");signOutId=REVOCATION_PREFIX+java.util.UUID.randomUUID();}
  generation++;clearedInMemory=true;cachedEncrypted=null;cachedSession=null;validationNanos=validationWall=0;forgetRotation();
 }
 /** One preferences transaction moves the credential out of active auth into the revocation-only queue. */
 public synchronized boolean finishSignOut(){
  if(signOutId==null)return true;
  SharedPreferences.Editor edit=prefs.edit().putLong("generation",generation).remove("encrypted");
  if(!signOutCiphertext.isEmpty())edit.putString(signOutId,signOutCiphertext);
  if(!edit.commit())return false;
  signOutId=signOutCiphertext=null;return true;
 }
 // Native-only snapshots. No queue data is returned by read(), exported, or used for renewal.
 public synchronized java.util.Map<String,String> pendingRevocations(){
  java.util.Map<String,String> result=new java.util.TreeMap<>();
  for(java.util.Map.Entry<String,?> entry:prefs.getAll().entrySet())if(entry.getKey().startsWith(REVOCATION_PREFIX)&&entry.getValue() instanceof String&&!entry.getKey().equals(signOutId))result.put(entry.getKey(),(String)entry.getValue());
  return result;
 }
 public synchronized JSONObject revocationCredential(String encoded)throws Exception{
  String[] parts=encoded.split(":",2);Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
  JSONObject stored=new JSONObject(new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8));
  return new JSONObject().put("token",stored.optString("token")).put("refreshToken",stored.optString("refreshToken"));
 }
 public synchronized boolean acknowledgeRevocation(String id,String encoded){
  String current=prefs.getString(id,"");
  if(!id.startsWith(REVOCATION_PREFIX)||!current.isEmpty()&&!encoded.equals(current))return false;
  return prefs.edit().remove(id).commit();
 }
 public synchronized boolean clearDurably(){generation++;clearedInMemory=true;cachedEncrypted=null;cachedSession=null;validationNanos=validationWall=0;forgetRotation();return prefs.edit().putLong("generation",generation).remove("encrypted").commit();}
 public synchronized void clear(){clearDurably();}
 public static boolean canSync(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active");}
 public static boolean canScan(JSONObject session){JSONObject p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active")&&("admin".equals(p.optString("role"))||p.optBoolean("scanner",false)&&"checker".equals(p.optString("station")));}
 public static String actor(JSONObject session){if(session==null)return "";JSONObject p=session.optJSONObject("profile");if(p==null)return "";return "admin".equals(p.optString("role"))?"admin":p.optString("checkerId","");}
}
