package `in`.navrang.gate

import android.app.Activity
import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class ReadinessPolicyTest {
    @Test fun resumingReadinessPreservesTheUserVolume() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val audio = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.setStreamVolume(AudioManager.STREAM_MUSIC, 1, 0)
        val readiness = GateReadiness(activity)
        readiness.resume()
        assertEquals(1, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
        readiness.pause()
        controller.pause().stop().destroy()
    }

    @Test fun disabledSystemAnimationIsExposedToTheReleasedWebInterface() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        Settings.Global.putFloat(activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 0f)
        assertTrue(GateReadiness.status(activity).optBoolean("reducedMotion"))
        Settings.Global.putFloat(activity.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        assertFalse(GateReadiness.status(activity).optBoolean("reducedMotion"))
        controller.pause().stop().destroy()
    }
}
