package `in`.navrang.gate

import android.view.WindowManager
import androidx.activity.ComponentActivity
import android.app.Application
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class ClassicHostTest {
    @Test fun scannerResumptionPreservesUpdaterBlock() {
        val controller = Robolectric.buildActivity(ClassicScannerActivity::class.java).create()
        val activity = controller.get()
        val vm = GateViewModel(ApplicationProvider.getApplicationContext<Application>(), false)
        val mutable = GateViewModel::class.java.getDeclaredField("mutable").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        val state = mutable.get(vm) as MutableStateFlow<GateState>
        state.value = GateState(ready = true, profile = Profile.from(json("role" to "admin", "name" to "Synthetic Administrator", "active" to true)))
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = vm as T
        }
        ViewModelProvider(activity, factory)[GateViewModel::class.java]
        controller.start().resume()
        assertEquals(Destination.Scanner, vm.state.value.destination)
        assertTrue(GateUpdater.scanActive)
        controller.pause()
        assertFalse(GateUpdater.scanActive)
        controller.resume()
        assertTrue(GateUpdater.scanActive)
        controller.pause().stop().destroy()
    }

    @Test fun restoredHostKeepsPrivateWindowAndInternalUpdateIsolation() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).create()
        val activity = controller.get()
        assertTrue(activity is ClassicActivity)
        assertTrue(activity is ComponentActivity)
        assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        assertEquals(!BuildConfig.DEBUG, GateUpdater.automatic(activity))
        if (BuildConfig.DEBUG) {
            MainActivity::class.java.getDeclaredMethod("browserGoogleLogin").apply {
                isAccessible = true
            }.invoke(activity)
            assertNull(org.robolectric.Shadows.shadowOf(activity).nextStartedActivity)
        }
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
