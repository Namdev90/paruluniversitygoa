package in.navrang.gate;
import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity implements GateRuntime.Listener,GateUpdater.Listener {
 private static final int CAMERA_PERMISSION=44,UPDATE_NOTIFICATIONS=45,START_PERMISSIONS=46,EXPORT_DOCUMENT=47,REPORT_DOCUMENT=48;
 private GateReadiness readiness;private String exportContent;private long exportGeneration=-1;
 private String reportContent;private long reportGeneration=-1;
 private WebView web;
 private GateRuntime runtime;
 private String pendingLogoutToken;private boolean clearingSignOut;
 protected Class<? extends Activity> scannerActivity(){return ScanActivity.class;}
 protected void clearCredentialProvider(){}
 protected boolean updatesEnabled(){return true;}
 protected final void nativeError(String text){error(text);}
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);GateReadiness.volume(this);readiness=new GateReadiness(this);GateFeedback.init(this);if(updatesEnabled())GateUpdater.init(this);else GateUpdater.setAutomatic(this,false);
  try{runtime=GateRuntime.get(this);}catch(Exception e){showMessage("Could not open saved data. Keep app data.\n\n"+e.getMessage());return;}
  getWindow().setStatusBarColor(Color.rgb(16,13,21));getWindow().setNavigationBarColor(Color.rgb(16,13,21));getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
  FrameLayout frame=new FrameLayout(this);
  try{web=new WebView(this);}catch(Exception e){showMessage("Update Android System WebView / Chrome and reopen Navrang Gate.");return;}
  if(!WebViewSupport.supported(web.getSettings().getUserAgentString())){web.destroy();web=null;showMessage("Update Android System WebView / Chrome to version 86 or newer, then reopen Navrang Gate. Confirmed entries remain on the server. Unconfirmed requests are temporary and may be lost when the app closes.");return;}
  frame.addView(web);frame.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i.consumeSystemWindowInsets();});setContentView(frame);frame.requestApplyInsets();
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  s.setCacheMode(WebSettings.LOAD_NO_CACHE);web.clearCache(true);web.clearFormData();web.setSaveEnabled(false);web.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);web.setOnLongClickListener(v->{WebView.HitTestResult hit=web.getHitTestResult();return hit==null||hit.getType()!=WebView.HitTestResult.EDIT_TEXT_TYPE;});
  WebView.setWebContentsDebuggingEnabled(false);web.addJavascriptInterface(new Bridge(),"Native");
  web.setWebViewClient(new WebViewClient(){
   private boolean allowed(String url){return url!=null&&url.startsWith("file:///android_asset/");}
   @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){return !allowed(r.getUrl().toString());}
   @Override public boolean shouldOverrideUrlLoading(WebView w,String u){return !allowed(u);}
   @Override public WebResourceResponse shouldInterceptRequest(WebView w,WebResourceRequest r){String u=r.getUrl().toString();if(allowed(u))return null;return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
  });
  web.loadUrl("file:///android_asset/index.html");handleOAuth(getIntent());
 }
 private void showMessage(String text){TextView v=new TextView(this);v.setText(text);v.setTextSize(18);v.setPadding(35,70,35,35);setContentView(v);}
 private void call(String fn,String json){runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript("window."+fn+" && window."+fn+"("+JSONObject.quote(json)+");",null);});}
 private void error(String text){call("onNativeError",text);}
 @Override public void updated(JSONObject state){try{event(new JSONObject().put("type","update").put("data",state));}catch(Exception ignored){}}
 @Override public void event(JSONObject e){if("auth".equals(e.optString("type"))||"profile".equals(e.optString("type")))runOnUiThread(()->{if(!exportAllowed(exportGeneration))clearExport();if(!reportAllowed(reportGeneration))clearReport();});call("onGateEvent",e.toString());}
 private void clearExport(){exportContent=null;exportGeneration=-1;}
 private void clearReport(){reportContent=null;reportGeneration=-1;}
 private boolean reportAllowed(long expected){if(runtime==null||expected!=runtime.sessions.generation())return false;JSONObject session=runtime.sessions.read(),p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active")&&("admin".equals(p.optString("role"))||p.optBoolean("reports",false));}
 private boolean exportAllowed(long expected){if(runtime==null||expected!=runtime.sessions.generation())return false;JSONObject session=runtime.sessions.read(),p=session==null?null:session.optJSONObject("profile");return p!=null&&p.optBoolean("active")&&"admin".equals(p.optString("role"));}
 private void beginScan(){
  JSONObject auth=runtime.sessions.read();if(!GateSession.canScan(auth)||("google".equals(auth.optJSONObject("profile").optString("method"))&&!auth.optJSONObject("profile").optBoolean("nameConfirmed",true))){error("Sign in with an approved checker account first.");return;}
  if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA_PERMISSION);return;}
  try{startActivity(new Intent(this,scannerActivity()));}catch(Exception e){error("Camera could not open. Use manual entry.");}
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==START_PERMISSIONS||request==UPDATE_NOTIFICATIONS){GateUpdater.publish(this);runtime.emit("readiness",GateReadiness.status(this));return;}if(request==CAMERA_PERMISSION){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)beginScan();else error("Allow camera permission in Android settings, or use manual entry.");}}
 private void preparePermissions(boolean initial){
  android.content.SharedPreferences p=getSharedPreferences("navrang-readiness",MODE_PRIVATE);if(initial&&p.getBoolean("prompted",false))return;p.edit().putBoolean("prompted",true).apply();
  java.util.ArrayList<String> wanted=new java.util.ArrayList<>();if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED)wanted.add(Manifest.permission.CAMERA);if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)wanted.add(Manifest.permission.POST_NOTIFICATIONS);
  if(!wanted.isEmpty())requestPermissions(wanted.toArray(new String[0]),START_PERMISSIONS);else runtime.emit("readiness",GateReadiness.status(this));
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==REPORT_DOCUMENT){
   final String content=reportContent;final long generation=reportGeneration;clearReport();
   if(result==RESULT_OK&&data!=null&&data.getData()!=null&&content!=null&&reportAllowed(generation)){
    final Uri uri=data.getData();runtime.requests.execute(()->{
     if(!refreshExportAccess(generation,false)){error("Reporting access changed. Refresh and download again.");return;}
     try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){
      if(out==null)throw new IOException("No document destination.");
      byte[] bytes=android.util.Base64.decode(content,android.util.Base64.NO_WRAP);
      if(bytes.length>12*1024*1024)throw new IOException("Report exceeds size limit.");
      for(int at=0;at<bytes.length;at+=16384){
       if(!reportAllowed(generation))throw new IOException("Reporting access changed.");
       out.write(bytes,at,Math.min(16384,bytes.length-at));
      }
      if(reportAllowed(generation))call("onNativeSaved","Navrang report");
     }catch(Exception e){if(reportAllowed(generation))error("Could not save report. Try another location.");}
    });
   }return;
  }
  if(request!=EXPORT_DOCUMENT)return;String content=exportContent;final long generation=exportGeneration;clearExport();if(result==RESULT_OK&&data!=null&&data.getData()!=null&&content!=null&&exportAllowed(generation)){final Uri uri=data.getData();runtime.requests.execute(()->{if(!refreshExportAccess(generation,true)){error("Administrator access changed. Refresh and download again.");return;}try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();byte[] bytes=content.getBytes(StandardCharsets.UTF_8);for(int at=0;at<bytes.length;at+=16384){if(!exportAllowed(generation))throw new IOException("Admin sign-in changed.");out.write(bytes,at,Math.min(16384,bytes.length-at));}if(exportAllowed(generation))call("onNativeSaved","Help Desk export");}catch(Exception e){if(exportAllowed(generation))error("Could not save the export. Download it again from Help Desk.");}});}}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleOAuth(intent);}
 protected void googleLogin(){
  final long generation=runtime.sessions.beginChange();
  runtime.requests.execute(()->{try{
   GateApi.Reply config=runtime.api.call("config",new JSONObject(),"");
   if(!config.body.optBoolean("googleEnabled")){error("Google sign-in awaits Google Cloud / Supabase provider setup. Ask the admin for an assigned checker code.");return;}
   String verifier=Pkce.verifier(),nonce=Pkce.verifier();
   getSharedPreferences("navrang-pkce",MODE_PRIVATE).edit().putString("verifier",verifier).putString("nonce",nonce).putLong("created",System.currentTimeMillis()).putLong("sessionGeneration",generation).commit();
   String redirect=runtime.api.config.getString("oauthRedirect")+"?state="+Uri.encode(nonce);
   Uri url=Uri.parse(runtime.api.config.getString("project")+"/auth/v1/authorize").buildUpon().appendQueryParameter("provider","google").appendQueryParameter("redirect_to",redirect).appendQueryParameter("code_challenge",Pkce.challenge(verifier)).appendQueryParameter("code_challenge_method","s256").build();
   runOnUiThread(()->{try{startActivity(new Intent(Intent.ACTION_VIEW,url));}catch(Exception e){error("Install a browser to sign in with Google.");}});
  }catch(Exception e){error("Could not start Google sign-in. Check your connection.");}});
 }
 private void handleOAuth(Intent intent){
  Uri u=intent==null?null:intent.getData();if(u==null)return;
  android.content.SharedPreferences p=getSharedPreferences("navrang-pkce",MODE_PRIVATE);
  String verifier=p.getString("verifier",""),nonce=p.getString("nonce","");
  if(verifier.isEmpty()||System.currentTimeMillis()-p.getLong("created",0)>10*60*1000)return;
  OAuthCallback callback=OAuthCallback.parse(u.toString(),nonce);if(callback==null)return;
  final long generation=p.getLong("sessionGeneration",-1);p.edit().clear().commit();
  if(callback.code.isEmpty()){error(callback.message);return;}final String code=callback.code;
  runtime.requests.execute(()->{try{
   if(generation!=runtime.sessions.generation())return;
   GateApi.Reply exchange=runtime.api.exchange(code,verifier);if(exchange.status!=200)throw new IOException();
   if(generation!=runtime.sessions.generation())return;
   GateApi.Reply r=runtime.api.call("google-login",new JSONObject().put("accessToken",exchange.body.getString("access_token")),"");
   if(r.status!=200||!r.body.optBoolean("ok")){error(r.body.optString("error","Google sign-in failed."));return;}
   if(!runtime.sessions.saveIfCurrent(generation,r.body.getString("token"),r.body.getJSONObject("profile")))return;p.edit().clear().commit();runtime.db.clearTemporary();runtime.emit("auth",r.body.getJSONObject("profile"));runtime.refresh();
  }catch(Exception e){error("Google sign-in could not finish. Reopen sign-in with a working connection.");}});
 }
 /** A picker may outlive a role/session grant. Refresh server authority before opening a file. */
 private boolean refreshExportAccess(long generation,boolean adminOnly){
  try{
   JSONObject session=runtime.sessions.read();if(session==null||generation!=runtime.sessions.generation())return false;
   String token=session.getString("token");long sequence=runtime.sessions.beginProfileRequest();
   GateApi.Reply reply=runtime.api.call("me",new JSONObject(),token);
   if(!runtime.sessions.isCurrent(generation,token))return false;
   if(reply.status==401){if(runtime.sessions.clearIfCurrent(generation,token)){runtime.db.clearTemporary();runtime.emit("auth",new JSONObject());}return false;}
   if(reply.status!=200||!reply.body.optBoolean("ok"))return false;
   JSONObject profile=new JSONObject(reply.body.toString());profile.remove("ok");
   if(!runtime.sessions.refreshIfCurrent(generation,token,sequence,profile))return false;
   runtime.emit("profile",profile);
   return adminOnly?exportAllowed(generation):reportAllowed(generation);
  }catch(Exception ignored){return false;}
 }
 private void apiResponse(String id,int status,JSONObject body){try{call("onApiResponse",new JSONObject().put("id",id).put("status",status).put("body",body).toString());}catch(Exception ignored){}}
 private synchronized void durableSignOut(String id){
  if(clearingSignOut){apiResponse(id,409,new JSONObject());return;}
  clearingSignOut=true;
  JSONObject auth=runtime.sessions.read();if(pendingLogoutToken==null&&auth!=null)pendingLogoutToken=auth.optString("token","");
  runtime.sessions.beginChange();runtime.db.clearTemporary();runOnUiThread(()->{clearExport();clearReport();});
  runtime.requests.execute(()->{
   final String token;
   try{
    if(!runtime.sessions.clearDurably())throw new IOException("Could not persist sign-out.");
    getSharedPreferences("navrang-pkce",MODE_PRIVATE).edit().clear().commit();clearCredentialProvider();
    synchronized(MainActivity.this){token=pendingLogoutToken;pendingLogoutToken=null;clearingSignOut=false;}
   }catch(Exception failure){
    synchronized(MainActivity.this){clearingSignOut=false;}
    try{apiResponse(id,0,new JSONObject().put("ok",false).put("error","Sign-out could not be saved. Private access is blocked. Retry sign out."));}catch(Exception ignored){}
    return;
   }
   try{apiResponse(id,200,new JSONObject().put("ok",true).put("signedOut",true));}catch(Exception ignored){}
   runtime.emit("auth",new JSONObject());
   // Revoking the captured old token must not block a later identity's local sign-out.
   if(token!=null&&!token.isEmpty())try{runtime.api.call("logout",new JSONObject(),token);}catch(Exception ignored){}
  });
 }
 private final class Bridge {
  @JavascriptInterface public String local(String action,String value){
   try{JSONObject p=value==null||value.isEmpty()?new JSONObject():new JSONObject(value),r;
    switch(action){
     case "snapshot":r=runtime.db.snapshot();break;
     case "lookup":r=runtime.db.lookup(p.getString("id"));break;
     case "session":JSONObject a=runtime.sessions.read();r=new JSONObject().put("profile",a==null?JSONObject.NULL:a.getJSONObject("profile"));break;
     case "config":r=runtime.api.config;break;
     default:throw new IllegalArgumentException("Unsupported local operation.");
    }return new JSONObject().put("ok",true).put("data",r).toString();
   }catch(Exception e){try{return new JSONObject().put("ok",false).put("error","Device storage is unavailable. Keep app data and retry.").toString();}catch(Exception ignored){return "{\"ok\":false}";}}
  }
  @JavascriptInterface public void api(String action,String value,String id){
   if("logout".equals(action)){durableSignOut(id);return;}
   final boolean changesIdentity="login".equals(action)||"checker-login".equals(action)||"google-login".equals(action)||"logout".equals(action);
   final long generation=changesIdentity?runtime.sessions.beginChange():runtime.sessions.generation();
   final long profileRequest="me".equals(action)?runtime.sessions.beginProfileRequest():-1;
   final JSONObject auth=runtime.sessions.read();final String token=auth==null?"":auth.optString("token");
   if(changesIdentity)runOnUiThread(()->{clearExport();clearReport();});
   runtime.requests.execute(()->{try{
    GateApi.Reply r=runtime.api.call(action,new JSONObject(value),token);
    if(!changesIdentity&&generation!=runtime.sessions.generation())r=new GateApi.Reply(409,new JSONObject().put("ok",false).put("error","Sign-in changed while this request was running."));
    if(!changesIdentity&&r.status==401&&runtime.sessions.clearIfCurrent(generation,token)){runtime.db.clearTemporary();runtime.emit("auth",new JSONObject());}
    if(r.status==200&&r.body.optBoolean("ok")){
     if(r.body.has("token")&&r.body.has("profile")){boolean saved=runtime.sessions.saveIfCurrent(generation,r.body.getString("token"),r.body.getJSONObject("profile"));r.body.remove("token");if(!saved)throw new IllegalStateException("Sign-in changed.");runtime.db.clearTemporary();runtime.refresh();}
     if("me".equals(action)&&auth!=null){JSONObject profile=new JSONObject(r.body.toString());profile.remove("ok");if(!runtime.sessions.refreshIfCurrent(generation,token,profileRequest,profile)){JSONObject current=runtime.sessions.read();if(generation!=runtime.sessions.generation()||current==null||!token.equals(current.optString("token")))throw new IllegalStateException("Sign-in changed.");r=new GateApi.Reply(200,new JSONObject(current.getJSONObject("profile").toString()).put("ok",true));}}
     if("sync".equals(action)&&generation==runtime.sessions.generation()&&GateSession.canSync(runtime.sessions.read())&&("admin".equals(GateSession.actor(runtime.sessions.read()))||r.body.optBoolean("staffSummary")))runtime.db.applySync(r.body);
    }
    JSONObject response=new JSONObject().put("id",id).put("status",r.status).put("body",r.body);call("onApiResponse",response.toString());
   }catch(Exception e){try{call("onApiResponse",new JSONObject().put("id",id).put("status",0).put("body",new JSONObject().put("ok",false).put("error","Connection interrupted. Unconfirmed scans stay only in memory while the app is open.")).toString());}catch(Exception ignored){}}});
  }
  @JavascriptInterface public String update(String action,boolean value){
   if(!updatesEnabled())return "{\"automatic\":false,\"available\":false,\"ready\":false,\"message\":\"Updates are disabled in the internal build.\"}";
   if("check".equals(action))GateUpdater.check(MainActivity.this,true,false);
   else if("background".equals(action)&&GateUpdater.automatic(MainActivity.this))GateUpdater.check(MainActivity.this,false,false);
   else if("download".equals(action))GateUpdater.check(MainActivity.this,true,true);
   else if("automatic".equals(action))GateUpdater.setAutomatic(MainActivity.this,value);
   else if("install".equals(action))runOnUiThread(()->GateUpdater.install(MainActivity.this));
   else if("notifications".equals(action))runOnUiThread(()->{if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},UPDATE_NOTIFICATIONS);else startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getPackageName()));});
   return GateUpdater.status(MainActivity.this).toString();
  }
  @JavascriptInterface public void copy(String value){if(value==null||value.length()>256)return;runOnUiThread(()->{android.content.ClipboardManager clip=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(clip!=null)clip.setPrimaryClip(android.content.ClipData.newPlainText("Navrang staff code",value));});}
  @JavascriptInterface public void exit(){runOnUiThread(()->finishAndRemoveTask());}
  @JavascriptInterface public void submit(String id){runtime.submit(id);}
  @JavascriptInterface public String destination(String value){android.content.SharedPreferences p=getSharedPreferences("navrang-ui",MODE_PRIVATE);if("home".equals(value)||"desk".equals(value))p.edit().putString("destination",value).apply();return p.getString("destination","home");}
  @JavascriptInterface public String readiness(String action){if("startup".equals(action)||"permissions".equals(action))runOnUiThread(()->preparePermissions("startup".equals(action)));else if("settings".equals(action))runOnUiThread(()->startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));else if("volume".equals(action))runOnUiThread(()->GateReadiness.volume(MainActivity.this));return GateReadiness.status(MainActivity.this).toString();}
  @JavascriptInterface public void save(String name,String mime,String content){JSONObject auth=runtime.sessions.read();if(auth==null||!auth.optJSONObject("profile").optBoolean("active")||!"admin".equals(auth.optJSONObject("profile").optString("role"))||!"text/csv".equals(mime)||content==null||content.length()>12*1024*1024){error("Only the admin can export Help Desk records.");return;}final long generation=runtime.sessions.generation();runOnUiThread(()->{if(!exportAllowed(generation))return;if(exportContent!=null){error("Finish the current save first.");return;}exportContent=content;exportGeneration=generation;try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("text/csv").putExtra(Intent.EXTRA_TITLE,name.replaceAll("[^A-Za-z0-9._-]","_")),EXPORT_DOCUMENT);}catch(Exception e){clearExport();error("No document save app is available. Use the laptop portal to export.");}});}
  @JavascriptInterface public void saveReport(String name,String mime,String content){
   if(!reportAllowed(runtime.sessions.generation())||name==null||!name.startsWith("Navrang-")||name.length()>100||
    !java.util.Arrays.asList("text/csv","application/pdf","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").contains(mime)||
    content==null||content.length()>16*1024*1024){error("Teacher reports access required. Sign in and refresh.");return;}
   final long generation=runtime.sessions.generation();
   runOnUiThread(()->{
    if(!reportAllowed(generation))return;
    if(exportContent!=null||reportContent!=null){error("Complete the current document save first.");return;}
    reportContent=content;reportGeneration=generation;
    try{startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
     .setType(mime).putExtra(Intent.EXTRA_TITLE,name.replaceAll("[^A-Za-z0-9._-]","_")),REPORT_DOCUMENT);}
    catch(Exception e){clearReport();error("No document save app is available.");}
   });
  }
  @JavascriptInterface public void scan(){runOnUiThread(()->beginScan());}
  @JavascriptInterface public void googleLogin(){googleLoginFromBridge();}
  private void googleLoginFromBridge(){MainActivity.this.googleLogin();}
  @JavascriptInterface public void feedback(String kind,boolean enabled){
   if(!java.util.Arrays.asList("intro","stop-intro","tap","transition","success","pending","issue","scan","duplicate","invalid","close").contains(kind))return;
   GateFeedback.play(MainActivity.this,kind,true);
  }

 }
 @Override public void onResume(){super.onResume();if(readiness!=null)readiness.resume();if(web!=null)web.onResume();if(runtime!=null){runtime.add(this);runtime.resume();JSONObject current=runtime.sessions.read();runtime.emit("profile",current==null?new JSONObject():current.optJSONObject("profile"));runtime.emit("readiness",GateReadiness.status(this));runtime.refresh();}GateUpdater.add(this);GateUpdater.publish(this);if(GateUpdater.automatic(this))GateUpdater.check(this,false,false);}
 @Override public void onPause(){if(readiness!=null)readiness.pause();GateUpdater.remove(this);if(runtime!=null){runtime.remove(this);runtime.pause();}if(web!=null)web.onPause();super.onPause();}
 @Override public void onDestroy(){clearExport();clearReport();if(web!=null){web.removeJavascriptInterface("Native");web.destroy();web=null;}super.onDestroy();}
 @Override public void onBackPressed(){if(web==null){finish();return;}web.evaluateJavascript("window.onBackRequested && window.onBackRequested();",null);}
}
