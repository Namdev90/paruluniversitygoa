package in.navrang.gate;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.util.*;
/** Original local bell cues, preloaded and played without blocking the scanner. */
public final class GateFeedback {
 private static final Handler h=new Handler(Looper.getMainLooper());private static SoundPool pool;private static final Map<String,Integer> sounds=new HashMap<>();private static final Set<Integer> ready=new HashSet<>();private static String waiting;private static int introStream;
 public static void init(Context context){final Context app=context.getApplicationContext();h.post(()->{if(pool!=null)return;try{pool=new SoundPool.Builder().setMaxStreams(4).setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();pool.setOnLoadCompleteListener((p,id,status)->{if(status==0){ready.add(id);if(waiting!=null&&sounds.get(waiting)!=null&&sounds.get(waiting)==id){introStream=p.play(id,1f,1f,1,0,1);waiting=null;}}});for(String kind:new String[]{"intro","success","issue","tap","pending","transition"}){int id=app.getResources().getIdentifier(kind,"raw",app.getPackageName());if(id!=0)sounds.put(kind,pool.load(app,id,1));}}catch(Exception ignored){}});}
 public static void setSound(Context c,boolean on){c.getSharedPreferences("navrang-feedback",0).edit().putBoolean("sound",on).apply();if(!on)h.post(()->{waiting=null;if(pool!=null)pool.autoPause();});else h.post(()->{if(pool!=null)pool.autoResume();});}
 public static void play(Context c,String kind){play(c,kind,c.getSharedPreferences("navrang-feedback",0).getBoolean("sound",true));}
 public static void play(Context c,String kind,boolean enabled){
  if("stop-intro".equals(kind)){h.post(()->{waiting=null;if(pool!=null&&introStream!=0)pool.stop(introStream);introStream=0;});return;}
  if("success".equals(kind)||"issue".equals(kind))try{Vibrator v=(Vibrator)c.getSystemService(Context.VIBRATOR_SERVICE);long[] pattern="success".equals(kind)?new long[]{0,40,45,40}:new long[]{0,130,70,130};if(v!=null){if(Build.VERSION.SDK_INT>=26)v.vibrate(VibrationEffect.createWaveform(pattern,"success".equals(kind)?new int[]{0,255,0,255}:new int[]{0,255,0,255},-1));else v.vibrate(pattern,-1);}}catch(Exception ignored){}
  if(!enabled)return;init(c);h.post(()->{Integer id=sounds.get(kind);if(pool==null||id==null)return;if(ready.contains(id)){int stream=pool.play(id,"tap".equals(kind)?.5f:1f,"tap".equals(kind)?.5f:1f,1,0,1);if("intro".equals(kind))introStream=stream;}else if("intro".equals(kind))waiting=kind;});
 }
}
