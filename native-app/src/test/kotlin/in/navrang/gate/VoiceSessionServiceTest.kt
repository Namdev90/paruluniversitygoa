package `in`.navrang.gate

import android.content.Intent
import android.app.Service
import android.app.Activity
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class VoiceSessionServiceTest {
    @Test fun coldStartOffersJoinOnlyInEnabledBuildsWithoutStartingAudio() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        val client = VoiceSessionClient(activity)
        try {
            client.resume()
            val status = JSONObject(client.command("status", "{}"))
            assertEquals(BuildConfig.VOICE_ENABLED, status.getBoolean("available"))
            assertEquals(if (BuildConfig.VOICE_ENABLED) "idle" else "unavailable", status.getString("state"))
            assertFalse(status.getBoolean("ready"))
            assertFalse(status.getBoolean("microphone"))
            assertNull(shadowOf(activity).nextStartedService)
        } finally {
            client.close()
            controller.destroy()
        }
    }

    @Test fun disabledBuildNeverStartsAudioForegroundWorkOrRestoresAnIntent() {
        assertFalse(BuildConfig.VOICE_ENABLED)
        val controller = Robolectric.buildService(VoiceSessionService::class.java).create()
        val service = controller.get()
        try {
            assertEquals(Service.START_NOT_STICKY, service.onStartCommand(
                Intent(service, VoiceSessionService::class.java).setAction(VoiceSessionService.START)
                    .putExtra(VoiceSessionService.USER_STARTED, true), 0, 1))
            assertNull(shadowOf(service).lastForegroundNotification)
            assertFalse(service.backgroundReceptionAllowed())
            assertFalse(service.prepareTransmitting())
            assertFalse(service.requestMicrophonePermission())
        } finally { controller.destroy() }
    }

    @Test fun nullRestartAndStopActionDoNotResurrectPreviousVoiceSession() {
        val controller = Robolectric.buildService(VoiceSessionService::class.java).create()
        val service = controller.get()
        try {
            assertEquals(Service.START_NOT_STICKY, service.onStartCommand(null, 0, 1))
            assertEquals(Service.START_NOT_STICKY, service.onStartCommand(
                Intent(service, VoiceSessionService::class.java).setAction(VoiceSessionService.STOP), 0, 2))
            service.onTaskRemoved(Intent())
            assertFalse(service.backgroundReceptionAllowed())
            assertNull(shadowOf(service).lastForegroundNotification)
        } finally { controller.destroy() }
    }
}
