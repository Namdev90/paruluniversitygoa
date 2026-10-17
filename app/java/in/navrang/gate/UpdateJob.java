package in.navrang.gate;
import android.app.job.*;
import java.util.concurrent.*;
public final class UpdateJob extends JobService {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile boolean stopped;
 @Override public boolean onStartJob(JobParameters p){stopped=false;worker.execute(()->{GateUpdater.background(getApplicationContext());if(!stopped)jobFinished(p,false);});return true;}
 @Override public boolean onStopJob(JobParameters p){stopped=true;return true;}
 @Override public void onDestroy(){worker.shutdown();super.onDestroy();}
}
