package `in`.navrang.gate

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.ExecutorService

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class NativeReconciliationTest {
    @Before fun before() = NativeTestProcess.reset()
    @After fun after() = NativeTestProcess.reset()
    private fun runtime(): GateRuntime {
        val runtime = GateRuntime.get(ApplicationProvider.getApplicationContext())
        (GateRuntime::class.java.getDeclaredField("sync").apply { isAccessible = true }.get(runtime) as ExecutorService).shutdownNow()
        return runtime
    }
    private fun identity(runtime: GateRuntime, role: String, active: Boolean) {
        val app = ApplicationProvider.getApplicationContext<Application>()
        app.getSharedPreferences("navrang-live-auth", 0).edit().putString("encrypted", "projection-fixture").commit()
        val session = JSONObject().put("token", "a".repeat(64)).put("profile", JSONObject().put("role", role).put("checkerId", "synthetic-staff").put("active", active).put("scanner", active).put("name", "Synthetic Volunteer"))
        for ((key, value) in mapOf("cachedEncrypted" to "projection-fixture", "cachedSession" to session.toString()))
            GateSession::class.java.getDeclaredField(key).apply { isAccessible = true }.set(runtime.sessions, value)
    }
    @Test fun everyRecordAndEntryIsReachableThroughBoundedRamDeltas() {
        val runtime = runtime()
        val records = JSONArray(); val entries = JSONArray()
        for (number in 1..501) {
            val id = "A%07d".format(number)
            records.put(JSONObject().put("id", id).put("name", "Synthetic $number"))
            entries.put(JSONObject().put("ticketId", id).put("seq", number).put("checkerId", "synthetic-staff").put("checker", "Synthetic Volunteer").put("at", "2026-10-25T00:00:00Z").put("deviceId", "fixture"))
        }
        runtime.db.applySync(JSONObject().put("dataRevision", 4).put("cursor", 501).put("records", records).put("entries", entries).put("stats", JSONObject().put("total", 501)))
        val first = runtime.db.adminSnapshot(-1, 0)
        assertEquals(501, first.getJSONArray("records").length())
        assertEquals(500, first.getJSONArray("entries").length()); assertTrue(first.getBoolean("hasMore"))
        val second = runtime.db.adminSnapshot(4, first.getLong("cursor"))
        assertFalse("Unchanged master must not be serialized repeatedly", second.has("records"))
        assertEquals(1, second.getJSONArray("entries").length()); assertFalse(second.getBoolean("hasMore"))
        assertEquals(501L, second.getLong("cursor"))
        assertEquals("A0000501", second.getJSONArray("entries").getJSONObject(0).getString("ticketId"))
    }
    @Test fun installedLocalProjectionRequiresCurrentUnlockedAdministrator() {
        val runtime = runtime()
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        val activity = controller.get()
        val type = Class.forName("in.navrang.gate.ClassicActivity\$Bridge")
        val bridge = type.declaredConstructors.single().apply { isAccessible = true }.newInstance(activity)
        val local = type.getDeclaredMethod("local", String::class.java, String::class.java).apply { isAccessible = true }
        fun view() = JSONObject(local.invoke(bridge, "admin-snapshot", "{\"dataRevision\":-1,\"afterSeq\":0}") as String)
        runtime.setPrivateAccess { true }; identity(runtime, "admin", true)
        val allowed = view(); assertTrue(allowed.getBoolean("ok"))
        assertEquals(runtime.sessions.generation(), allowed.getJSONObject("data").getLong("ownerGeneration"))
        identity(runtime, "checker", true); assertFalse(view().getBoolean("ok"))
        identity(runtime, "admin", false); assertFalse(view().getBoolean("ok"))
        identity(runtime, "admin", true); runtime.setPrivateAccess { false }; assertFalse(view().getBoolean("ok"))
        controller.destroy()
    }
}
