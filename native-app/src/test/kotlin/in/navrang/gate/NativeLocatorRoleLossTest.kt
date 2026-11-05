package `in`.navrang.gate

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowAlertDialog
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class NativeLocatorRoleLossTest {
    @Before fun before() = NativeTestProcess.reset()
    @After fun after() = NativeTestProcess.reset()
    private fun cache(runtime: GateRuntime, active: Boolean) {
        val app = ApplicationProvider.getApplicationContext<Application>()
        app.getSharedPreferences("navrang-live-auth", 0).edit().putString("encrypted", "fixture-envelope").commit()
        val value = JSONObject().put("token", "a".repeat(64)).put("profile", JSONObject().put("role", "checker").put("checkerId", "00000000-0000-4000-8000-000000000001").put("active", active).put("scanner", active).put("name", "Synthetic Volunteer"))
        for ((name, text) in mapOf("cachedEncrypted" to "fixture-envelope", "cachedSession" to value.toString()))
            GateSession::class.java.getDeclaredField(name).apply { isAccessible = true }.set(runtime.sessions, text)
    }
    @Test fun canonicalRoleLossClosesIdentificationEvenWithAStaleEventPayload() {
        val runtime = GateRuntime.get(ApplicationProvider.getApplicationContext())
        cache(runtime, true)
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        val activity = controller.get()
        activity.event(JSONObject().put("type", "profile").put("data", JSONObject()))
        val field = MainActivity::class.java.getDeclaredField("nativeFindMe").apply { isAccessible = true }
        val actions = field.get(activity) as NativeFindMeActions
        actions.resume()
        val id = "00000000-0000-4000-8000-000000000008"
        actions.response(JSONObject().put("requestId", id).put("choice", "bright"),
            JSONObject().put("requestId", id).put("administrator", "Namdev").put("state", "device-acknowledged").put("performAction", true).put("serverTime", "2026-10-25T00:00:00Z").put("expiresAt", "2026-10-25T00:02:00Z"),
            actions.request("locator-respond"), 0, "Synthetic Volunteer") { true }
        val dialog = ShadowAlertDialog.getLatestAlertDialog()
        assertTrue(dialog.isShowing)
        cache(runtime, false)
        activity.event(JSONObject().put("type", "profile").put("data", JSONObject().put("active", true).put("scanner", true)))
        assertFalse("Native UI must follow the canonical vault, never stale event permissions", dialog.isShowing)
        controller.pause().stop().destroy()
    }
}
