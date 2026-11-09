package `in`.navrang.gate

import android.app.AlertDialog
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import org.json.JSONObject

/** Explicit foreground actions only, after the authenticated server grants this response. */
internal class NativeFindMeActions(
    private val activity: FragmentActivity,
    private val effects: Effects = AndroidEffects(activity),
) {
    interface Effects {
        fun sound(): () -> Unit
        fun bright(administrator: String, volunteer: String, durationMillis: Long): () -> Unit
    }
    private val fence = AtomicLong()
    private val handler = Handler(Looper.getMainLooper())
    private val performed = mutableMapOf<String, Long>()
    private val active = mutableMapOf<() -> Unit,String>()
    private var resumed = false
    private var closed = false
    fun request(action: String): Long = if (action == "locator-stop" || action == "locator-consent") invalidate() else fence.get()
    private fun invalidate(): Long {
        val next = fence.incrementAndGet()
        activity.runOnUiThread { if (next == fence.get()) clearEffects() }
        return next
    }
    fun resume() { resumed = true }
    fun pause() { resumed = false; invalidate() }
    fun identityChanging() { invalidate(); performed.clear() }
    fun close() { closed = true; resumed = false; identityChanging(); handler.removeCallbacksAndMessages(null) }
    private fun clearEffects() { for (cancel in active.keys.toList()) cancel(); active.clear() }
    fun retainRequests(ids: Set<String>) { for ((cancel,id) in active.toMap()) if (id !in ids) cancel() }
    fun response(payload: JSONObject, body: JSONObject, requestFence: Long, roundTripMillis: Long, volunteer: String, current: () -> Boolean) {
        if (closed || !resumed || requestFence != fence.get() || !current() || activity.isFinishing || activity.isDestroyed ||
            body.opt("performAction") != true || body.optString("state") != "device-acknowledged") return
        val id = body.optString("requestId")
        val choice = payload.optString("choice")
        if (!id.matches(Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)) ||
            id != payload.optString("requestId") || choice !in setOf("sound", "bright") || roundTripMillis < 0) return
        val remaining = runCatching {
            NativeLocator.serverEpoch(body.getString("expiresAt")) - NativeLocator.serverEpoch(body.getString("serverTime")) - roundTripMillis - 1
        }.getOrDefault(0).coerceAtMost(120_000)
        if (remaining <= 0) return
        val now = SystemClock.elapsedRealtime()
        performed.entries.removeAll { it.value <= now }
        val key = "$id:$choice"
        if (performed.containsKey(key)) return
        val administrator = body.optString("administrator")
        if (administrator.isBlank() || administrator.length > 80 || volunteer.length > 128) return
        performed[key] = now + remaining
        try {
            val duration = minOf(remaining, if (choice == "bright") 30_000 else 750)
            val cancel = if (choice == "sound") effects.sound() else effects.bright(administrator, volunteer, duration)
            val finished = AtomicBoolean()
            lateinit var stop: () -> Unit
            stop = { if (finished.compareAndSet(false, true)) { active.remove(stop); runCatching(cancel) } }
            active[stop]=id; handler.postDelayed({ stop() }, duration)
        } catch (_: Exception) { /* No fallback that bypasses Android sound or window policy. */ }
    }

    private class AndroidEffects(private val activity: FragmentActivity) : Effects {
        private val handler = Handler(Looper.getMainLooper())
        @Suppress("DEPRECATION")
        override fun sound(): () -> Unit {
            val notifications = activity.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            val audio = activity.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
            // Conservatively respect quiet/DND modes; never change volume,
            // interruption filters, notification-policy access or audio routing.
            if (notifications?.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL || audio == null || audio.ringerMode == AudioManager.RINGER_MODE_SILENT) return {}
            val tone = if (audio.ringerMode == AudioManager.RINGER_MODE_NORMAL) ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60).also { it.startTone(ToneGenerator.TONE_PROP_BEEP, 500) } else null
            val vibrator = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            if (vibrator?.hasVibrator() == true) {
                if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE), attributes)
                else vibrator.vibrate(200L, attributes)
            }
            val released = AtomicBoolean()
            var expiry: Runnable? = null
            val finish = { if (released.compareAndSet(false, true)) { expiry?.let(handler::removeCallbacks); expiry = null; runCatching { tone?.stopTone(); tone?.release() }; runCatching { vibrator?.cancel() }; Unit } }
            expiry = Runnable { finish() }; handler.postDelayed(expiry!!, 600)
            return { finish(); Unit }
        }
        override fun bright(administrator: String, volunteer: String, durationMillis: Long): () -> Unit {
            val text = TextView(activity).apply {
                text = "$administrator is trying to find ${volunteer.ifBlank { "you" }}"
                textSize = 32f; setTextColor(Color.rgb(38, 9, 25)); setBackgroundColor(Color.rgb(245, 215, 149))
                val padding = (24 * resources.displayMetrics.density).toInt(); setPadding(padding, padding, padding, padding)
            }
            // An ordinary in-app dialog: no full-screen intent, screen wake,
            // lock-screen display flag, global brightness or system setting.
            val dialog = AlertDialog.Builder(activity).setView(text).setPositiveButton("Close identification", null).create()
            dialog.show()
            val window = dialog.window
            val original = window?.attributes?.screenBrightness ?: -1f
            window?.let { it.attributes = it.attributes.apply { screenBrightness = 1f } }
            val released = AtomicBoolean()
            var expiry: Runnable? = null
            val finish = {
                if (released.compareAndSet(false, true)) {
                    expiry?.let(handler::removeCallbacks); expiry = null
                    text.text = ""
                    runCatching { window?.let { it.attributes = it.attributes.apply { screenBrightness = original } } }
                    runCatching { if (dialog.isShowing) dialog.dismiss() }
                }
                Unit
            }
            dialog.setOnDismissListener { finish() }
            expiry = Runnable { finish() }; handler.postDelayed(expiry!!, durationMillis)
            return finish
        }
    }
}
