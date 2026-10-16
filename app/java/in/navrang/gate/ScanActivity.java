package in.navrang.gate;
import android.app.Activity;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;
import java.util.List;
import java.util.concurrent.*;

@SuppressWarnings("deprecation")
public final class ScanActivity extends Activity implements SurfaceHolder.Callback,GateRuntime.Listener {
 private SurfaceView surface;private Camera camera;private boolean ready=false,active=false,torch=false,continuous=false;
 private GateRuntime runtime;private LinearLayout resultCard;private TextView title,person,detail,connection;private View reticle;
 private final Handler handler=new Handler(Looper.getMainLooper());private final ExecutorService decoder=Executors.newSingleThreadExecutor();private final ScanLatch latch=new ScanLatch();
 private final Runnable autofocus=new Runnable(){public void run(){if(camera!=null&&active&&!continuous){try{camera.autoFocus((ok,c)->{});}catch(Exception ignored){}handler.postDelayed(this,1500);}}};
 private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
 private GradientDrawable box(int color,int stroke){GradientDrawable d=new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{color,color});d.setCornerRadius(dp(24));d.setStroke(dp(1),stroke);return d;}
 private TextView text(int size,int color){TextView v=new TextView(this);v.setTextSize(size);v.setTextColor(color);return v;}
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);try{runtime=GateRuntime.get(this);}catch(Exception e){finish();return;}
  getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().setStatusBarColor(0xff210817);getWindow().setNavigationBarColor(0xff210817);
  FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.BLACK);surface=new SurfaceView(this);frame.addView(surface,new FrameLayout.LayoutParams(-1,-1));surface.getHolder().addCallback(this);
  LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.VERTICAL);top.setPadding(dp(20),dp(16),dp(20),dp(16));top.setBackgroundColor(0xe8210817);
  TextView brand=text(13,0xffecd09a);brand.setText("PARUL UNIVERSITY  ·  GOA");brand.setLetterSpacing(.12f);top.addView(brand);
  TextView name=text(29,Color.WHITE);name.setText("Navrang Gate");name.setTypeface(null,1);top.addView(name);
  connection=text(13,0xffecd09a);JSONObject auth=runtime.sessions.read();connection.setText("AUTO SCAN  ·  "+(auth==null?"":auth.optJSONObject("profile").optString("name")));top.addView(connection);
  frame.addView(top,new FrameLayout.LayoutParams(-1,-2,Gravity.TOP));
  reticle=new View(this);reticle.setBackground(box(0x09000000,0xccf5d392));FrameLayout.LayoutParams rp=new FrameLayout.LayoutParams(dp(270),dp(270),Gravity.CENTER);rp.bottomMargin=dp(80);frame.addView(reticle,rp);
  LinearLayout bottom=new LinearLayout(this);bottom.setOrientation(LinearLayout.VERTICAL);bottom.setPadding(dp(16),dp(8),dp(16),dp(16));
  resultCard=new LinearLayout(this);resultCard.setOrientation(LinearLayout.VERTICAL);resultCard.setPadding(dp(22),dp(20),dp(22),dp(20));resultCard.setElevation(dp(12));resultCard.setBackground(box(0xfff8efdc,0xffdfc495));
  title=text(23,0xff550222);title.setTypeface(null,1);title.setText("Ready for the next ticket");
  person=text(21,0xff271321);person.setTypeface(null,1);person.setText("Show the email QR");
  detail=text(14,0xff6a5361);detail.setText("Keep the code in view until a result appears. Each new QR is saved automatically. Green confirms a server-approved entry.");
  resultCard.addView(title);resultCard.addView(person);resultCard.addView(detail);bottom.addView(resultCard);
  LinearLayout actions=new LinearLayout(this);Button back=new Button(this);back.setText("Home");back.setOnClickListener(v->finish());Button light=new Button(this);light.setText("Torch");light.setOnClickListener(v->toggleTorch());actions.addView(back,new LinearLayout.LayoutParams(0,dp(54),1));actions.addView(light,new LinearLayout.LayoutParams(0,dp(54),1));bottom.addView(actions);
  frame.addView(bottom,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
  frame.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i.consumeSystemWindowInsets();});setContentView(frame);frame.requestApplyInsets();
 }
 @Override public void surfaceCreated(SurfaceHolder h){ready=true;if(active)openCamera();}
 @Override public void surfaceChanged(SurfaceHolder h,int f,int w,int height){}
 @Override public void surfaceDestroyed(SurfaceHolder h){ready=false;release();}
 @Override public void onResume(){super.onResume();active=true;if(runtime!=null){runtime.add(this);runtime.resume();}if(ready)openCamera();}
 @Override public void onPause(){active=false;release();if(runtime!=null){runtime.remove(this);runtime.pause();}super.onPause();}
 @Override public void onDestroy(){decoder.shutdownNow();super.onDestroy();}
 @Override public void event(JSONObject e){if(!"result".equals(e.optString("type")))return;JSONObject data=e.optJSONObject("data");if(data!=null)runOnUiThread(()->showResult(data));}
 private void showResult(JSONObject r){
  if(!active)return;String code=r.optString("code"),id=r.optString("id");
  boolean admitted="admitted".equals(code),dup="duplicate".equals(code),pending="pending".equals(code);
  int bg=admitted?0xffd5f3df:pending?0xffffedbc:0xffffdedf;int ink=admitted?0xff115b38:pending?0xff795009:0xff9a173d;
  resultCard.setBackground(box(bg,admitted?0xff88c79e:0xffd1b786));title.setTextColor(ink);
  title.setText(admitted?"✓  Entry confirmed":dup?"Already admitted":pending?"Awaiting confirmation":"Entry not confirmed");
  JSONObject record=r.optJSONObject("record"),entry=r.optJSONObject("entry");
  String name=entry!=null?entry.optString("name"):record!=null?record.optString("name"):"";
  person.setText(name.isEmpty()?(id.isEmpty()?"Request saved for retry":id):name);
  if(admitted||dup){detail.setText(id+"  ·  "+(record==null?"":("₹"+record.optString("amount")+"  ·  "))+"\n"+entry.optString("checker")+"  ·  "+entry.optString("at")+"\n"+(admitted?"Saved on server and phone. Next QR is ready.":"One entry only. No re-entry."));}
  else detail.setText((id.isEmpty()?"":id+"\n")+r.optString("message","Visit the help desk."));
  resultCard.animate().cancel();resultCard.setTranslationY(dp(14));resultCard.setAlpha(.85f);resultCard.animate().translationY(0).alpha(1).setDuration(140).start();
  if(!pending){try{Vibrator v=(Vibrator)getSystemService(VIBRATOR_SERVICE);long duration=admitted?50:150;if(v!=null){if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createOneShot(duration,VibrationEffect.DEFAULT_AMPLITUDE));else v.vibrate(duration);}}catch(Exception ignored){}}
 }
 private void fail(){Toast.makeText(this,"Camera unavailable. Use manual entry on Home.",Toast.LENGTH_LONG).show();finish();}
 private void openCamera(){
  if(camera!=null||!ready||!active)return;
  try{int cameraId=0;Camera.CameraInfo info=new Camera.CameraInfo();for(int i=0;i<Camera.getNumberOfCameras();i++){Camera.getCameraInfo(i,info);if(info.facing==Camera.CameraInfo.CAMERA_FACING_BACK){cameraId=i;break;}}Camera.getCameraInfo(cameraId,info);camera=Camera.open(cameraId);Camera.Parameters p=camera.getParameters();Camera.Size chosen=p.getPreviewSize();long best=Long.MAX_VALUE;List<Camera.Size> sizes=p.getSupportedPreviewSizes();if(sizes!=null)for(Camera.Size s:sizes){long d=Math.abs((long)s.width*s.height-1280L*720);if(d<best){best=d;chosen=s;}}
   p.setPreviewSize(chosen.width,chosen.height);p.setPreviewFormat(ImageFormat.NV21);List<String> modes=p.getSupportedFocusModes();if(modes!=null&&modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)){p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);continuous=true;}else if(modes!=null&&modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)){p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);continuous=true;}
   camera.setParameters(p);int rot=getWindowManager().getDefaultDisplay().getRotation();int deg=rot==Surface.ROTATION_90?90:rot==Surface.ROTATION_180?180:rot==Surface.ROTATION_270?270:0;camera.setDisplayOrientation((info.orientation-deg+360)%360);camera.setPreviewDisplay(surface.getHolder());camera.startPreview();nextFrame();if(!continuous)handler.postDelayed(autofocus,500);
  }catch(Exception e){release();fail();}
 }
 private void nextFrame(){
  if(camera==null||!active)return;
  try{camera.setOneShotPreviewCallback((data,c)->{if(!active||camera==null)return;Camera.Size size=c.getParameters().getPreviewSize();
   try{decoder.execute(()->{String value=QrCodec.decode(data,size.width,size.height);handler.post(()->{if(!active||camera==null)return;boolean fresh=latch.observe(value,SystemClock.elapsedRealtime());if(fresh&&value!=null){if(value.matches("[A-Z0-9]{8}"))runtime.submit(value);else{try{showResult(new JSONObject().put("code","invalid").put("message","This is not an eight-character ticket QR. Scan the code from the ticket email."));}catch(Exception ignored){}}}handler.postDelayed(()->nextFrame(),70);});});}catch(RejectedExecutionException ignored){}
  });}catch(Exception e){release();fail();}
 }
 private void toggleTorch(){if(camera==null)return;try{Camera.Parameters p=camera.getParameters();List<String> modes=p.getSupportedFlashModes();if(modes==null||!modes.contains(Camera.Parameters.FLASH_MODE_TORCH)){Toast.makeText(this,"Torch unavailable",Toast.LENGTH_SHORT).show();return;}torch=!torch;p.setFlashMode(torch?Camera.Parameters.FLASH_MODE_TORCH:Camera.Parameters.FLASH_MODE_OFF);camera.setParameters(p);}catch(Exception e){Toast.makeText(this,"Could not change torch",Toast.LENGTH_SHORT).show();}}
 private void release(){handler.removeCallbacksAndMessages(null);if(camera!=null){try{camera.setOneShotPreviewCallback(null);camera.stopPreview();camera.release();}catch(Exception ignored){}camera=null;}torch=false;}
}
