#!/usr/bin/env python3
"""Exercise real GateSession encryption/caching with in-memory Android platform fakes."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
sources = {
    'android/content/Context.java': '''package android.content;
public class Context {public static final int MODE_PRIVATE=0;public final SharedPreferences prefs=new SharedPreferences();public SharedPreferences getSharedPreferences(String name,int mode){return prefs;}}''',
    'android/content/SharedPreferences.java': '''package android.content;import java.util.*;
public class SharedPreferences {
 public final Map<String,Object> values=new HashMap<>();public boolean fail;
 public String getString(String key,String fallback){return (String)values.getOrDefault(key,fallback);}public long getLong(String key,long fallback){return (Long)values.getOrDefault(key,fallback);}
 public Editor edit(){return new Editor();}public class Editor {Map<String,Object> changes=new HashMap<>();public Editor putString(String k,String v){changes.put(k,v);return this;}public Editor putLong(String k,long v){changes.put(k,v);return this;}public Editor remove(String k){changes.put(k,null);return this;}public boolean commit(){if(fail)return false;for(String k:changes.keySet())if(changes.get(k)==null)values.remove(k);else values.put(k,changes.get(k));return true;}}
}''',
    'android/util/Base64.java': '''package android.util;public class Base64 {public static final int NO_WRAP=0;public static String encodeToString(byte[] value,int flags){return java.util.Base64.getEncoder().encodeToString(value);}public static byte[] decode(String value,int flags){return java.util.Base64.getDecoder().decode(value);}}''',
    'android/security/keystore/KeyProperties.java': '''package android.security.keystore;public class KeyProperties {public static final String KEY_ALGORITHM_AES="AES",BLOCK_MODE_GCM="GCM",ENCRYPTION_PADDING_NONE="NoPadding";public static final int PURPOSE_ENCRYPT=1,PURPOSE_DECRYPT=2;}''',
    'android/security/keystore/KeyGenParameterSpec.java': '''package android.security.keystore;public class KeyGenParameterSpec implements java.security.spec.AlgorithmParameterSpec {public static class Builder {public Builder(String alias,int purposes){}public Builder setBlockModes(String value){return this;}public Builder setEncryptionPaddings(String value){return this;}public KeyGenParameterSpec build(){return new KeyGenParameterSpec();}}}''',
    # The JSON dependency is represented by isolated object snapshots. AES/GCM and
    # the GateSession class itself execute unchanged on the JVM.
    'org/json/JSONObject.java': '''package org.json;import java.util.*;
public class JSONObject {
 private static final Map<String,Map<String,Object>> serialized=new HashMap<>();private final Map<String,Object> values;
 public JSONObject(){values=new LinkedHashMap<>();}public JSONObject(String text){Map<String,Object> v=serialized.get(text);if(v==null)throw new IllegalArgumentException("Invalid JSON fixture");values=copy(v);}
 private static Map<String,Object> copy(Map<String,Object> input){Map<String,Object> out=new LinkedHashMap<>();for(String key:input.keySet()){Object v=input.get(key);out.put(key,v instanceof JSONObject?new JSONObject(((JSONObject)v).toString()):v);}return out;}
 public JSONObject put(String key,Object value){values.put(key,value);return this;}public JSONObject getJSONObject(String key){return (JSONObject)values.get(key);}public JSONObject optJSONObject(String key){return (JSONObject)values.get(key);}
 public String optString(String key){return optString(key,"");}public String optString(String key,String fallback){Object v=values.get(key);return v==null?fallback:v.toString();}public boolean optBoolean(String key){return optBoolean(key,false);}public boolean optBoolean(String key,boolean fallback){Object v=values.get(key);return v instanceof Boolean?(Boolean)v:fallback;}
 public String toString(){String id="json-fixture-"+java.util.UUID.randomUUID();serialized.put(id,copy(values));return id;}
}''',
    'SessionCacheCheck.java': '''import in.navrang.gate.*;import android.content.Context;import org.json.JSONObject;import java.security.*;import java.security.cert.Certificate;import java.io.*;import java.util.*;import javax.crypto.spec.SecretKeySpec;
public class SessionCacheCheck {
 public static class TestStore extends KeyStoreSpi {
  static int loads;static boolean locked;static final Key secret=new SecretKeySpec(new byte[16],"AES");
  public void engineLoad(InputStream input,char[] password){loads++;}public void engineStore(OutputStream out,char[] password){}public Key engineGetKey(String alias,char[] password)throws UnrecoverableKeyException{if(locked)throw new UnrecoverableKeyException("Keystore temporarily unavailable");return secret;}
  public boolean engineContainsAlias(String alias){return true;}public int engineSize(){return 1;}public Enumeration<String> engineAliases(){return Collections.enumeration(Collections.singletonList("navrang-session-v2"));}
  public void engineSetKeyEntry(String a,Key k,char[] p,Certificate[] chain){}public void engineSetKeyEntry(String a,byte[] k,Certificate[] chain){}public void engineSetCertificateEntry(String a,Certificate c){}public void engineDeleteEntry(String a){}
  public Certificate[] engineGetCertificateChain(String a){return null;}public Certificate engineGetCertificate(String a){return null;}public Date engineGetCreationDate(String a){return new Date();}public boolean engineIsKeyEntry(String a){return true;}public boolean engineIsCertificateEntry(String a){return false;}public String engineGetCertificateAlias(Certificate c){return null;}
 }
 static int checks;static void check(boolean value,String reason){checks++;if(!value)throw new AssertionError(reason);}
 static JSONObject profile(boolean scanner){return new JSONObject().put("role","checker").put("active",true).put("station",scanner?"checker":"helpdesk").put("scanner",scanner).put("helpdesk",!scanner).put("checkerId","synthetic-staff");}
 public static void main(String[] args)throws Exception {
  Provider provider=new Provider("TestAndroidKeyStore","1.0","Test-only keystore"){ };provider.put("KeyStore.AndroidKeyStore",TestStore.class.getName());Security.addProvider(provider);
  Context context=new Context();GateSession session=new GateSession(context);JSONObject input=profile(true);session.save("synthetic-token",input);int afterSave=TestStore.loads;
  for(int i=0;i<100;i++)check(GateSession.canScan(session.read()),"saved checker stays active");
  check(TestStore.loads==afterSave,"UI reads must not repeatedly load/decrypt AndroidKeyStore: "+(TestStore.loads-afterSave)+" extra loads");
  input.put("scanner",false);check(GateSession.canScan(session.read()),"caller mutation of save input cannot alter the cached session");
  session.read().getJSONObject("profile").put("scanner",false);check(GateSession.canScan(session.read()),"read snapshots cannot mutate cached permissions");
  GateSession restarted=new GateSession(context);int before=TestStore.loads;check(GateSession.canScan(restarted.read()),"a new process restores encrypted sign-in");restarted.read();check(TestStore.loads==before+1,"restored session decrypts once");
  GateSession temporarilyLocked=new GateSession(context);TestStore.locked=true;check(temporarilyLocked.read()==null,"unavailable keystore fails closed");TestStore.locked=false;check(GateSession.canScan(temporarilyLocked.read()),"temporary keystore failures must retry even when encrypted preferences are unchanged");
  long generation=session.generation(),first=session.beginProfileRequest(),second=session.beginProfileRequest();
  check(session.refreshIfCurrent(generation,"synthetic-token",second,profile(false)),"current reassignment is saved");check(!GateSession.canScan(session.read()),"reassignment replaces cached scanner access immediately");
  check(!session.refreshIfCurrent(generation,"synthetic-token",first,profile(true)),"old profile reply cannot restore permission");
  check(!GateSession.canScan(restarted.read()),"changed encrypted preferences invalidate an existing cache");
  String saved=context.prefs.getString("encrypted","");context.prefs.values.put("encrypted","broken-ciphertext");check(session.read()==null,"damaged storage cannot reuse prior cached permission");
  context.prefs.values.put("encrypted",saved);check(session.read()!=null&&!GateSession.canScan(session.read()),"repaired storage reloads its current permissions");
  session.clear();check(session.read()==null&&restarted.read()==null,"logout invalidates every session snapshot");
  check(!session.saveIfCurrent(generation,"old-token",profile(true)),"old save cannot restore signed-out state");
  session.save("new-token",profile(true));check(!session.clearIfCurrent(generation,"synthetic-token"),"old denial cannot clear the new login");check(GateSession.canScan(session.read()),"new identity remains usable");
  context.prefs.fail=true;try{session.save("failed-token",profile(false));throw new AssertionError("failed persistence was accepted");}catch(IOException expected){}context.prefs.fail=false;
  check("new-token".equals(session.read().optString("token")),"failed save cannot publish new cached identity");
  System.out.println("PASS actual GateSession: "+checks+" checks for one-time decryption, isolated snapshots, invalidation, profile ordering and failed saves.");
 }
}''',
}
with tempfile.TemporaryDirectory(prefix='navrang-session-cache-') as temp:
    folder = Path(temp)
    files = []
    for name, source in sources.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        files.append(str(path))
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), *files, str(root / 'app/java/in/navrang/gate/GateSession.java'), str(root / 'app/java/in/navrang/gate/ResponseOrder.java')], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'SessionCacheCheck'], check=True, timeout=20)
