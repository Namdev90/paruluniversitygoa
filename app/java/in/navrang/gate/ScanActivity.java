package in.navrang.gate;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class ScanActivity extends Activity implements SurfaceHolder.Callback {
 private SurfaceView surface;
 private Camera camera;
 private boolean surfaceReady=false,active=false,torch=false,continuous=false;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private final ExecutorService decoder=Executors.newSingleThreadExecutor();
 private final Runnable autofocus=new Runnable(){public void run(){if(camera!=null&&active&&!continuous){try{camera.autoFocus((ok,c)->{});}catch(Exception ignored){}handler.postDelayed(this,1500);}}};

 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);getWindow().setStatusBarColor(Color.BLACK);getWindow().setNavigationBarColor(Color.BLACK);
  FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(Color.BLACK);surface=new SurfaceView(this);frame.addView(surface,new FrameLayout.LayoutParams(-1,-1));surface.getHolder().addCallback(this);
  LinearLayout top=new LinearLayout(this);top.setPadding(24,36,24,24);top.setBackgroundColor(0xb0000000);top.setOrientation(LinearLayout.VERTICAL);TextView title=new TextView(this);title.setText("Scan the ticket email QR");title.setTextColor(Color.WHITE);title.setTextSize(22);top.addView(title);TextView detail=new TextView(this);detail.setText("Hold steady. Admission is confirmed on the next screen.");detail.setTextColor(0xffeeeeee);detail.setTextSize(14);top.addView(detail);FrameLayout.LayoutParams tp=new FrameLayout.LayoutParams(-1,-2,Gravity.TOP);frame.addView(top,tp);
  LinearLayout actions=new LinearLayout(this);actions.setPadding(20,12,20,30);actions.setBackgroundColor(0xb0000000);Button light=new Button(this);light.setText("Light");light.setOnClickListener(v->toggleTorch());Button cancel=new Button(this);cancel.setText("Cancel");cancel.setOnClickListener(v->finish());actions.addView(light,new LinearLayout.LayoutParams(0,-2,1));actions.addView(cancel,new LinearLayout.LayoutParams(0,-2,1));frame.addView(actions,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));
  frame.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});setContentView(frame);frame.requestApplyInsets();
 }
 @Override public void surfaceCreated(SurfaceHolder holder){surfaceReady=true;if(active)openCamera();}
 @Override public void surfaceChanged(SurfaceHolder holder,int format,int width,int height){}
 @Override public void surfaceDestroyed(SurfaceHolder holder){surfaceReady=false;release();}
 @Override public void onResume(){super.onResume();active=true;if(surfaceReady)openCamera();}
 @Override public void onPause(){active=false;release();super.onPause();}
 @Override public void onDestroy(){decoder.shutdownNow();super.onDestroy();}
 private void fail(){Intent result=new Intent();result.putExtra("error","Camera could not open. Enter the Transaction ID instead.");setResult(RESULT_OK,result);finish();}
 private void openCamera(){
  if(camera!=null||!surfaceReady||!active)return;
  try{
   int cameraId=0;Camera.CameraInfo info=new Camera.CameraInfo();for(int i=0;i<Camera.getNumberOfCameras();i++){Camera.getCameraInfo(i,info);if(info.facing==Camera.CameraInfo.CAMERA_FACING_BACK){cameraId=i;break;}}
   Camera.getCameraInfo(cameraId,info);camera=Camera.open(cameraId);Camera.Parameters p=camera.getParameters();List<Camera.Size> sizes=p.getSupportedPreviewSizes();Camera.Size chosen=p.getPreviewSize();long best=Long.MAX_VALUE;
   if(sizes!=null)for(Camera.Size s:sizes){long distance=Math.abs((long)s.width*s.height-1280L*720);if(distance<best){best=distance;chosen=s;}}
   p.setPreviewSize(chosen.width,chosen.height);p.setPreviewFormat(ImageFormat.NV21);List<String> focuses=p.getSupportedFocusModes();
   if(focuses!=null&&focuses.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)){p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);continuous=true;}else if(focuses!=null&&focuses.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO)){p.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_VIDEO);continuous=true;}
   camera.setParameters(p);int rotation=getWindowManager().getDefaultDisplay().getRotation();int degrees=rotation==Surface.ROTATION_90?90:rotation==Surface.ROTATION_180?180:rotation==Surface.ROTATION_270?270:0;int orientation=info.facing==Camera.CameraInfo.CAMERA_FACING_FRONT?(360-(info.orientation+degrees)%360)%360:(info.orientation-degrees+360)%360;camera.setDisplayOrientation(orientation);camera.setPreviewDisplay(surface.getHolder());camera.startPreview();nextFrame();if(!continuous)handler.postDelayed(autofocus,500);
  }catch(Exception e){release();fail();}
 }
 private void nextFrame(){
  if(camera==null||!active)return;
  try{camera.setOneShotPreviewCallback((data,c)->{
   if(!active||camera==null)return;Camera.Size size=c.getParameters().getPreviewSize();
   decoder.execute(()->{String value=QrCodec.decode(data,size.width,size.height);handler.post(()->{if(!active||camera==null)return;if(value!=null){Intent result=new Intent();result.putExtra("qr",value);setResult(RESULT_OK,result);finish();}else handler.postDelayed(()->nextFrame(),90);});});
  });}catch(Exception e){release();fail();}
 }
 private void toggleTorch(){if(camera==null)return;try{Camera.Parameters p=camera.getParameters();List<String> modes=p.getSupportedFlashModes();if(modes==null||!modes.contains(Camera.Parameters.FLASH_MODE_TORCH)){Toast.makeText(this,"Light unavailable on this camera",Toast.LENGTH_SHORT).show();return;}torch=!torch;p.setFlashMode(torch?Camera.Parameters.FLASH_MODE_TORCH:Camera.Parameters.FLASH_MODE_OFF);camera.setParameters(p);}catch(Exception e){Toast.makeText(this,"Could not change light",Toast.LENGTH_SHORT).show();}}
 private void release(){handler.removeCallbacksAndMessages(null);if(camera!=null){try{camera.setOneShotPreviewCallback(null);camera.stopPreview();camera.release();}catch(Exception ignored){}camera=null;}torch=false;}
}
