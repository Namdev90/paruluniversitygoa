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

public final class MainActivity extends Activity implements GateRuntime.Listener {
 private static final int PICK_FILE=41,SAVE_FILE=42,CAMERA_PERMISSION=44;
 private WebView web;private ValueCallback<Uri[]> chooser;private byte[] pendingExport;private String pendingName;
 private volatile String selectedImportUri;
 private GateRuntime runtime;
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);
  try{runtime=GateRuntime.get(this);}catch(Exception e){showMessage("Could not open saved data. Keep app data and backups.\n\n"+e.getMessage());return;}
  getWindow().setStatusBarColor(Color.rgb(99,0,39));getWindow().setNavigationBarColor(Color.rgb(249,240,222));
  FrameLayout frame=new FrameLayout(this);
  try{web=new WebView(this);}catch(Exception e){showMessage("Update Android System WebView / Chrome and reopen Navrang Gate.");return;}
  if(!WebViewSupport.supported(web.getSettings().getUserAgentString())){web.destroy();web=null;showMessage("Update Android System WebView / Chrome to version 86 or newer, then reopen Navrang Gate. Your saved entries are kept.");return;}
  frame.addView(web);frame.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i.consumeSystemWindowInsets();});setContentView(frame);frame.requestApplyInsets();
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  WebView.setWebContentsDebuggingEnabled(false);web.addJavascriptInterface(new Bridge(),"Native");
  web.setWebViewClient(new WebViewClient(){
   private boolean allowed(String url){return url!=null&&url.startsWith("file:///android_asset/");}
   @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){return !allowed(r.getUrl().toString());}
   @Override public boolean shouldOverrideUrlLoading(WebView w,String u){return !allowed(u);}
   @Override public WebResourceResponse shouldInterceptRequest(WebView w,WebResourceRequest r){String u=r.getUrl().toString();if(allowed(u)||u.equals(selectedImportUri))return null;return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){if(chooser!=null)chooser.onReceiveValue(null);chooser=cb;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/json","application/octet-stream"});try{startActivityForResult(i,PICK_FILE);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;error("No file picker is available.");}return true;}
  });
  web.loadUrl("file:///android_asset/index.html");handleOAuth(getIntent());
 }
 private void showMessage(String text){TextView v=new TextView(this);v.setText(text);v.setTextSize(18);v.setPadding(35,70,35,35);setContentView(v);}
 private void call(String fn,String json){runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript("window."+fn+" && window."+fn+"("+JSONObject.quote(json)+");",null);});}
 private void error(String text){call("onNativeError",text);}
 @Override public void event(JSONObject e){call("onGateEvent",e.toString());}
 private void beginScan(){
  JSONObject auth=runtime.sessions.read();if(auth==null||auth.optJSONObject("profile")==null||!auth.optJSONObject("profile").optBoolean("active")){error("Sign in with an approved checker account first.");return;}
  if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA_PERMISSION);return;}
  try{startActivity(new Intent(this,ScanActivity.class));}catch(Exception e){error("Camera could not open. Use manual entry.");}
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==CAMERA_PERMISSION){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)beginScan();else error("Allow camera permission in Android settings, or use manual entry.");}}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handleOAuth(intent);}
 private void googleLogin(){
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
  Uri u=intent==null?null:intent.getData();if(u==null||!"navranggate".equals(u.getScheme())||!"auth-callback".equals(u.getHost()))return;
  android.content.SharedPreferences p=getSharedPreferences("navrang-pkce",MODE_PRIVATE);
  String verifier=p.getString("verifier",""),nonce=p.getString("nonce","");
  if(verifier.isEmpty()||!nonce.equals(u.getQueryParameter("state"))||System.currentTimeMillis()-p.getLong("created",0)>10*60*1000)return;
  final long generation=p.getLong("sessionGeneration",-1);String code=u.getQueryParameter("code");if(code==null){error("Google sign-in was cancelled or failed. Try again.");return;}
  runtime.requests.execute(()->{try{
   GateApi.Reply exchange=runtime.api.exchange(code,verifier);if(exchange.status!=200)throw new IOException();
   GateApi.Reply r=runtime.api.call("google-login",new JSONObject().put("accessToken",exchange.body.getString("access_token")),"");
   if(r.status!=200||!r.body.optBoolean("ok")){error(r.body.optString("error","Google sign-in failed."));return;}
   if(!runtime.sessions.saveIfCurrent(generation,r.body.getString("token"),r.body.getJSONObject("profile")))return;p.edit().clear().commit();runtime.emit("auth",r.body.getJSONObject("profile"));runtime.refresh();
  }catch(Exception e){error("Google sign-in could not finish. Reopen sign-in with a working connection.");}});
 }
 @Override public void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==PICK_FILE&&chooser!=null){Uri uri=result==RESULT_OK&&data!=null?data.getData():null;selectedImportUri=uri==null?null:uri.toString();chooser.onReceiveValue(uri==null?null:new Uri[]{uri});chooser=null;}
  if(request==SAVE_FILE){byte[] bytes=pendingExport;String name=pendingName;pendingExport=null;pendingName=null;if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){Uri uri=data.getData();runtime.requests.execute(()->{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new IOException();out.write(bytes);out.flush();call("onNativeSaved",name);}catch(Exception e){error("Could not save the export. Your entries are still stored; choose another folder.");}});}}
 }
 private final class Bridge {
  @JavascriptInterface public String local(String action,String value){
   try{JSONObject p=value==null||value.isEmpty()?new JSONObject():new JSONObject(value),r;
    switch(action){
     case "snapshot":r=runtime.db.snapshot();break;
     case "lookup":r=runtime.db.lookup(p.getString("id"));break;
     case "backup":r=runtime.db.backup();break;
     case "import":runtime.db.importLocal(p.getJSONArray("records"),p.optString("source"));r=runtime.db.snapshot();break;
     case "session":JSONObject a=runtime.sessions.read();r=new JSONObject().put("profile",a==null?JSONObject.NULL:a.getJSONObject("profile"));break;
     case "config":r=runtime.api.config;break;
     default:throw new IllegalArgumentException("Unsupported local operation.");
    }return new JSONObject().put("ok",true).put("data",r).toString();
   }catch(Exception e){try{return new JSONObject().put("ok",false).put("error","Device storage is unavailable. Keep app data and retry.").toString();}catch(Exception ignored){return "{\"ok\":false}";}}
  }
  @JavascriptInterface public void api(String action,String value,String id){
   final boolean changesIdentity="login".equals(action)||"checker-login".equals(action)||"google-login".equals(action)||"logout".equals(action);
   final long generation=changesIdentity?runtime.sessions.beginChange():runtime.sessions.generation();
   final JSONObject auth=runtime.sessions.read();final String token=auth==null?"":auth.optString("token");
   if("logout".equals(action))runtime.sessions.clear();
   runtime.requests.execute(()->{try{
    GateApi.Reply r=runtime.api.call(action,new JSONObject(value),token);
    if(r.status==200&&r.body.optBoolean("ok")){
     if(r.body.has("token")&&r.body.has("profile")){boolean saved=runtime.sessions.saveIfCurrent(generation,r.body.getString("token"),r.body.getJSONObject("profile"));r.body.remove("token");if(!saved)throw new IllegalStateException("Sign-in changed.");runtime.refresh();}
     if("me".equals(action)&&auth!=null){JSONObject profile=new JSONObject(r.body.toString());profile.remove("ok");if(!runtime.sessions.refreshIfCurrent(generation,token,profile))throw new IllegalStateException("Sign-in changed.");}
     if("sync".equals(action))runtime.db.applySync(r.body);
    }
    JSONObject response=new JSONObject().put("id",id).put("status",r.status).put("body",r.body);call("onApiResponse",response.toString());
   }catch(Exception e){try{call("onApiResponse",new JSONObject().put("id",id).put("status",0).put("body",new JSONObject().put("ok",false).put("error","Connection interrupted. Pending scans remain saved.")).toString());}catch(Exception ignored){}}});
  }
  @JavascriptInterface public void submit(String id){runtime.submit(id);}
  @JavascriptInterface public void scan(){runOnUiThread(()->beginScan());}
  @JavascriptInterface public void googleLogin(){googleLoginFromBridge();}
  private void googleLoginFromBridge(){MainActivity.this.googleLogin();}
  @JavascriptInterface public void saveText(String name,String mime,String text){runOnUiThread(()->{
   if(pendingExport!=null){error("Finish or cancel the current export first.");return;}
   if(!"text/csv".equals(mime)&&!"application/json".equals(mime)){error("Unsupported export format.");return;}
   byte[] bytes=text.getBytes(StandardCharsets.UTF_8);if(bytes.length>20*1024*1024){error("This export is too large.");return;}
   pendingExport=bytes;pendingName=name.replaceAll("[^a-zA-Z0-9._-]","_");
   Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType(mime);i.putExtra(Intent.EXTRA_TITLE,pendingName);try{startActivityForResult(i,SAVE_FILE);}catch(Exception e){pendingExport=null;error("No save picker is available.");}
  });}
 }
 @Override public void onResume(){super.onResume();if(web!=null)web.onResume();if(runtime!=null){runtime.add(this);runtime.resume();}}
 @Override public void onPause(){if(runtime!=null){runtime.remove(this);runtime.pause();}if(web!=null)web.onPause();super.onPause();}
 @Override public void onDestroy(){if(chooser!=null)chooser.onReceiveValue(null);if(web!=null){web.removeJavascriptInterface("Native");web.destroy();web=null;}super.onDestroy();}
 @Override public void onBackPressed(){new android.app.AlertDialog.Builder(this).setTitle("Close Navrang Gate?").setMessage("Saved entries and pending requests stay on this phone.").setNegativeButton("Keep open",null).setPositiveButton("Close",(d,w)->finish()).show();}
}
