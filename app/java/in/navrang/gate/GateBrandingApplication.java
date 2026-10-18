package in.navrang.gate;

import android.app.Activity;
import android.app.Application;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Central presentation for the native scanner. No auth, storage or network actions. */
public final class GateBrandingApplication extends Application {
 private static int dp(Activity activity,int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
 @Override public void onCreate(){
  super.onCreate();
  registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks(){
   @Override public void onActivityCreated(Activity activity,Bundle state){
    if(!"in.navrang.gate.ScanActivity".equals(activity.getClass().getName()))return;
    View root=activity.findViewById(android.R.id.content);
    root.post(()->{if(activity.isFinishing()||activity.isDestroyed())return;try{styleScanner(activity,root);}catch(RuntimeException error){android.util.Log.w("NavrangBranding","Scanner branding could not be applied; gate controls preserved.");}});
   }
   @Override public void onActivityStarted(Activity activity){}
   @Override public void onActivityResumed(Activity activity){}
   @Override public void onActivityPaused(Activity activity){}
   @Override public void onActivityStopped(Activity activity){}
   @Override public void onActivitySaveInstanceState(Activity activity,Bundle state){}
   @Override public void onActivityDestroyed(Activity activity){}
  });
 }
 private static GradientDrawable surface(Activity activity,int fill,int stroke){
  GradientDrawable shape=new GradientDrawable();shape.setColor(fill);shape.setCornerRadius(dp(activity,9));shape.setStroke(dp(activity,1),stroke);return shape;
 }
 private static void styleScanner(Activity activity,View view){
  if(view==null)return;
  if(view instanceof Button){
   Button button=(Button)view;StateListDrawable states=new StateListDrawable();
   states.addState(new int[]{-android.R.attr.state_enabled},surface(activity,0xff20251f,0xff41483d));
   states.addState(new int[]{android.R.attr.state_pressed},surface(activity,0xff44513e,0xffa6b399));
   states.addState(new int[]{},surface(activity,0xff293326,0xff66755d));
   button.setBackground(states);button.setElevation(0);button.setTextColor(0xfff0e7d7);
   button.setMinimumHeight(dp(activity,48));
   // Existing click/touch handlers, enabled states and scanner timing remain untouched.
  }
  if(!(view instanceof ViewGroup))return;
  ViewGroup group=(ViewGroup)view;
  for(int i=0;i<group.getChildCount();i++){
   View child=group.getChildAt(i);
   if(child instanceof TextView&&!(child instanceof Button)&&"Navrang · live scanner".contentEquals(((TextView)child).getText())){
    int resource=activity.getResources().getIdentifier("navrang_wordmark","drawable",activity.getPackageName());
    if(resource==0)continue;
    LinearLayout branding=new LinearLayout(activity);branding.setOrientation(LinearLayout.HORIZONTAL);branding.setGravity(android.view.Gravity.CENTER_VERTICAL);branding.setPadding(0,dp(activity,7),0,dp(activity,7));
    ImageView logo=new ImageView(activity);logo.setImageResource(resource);logo.setScaleType(ImageView.ScaleType.FIT_CENTER);logo.setContentDescription("Navrang official event logo");
    branding.addView(logo,new LinearLayout.LayoutParams(dp(activity,128),dp(activity,59)));
    TextView label=new TextView(activity);label.setText("Live scanner");label.setTextSize(16);label.setTextColor(Color.WHITE);label.setPadding(dp(activity,14),0,0,0);branding.addView(label);
    ViewGroup.LayoutParams params=child.getLayoutParams();group.removeViewAt(i);group.addView(branding,i,params);
   }else styleScanner(activity,child);
  }
 }
}
