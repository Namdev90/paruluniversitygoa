package `in`.navrang.gate

import android.Manifest
import android.app.Application
import android.location.Location
import android.os.Looper
import android.os.SystemClock
import java.time.Duration
import androidx.fragment.app.FragmentActivity
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class NativeLocatorTest {
    @Before fun before() = NativeTestProcess.reset()
    @After fun after() = NativeTestProcess.reset()
    private val operation = "00000000-0000-4000-8000-000000000007"
    private lateinit var host: FragmentActivity
    private fun payload() = JSONObject().put("operationId", operation).toString()
    private class Source : NativeLocator.Source {
        var requests = 0
        var cancellations = 0
        var callback: ((Location?) -> Unit)? = null
        override fun request(activity: FragmentActivity, receive: (Location?) -> Unit): () -> Unit {
            requests++; callback = receive
            return { cancellations++ }
        }
    }
    private fun fix(ageMs: Long = 0) = Location("synthetic").apply {
        latitude = 15.49; longitude = 73.82; accuracy = 35f
        time = System.currentTimeMillis() - ageMs
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos() - ageMs * 1_000_000
    }
    private fun fixture(granted: Boolean = true, durationMillis: Long = 20_000, allowed: () -> Boolean = { true }): Triple<NativeLocator, Source, MutableList<JSONObject>> {
        val app = ApplicationProvider.getApplicationContext<Application>()
        app.getSharedPreferences("navrang-live-auth", 0).edit().clear().commit()
        shadowOf(app).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (granted) shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        val controller = Robolectric.buildActivity(FragmentActivity::class.java).create().start().resume()
        host = controller.get()
        NativeAppLock.install(controller.get())
        val source = Source(); val replies = mutableListOf<JSONObject>()
        val locator = NativeLocator(controller.get(), { replies.add(it) }, {
            NativeLocator.Authorization(SystemClock.elapsedRealtime() + durationMillis, allowed)
        }, source)
        locator.resume()
        return Triple(locator, source, replies)
    }
    @Test fun constructionDoesNotAskForPermissionOrLocation() {
        val (locator, source, replies) = fixture(false)
        assertEquals(0, source.requests); assertTrue(replies.isEmpty()); locator.close()
    }
    @Test fun explicitShareRequestsOnlyForegroundLocationPermissions() {
        val (locator, source, replies) = fixture(false)
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, source.requests); assertTrue(replies.isEmpty())
        assertEquals(setOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), shadowOf(host).lastRequestedPermission!!.requestedPermissions.toSet())
        locator.close()
    }
    @Test fun authorityExpiryStopsTheLocationSourceWithoutWaitingForACallback() {
        val (locator, source, replies) = fixture(durationMillis = 100)
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, source.requests)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(101))
        assertEquals("The OS source must stop at authority expiry, even if no fix arrives", 1, source.cancellations)
        assertFalse(replies.any { it.has("fix") }); locator.close()
    }
    @Test fun coarsePermissionCanReturnOneFreshSample() {
        val (locator, source, replies) = fixture()
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, source.requests); source.callback!!(fix())
        assertEquals(1, replies.size); assertTrue(replies.single().getBoolean("ok"))
        assertEquals(35.0, replies.single().getJSONObject("fix").getDouble("accuracy"), 0.0)
        source.callback!!(fix()); assertEquals(1, replies.size); assertEquals(1, source.cancellations)
        locator.close()
    }
    @Test fun cancelDropsALateLocationCallback() {
        val (locator, source, replies) = fixture()
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        locator.command("cancel", payload()); source.callback!!(fix())
        assertEquals(1, source.cancellations); assertFalse(replies.any { it.has("fix") }); locator.close()
    }
    @Test fun backgroundingCancelsTheOneShotAndDoesNotCollectOnReturn() {
        val (locator, source, replies) = fixture()
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle(); locator.pause()
        source.callback!!(fix()); locator.resume()
        assertEquals(1, source.requests); assertFalse(replies.any { it.has("fix") }); locator.close()
    }
    @Test fun changedAuthorityRejectsAPreviouslyPreparedSample() {
        var allowed = true; val (locator, source, replies) = fixture(allowed = { allowed })
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle(); allowed = false
        source.callback!!(fix()); assertFalse(replies.any { it.has("fix") }); locator.close()
    }
    @Test fun staleLocationIsNotTreatedAsCurrent() {
        val (locator, source, replies) = fixture()
        locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        source.callback!!(fix(31_000)); assertFalse(replies.any { it.has("fix") }); locator.close()
    }
    @Test fun malformedOrBackgroundCommandsDoNotStartLocation() {
        val (locator, source, replies) = fixture()
        locator.command("sample", JSONObject().put("operationId", operation).put("principal", "admin").toString())
        locator.pause(); locator.command("sample", payload()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals(0, source.requests); assertFalse(replies.any { it.has("fix") }); locator.close()
    }
}
