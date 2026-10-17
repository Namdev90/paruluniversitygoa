package in.navrang.gate;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.util.*;
/** Preloaded Kenney CC0 cues. App sound is always enabled; device policies still apply. */
public final class GateFeedback {
 private static final Handler h=new Handler(Looper.getMainLooper());
 private static SoundPool pool;
 private static final Map<String,Integer> sounds=new HashMap<>();
 private static final Set<Integer> ready=new HashSet<>();
 private static final Map<String,Long> waiting=new HashMap<>();
 private static int introStream; private static long lastTap,lastScan;
 public static void init(Context context){
  final Context app=context.getApplicationContext();
  h.post(()->{if(pool!=null)return;try{
   pool=new SoundPool.Builder().setMaxStreams(6).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
   pool.setOnLoadCompleteListener((p,id,status)->{if(status!=0)return;ready.add(id);for(String kind:new ArrayList<>(waiting.keySet()))if(sounds.get(kind)!=null&&sounds.get(kind)==id){long at=waiting.remove(kind);if(SystemClock.elapsedRealtime()-at<2000)playReady(kind,id);}});
   for(String kind:new String[]{"intro","tap","scan","success","issue","duplicate","invalid","pending","transition","close"}){int id=app.getResources().getIdentifier(kind,"raw",app.getPackageName());if(id!=0)sounds.put(kind,pool.load(app,id,1));}
  }catch(Exception ignored){}});
 }
 private static void playReady(String kind,int id){
  float volume="tap".equals(kind)?.7f:1f;int priority="tap".equals(kind)?0:"intro".equals(kind)?1:3;
  int stream=pool.play(id,volume,volume,priority,0,1);if("intro".equals(kind))introStream=stream;
 }
 public static void play(Context c,String kind){play(c,kind,true);}
 public static void play(Context c,String kind,boolean ignoredEnabled){
  if("stop-intro".equals(kind)){h.post(()->{waiting.remove("intro");if(pool!=null&&introStream!=0)pool.stop(introStream);introStream=0;});return;}
  if(Arrays.asList("scan","success","issue","duplicate","invalid").contains(kind))try{
   Vibrator v=(Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE);long[] pattern="scan".equals(kind)?new long[]{0,35}:"success".equals(kind)?new long[]{0,40,45,40}:"duplicate".equals(kind)?new long[]{0,65,45,65,45,65}:new long[]{0,130,70,130};
   int[] amplitude=new int[pattern.length];for(int i=1;i<amplitude.length;i+=2)amplitude[i]=255;if(v!=null){if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createWaveform(pattern,amplitude,-1));else v.vibrate(pattern,-1);}
  }catch(Exception ignored){}
  init(c);h.post(()->{long now=SystemClock.elapsedRealtime();if("tap".equals(kind)){if(now-lastTap<70)return;lastTap=now;}if("scan".equals(kind))lastScan=now;
   boolean outcome=Arrays.asList("success","issue","duplicate","invalid").contains(kind);long delay=outcome?Math.max(0,330-(now-lastScan)):0;
   h.postDelayed(()->{Integer id=sounds.get(kind);if(pool==null||id==null)return;if(ready.contains(id))playReady(kind,id);else waiting.put(kind,SystemClock.elapsedRealtime());},delay);
  });
 }
}
