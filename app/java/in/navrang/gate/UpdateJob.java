package in.navrang.gate;
import android.app.job.*;
import java.util.concurrent.*;
public final class UpdateJob extends JobService {
 private final ExecutorService worker=Executors.newSingleThreadExecutor();
 private volatile GateUpdater.UpdateCancellation cancellation;
 @Override public boolean onStartJob(JobParameters p){
  GateUpdater.UpdateCancellation run=new GateUpdater.UpdateCancellation();cancellation=run;
  worker.execute(()->{GateUpdater.background(getApplicationContext(),run);if(!run.isCancelled())jobFinished(p,false);});return true;
 }
 @Override public boolean onStopJob(JobParameters p){if(cancellation!=null)cancellation.cancel();return true;}
 @Override public void onDestroy(){if(cancellation!=null)cancellation.cancel();worker.shutdown();super.onDestroy();}
}
