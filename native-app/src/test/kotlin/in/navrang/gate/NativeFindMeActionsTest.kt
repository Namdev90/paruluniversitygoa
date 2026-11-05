package `in`.navrang.gate

import androidx.fragment.app.FragmentActivity
import java.time.Duration
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class NativeFindMeActionsTest {
    private val request = "00000000-0000-4000-8000-000000000008"
    private class Effects : NativeFindMeActions.Effects {
        var sounds = 0; var brights = 0; var closed = 0
        var administrator = ""; var volunteer = ""; var duration = 0L
        override fun sound(): () -> Unit { sounds++; return { closed++ } }
        override fun bright(administrator: String, volunteer: String, durationMillis: Long): () -> Unit {
            brights++; this.administrator = administrator; this.volunteer = volunteer; duration = durationMillis
            return { closed++ }
        }
    }
    private fun fixture(): Pair<NativeFindMeActions, Effects> {
        val activity = Robolectric.buildActivity(FragmentActivity::class.java).create().start().resume().get()
        val effects = Effects()
        return NativeFindMeActions(activity, effects).also { it.resume() } to effects
    }
    private fun payload(choice: String) = JSONObject().put("requestId", request).put("choice", choice)
    private fun body(perform: Boolean = true) = JSONObject().put("requestId", request).put("administrator", "Namdev")
        .put("state", "device-acknowledged").put("performAction", perform)
        .put("serverTime", "2026-10-25T00:00:00.000Z").put("expiresAt", "2026-10-25T00:02:00.000Z")
    @Test fun serverAcknowledgementAloneNeverPlaysSound() {
        val (actions, effects) = fixture()
        actions.response(payload("sound"), body(false), actions.request("locator-respond"), 0, "Volunteer") { true }
        assertEquals(0, effects.sounds); actions.close()
    }
    @Test fun currentExplicitSoundActionIsOnceOnly() {
        val (actions, effects) = fixture(); val fence = actions.request("locator-respond")
        repeat(2) { actions.response(payload("sound"), body(), fence, 0, "Volunteer") { true } }
        assertEquals(1, effects.sounds); assertEquals(0, effects.brights); actions.close(); assertEquals(1, effects.closed)
    }
    @Test fun backgroundReturnRejectsAPreviousResponse() {
        val (actions, effects) = fixture(); val fence = actions.request("locator-respond")
        actions.pause(); actions.resume()
        actions.response(payload("bright"), body(), fence, 0, "Volunteer") { true }
        assertEquals(0, effects.brights); actions.close()
    }
    @Test fun accessLossRejectsAnOtherwiseValidResponse() {
        val (actions, effects) = fixture()
        actions.response(payload("bright"), body(), actions.request("locator-respond"), 0, "Volunteer") { false }
        assertEquals(0, effects.brights); actions.close()
    }
    @Test fun stopImmediatelyClosesEffectsAndFencesLateResponses() {
        val (actions, effects) = fixture(); val fence = actions.request("locator-respond")
        actions.response(payload("bright"), body(), fence, 0, "Volunteer") { true }
        actions.request("locator-stop")
        assertEquals(1, effects.closed)
        actions.response(payload("sound"), body(), fence, 0, "Volunteer") { true }
        assertEquals(0, effects.sounds); actions.close()
    }
    @Test fun identificationIsNamedAndTimeBoundWithoutAFullscreenLaunch() {
        val (actions, effects) = fixture()
        actions.response(payload("bright"), body(), actions.request("locator-respond"), 0, "Synthetic Volunteer") { true }
        assertEquals("Namdev", effects.administrator); assertEquals("Synthetic Volunteer", effects.volunteer)
        assertEquals(30_000, effects.duration)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(30_001))
        assertEquals(1, effects.closed); actions.close()
    }
    @Test fun networkDelayCannotExtendServerExpiry() {
        val (actions, effects) = fixture()
        val expired = body().put("expiresAt", "2026-10-25T00:00:00.500Z")
        actions.response(payload("sound"), expired, actions.request("locator-respond"), 501, "Volunteer") { true }
        assertEquals(0, effects.sounds); actions.close()
    }
    @Test fun closingIdentificationClearsPrivateTextAndRestoresBrightness() {
        val activity = Robolectric.buildActivity(FragmentActivity::class.java).create().start().resume().get()
        val original = activity.window.attributes.screenBrightness
        val actions = NativeFindMeActions(activity).also { it.resume() }
        actions.response(payload("bright"), body(), actions.request("locator-respond"), 0, "Synthetic Volunteer") { true }
        val dialog = ShadowAlertDialog.getLatestAlertDialog()
        fun labels(view: View): List<TextView> = (if (view is TextView) listOf(view) else emptyList()) +
            (if (view is ViewGroup) (0 until view.childCount).flatMap { labels(view.getChildAt(it)) } else emptyList())
        val label = labels(dialog.window!!.decorView).first { it.text.contains("Synthetic Volunteer") }
        assertTrue(dialog.isShowing)
        actions.pause()
        assertFalse(dialog.isShowing)
        assertEquals("Private identity must be removed on background/lock/sign-out", "", label.text.toString())
        assertEquals(original, activity.window.attributes.screenBrightness)
        actions.close()
    }
}
