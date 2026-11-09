package `in`.navrang.gate

import android.app.Application
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

class LockProbeActivity : FragmentActivity() {
    lateinit var privateView: TextView
    lateinit var lockUi: NativeLockUi
    override fun onCreate(savedInstanceState: Bundle?) {
        NativeAppLock.install(this)
        super.onCreate(savedInstanceState)
        privateView = TextView(this).apply { text = "Synthetic protected content" }
        setContentView(privateView)
        lockUi = NativeLockUi(this, {}, {})
    }
    override fun onResume() { super.onResume(); lockUi.resume() }
    override fun onPause() { lockUi.pause(); super.onPause() }
    override fun onDestroy() { lockUi.close(); super.onDestroy() }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class AppLockHostTest {
    @Before fun startIsolatedProcessFixture() = resetFixture()
    @After fun stopIsolatedProcessFixture() = resetFixture()

    private fun resetFixture() = NativeTestProcess.reset()
    private fun fixtureSession(): GateRuntime {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val runtime = GateRuntime.get(context)
        // Only the credential boundary is isolated here. Real host, runtime gate,
        // JSON, views and lifecycle execute; cryptography has its separate JVM checks.
        context.getSharedPreferences("navrang-live-auth", 0).edit().putString("encrypted", "fixture-envelope").commit()
        for ((name, value) in mapOf(
            "cachedEncrypted" to "fixture-envelope",
            "cachedSession" to JSONObject().put("token", "a".repeat(64)).put("profile", JSONObject().put("role", "admin").put("active", true)).toString(),
        )) GateSession::class.java.getDeclaredField(name).apply { isAccessible = true }.set(runtime.sessions, value)
        assertTrue("Synthetic encrypted fixture is present", runtime.sessions.hasSavedCredential())
        assertNotNull("Synthetic fixture decrypt boundary is isolated", runtime.sessions.read())
        return runtime
    }

    private fun secureProbe(): org.robolectric.android.controller.ActivityController<LockProbeActivity> {
        fixtureSession()
        val context = ApplicationProvider.getApplicationContext<Application>()
        val keyguard = context.getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
        org.robolectric.Shadows.shadowOf(keyguard).apply { setIsDeviceSecure(true); setIsKeyguardSecure(true); setIsDeviceLocked(false) }
        val controller = Robolectric.buildActivity(LockProbeActivity::class.java).create().start()
        NativeAppLock::class.java.getDeclaredField("attempted").apply { isAccessible = true }.setBoolean(null, true)
        return controller.resume()
    }
    private fun currentOperation() = NativeAppLock::class.java.getDeclaredField("operation").apply { isAccessible = true }.getLong(null)
    private fun currentProcess() = NativeAppLock::class.java.getDeclaredField("processId").apply { isAccessible = true }.get(null) as String

    @Test fun explicitDeviceCredentialFallbackCanBeChosenAfterDismissal() {
        val controller = secureProbe()
        NativeAppLock.unlock(controller.get().lockUi, true)
        assertTrue("An explicit device-credential request must begin a protected operation", currentOperation() > 0)
        assertTrue("Launching confirmation alone must never unlock", NativeAppLock.locked())
        controller.pause().stop().destroy()
    }

    @Test @Config(sdk = [24]) fun credentialSuccessBeforeResumeWaitsForVisibleHost() {
        val controller = secureProbe()
        NativeAppLock.unlock(controller.get().lockUi, true)
        val id = currentOperation()
        assertTrue(id > 0)
        controller.pause().stop().restart()
        NativeAppLock.credentialResult(id, currentProcess(), true) // isolated OS result boundary, not a physical PIN test
        assertTrue(NativeAppLock.locked())
        controller.resume()
        assertFalse("A current OS result can complete on the genuine foreground return", NativeAppLock.locked())
        assertEquals(View.VISIBLE, controller.get().privateView.visibility)
        controller.pause().stop().destroy()
    }

    @Test @Config(sdk = [24]) fun oldCredentialResultCannotUnlockReplacementOperation() {
        val controller = secureProbe()
        NativeAppLock.unlock(controller.get().lockUi, true)
        val first = currentOperation()
        NativeAppLock.identityChanged()
        NativeAppLock.unlock(controller.get().lockUi, true)
        val replacement = currentOperation()
        assertTrue(replacement > 0 && replacement != first)
        NativeAppLock.credentialResult(first, currentProcess(), true)
        assertTrue("A prior launch cannot authenticate the replacement", NativeAppLock.locked())
        NativeAppLock.credentialResult(replacement, currentProcess(), true)
        assertFalse(NativeAppLock.locked())
        controller.pause().stop().destroy()
    }

    @Test @Config(sdk = [24]) fun queuedCredentialProofCannotOutliveBackgroundGrace() {
        val controller = secureProbe()
        NativeAppLock.unlock(controller.get().lockUi, true)
        val id = currentOperation()
        controller.pause().stop().restart()
        NativeAppLock.credentialResult(id, currentProcess(), true)
        org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofSeconds(30))
        controller.resume()
        assertTrue("An old background result must require a fresh prompt", NativeAppLock.locked())
        controller.pause().stop().destroy()
    }

    @Test @Config(sdk = [24]) fun priorProcessResultCannotUnlockAnEqualOperationCounter() {
        val controller = secureProbe()
        NativeAppLock.unlock(controller.get().lockUi, true)
        val id = currentOperation()
        assertTrue(id > 0)
        NativeAppLock.credentialResult(id, "synthetic-previous-process", true)
        assertTrue("A restored result must not unlock a fresh process even if its counter repeats", NativeAppLock.locked())
        NativeAppLock.credentialResult(id, currentProcess(), true)
        assertFalse(NativeAppLock.locked())
        controller.pause().stop().destroy()
    }

    @Test fun activityBackgroundGraceUsesTheMonotonicThirtySecondBoundary() {
        val controller = secureProbe()
        val state = NativeAppLock::class.java.getDeclaredField("state").apply { isAccessible = true }.get(null) as AppLockState
        assertTrue(state.authenticated(state.beginPrompt())) // isolated authenticator boundary
        NativeAppLock::class.java.getDeclaredMethod("refresh", Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(NativeAppLock, false)
        controller.pause().stop()
        fun clockTrace() = "now=${android.os.SystemClock.elapsedRealtime()}, started=${NativeAppLock::class.java.getDeclaredField("started").apply { isAccessible = true }.getInt(null)}, background=${AppLockState::class.java.getDeclaredField("backgroundAt").apply { isAccessible = true }.getLong(state)}, foreground=${AppLockState::class.java.getDeclaredField("foreground").apply { isAccessible = true }.getBoolean(state)}, changing=${controller.get().isChangingConfigurations}"
        val trace = mutableListOf("first-stop: ${clockTrace()}")
        org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(29_900))
        // Robolectric restart() already invokes Android performRestart(start=true).
        controller.restart().resume()
        trace += "first-return: ${clockTrace()}"
        assertFalse(NativeAppLock.locked())
        controller.pause().stop()
        trace += "second-stop: ${clockTrace()}"
        org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(30_000))
        trace += "before-return: ${clockTrace()}"
        controller.restart().resume()
        assertTrue(trace.joinToString("; ") + "; second-return: ${clockTrace()}", NativeAppLock.locked())
        controller.pause().stop().destroy()
    }

    @Test fun coldAuthenticatedHostIsCoveredAndPrivateRuntimeIsBlocked() {
        val runtime = fixtureSession()
        val controller = Robolectric.buildActivity(LockProbeActivity::class.java).create().start().resume()
        assertTrue(NativeAppLock.locked())
        assertFalse(runtime.privateAccessAllowed())
        assertNotEquals(View.VISIBLE, controller.get().privateView.visibility)
        controller.pause().stop().destroy()
    }

    @Test fun publicRegistrationDoesNotRequireAnUnrelatedDevicePermission() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        GateRuntime.get(context).sessions.clear()
        val controller = Robolectric.buildActivity(LockProbeActivity::class.java).create().start().resume()
        assertFalse(NativeAppLock.locked())
        assertEquals(View.VISIBLE, controller.get().privateView.visibility)
        controller.pause().stop().destroy()
    }

    @Test fun screenLockKeepsTheHostCoveredWithoutErasingItsSession() {
        val runtime = fixtureSession()
        val controller = Robolectric.buildActivity(LockProbeActivity::class.java).create().start().resume()
        controller.get().sendBroadcast(Intent(Intent.ACTION_SCREEN_OFF))
        assertTrue(NativeAppLock.locked())
        assertNotNull(runtime.sessions.read())
        assertNotEquals(View.VISIBLE, controller.get().privateView.visibility)
        controller.pause().stop().destroy()
    }

    @Test fun lockedOriginalHostCannotReadPrivateDataThroughItsJavascriptBridge() {
        fixtureSession()
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        val bridgeType = Class.forName("in.navrang.gate.ClassicActivity\$Bridge")
        val bridge = bridgeType.declaredConstructors.single().apply { isAccessible = true }.newInstance(controller.get())
        val local = bridgeType.getDeclaredMethod("local", String::class.java, String::class.java).apply { isAccessible = true }
        val session = JSONObject(local.invoke(bridge, "session", "{}") as String)
        assertTrue(session.getJSONObject("data").isNull("profile"))
        val snapshot = JSONObject(local.invoke(bridge, "snapshot", "{}") as String)
        assertFalse(snapshot.optBoolean("ok"))
        assertNotNull(GateRuntime.get(controller.get()).sessions.read())
        controller.pause().stop().destroy()
    }

    @Test fun lockedBackActionCannotNavigateThePrivateWebview() {
        fixtureSession()
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        val activity = controller.get()
        val field = ClassicActivity::class.java.getDeclaredField("web").apply { isAccessible = true }
        val web = (field.get(activity) as? android.webkit.WebView) ?: android.webkit.WebView(activity).also { field.set(activity, it) }
        val shadow = org.robolectric.Shadows.shadowOf(web)
        val before = shadow.lastEvaluatedJavascript
        ClassicActivity::class.java.getDeclaredMethod("classicBack").apply { isAccessible = true }.invoke(activity)
        assertEquals("Back while locked must not execute private route navigation", before, shadow.lastEvaluatedJavascript)
        assertTrue(org.robolectric.Shadows.shadowOf(activity).isTaskMovedToBack)
        controller.pause().stop().destroy()
    }

    @Test fun pickerReturningWhileLockedRetainsTheDocumentUntilUnlock() {
        val runtime = fixtureSession()
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        runtime.requests.shutdownNow()
        val single = java.util.concurrent.Executors.newSingleThreadExecutor()
        GateRuntime::class.java.getDeclaredField("requests").apply { isAccessible = true }.set(runtime, single)
        val activity = controller.get()
        val owner = ClassicActivity::class.java.getDeclaredField("documentSaves").apply { isAccessible = true }.get(activity) as ReportSaveCoordinator
        val pending = ReportSaveCoordinator.Request(ReportSaveCoordinator.Kind.REPORT, "22222222-2222-4222-8222-222222222222", runtime.sessions.generation(), "a".repeat(64), "Zml4dHVyZQ==")
        assertTrue(owner.begin(pending))
        val result = ClassicActivity::class.java.getDeclaredMethod("onActivityResult", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType, Intent::class.java).apply { isAccessible = true }
        result.invoke(activity, owner.requestCode(pending), android.app.Activity.RESULT_OK, Intent().setData(android.net.Uri.parse("content://navrang-fixture/report")))
        single.submit {}.get(2, java.util.concurrent.TimeUnit.SECONDS)
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        assertTrue("The selected report must remain pending while locked", owner.isCurrent(pending))
        assertNull("Duplicate picker callback cannot claim it again", owner.claimPicker(owner.requestCode(pending)))
        runtime.sessions.clear()
        runtime.emit("auth", JSONObject())
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
        assertFalse("Sign-out discards the old deferred report", owner.busy())
        controller.pause().stop().destroy()
    }
}
