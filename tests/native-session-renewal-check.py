#!/usr/bin/env python3
"""Real native vault + renewal coordinator; only Android and HTTP are isolated."""
from pathlib import Path
import runpy
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
sources = runpy.run_path(str(root / 'tests/native-session-cache-check.py'))['sources'].copy()
sources['android/content/Context.java'] = sources['android/content/Context.java'].replace('public static final int', 'public android.content.res.AssetManager getAssets(){return new android.content.res.AssetManager();}public static final int')
sources['android/content/res/AssetManager.java'] = '''package android.content.res;public class AssetManager {public static String config;public java.io.InputStream open(String name){return new java.io.ByteArrayInputStream(config.getBytes(java.nio.charset.StandardCharsets.UTF_8));}}'''
sources['NativeRenewalCheck.java'] = r'''
import in.navrang.gate.*;import android.content.Context;import org.json.JSONObject;import java.security.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;import java.net.*;import java.io.*;
public class NativeRenewalCheck {
 static final String A="a".repeat(64),R="b".repeat(64),C="c".repeat(64),F="12345678-1234-4234-9234-123456789abc";
 static int checks;static void check(boolean ok,String why){checks++;if(!ok)throw new AssertionError(why);}
 static JSONObject profile(){return new JSONObject().put("role","admin").put("active",true);}
 static JSONObject reply(){return new JSONObject().put("ok",true).put("token",C).put("profile",profile()).put("refreshFamilyId",F).put("refreshExpiresAt","2026-11-02T00:00:00Z").put("absoluteExpiresAt","2026-11-24T00:00:00Z");}
 static GateSession session()throws Exception{GateSession s=new GateSession(new Context());s.saveBundleIfCurrent(s.generation(),new JSONObject().put("token",A).put("refreshToken",R).put("profile",profile()).put("refreshFamilyId",F).put("refreshExpiresAt","2026-11-01T00:00:00Z").put("absoluteExpiresAt","2026-11-24T00:00:00Z"));return s;}
 static SessionRenewal.Result expired(){return new SessionRenewal.Result(401,new JSONObject().put("ok",false).put("error","Sign in again."),A);}
 static SessionRenewal.Result ok(String token){return new SessionRenewal.Result(200,new JSONObject().put("ok",true),token);}
 static final ArrayDeque<SessionRenewal.Result> http=new ArrayDeque<>();static final List<JSONObject> posted=new ArrayList<>();
 static class FakeHttp extends HttpURLConnection {
  final ByteArrayOutputStream out=new ByteArrayOutputStream();SessionRenewal.Result response;FakeHttp(URL url){super(url);}
  public OutputStream getOutputStream(){return out;}public int getResponseCode(){posted.add(new JSONObject(out.toString(java.nio.charset.StandardCharsets.UTF_8)));response=http.remove();return response.status;}
  public InputStream getInputStream(){return new ByteArrayInputStream(response.body.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}public InputStream getErrorStream(){return getInputStream();}
  public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
 }
 public static void main(String[] args)throws Exception{
  Provider provider=new Provider("TestAndroidKeyStore","1.0","Test-only keystore"){};provider.put("KeyStore.AndroidKeyStore",SessionCacheCheck.TestStore.class.getName());Security.addProvider(provider);
  GateSession s=session();List<JSONObject> renewalPosts=new ArrayList<>();List<String> actions=new ArrayList<>();
  SessionRenewal nativeApi=new SessionRenewal(s,"fixture-install",()->true,(action,payload,token)->{
   actions.add(action);if(action.equals("session-refresh")){renewalPosts.add(payload);return new SessionRenewal.Result(200,reply(),"");}return A.equals(token)?expired():ok(token);
  },()->1000L);
  SessionRenewal.Result result=nativeApi.call("me",new JSONObject(),A);
  check(result.status==200&&C.equals(result.accessToken),"expired access is renewed and retried using the committed access");
  check(actions.equals(Arrays.asList("me","session-refresh","me")),"one bounded original-action retry after rotation");
  check(R.equals(renewalPosts.get(0).optString("refreshToken"))&&"fixture-install".equals(renewalPosts.get(0).optString("installationId")),"rotation targets its own installation");
  check(renewalPosts.get(0).optString("nextRefreshHash").matches("[a-f0-9]{64}")&&!renewalPosts.get(0).has("nextRefreshToken"),"only successor hash crosses the HTTP boundary");
  check(!R.equals(s.read().optString("refreshToken")),"successful rotation replaces the consumed refresh secret");
  check(nativeApi.call("sync",new JSONObject(),A).status==200&&renewalPosts.size()==1,"queued access from the same identity reuses the committed rotation");

  AtomicInteger posts=new AtomicInteger();GateSession offline=session();AtomicLong time=new AtomicLong(1000);List<JSONObject> retries=new ArrayList<>();
  SessionRenewal retryApi=new SessionRenewal(offline,"fixture-install",()->true,(action,payload,token)->{
   if(action.equals("session-refresh")){retries.add(payload);if(posts.incrementAndGet()==1)throw new java.io.IOException("Synthetic lost response");return new SessionRenewal.Result(200,reply(),"");}return A.equals(token)?expired():ok(token);
  },time::get);
  check(retryApi.call("me",new JSONObject(),A).status==503&&offline.read()!=null,"lost refresh response preserves the encrypted credential");
  check(retryApi.call("me",new JSONObject(),A).status==503&&posts.get()==1,"backoff prevents repeated refresh requests");
  time.set(4000);check(retryApi.call("me",new JSONObject(),A).status==200,"same pending operation can recover inside the server's 30-second retry window");
  check(retries.get(0).optString("requestId").equals(retries.get(1).optString("requestId"))&&retries.get(0).optString("nextRefreshHash").equals(retries.get(1).optString("nextRefreshHash")),"retry never creates a second successor for a consumed credential");

  GateSession background=session();AtomicInteger backgroundRefresh=new AtomicInteger();
  SessionRenewal asleep=new SessionRenewal(background,"fixture-install",()->false,(action,payload,token)->{if(action.equals("session-refresh"))backgroundRefresh.incrementAndGet();return expired();},()->1000L);
  check(asleep.call("me",new JSONObject(),A).status==503&&backgroundRefresh.get()==0&&background.read()!=null,"background or locked work cannot renew inactivity or sign out a valid refresh path");
  AtomicInteger gatewayPosts=new AtomicInteger();SessionRenewal gateway=new SessionRenewal(session(),"fixture-install",()->true,(action,payload,token)->{gatewayPosts.incrementAndGet();return new SessionRenewal.Result(401,new JSONObject().put("message","Invalid JWT"),token);},()->1000L);
  check(gateway.call("me",new JSONObject(),A).status==503&&gatewayPosts.get()==1,"gateway 401 must not rotate or delete a Navrang session");
  GateSession stale=session();SessionRenewal changed=new SessionRenewal(stale,"fixture-install",()->true,(action,payload,token)->{if(action.equals("session-refresh")){stale.beginChange();stale.save("new-user-token",profile());return new SessionRenewal.Result(200,reply(),"");}return expired();},()->1000L);
  check(changed.call("me",new JSONObject(),A).status==409&&"new-user-token".equals(stale.read().optString("token")),"an interrupted account change cannot restore a prior refresh family");

  GateSession parallel=session();AtomicInteger rotations=new AtomicInteger();CountDownLatch oldRequests=new CountDownLatch(2);
  SessionRenewal concurrent=new SessionRenewal(parallel,"fixture-install",()->true,(action,payload,token)->{
   if(action.equals("session-refresh")){rotations.incrementAndGet();return new SessionRenewal.Result(200,reply(),"");}if(A.equals(token)){oldRequests.countDown();check(oldRequests.await(2,TimeUnit.SECONDS),"both original calls arrived");return expired();}return ok(token);
  },()->1000L);
  ExecutorService pool=Executors.newFixedThreadPool(2);try{
   Future<SessionRenewal.Result> a=pool.submit(()->concurrent.call("me",new JSONObject(),A)),b=pool.submit(()->concurrent.call("sync",new JSONObject(),A));
   check(a.get(3,TimeUnit.SECONDS).status==200&&b.get(3,TimeUnit.SECONDS).status==200&&rotations.get()==1,"concurrent access failures coalesce one refresh without reuse-family invalidation");
  }finally{pool.shutdownNow();}
  AtomicReference<JSONObject> loginPayload=new AtomicReference<>();SessionRenewal login=new SessionRenewal(session(),"fixture-install",()->true,(action,payload,token)->{loginPayload.set(payload);return ok("");},()->1000L);
  JSONObject original=new JSONObject().put("username","synthetic");login.call("login",original,"");
  check("1".equals(loginPayload.get().optString("authProtocol"))&&"fixture-install".equals(loginPayload.get().optString("installationId"))&&!original.has("authProtocol"),"native login advertises the optional protocol without mutating caller data");
  URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new FakeHttp(url);}}:null);
  android.content.res.AssetManager.config=new JSONObject().put("api","https://fixture.invalid/gate").put("project","https://fixture.invalid").put("publishableKey","synthetic-public").toString();
  GateSession wired=session();GateApi api=new GateApi(new Context(),wired,()->true);
  http.add(expired());http.add(new SessionRenewal.Result(200,reply(),""));http.add(ok(C));
  GateApi.Reply actual=api.call("me",new JSONObject(),A);
  check(actual.status==200&&C.equals(actual.sessionToken)&&wired.isCurrent(wired.generation(),C),"real GateApi wires HTTP rotation to its shared encrypted session and identifies the effective access");
  check(posted.size()==3&&"session-refresh".equals(posted.get(1).optString("action"))&&http.isEmpty(),"real HTTP path is bounded and never contacts a live endpoint in this fixture");
  JSONObject publicReply=GateApi.publicBody(new JSONObject(reply().toString()).put("refreshToken",R).put("nextRefreshToken",R).put("pendingRefresh",new JSONObject().put("secret",R)));
  check(publicReply.optJSONObject("profile")!=null&&!publicReply.has("token")&&!publicReply.has("refreshToken")&&!publicReply.has("nextRefreshToken")&&!publicReply.has("pendingRefresh"),"generic bridge output cannot disclose any renewal credential");
  AtomicReference<JSONObject> revokePayload=new AtomicReference<>();SessionRenewal revoke=new SessionRenewal(session(),"fixture-install",()->false,(action,payload,token)->{revokePayload.set(payload);return ok(token);},()->1000L);
  revoke.call("logout",new JSONObject().put("refreshToken",R),A);
  check("fixture-install".equals(revokePayload.get().optString("installationId")),"logout can revoke the captured refresh family after local clearing or access expiry");
  System.out.println("PASS actual native SessionRenewal + encrypted GateSession: "+checks+" checks.");
 }
}
'''
with tempfile.TemporaryDirectory(prefix='navrang-renewal-') as temp:
    folder = Path(temp)
    files = []
    for name, source in sources.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)
        files.append(str(path))
    real = [root / 'app/java/in/navrang/gate' / name for name in
            ('GateSession.java', 'SessionRenewal.java', 'GateApi.java', 'AuthResponsePolicy.java', 'ResponseOrder.java')]
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), *files, *map(str, real)], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'NativeRenewalCheck'], check=True, timeout=20)
