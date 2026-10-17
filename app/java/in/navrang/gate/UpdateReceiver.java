package in.navrang.gate;
import android.content.*;
public final class UpdateReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context c,Intent intent){GateUpdater.installationResult(c,intent);}
}
