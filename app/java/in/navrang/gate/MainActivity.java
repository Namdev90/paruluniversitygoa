package in.navrang.gate;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.AtomicFile;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
 private static final int PICK_FILE=41, SAVE_FILE=42, SCAN=43, CAMERA_PERMISSION=44;
 private static final int MAX_STATE=20*1024*1024;
 private WebView web;
 private ValueCallback<Uri[]> chooser;
 private byte[] pendingExport;
 private String pendingExportName;
 private AtomicFile stateFile;
 private volatile String selectedImportUri;

 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);
  stateFile=new AtomicFile(new File(getFilesDir(),"navrang-state-v1.json"));
  getWindow().setStatusBarColor(Color.rgb(128,11,53));getWindow().setNavigationBarColor(Color.rgb(246,242,237));
  FrameLayout frame=new FrameLayout(this);
  try{web=new WebView(this);}catch(Exception e){showCompatibilityMessage();return;}
  if(!WebViewSupport.supported(web.getSettings().getUserAgentString())){web.destroy();web=null;showCompatibilityMessage();return;}
  frame.addView(web);
  frame.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
  setContentView(frame);frame.requestApplyInsets();
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setAllowFileAccessFromFileURLs(false);settings.setAllowUniversalAccessFromFileURLs(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  WebView.setWebContentsDebuggingEnabled(false);web.addJavascriptInterface(new Bridge(),"Native");
  web.setWebViewClient(new WebViewClient(){
   private boolean allowed(String url){return url!=null&&url.startsWith("file:///android_asset/");}
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){return !allowed(request.getUrl().toString());}
   @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !allowed(url);}
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    if(allowed(request.getUrl().toString())||request.getUrl().toString().equals(selectedImportUri))return null;
    return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
   }
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(chooser!=null)chooser.onReceiveValue(null);chooser=callback;
    Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/octet-stream"});
    try{startActivityForResult(intent,PICK_FILE);}catch(Exception e){chooser.onReceiveValue(null);chooser=null;error("No file picker found. Save the Excel file in Downloads and try again.");}
    return true;
   }
  });
  web.loadUrl("file:///android_asset/index.html");
 }
 private void showCompatibilityMessage(){TextView message=new TextView(this);message.setText("Update Android System WebView\n\nThis prototype needs Android System WebView / Chrome version 86 or newer. Update your WebView provider in Google Play before the event, then reopen Navrang Gate.\n\nAfter setup, this app works without internet. Your saved entry data is kept.");message.setTextSize(18);message.setPadding(40,80,40,40);message.setTextColor(Color.rgb(55,25,40));setContentView(message);}
 private void call(String fn,String value){runOnUiThread(()->{if(web!=null&&!isFinishing())web.evaluateJavascript("window."+fn+" && window."+fn+"("+JSONObject.quote(value)+");",null);});}
 private void error(String message){call("onNativeError",message);}
 private void beginScan(){
  if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.CAMERA},CAMERA_PERMISSION);return;}
  try{startActivityForResult(new Intent(this,ScanActivity.class),SCAN);}catch(Exception e){error("Camera could not open. Enter the Transaction ID instead.");}
 }
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==CAMERA_PERMISSION){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)beginScan();else error("Camera permission was not granted. Allow it in Android settings or enter the Transaction ID.");}}
 @Override public void onActivityResult(int request,int result,Intent data){
  super.onActivityResult(request,result,data);
  if(request==PICK_FILE){if(chooser!=null){Uri picked=result==RESULT_OK&&data!=null?data.getData():null;selectedImportUri=picked==null?null:picked.toString();chooser.onReceiveValue(picked==null?null:new Uri[]{picked});chooser=null;}}
  else if(request==SCAN&&result==RESULT_OK&&data!=null){String value=data.getStringExtra("qr");String failure=data.getStringExtra("error");if(value!=null)call("onNativeScan",value);else if(failure!=null)error(failure);}
  else if(request==SAVE_FILE){
   final byte[] bytes=pendingExport;final String name=pendingExportName;pendingExport=null;pendingExportName=null;
   if(result==RESULT_OK&&data!=null&&data.getData()!=null&&bytes!=null){final Uri uri=data.getData();new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(uri,"wt")){if(out==null)throw new java.io.IOException();out.write(bytes);out.flush();call("onNativeSaved",name);}catch(Exception e){error("Could not save the export. Your entries are still in the app; try a different folder.");}},"navrang-export").start();}
  }
 }
 private final class Bridge {
  @JavascriptInterface public synchronized String readState(){
   File base=stateFile.getBaseFile();if(!base.exists()&&!new File(base.getPath()+".bak").exists())return "";
   try(InputStream in=stateFile.openRead();ByteArrayOutputStream out=new ByteArrayOutputStream()){
    byte[] buffer=new byte[16384];int n;while((n=in.read(buffer))!=-1){if(out.size()+n>MAX_STATE)throw new java.io.IOException();out.write(buffer,0,n);}return new String(out.toByteArray(),StandardCharsets.UTF_8);
   }catch(Exception e){return "{\"storageError\":true}";}
  }
  @JavascriptInterface public synchronized boolean writeState(String json){
   try{byte[] bytes=json.getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_STATE)return false;JSONObject object=new JSONObject(json);if(object.optInt("version")!=1||!"O9KL3".equals(object.optString("eventId")))return false;
    return AtomicCommit.write(new AtomicCommit.Store(){
     public OutputStream start()throws Exception{return stateFile.startWrite();}
     public void sync(OutputStream out)throws Exception{((FileOutputStream)out).getFD().sync();}
     public void finish(OutputStream out){stateFile.finishWrite((FileOutputStream)out);}
     public void fail(OutputStream out){stateFile.failWrite((FileOutputStream)out);}
     public InputStream read()throws Exception{return stateFile.openRead();}
    },bytes);
   }catch(Exception e){return false;}
  }
  @JavascriptInterface public void scan(){runOnUiThread(()->beginScan());}
  @JavascriptInterface public void feedback(String outcome){try{Vibrator v=(Vibrator)getSystemService(VIBRATOR_SERVICE);if(v!=null){long ms="admitted".equals(outcome)?65:160;if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createOneShot(ms,VibrationEffect.DEFAULT_AMPLITUDE));else v.vibrate(ms);}}catch(Exception ignored){}}
  @JavascriptInterface public void saveText(String name,String mime,String text){
   runOnUiThread(()->{
    if(pendingExport!=null){error("Finish or cancel the current export first.");return;}
    if(!"text/csv".equals(mime)&&!"application/json".equals(mime)){error("Unsupported export format.");return;}
    byte[] bytes=text.getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_STATE){error("This export is too large. Your entries remain saved in the app.");return;}
    pendingExport=bytes;pendingExportName=name.replaceAll("[^a-zA-Z0-9._-]","_");Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);intent.putExtra(Intent.EXTRA_TITLE,pendingExportName);
    try{startActivityForResult(intent,SAVE_FILE);}catch(Exception e){pendingExport=null;error("No save picker found. Your entries remain saved in the app.");}
   });
  }
 }
 @Override public void onPause(){super.onPause();if(web!=null)web.onPause();}
 @Override public void onResume(){super.onResume();if(web!=null)web.onResume();}
 @Override public void onDestroy(){if(chooser!=null){chooser.onReceiveValue(null);chooser=null;}if(web!=null){web.removeJavascriptInterface("Native");web.destroy();web=null;}super.onDestroy();}
 @Override public void onBackPressed(){new android.app.AlertDialog.Builder(this).setTitle("Close scanner?").setMessage("Your imported file and entry history are saved on this phone.").setNegativeButton("Keep open",null).setPositiveButton("Close",(d,w)->finish()).show();}
}
