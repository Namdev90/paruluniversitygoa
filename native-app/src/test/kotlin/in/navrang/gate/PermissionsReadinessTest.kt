package `in`.navrang.gate

import android.Manifest
import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
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

class ReadinessProbeActivity : ClassicActivity() {
    override fun updatesEnabled() = true
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class PermissionsReadinessTest {
    @Before fun before() = NativeTestProcess.reset()
    @After fun after() = NativeTestProcess.reset()
    private fun bridge(activity: ClassicActivity): Any {
        val type = Class.forName("in.navrang.gate.ClassicActivity\$Bridge")
        return type.declaredConstructors.single().apply { isAccessible = true }.newInstance(activity)
    }
    private fun readiness(activity: ClassicActivity, action: String) {
        val bridge = bridge(activity)
        bridge.javaClass.getDeclaredMethod("readiness", String::class.java).apply { isAccessible = true }.invoke(bridge, action)
    }
    private fun notifications(activity: ClassicActivity) {
        val bridge = bridge(activity)
        bridge.javaClass.getDeclaredMethod("update", String::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }.invoke(bridge, "notifications", false)
    }
    private fun denyOptionalPermissions() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        app.getSharedPreferences("navrang-readiness", 0).edit().clear().commit()
        shadowOf(app).denyPermissions(Manifest.permission.CAMERA, Manifest.permission.POST_NOTIFICATIONS)
    }

    @Test fun startupDoesNotBundleOptionalPermissionRequests() {
        denyOptionalPermissions()
        val controller = Robolectric.buildActivity(ReadinessProbeActivity::class.java).create().start().resume()
        val activity = controller.get()
        readiness(activity, "startup")
        assertNull("Public registration/startup must not launch unrelated permission prompts", shadowOf(activity).lastRequestedPermission)
        assertNull(shadowOf(activity).nextStartedActivity)
        assertEquals(PackageManager.PERMISSION_DENIED, activity.checkSelfPermission(Manifest.permission.CAMERA))
        controller.pause().stop().destroy()
    }

    @Test fun permissionReadinessOpensSettingsWithoutGrantingAnything() {
        denyOptionalPermissions()
        val controller = Robolectric.buildActivity(ReadinessProbeActivity::class.java).create().start().resume()
        val activity = controller.get()
        readiness(activity, "permissions")
        val intent = shadowOf(activity).nextStartedActivity
        assertNotNull(intent)
        assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, intent.action)
        assertEquals("package:${activity.packageName}", intent.data.toString())
        assertNull(shadowOf(activity).lastRequestedPermission)
        assertEquals(PackageManager.PERMISSION_DENIED, activity.checkSelfPermission(Manifest.permission.CAMERA))
        controller.pause().stop().destroy()
    }

    @Test fun notificationSettingsUseSupportedScreenOnEachAndroidVersion() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        if (Build.VERSION.SDK_INT >= 33) shadowOf(app).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val controller = Robolectric.buildActivity(ReadinessProbeActivity::class.java).create().start().resume()
        val activity = controller.get()
        notifications(activity)
        val intent = shadowOf(activity).nextStartedActivity
        assertNotNull(intent)
        assertEquals(if (Build.VERSION.SDK_INT >= 26) Settings.ACTION_APP_NOTIFICATION_SETTINGS else Settings.ACTION_APPLICATION_DETAILS_SETTINGS, intent.action)
        controller.pause().stop().destroy()
    }

    @Test @Config(sdk = [35]) fun explicitNotificationRequestDoesNotAskForCamera() {
        denyOptionalPermissions()
        val controller = Robolectric.buildActivity(ReadinessProbeActivity::class.java).create().start().resume()
        val activity = controller.get()
        notifications(activity)
        val request = shadowOf(activity).lastRequestedPermission
        assertNotNull(request)
        assertArrayEquals(arrayOf(Manifest.permission.POST_NOTIFICATIONS), request.requestedPermissions)
        controller.pause().stop().destroy()
    }
}
