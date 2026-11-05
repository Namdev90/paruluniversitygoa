package `in`.navrang.gate

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.ActivityResultLauncher
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import java.lang.ref.WeakReference
import java.util.WeakHashMap

/** One process-memory unlock; no credentials or unlocked flag are persisted. */
object NativeAppLock : Application.ActivityLifecycleCallbacks, GateRuntime.Listener {
    // Nonsecret process identity. Unlike an operation counter, it does not
    // repeat when Android restores a previous process's Activity result state.
    internal val processId = java.util.UUID.randomUUID().toString()
    private val state = AppLockState(SystemClock::elapsedRealtime)
    private val handler = Handler(Looper.getMainLooper())
    private val hosts = WeakHashMap<NativeLockUi, Boolean>()
    private var application: Application? = null
    private lateinit var runtime: GateRuntime
    private var started = 0
    private var generation = -1L
    private var attempted = false
    private var lastLocked = false
    private var operation = 0L
    private var credentialFlow = false
    private var pendingCompletion = 0L
    private var pendingCompletionAt = 0L
    private var prompt: BiometricPrompt? = null
    private var current = WeakReference<NativeLockUi>(null)
    private val expiry = Runnable { refresh() }

    fun install(context: Context) {
        if (application != null) return
        val app = context.applicationContext as Application
        runtime = GateRuntime.get(app)
        generation = runtime.sessions.generation()
        runtime.setPrivateAccess { !hasSession() || state.isUnlocked }
        runtime.add(this)
        application = app
        app.registerActivityLifecycleCallbacks(this)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                state.screenLocked()
                cancelPrompt()
                attempted = false
                refresh()
            }
        }
        if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
        else app.registerReceiver(receiver, IntentFilter(Intent.ACTION_SCREEN_OFF))
    }

    private fun hasSession() = ::runtime.isInitialized && runtime.sessions.hasSavedCredential()
    fun locked() = hasSession() && !state.isUnlocked
    private fun deviceLocked(context: Context) = (context.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isDeviceLocked != false
    fun identityChanged() { state.identityChanged(); cancelPrompt(); attempted = false; refresh(false) }
    override fun event(event: org.json.JSONObject) {
        if (event.optString("type") !in listOf("auth", "profile")) return
        handler.post {
            val next = runtime.sessions.generation()
            if (next != generation || !hasSession()) {
                generation = next
                state.identityChanged()
                cancelPrompt()
                attempted = false
            }
            refresh()
        }
    }

    internal fun attach(ui: NativeLockUi) { hosts[ui] = true; ui.render(locked()) }
    internal fun detach(ui: NativeLockUi) {
        hosts.remove(ui)
        if (current.get() === ui) {
            current.clear()
            if (!ui.activity.isChangingConfigurations) cancelPrompt()
        }
    }
    internal fun resume(ui: NativeLockUi) {
        current = WeakReference(ui)
        if (deviceLocked(ui.activity)) { state.screenLocked(); cancelPrompt(); attempted = false }
        val pending = pendingCompletion
        if (pending != 0L) {
            val age = SystemClock.elapsedRealtime() - pendingCompletionAt
            pendingCompletion = 0; pendingCompletionAt = 0
            if (pending == operation && age >= 0 && age < 30_000) complete(pending, true)
            else if (pending == operation) failed(pending, "Unlock again to confirm your current return to Navrang.")
        }
        // FragmentActivity reconnects callbacks to an in-flight retained prompt
        // after rotation. Constructing a prompt does not authenticate again.
        if (operation != 0L && !credentialFlow) prompt = makePrompt(ui, operation)
        refresh()
    }
    private fun refresh(automatic: Boolean = true) {
        if (Looper.myLooper() != Looper.getMainLooper()) { handler.post { refresh(automatic) }; return }
        val locked = locked()
        if (locked && !lastLocked) attempted = false
        lastLocked = locked
        hosts.keys.toList().forEach { it.render(locked || !it.resumed) }
        if (!locked) return
        val ui = current.get() ?: return
        if (automatic && ui.resumed && !attempted && operation == 0L) unlock(ui)
    }

    internal fun unlock(ui: NativeLockUi, deviceOnly: Boolean = false) {
        if (!ui.resumed || !locked() || operation != 0L || ui.activity.supportFragmentManager.isStateSaved) return
        val id = state.beginPrompt()
        if (id == 0L) return
        operation = id
        attempted = true
        current = WeakReference(ui)
        val manager = BiometricManager.from(ui.activity)
        val strong = BiometricManager.Authenticators.BIOMETRIC_STRONG
        val device = BiometricManager.Authenticators.DEVICE_CREDENTIAL
        if (deviceOnly && Build.VERSION.SDK_INT < 30) {
            if (ui.deviceSecure()) credential(ui, id)
            else failed(id, "Set up your device PIN/password in Android security settings.")
            return
        }
        var allowed = if (Build.VERSION.SDK_INT >= 30) (if (deviceOnly) device else strong or device) else strong
        var available = manager.canAuthenticate(allowed)
        if (available != BiometricManager.BIOMETRIC_SUCCESS && Build.VERSION.SDK_INT >= 30 && ui.deviceSecure()) {
            allowed = device
            available = manager.canAuthenticate(allowed)
        }
        if (available == BiometricManager.BIOMETRIC_SUCCESS) {
            val info = BiometricPrompt.PromptInfo.Builder().setTitle("Unlock Navrang")
                .setSubtitle("Protect your saved sign-in and event data").setAllowedAuthenticators(allowed)
            if (Build.VERSION.SDK_INT < 30) info.setNegativeButtonText("Use device PIN")
            prompt = makePrompt(ui, id)
            prompt?.authenticate(info.build())
        } else if (Build.VERSION.SDK_INT < 30 && ui.deviceSecure()) credential(ui, id)
        else failed(id, "Set up a secure device PIN/password or supported strong biometric in Android security settings.")
    }

    private fun makePrompt(ui: NativeLockUi, id: Long) = BiometricPrompt(ui.activity, ui.activity.mainExecutorCompat(), object : BiometricPrompt.AuthenticationCallback() {
        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { complete(id, true) }
        override fun onAuthenticationError(code: Int, message: CharSequence) {
            val active = current.get()
            if (code == BiometricPrompt.ERROR_NEGATIVE_BUTTON && Build.VERSION.SDK_INT < 30 && active != null && active.deviceSecure() && operation == id) credential(active, id)
            else failed(id, "Navrang remains locked. Tap Unlock to try again.")
        }
    })
    private fun credential(ui: NativeLockUi, id: Long) {
        credentialFlow = true
        if (!ui.openCredential(id)) failed(id, "Device credential confirmation is unavailable. Open Android security settings.")
    }
    internal fun credentialResult(id: Long, sourceProcess: String, success: Boolean) {
        if (sourceProcess == processId && credentialFlow && id == operation) complete(id, success)
    }
    private fun complete(id: Long, success: Boolean) {
        if (id == 0L || id != operation) return
        val ui = current.get()
        // Android may deliver a result before onResume, including during
        // recreation. Keep only a short, operation-bound proof in process RAM.
        if (success && (ui == null || !ui.resumed)) {
            if (pendingCompletion != id) { pendingCompletion = id; pendingCompletionAt = SystemClock.elapsedRealtime() }
            return
        }
        val accepted = success && ui != null && ui.resumed && !deviceLocked(ui.activity) && state.authenticated(id)
        if (!accepted) state.cancelled(id)
        operation = 0L; credentialFlow = false; prompt = null; pendingCompletion = 0; pendingCompletionAt = 0
        refresh(false)
        if (accepted) {
            runtime.refresh()
            runtime.sessions.read()?.optJSONObject("profile")?.let { runtime.emit("profile", it) }
        }
    }
    private fun failed(id: Long, message: String) {
        if (id == 0L || operation != id) return
        state.cancelled(id); operation = 0; credentialFlow = false; prompt = null; pendingCompletion = 0; pendingCompletionAt = 0
        current.get()?.message(message)
        refresh(false)
    }
    private fun cancelPrompt() {
        val old = operation
        operation = 0; credentialFlow = false; pendingCompletion = 0; pendingCompletionAt = 0
        state.cancelled(old)
        val active = prompt; prompt = null; active?.cancelAuthentication()
    }

    override fun onActivityStarted(activity: Activity) {
        if (started++ == 0) { handler.removeCallbacks(expiry); state.foreground(); refresh(false) }
    }
    override fun onActivityStopped(activity: Activity) {
        started = (started - 1).coerceAtLeast(0)
        if (started == 0 && !activity.isChangingConfigurations) { state.background(); handler.removeCallbacks(expiry); handler.postDelayed(expiry, 30_000) }
    }
    override fun onActivityCreated(activity: Activity, saved: Bundle?) {}
    override fun onActivityResumed(activity: Activity) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, saved: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}

private fun FragmentActivity.mainExecutorCompat() = java.util.concurrent.Executor { task -> runOnUiThread(task) }

/** A native cover also removes protected views from accessibility while locked. */
class NativeLockUi(val activity: FragmentActivity, private val onLocked: (Boolean) -> Unit, private val signOut: () -> Unit) {
    internal var resumed = false
        private set
    private val content = activity.findViewById<ViewGroup>(android.R.id.content)
    private val roots = (0 until content.childCount).map { content.getChildAt(it) }.associateWith { it.visibility to it.importantForAccessibility }
    private val panel = ScrollView(activity)
    private val status = TextView(activity)
    private val deviceButton = Button(activity)
    private var shown = false
    private var policyLocked = false
    private val restoredCredential = activity.savedStateRegistry.consumeRestoredStateForKey("navrang-lock-credential")
    private var credentialProcess = restoredCredential?.getString("processId").orEmpty()
    private var credentialOperation = if (credentialProcess == NativeAppLock.processId) restoredCredential?.getLong("operation") ?: 0L else 0L
    private var credentialLauncher: ActivityResultLauncher<Intent>? = null

    init {
        NativeAppLock.install(activity)
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
            val padding = (24 * resources.displayMetrics.density).toInt(); setPadding(padding, padding, padding, padding)
        }
        panel.setBackgroundColor(Color.rgb(32, 9, 24)); panel.isFillViewport = true
        column.addView(TextView(activity).apply { text = "Unlock Navrang"; textSize = 26f; setTextColor(Color.rgb(245, 215, 149)) })
        status.text = "Your saved sign-in is protected. Use a strong fingerprint/supported face or your device PIN/password. Returning within 30 seconds keeps the current unlock."
        status.textSize = 16f; status.setTextColor(Color.WHITE); column.addView(status)
        column.addView(Button(activity).apply { text = "Unlock"; setOnClickListener { NativeAppLock.unlock(this@NativeLockUi) } })
        deviceButton.text = "Use device PIN/password"
        deviceButton.setOnClickListener { NativeAppLock.unlock(this, true) }
        column.addView(deviceButton)
        column.addView(Button(activity).apply { text = "Android security settings"; setOnClickListener { runCatching { activity.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) } } })
        column.addView(Button(activity).apply { text = "Sign out"; setOnClickListener { signOut() } })
        panel.addView(column, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        content.addView(panel, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        panel.contentDescription = "Navrang app lock"
        // This nonsecret operation ID cannot unlock a cold process. The actual
        // successful result and unlock state are never saved in instance state.
        activity.savedStateRegistry.registerSavedStateProvider("navrang-lock-credential") {
            Bundle().apply { putLong("operation", credentialOperation); putString("processId", credentialProcess) }
        }
        NativeAppLock.attach(this)
        if (credentialOperation != 0L) bindCredential(credentialOperation)
    }
    internal fun render(locked: Boolean) {
        roots.forEach { (view, original) ->
            view.visibility = if (locked) View.INVISIBLE else original.first
            view.importantForAccessibility = if (locked) View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS else original.second
        }
        panel.visibility = if (locked) View.VISIBLE else View.GONE
        deviceButton.visibility = if (deviceSecure()) View.VISIBLE else View.GONE
        val policy = NativeAppLock.locked()
        if (shown != locked || policyLocked != policy) { shown = locked; policyLocked = policy; onLocked(locked) }
        if (locked) (activity.getSystemService(Context.INPUT_METHOD_SERVICE) as? InputMethodManager)?.hideSoftInputFromWindow(panel.windowToken, 0)
    }
    fun resume() { resumed = true; NativeAppLock.resume(this) }
    fun pause() { resumed = false; render(true) }
    fun close() {
        resumed = false
        credentialLauncher?.unregister(); credentialLauncher = null
        activity.savedStateRegistry.unregisterSavedStateProvider("navrang-lock-credential")
        NativeAppLock.detach(this)
    }
    internal fun message(value: String) { status.text = value }
    internal fun deviceSecure() = (activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isDeviceSecure == true
    @Suppress("DEPRECATION")
    private fun bindCredential(id: Long) {
        credentialLauncher?.unregister(); credentialLauncher = null
        // Capture both values, rather than reading a mutable latest operation
        // in the callback. Registry keys also differ after process death.
        val process = credentialProcess
        val launcher = activity.activityResultRegistry.register("navrang-device-credential-$process-$id", ActivityResultContracts.StartActivityForResult()) { result ->
            if (credentialOperation == id) {
                credentialOperation = 0
                credentialLauncher?.unregister(); credentialLauncher = null
            }
            NativeAppLock.credentialResult(id, process, result.resultCode == Activity.RESULT_OK)
        }
        if (credentialOperation == id) credentialLauncher = launcher else launcher.unregister()
    }
    @Suppress("DEPRECATION")
    internal fun openCredential(id: Long): Boolean {
        val manager = activity.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager ?: return false
        val intent = manager.createConfirmDeviceCredentialIntent("Unlock Navrang", "Confirm your device PIN/password") ?: return false
        return runCatching {
            credentialProcess = NativeAppLock.processId
            credentialOperation = id
            bindCredential(id)
            credentialLauncher?.launch(intent) ?: return false
            true
        }.getOrDefault(false)
    }
}
