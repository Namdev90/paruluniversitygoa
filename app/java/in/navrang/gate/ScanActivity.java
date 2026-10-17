package in.navrang.gate;
import android.app.*;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.hardware.Camera;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.*;

@SuppressWarnings("deprecation")
public final class ScanActivity extends Activity implements SurfaceHolder.Callback,GateRuntime.Listener {
 private SurfaceView surface;private Camera camera;private boolean ready,active,torch,continuous,issueHeld;private int torchMode=0,darkFrames=0,brightFrames=0;
 private GateRuntime runtime;private LinearLayout resultCard;private TextView title,person,detail,connection,quality;private Button light,zoomLabel;private View reticle;
 private AlertDialog issueDialog;private JSONObject heldResult;private final ArrayDeque<JSONObject> deferred=new ArrayDeque<>();
 private long lastHealth=0,lastTorch=0,lastZoom=0,lastRead=0;private final Set<String> acknowledgedPending=new HashSet<>();private String pendingId="";private int previewWidth=1280,previewHeight=720;
 private final Handler handler=new Handler(Looper.getMainLooper());private final ExecutorService decoder=Executors.newSingleThreadExecutor();private final ScanLatch latch=new ScanLatch();
 private final Runnable autofocus=new Runnable(){public void run(){if(camera!=null&&active&&!continuous){focus();handler.postDelayed(this,1800);}}};
 private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
 private GradientDrawable box(int color,int stroke){GradientDrawable d=new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,new int[]{color,color});d.setCornerRadius(dp(22));d.setStroke(dp(1),stroke);return d;}
 private TextView text(int size,int color){TextView v=new TextView(this);v.setTextSize(size);v.setTextColor(color);return v;}
 private Button button(String label){Button b=new Button(this);b.setText(label);b.setTextSize(11);b.setTextColor(0xfff4d3a0);b.setBackgroundTintList(android.content.res.ColorStateList.valueOf(0xff30202e));return b;}
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);try{runtime=GateRuntime.get(this);}catch(Exception e){finish();return;}
  getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);getWindow().setStatusBarColor(0xff100d15);getWindow().setNavigationBarColor(0xff100d15);
  FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.BLACK);surface=new SurfaceView(this);frame.addView(surface,new FrameLayout.LayoutParams(-1,-1));surface.getHolder().addCallback(this);surface.setOnTouchListener((v,e)->{if(e.getAction()==MotionEvent.ACTION_UP){focus();quality.setText("Focusing · hold the QR steady");v.performClick();}return true;});
  LinearLayout top=new LinearLayout(this);top.setOrientation(LinearLayout.VERTICAL);top.setPadding(dp(18),dp(12),dp(18),dp(12));top.setBackgroundColor(0xef100d15);
  TextView brand=text(11,0xffe5be7d);brand.setText("PARUL UNIVERSITY GOA");brand.setLetterSpacing(.12f);top.addView(brand);
  TextView name=text(25,Color.WHITE);name.setText("Navrang · live scanner");name.setTypeface(null,1);top.addView(name);
  connection=text(11,0xffa7e4bb);JSONObject auth=runtime.sessions.read();JSONObject profile=auth==null?null:auth.optJSONObject("profile");connection.setText("AUTO SCAN  ·  "+(profile==null?"Checker":profile.optString("name")));top.addView(connection);
  quality=text(11,0xffd9bfcf);quality.setText("Center one QR · tap the preview to focus");top.addView(quality);frame.addView(top,new FrameLayout.LayoutParams(-1,-2,Gravity.TOP));
  reticle=new View(this);reticle.setBackground(box(0x05000000,0xdde5be7d));int side=Math.min(dp(265),getResources().getDisplayMetrics().widthPixels-dp(52));FrameLayout.LayoutParams rp=new FrameLayout.LayoutParams(side,side,Gravity.CENTER);rp.bottomMargin=dp(100);frame.addView(reticle,rp);
  LinearLayout bottom=new LinearLayout(this);bottom.setOrientation(LinearLayout.VERTICAL);bottom.setPadding(dp(13),dp(8),dp(13),dp(13));resultCard=new LinearLayout(this);resultCard.setOrientation(LinearLayout.VERTICAL);resultCard.setPadding(dp(19),dp(16),dp(19),dp(16));resultCard.setElevation(dp(12));resultCard.setBackground(box(0xff201a27,0xff624052));
  title=text(21,0xffe5be7d);title.setTypeface(null,1);title.setText("Ready for the next ticket");person=text(19,0xfff6eddf);person.setTypeface(null,1);person.setText("Show the email QR");detail=text(12,0xffcbb9c6);detail.setText("Green confirms entry. A payment or ticket issue pauses scanning until you acknowledge the help-desk message.");resultCard.addView(title);resultCard.addView(person);resultCard.addView(detail);bottom.addView(resultCard);
  LinearLayout actions=new LinearLayout(this);Button back=button("Home");back.setOnClickListener(v->finish());light=button("Light: auto");light.setOnClickListener(v->{torchMode=(torchMode+1)%3;light.setText(torchMode==0?"Light: auto":torchMode==1?"Light: on":"Light: off");setTorch(torchMode==1);GateFeedback.play(this,"tap");});Button out=button("−");out.setContentDescription("Zoom out");out.setOnClickListener(v->changeZoom(-1,false));zoomLabel=button("1×");zoomLabel.setContentDescription("Reset zoom");zoomLabel.setOnClickListener(v->resetZoom());Button in=button("+");in.setContentDescription("Zoom in");in.setOnClickListener(v->changeZoom(1,false));
  actions.addView(back,new LinearLayout.LayoutParams(0,dp(49),1.2f));actions.addView(light,new LinearLayout.LayoutParams(0,dp(49),1.8f));actions.addView(out,new LinearLayout.LayoutParams(0,dp(49),.7f));actions.addView(zoomLabel,new LinearLayout.LayoutParams(0,dp(49),.9f));actions.addView(in,new LinearLayout.LayoutParams(0,dp(49),.7f));bottom.addView(actions);frame.addView(bottom,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
  frame.setOnApplyWindowInsetsListener((v,i)->{v.setPadding(i.getSystemWindowInsetLeft(),i.getSystemWindowInsetTop(),i.getSystemWindowInsetRight(),i.getSystemWindowInsetBottom());return i.consumeSystemWindowInsets();});setContentView(frame);frame.requestApplyInsets();
 }
 @Override public void surfaceCreated(SurfaceHolder h){ready=true;if(active)openCamera();}
 @Override public void surfaceChanged(SurfaceHolder h,int f,int w,int height){fitPreview();}
 @Override public void surfaceDestroyed(SurfaceHolder h){ready=false;release();}
 @Override public void onResume(){super.onResume();active=true;if(runtime!=null){runtime.add(this);runtime.resume();}if(ready)openCamera();}
 @Override public void onPause(){active=false;release();if(runtime!=null){runtime.remove(this);runtime.pause();}super.onPause();}
 @Override public void onDestroy(){if(issueDialog!=null)issueDialog.dismiss();decoder.shutdownNow();super.onDestroy();}
 @Override public void event(JSONObject e){if(!"result".equals(e.optString("type")))return;JSONObject data=e.optJSONObject("data");if(data!=null)runOnUiThread(()->showResult(data));}
 private void showResult(JSONObject r){
  if(!active)return;String code=r.optString("code"),id=r.optString("id");boolean admitted="admitted".equals(code),dup="duplicate".equals(code),pending="pending".equals(code);
  if(pending&&acknowledgedPending.contains(id))return;if(!pending)acknowledgedPending.remove(id);
  if(issueHeld){if(id.equals(heldResult.optString("id"))&&"pending".equals(heldResult.optString("code"))){heldResult=r;if(admitted)GateFeedback.play(this,"success");if(issueDialog!=null){issueDialog.setTitle(admitted?"Entry confirmed":"Help desk required");issueDialog.setMessage(message(r)+(admitted?"\n\nServer now confirms entry. Acknowledge to continue.":"\n\nPlease send this student to the help desk. Do not allow entry."));}}else if(!pending)deferred.add(r);return;}
  int border=admitted?0xff68b98b:pending?0xffd4ac65:0xffdc738b;title.setTextColor(admitted?0xff9ae2b3:pending?0xffe5be7d:0xffffa9b8);resultCard.setBackground(box(0xff211925,border));
  title.setText(admitted?"✓ Entry confirmed":dup?"Already entered":pending?"Awaiting confirmation":"Entry not allowed");JSONObject record=r.optJSONObject("record"),entry=r.optJSONObject("entry");String name=entry!=null?entry.optString("name"):record!=null?record.optString("name"):"";person.setText(name.isEmpty()?(id.isEmpty()?"Ticket issue":id):name);detail.setText(message(r));
  resultCard.animate().cancel();resultCard.setTranslationY(dp(12));resultCard.setAlpha(.8f);resultCard.animate().translationY(0).alpha(1).setDuration(190).start();GateFeedback.play(this,admitted?"success":pending?"pending":"issue");
  if(pending){pendingId=id;handler.postDelayed(()->{if(active&&!issueHeld&&id.equals(pendingId)){pendingId="";holdIssue(r);}},2500);}else{if(id.equals(pendingId))pendingId="";if(!admitted)holdIssue(r);else {lastRead=SystemClock.elapsedRealtime();quality.setText("Entry saved · ready for the next student");}}
 }
 private String message(JSONObject r){JSONObject record=r.optJSONObject("record"),entry=r.optJSONObject("entry");String code=r.optString("code");if(entry!=null)return r.optString("id",entry.optString("ticketId"))+"  ·  "+(record==null?"":("₹"+record.optString("amount")))+"\n"+entry.optString("checker")+"  ·  "+localTime(entry.optString("at"))+" IST\n"+("admitted".equals(code)?"Saved on server and phone. Next QR is ready.":"One entry only. No re-entry.");return (r.optString("id").isEmpty()?"":r.optString("id")+"\n")+r.optString("message","Ticket could not be verified.");}
 private String localTime(String at){try{String clean=at.replaceFirst("\\.\\d+","");java.text.SimpleDateFormat p=new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX",java.util.Locale.US);java.text.SimpleDateFormat f=new java.text.SimpleDateFormat("HH:mm:ss",java.util.Locale.US);f.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Kolkata"));return f.format(p.parse(clean));}catch(Exception e){return at;}}
 private void holdIssue(JSONObject r){
  if(!active||isFinishing())return;issueHeld=true;heldResult=r;String msg=message(r)+"\n\nPlease send this student to the help desk. Do not allow entry.\n\nScanning is paused until you acknowledge.";
  issueDialog=new AlertDialog.Builder(this).setTitle("Help desk required").setMessage(msg).setCancelable(false).setPositiveButton("Acknowledge · next student",(d,w)->{if(heldResult!=null&&"pending".equals(heldResult.optString("code")))acknowledgedPending.add(heldResult.optString("id"));pendingId="";issueHeld=false;heldResult=null;issueDialog=null;quality.setText("Ready · remove the old QR before scanning again");if(!deferred.isEmpty())showResult(deferred.remove());}).create();issueDialog.show();if("pending".equals(r.optString("code")))GateFeedback.play(this,"issue");
 }
 private void fail(){Toast.makeText(this,"Camera unavailable. Use exact ticket-ID entry on Home.",Toast.LENGTH_LONG).show();finish();}
 private void openCamera(){
  if(camera!=null||!ready||!active)return;
  try{int cameraId=0;Camera.CameraInfo info=new Camera.CameraInfo();for(int i=0;i<Camera.getNumberOfCameras();i++){Camera.getCameraInfo(i,info);if(info.facing==Camera.CameraInfo.CAMERA_FACING_BACK){cameraId=i;break;}}Camera.getCameraInfo(cameraId,info);camera=Camera.open(cameraId);camera.setErrorCallback((err,c)->{release();fail();});Camera.Parameters p=camera.getParameters();Camera.Size chosen=p.getPreviewSize();long best=Long.MAX_VALUE;List<Camera.Size> sizes=p.getSupportedPreviewSizes();if(sizes!=null)for(Camera.Size s:sizes){long d=Math.abs((long)s.width*s.height-1280L*720)+(long)(Math.abs((double)s.width/s.height-16.0/9)*300000);if(d<best){best=d;chosen=s;}}
   previewWidth=chosen.width;previewHeight=chosen.height;p.setPreviewSize(previewWidth,previewHeight);p.setPreviewFormat(ImageFormat.NV21);continuous=false;List<String> modes=p.getSupportedFocusModes();if(modes!=null&&modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)){p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);continuous=true;}else if(modes!=null&&modes.contains(Camera.Parameters.FOCUS_MODE_AUTO))p.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
   camera.setParameters(p);int rot=getWindowManager().getDefaultDisplay().getRotation();int deg=rot==Surface.ROTATION_90?90:rot==Surface.ROTATION_180?180:rot==Surface.ROTATION_270?270:0;camera.setDisplayOrientation((info.orientation-deg+360)%360);camera.setPreviewDisplay(surface.getHolder());camera.startPreview();fitPreview();lastRead=SystemClock.elapsedRealtime();lastHealth=0;darkFrames=brightFrames=0;nextFrame();if(!continuous)handler.postDelayed(autofocus,500);if(torchMode==1)setTorch(true);
  }catch(Exception e){release();fail();}
 }
 private void fitPreview(){if(surface==null||previewWidth<=0||previewHeight<=0)return;View parent=(View)surface.getParent();int w=parent.getWidth(),h=parent.getHeight();if(w<=0||h<=0)return;float ratio=(float)previewHeight/previewWidth;int dw=w,dh=Math.round(w/ratio);if(dh<h){dh=h;dw=Math.round(h*ratio);}FrameLayout.LayoutParams p=new FrameLayout.LayoutParams(dw,dh,Gravity.CENTER);surface.setLayoutParams(p);}
 private void nextFrame(){
  if(camera==null||!active)return;
  try{camera.setOneShotPreviewCallback((bytes,c)->{if(!active||camera==null)return;final Camera expected=c;Camera.Size size=c.getParameters().getPreviewSize();
   if(issueHeld){handler.postDelayed(this::nextFrame,120);return;}
   try{decoder.execute(()->{QrCodec.Attempt attempt;CameraHealth health;try{attempt=QrCodec.inspect(bytes,size.width,size.height);health=CameraHealth.measure(bytes,size.width,size.height);}catch(Exception e){attempt=new QrCodec.Attempt(null,0,0);health=CameraHealth.measure(null,0,0);}final QrCodec.Attempt found=attempt;final CameraHealth measured=health;handler.post(()->{if(!active||camera!=expected)return;long now=SystemClock.elapsedRealtime();if(now-lastHealth>700){assist(measured,found,now);lastHealth=now;}
    boolean fresh=latch.observe(found.value,now);if(fresh&&found.value!=null&&!issueHeld){lastRead=now;if(found.value.matches("[A-Z0-9]{8}"))runtime.submit(found.value);else try{showResult(new JSONObject().put("code","invalid").put("id","").put("message","This QR is not a student ticket. Scan the QR from the ticket email."));}catch(Exception ignored){}}
    handler.postDelayed(this::nextFrame,65);
   });});}catch(RejectedExecutionException ignored){}
  });}catch(Exception e){release();fail();}
 }
 private void assist(CameraHealth h,QrCodec.Attempt a,long now){
  darkFrames=h.dark()?darkFrames+1:0;brightFrames=h.luminance>165?brightFrames+1:0;
  if(torchMode==0&&now-lastTorch>5000){if(darkFrames>=3&&!torch)setTorch(true);else if(brightFrames>=5&&torch&&a.points==0)setTorch(false);}
  if(a.value!=null){quality.setText("QR read · awaiting entry result");return;}
  if(h.dark())quality.setText(torch?"Low light · hold steady or increase screen brightness":"Low light · automatic torch is available");
  else if(a.points>=2&&h.soft()&&now-lastRead>1600){quality.setText("Image may be soft · hold steady, clean lens or tap to focus");focus();}
  else if(a.points>=2&&a.span>0&&a.span<Math.min(previewWidth,previewHeight)*.24f&&now-lastZoom>2200){changeZoom(1,true);quality.setText("Small QR · adjusting zoom. Keep the whole code visible");}
  else if(now-lastRead>4000){quality.setText("Keep the whole QR visible · reduce glare or move closer");if(torchMode==0&&now-lastZoom>6000)resetZoom();}
 }
 private void focus(){if(camera==null)return;try{camera.cancelAutoFocus();camera.autoFocus((ok,c)->{if(!ok&&active)quality.setText("Focus not locked · hold steady or move slightly back");if(continuous&&camera==c)try{c.cancelAutoFocus();}catch(Exception ignored){}});}catch(Exception ignored){}}
 private void setTorch(boolean on){if(camera==null)return;try{Camera.Parameters p=camera.getParameters();List<String> modes=p.getSupportedFlashModes();if(modes==null||!modes.contains(Camera.Parameters.FLASH_MODE_TORCH))return;p.setFlashMode(on?Camera.Parameters.FLASH_MODE_TORCH:Camera.Parameters.FLASH_MODE_OFF);camera.setParameters(p);torch=on;lastTorch=SystemClock.elapsedRealtime();}catch(Exception ignored){quality.setText("Torch unavailable · increase the ticket screen brightness");}}
 private void changeZoom(int direction,boolean automatic){if(camera==null)return;try{Camera.Parameters p=camera.getParameters();if(!p.isZoomSupported())return;List<Integer> ratios=p.getZoomRatios();int current=p.getZoom(),target=current;if(ratios==null||ratios.isEmpty())return;int desired=ratios.get(current)+(direction>0?25:-25);for(int i=0;i<ratios.size();i++){if(direction>0&&ratios.get(i)>=desired){target=i;break;}if(direction<0&&ratios.get(i)<=desired)target=i;}if(automatic&&ratios.get(target)>180)return;p.setZoom(Math.max(0,Math.min(p.getMaxZoom(),target)));camera.setParameters(p);zoomLabel.setText(String.format(java.util.Locale.US,"%.1f×",ratios.get(p.getZoom())/100.0));lastZoom=SystemClock.elapsedRealtime();focus();}catch(Exception ignored){}}
 private void resetZoom(){if(camera==null)return;try{Camera.Parameters p=camera.getParameters();if(p.isZoomSupported()){p.setZoom(0);camera.setParameters(p);zoomLabel.setText("1×");lastZoom=SystemClock.elapsedRealtime();}}catch(Exception ignored){}}
 private void release(){handler.removeCallbacksAndMessages(null);if(camera!=null){try{camera.setOneShotPreviewCallback(null);camera.stopPreview();camera.release();}catch(Exception ignored){}camera=null;}torch=false;}
}
