package in.navrang.gate;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

/** Persisted, network-constrained cleanup survives process death and offline sign-out. */
public final class PushReconcileJob extends JobService {
    private static final int JOB_ID = 48117;
    private final java.util.concurrent.atomic.AtomicReference<JobParameters> running = new java.util.concurrent.atomic.AtomicReference<>();
    public static void schedule(Context context) {
        if (!BuildConfig.PUSH_ENABLED) return;
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        // Replacing an existing job is intentional. A token/logout signal must
        // not disappear between a worker's final check and jobFinished(false).
        if (scheduler != null)
            scheduler.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, PushReconcileJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true)
                .setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build());
    }
    @Override public boolean onStartJob(JobParameters params) {
        if (!BuildConfig.PUSH_ENABLED) return false;
        running.set(params);
        try { PushCoordinator.get(this).reconcile(() -> running.get() != params, retry -> new android.os.Handler(getMainLooper()).post(() -> {
            if (running.compareAndSet(params, null)) jobFinished(params, retry);
        })); return true; }
        catch (Exception ignored) { return false; }
    }
    @Override public boolean onStopJob(JobParameters params) { running.compareAndSet(params, null); return BuildConfig.PUSH_ENABLED; }
}
