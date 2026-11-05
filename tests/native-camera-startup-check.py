#!/usr/bin/env python3
"""Run the real scanner startup/release methods with a deliberately stalled camera."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / 'app/java/in/navrang/gate/ScanActivity.java').read_text()
opening = source[source.index(' private void openCamera(){'):source.index('\n private void fitPreview()')]
release = source[source.index(' private void release(){'):source.rfind('\n}')]
harness = r'''
import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
public class CameraStartupCheck {
 static class Camera {
  static volatile CountDownLatch entered,allow;static AtomicInteger opens=new AtomicInteger(),closes=new AtomicInteger();static boolean failPreview;
  static void reset(boolean blocked){entered=new CountDownLatch(1);allow=new CountDownLatch(blocked?1:0);opens.set(0);closes.set(0);failPreview=false;}
  static class CameraInfo {static final int CAMERA_FACING_BACK=0,CAMERA_FACING_FRONT=1;int facing=0,orientation=90;}
  static class Size {int width=1280,height=720;}
  static class Parameters {static final String FOCUS_MODE_CONTINUOUS_PICTURE="continuous",FOCUS_MODE_AUTO="auto";Size getPreviewSize(){return new Size();}List<Size> getSupportedPreviewSizes(){return Arrays.asList(new Size());}List<String> getSupportedFocusModes(){return Arrays.asList(FOCUS_MODE_AUTO);}void setPreviewSize(int w,int h){}void setPreviewFormat(int f){}void setFocusMode(String m){}}
  interface ErrorCallback {void error(int code,Camera camera);}
  static int getNumberOfCameras(){return 1;}static void getCameraInfo(int id,CameraInfo info){}
  static Camera open(int id)throws Exception{opens.incrementAndGet();entered.countDown();if(!allow.await(5,TimeUnit.SECONDS))throw new IllegalStateException("test camera stalled");return new Camera();}
  Parameters getParameters(){return new Parameters();}void setParameters(Parameters p){}void setErrorCallback(ErrorCallback cb){}void setDisplayOrientation(int n){}void setPreviewDisplay(Object holder){}
  void startPreview(){if(failPreview)throw new IllegalStateException("preview failed");}void setOneShotPreviewCallback(Object callback){}void stopPreview(){}void release(){closes.incrementAndGet();}
 }
 static class ImageFormat {static final int NV21=17;}static class Surface {static final int ROTATION_90=1,ROTATION_180=2,ROTATION_270=3;}
 static class Display {int getRotation(){return 0;}}static class WindowManager {Display getDefaultDisplay(){return new Display();}}
 static class SurfaceHolder {}static class SurfaceView {final SurfaceHolder holder=new SurfaceHolder();SurfaceHolder getHolder(){return holder;}}static class SystemClock {static long elapsedRealtime(){return System.nanoTime()/1000000;}}
 static class Handler {void postDelayed(Runnable r,long delay){}void removeCallbacksAndMessages(Object token){}}
 final ExecutorService ui=Executors.newSingleThreadExecutor(),cameraWorker=Executors.newSingleThreadExecutor();
 final Queue<Runnable> uiCallbacks=new ConcurrentLinkedQueue<>();final Object cameraLock=new Object();
 final Handler handler=new Handler();final SurfaceView surface=new SurfaceView();final Runnable autofocus=()->{};
 Camera camera,openingCamera;boolean ready=true,active=true,continuous,torch,cameraOpening;int cameraGeneration,torchMode,previewWidth,previewHeight,previewRotation,darkFrames,brightFrames,failures,frames;long lastRead,lastHealth;
 WindowManager getWindowManager(){return new WindowManager();}void runOnUiThread(Runnable task){uiCallbacks.add(task);}void fitPreview(){}void nextFrame(){frames++;}void setTorch(boolean on){}void fail(){failures++;}
 __OPENING__
 __RELEASE__
 void ui(Runnable task)throws Exception{ui.submit(task).get(3,TimeUnit.SECONDS);}
 void flush()throws Exception{ui(()->{Runnable task;while((task=uiCallbacks.poll())!=null)task.run();});}
 void idleWorker()throws Exception{cameraWorker.submit(()->{}).get(3,TimeUnit.SECONDS);}
 void stop()throws Exception{Camera.allow.countDown();idleWorker();flush();ui(this::release);cameraWorker.shutdown();cameraWorker.awaitTermination(3,TimeUnit.SECONDS);flush();ui.shutdownNow();}
 static int checks;static void check(boolean ok,String message){checks++;if(!ok)throw new AssertionError(message);}
 static void responsiveStartup()throws Exception {
  Camera.reset(true);CameraStartupCheck s=new CameraStartupCheck();try{
   s.ui.execute(s::openCamera);check(Camera.entered.await(2,TimeUnit.SECONDS),"camera open began");CountDownLatch button=new CountDownLatch(1);s.ui.execute(button::countDown);
   boolean responded=button.await(400,TimeUnit.MILLISECONDS);Camera.allow.countDown();check(responded,"slow Camera.open must not block the UI's next button click");
   s.idleWorker();s.flush();check(s.camera!=null&&s.frames==1,"successful startup starts the live scanner once");
  }finally{s.stop();}check(Camera.closes.get()==1,"leaving scanner releases its camera once");
 }
 static void cancelledStartup(boolean afterOpen,boolean destroy)throws Exception {
  Camera.reset(true);CameraStartupCheck s=new CameraStartupCheck();try{
   s.ui(s::openCamera);check(Camera.entered.await(2,TimeUnit.SECONDS),"background camera started");s.ui(s::openCamera);check(Camera.opens.get()==1,"repeated launch cannot open a second camera");
   if(afterOpen){Camera.allow.countDown();s.idleWorker();}
   s.ui(()->{s.active=false;s.ready=false;s.release();});
   if(destroy)s.cameraWorker.shutdown();Camera.allow.countDown();
   if(destroy)check(s.cameraWorker.awaitTermination(3,TimeUnit.SECONDS),"destroy drains camera cleanup");else s.idleWorker();s.flush();
   check(s.camera==null&&s.frames==0&&s.failures==0,"cancelled startup cannot attach preview or show a spurious error");
   check(Camera.closes.get()==1,"cancelled camera is released exactly once");
   if(!destroy){s.ui(()->{s.active=true;s.ready=true;s.openCamera();});s.idleWorker();s.flush();check(s.camera!=null&&s.frames==1,"resuming after cancellation opens a fresh preview");}
  }finally{if(destroy){s.ui.shutdownNow();}else s.stop();}
 }
 static void startupFailure()throws Exception {
  Camera.reset(false);Camera.failPreview=true;CameraStartupCheck s=new CameraStartupCheck();try{
   s.ui(s::openCamera);s.idleWorker();s.flush();check(s.camera==null&&s.failures==1,"failed configuration reports one camera error");check(Camera.closes.get()==1,"failed startup releases its partially opened camera");
  }finally{s.stop();}
 }
 public static void main(String[] args)throws Exception {responsiveStartup();cancelledStartup(false,false);cancelledStartup(true,false);cancelledStartup(false,true);cancelledStartup(true,true);startupFailure();System.out.println("PASS actual scanner startup: "+checks+" checks for UI responsiveness, duplicate taps, cancellation, destruction and failed preview cleanup.");}
}
'''.replace('__OPENING__', opening).replace('__RELEASE__', release)
with tempfile.TemporaryDirectory(prefix='navrang-camera-startup-') as temp:
    folder = Path(temp)
    java = folder / 'CameraStartupCheck.java'
    java.write_text(harness)
    subprocess.run(['java', '--module', 'jdk.compiler/com.sun.tools.javac.Main', '-d', str(folder / 'classes'), str(java)], check=True)
    subprocess.run(['java', '-cp', str(folder / 'classes'), 'CameraStartupCheck'], check=True, timeout=25)
