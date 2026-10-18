package `in`.navrang.gate

import android.view.WindowManager
import androidx.activity.ComponentActivity
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class ClassicHostTest {
    @Test fun restoredHostKeepsPrivateWindowAndInternalUpdateIsolation() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        val activity = controller.get()
        assertTrue(activity is ClassicActivity)
        assertTrue(activity is ComponentActivity)
        assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        assertFalse(GateUpdater.automatic(activity))
        controller.destroy()
    }

    @Test fun installedAssetsContainOriginalShellAndEveryOperationalExtension() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        val activity = controller.get()
        val page = activity.assets.open("index.html").bufferedReader().use { it.readText() }
        assertTrue(page.contains("art/classic-restore.css"))
        assertTrue(page.contains("classic-signout-pending"))
        for (name in listOf("reports.js", "report-export.js", "workbook.js", "desk.js")) {
            assertTrue(activity.assets.open(name).use { it.read() >= 0 })
        }
        assertTrue(activity.resources.getDrawable(R.drawable.app_icon, activity.theme) != null)
        controller.destroy()
    }
}
