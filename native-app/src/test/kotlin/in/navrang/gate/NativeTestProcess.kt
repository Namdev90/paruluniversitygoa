package `in`.navrang.gate

import android.app.Application
import android.os.Handler

/** Isolate owned app statics between Robolectric Applications; never touches a device. */
internal object NativeTestProcess {
    fun reset() {
        val instance = GateRuntime::class.java.getDeclaredField("instance").apply { isAccessible = true }
        (instance.get(null) as? GateRuntime)?.let { runtime ->
            for (name in listOf("sync", "entries", "requests")) {
                (GateRuntime::class.java.getDeclaredField(name).apply { isAccessible = true }.get(runtime) as java.util.concurrent.ExecutorService).shutdownNow()
            }
        }
        instance.set(null, null)
        val lock = NativeAppLock::class.java
        val app = lock.getDeclaredField("application").apply { isAccessible = true }
        (app.get(null) as? Application)?.unregisterActivityLifecycleCallbacks(NativeAppLock)
        app.set(null, null)
        (lock.getDeclaredField("handler").apply { isAccessible = true }.get(null) as Handler).removeCallbacksAndMessages(null)
        (lock.getDeclaredField("state").apply { isAccessible = true }.get(null) as AppLockState).apply { screenLocked(); background() }
        @Suppress("UNCHECKED_CAST")
        (lock.getDeclaredField("hosts").apply { isAccessible = true }.get(null) as MutableMap<NativeLockUi, Boolean>).clear()
        for (name in listOf("started")) lock.getDeclaredField(name).apply { isAccessible = true }.setInt(null, 0)
        for (name in listOf("operation", "pendingCompletion", "pendingCompletionAt")) lock.getDeclaredField(name).apply { isAccessible = true }.setLong(null, 0L)
        for (name in listOf("credentialFlow", "attempted", "lastLocked")) lock.getDeclaredField(name).apply { isAccessible = true }.setBoolean(null, false)
    }
}
