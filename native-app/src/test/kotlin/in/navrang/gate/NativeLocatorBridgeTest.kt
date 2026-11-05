package `in`.navrang.gate

import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.os.Looper
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
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
class NativeLocatorBridgeTest {
    @Before fun before() {
        NativeTestProcess.reset()
        ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("navrang-live-auth", 0).edit().clear().commit()
    }
    @After fun after() = NativeTestProcess.reset()
    @Test fun installedBridgeDoesNotCollectOrPromptWithoutAnAuthorizedSession() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create().start().resume()
        val activity = controller.get()
        val type = Class.forName("in.navrang.gate.ClassicActivity\$Bridge")
        val bridge = type.declaredConstructors.single().apply { isAccessible = true }.newInstance(activity)
        val method = type.getDeclaredMethod("locator", String::class.java, String::class.java).apply { isAccessible = true }
        val field = ClassicActivity::class.java.getDeclaredField("web").apply { isAccessible = true }
        // Robolectric's synthetic UA can deliberately fail the production
        // WebView86+ gate. Install only a synthetic callback sink, as in the
        // locked-Back fixture; do not relax that gate or emulate a real browser.
        val web = (field.get(activity) as? WebView) ?: WebView(activity).also { field.set(activity, it) }
        method.invoke(bridge, "sample", "{\"operationId\":\"00000000-0000-4000-8000-000000000001\"}")
        val deadline = System.nanoTime() + 2_000_000_000
        while (shadowOf(web).lastEvaluatedJavascript?.contains("onNativeLocatorResult") != true && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(5)
        }
        assertTrue("The installed host must deliver a bounded native refusal", shadowOf(web).lastEvaluatedJavascript?.contains("onNativeLocatorResult") == true)
        assertNull("No unrelated permission prompt may run before server consent", shadowOf(activity).lastRequestedPermission)
        controller.pause().stop().destroy()
    }
    @Test fun installedManifestHasNoBackgroundLocationPermission() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val declared = app.packageManager.getPackageInfo(app.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().toSet()
        assertTrue(declared.contains(Manifest.permission.ACCESS_COARSE_LOCATION))
        assertFalse(declared.contains(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }
}
