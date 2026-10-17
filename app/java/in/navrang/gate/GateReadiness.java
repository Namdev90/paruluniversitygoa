package in.navrang.gate;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.hardware.*;
import android.media.AudioManager;
import android.os.*;
import android.view.WindowManager;
import org.json.JSONObject;
/** Activity-only adaptive brightness; never requests global settings or DND access. */
public final class GateReadiness implements SensorEventListener {
 private final Activity activity;private final SensorManager sensors;private final Sensor light;
 private float applied=-1;private long last=0;
 public GateReadiness(Activity a){activity=a;sensors=(SensorManager)a.getSystemService(Context.SENSOR_SERVICE);light=sensors==null?null:sensors.getDefaultSensor(Sensor.TYPE_LIGHT);}
 public static void volume(Activity a){a.setVolumeControlStream(AudioManager.STREAM_MUSIC);try{AudioManager m=(AudioManager)a.getSystemService(Context.AUDIO_SERVICE);if(m!=null&&!m.isVolumeFixed())m.setStreamVolume(AudioManager.STREAM_MUSIC,m.getStreamMaxVolume(AudioManager.STREAM_MUSIC),0);}catch(SecurityException ignored){} }
 public void resume(){volume(activity);activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);if(light!=null)sensors.registerListener(this,light,SensorManager.SENSOR_DELAY_NORMAL);}
 public void pause(){if(sensors!=null)sensors.unregisterListener(this);WindowManager.LayoutParams p=activity.getWindow().getAttributes();p.screenBrightness=WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;activity.getWindow().setAttributes(p);applied=-1;}
 @Override public void onSensorChanged(SensorEvent event){long now=SystemClock.elapsedRealtime();if(now-last<1200)return;float lux=Math.max(0,event.values[0]);float target=Math.max(.28f,Math.min(1f,.28f+(float)Math.log10(lux+1)*.18f));float next=applied<0?target:applied*.7f+target*.3f;if(applied>=0&&Math.abs(next-applied)<.035f)return;applied=next;last=now;WindowManager.LayoutParams p=activity.getWindow().getAttributes();p.screenBrightness=next;activity.getWindow().setAttributes(p);}
 @Override public void onAccuracyChanged(Sensor sensor,int accuracy){}
 public static JSONObject status(Activity a){JSONObject r=new JSONObject();try{AudioManager m=(AudioManager)a.getSystemService(Context.AUDIO_SERVICE);Vibrator v=(Vibrator)a.getSystemService(Context.VIBRATOR_SERVICE);SensorManager sm=(SensorManager)a.getSystemService(Context.SENSOR_SERVICE);r.put("native",true).put("camera",a.checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED).put("notifications",((NotificationManager)a.getSystemService(Context.NOTIFICATION_SERVICE)).areNotificationsEnabled()).put("vibration",v!=null&&v.hasVibrator()).put("fullVolume",m!=null&&m.getStreamVolume(AudioManager.STREAM_MUSIC)==m.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).put("adaptiveBrightness",sm!=null&&sm.getDefaultSensor(Sensor.TYPE_LIGHT)!=null).put("message","Android controls permission approval and may limit sound or vibration through device policy.");}catch(Exception ignored){}return r;}
}
