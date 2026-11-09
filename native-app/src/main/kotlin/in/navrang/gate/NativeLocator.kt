package `in`.navrang.gate

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Foreground one-shot only. No background location, watch, persistent fix or log. */
internal class NativeLocator(
    private val activity: FragmentActivity,
    private val reply: (JSONObject) -> Unit,
    private val authorize: suspend (String?) -> Authorization = { prepare(activity, it) },
    private val source: Source = PlatformSource,
) {
    data class Authorization(val untilElapsed: Long, val isCurrent: () -> Boolean)
    interface Source {
        fun request(activity: FragmentActivity, receive: (Location?) -> Unit): () -> Unit
    }
    private class Operation(val id: String, val requestId: String?) {
        val deadlineElapsed = SystemClock.elapsedRealtime() + 25_000
        var authorization: Authorization? = null
        var job: Job? = null
        var waitingPermission = false
        var waitingResume = false
        var launcher: ActivityResultLauncher<Array<String>>? = null
        var cancelSource: (() -> Unit)? = null
        var timeout: Runnable? = null
    }
    private val handler = Handler(Looper.getMainLooper())
    private var operation: Operation? = null
    private var resumed = false
    private var closed = false

    fun resume() {
        resumed = true
        val active = operation
        if (NativeAppLock.locked()) identityChanging()
        else if (active?.waitingResume == true) { active.waitingResume = false; prepare(active) }
    }
    fun pause() {
        resumed = false
        // A contextual system permission flow may return before onResume. It
        // never starts location while covered; its native timeout still applies.
        if (operation?.waitingPermission != true) operation?.let { finish(it, "Location sharing cancelled while Navrang was covered.") }
    }
    fun identityChanging() { operation?.let { finish(it, "Sign-in or access changed. Location sharing cancelled.") } }
    fun retainRequests(ids: Set<String>) { operation?.takeIf { it.requestId != null && it.requestId !in ids }?.let { finish(it, "Find-me request ended. No location was shared.") } }
    fun close() { closed = true; resumed = false; identityChanging() }

    fun command(action: String, payload: String?) {
        if (closed || payload == null || payload.length > 512) return
        val body = runCatching { JSONObject(payload) }.getOrNull() ?: return
        val id = body.optString("operationId")
        if (!uuid.matches(id)) return
        if (action == "cancel") { operation?.takeIf { it.id == id }?.let { finish(it, "Location sharing cancelled.") }; return }
        if (action != "sample" || body.keys().asSequence().any { it !in setOf("operationId", "requestId") }) { error(id, "Invalid location request."); return }
        val requestId = body.optString("requestId").takeIf { it.isNotEmpty() }
        if (requestId != null && !uuid.matches(requestId)) { error(id, "Invalid find-me request."); return }
        if (!resumed || NativeAppLock.locked()) { error(id, "Open and unlock Navrang before sharing once."); return }
        if (operation != null) { if (operation?.id != id) error(id, "A location request is already running."); return }
        val next = Operation(id, requestId); operation = next
        next.timeout = Runnable { finish(next, "Location request expired. No sample was shared.") }.also { handler.postDelayed(it, 25_000) }
        prepare(next)
    }
    private fun valid(active: Operation): Boolean = !closed && operation === active && resumed && !NativeAppLock.locked() &&
        active.authorization?.let { SystemClock.elapsedRealtime() < it.untilElapsed && it.isCurrent() } == true
    private fun prepare(active: Operation) {
        active.job = activity.lifecycleScope.launch {
            try {
                val proof = authorize(active.requestId)
                if (operation !== active) return@launch
                active.authorization = proof
                if (!valid(active)) { finish(active, "Duty, consent or access changed. No location was shared."); return@launch }
                active.timeout?.let(handler::removeCallbacks)
                active.timeout = Runnable { finish(active, "Duty or find-me authorization expired. No sample was shared.") }.also {
                    handler.postDelayed(it, (minOf(active.deadlineElapsed, proof.untilElapsed) - SystemClock.elapsedRealtime()).coerceAtLeast(1))
                }
                if (hasPermission()) collect(active) else askPermission(active)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { finish(active, "Current duty and location consent could not be verified. No sample was shared.") }
        }
    }
    private fun hasPermission() = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    private fun askPermission(active: Operation) {
        if (!valid(active)) { finish(active, "Location sharing cancelled."); return }
        active.waitingPermission = true
        // Registry keys cannot collide with a permission result restored from
        // another process. No granted result or pending operation is persisted.
        val launcher = activity.activityResultRegistry.register("locator-permission-${NativeAppLock.processId}-${active.id}", ActivityResultContracts.RequestMultiplePermissions()) {
            active.launcher?.unregister(); active.launcher = null
            if (operation !== active) return@register
            active.waitingPermission = false
            if (!hasPermission()) { finish(active, "Location permission was declined. Existing station work remains available."); return@register }
            if (resumed && !NativeAppLock.locked()) prepare(active) else active.waitingResume = true
        }
        if (operation !== active) { launcher.unregister(); return }
        active.launcher = launcher
        launcher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    private fun collect(active: Operation) {
        if (!valid(active) || !hasPermission()) { finish(active, "Location sharing stopped or permission changed."); return }
        try {
            val cancel = source.request(activity) { location ->
                if (operation !== active) return@request
                if (!valid(active) || !hasPermission()) { finish(active, "Access changed. No location was shared."); return@request }
                val age = location?.let { SystemClock.elapsedRealtime() - it.elapsedRealtimeNanos / 1_000_000 }
                if (location == null || age == null || age !in 0L..30_000L || !location.hasAccuracy() ||
                    !location.latitude.isFinite() || location.latitude !in -90.0..90.0 || !location.longitude.isFinite() || location.longitude !in -180.0..180.0 ||
                    !location.accuracy.isFinite() || location.accuracy !in 0f..5000f || location.time <= 0) {
                    finish(active, "No fresh location with usable accuracy was available. No sample was shared."); return@request
                }
                val stamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(location.time))
                val fix = JSONObject().put("latitude", location.latitude).put("longitude", location.longitude).put("accuracy", location.accuracy.toDouble()).put("capturedAt", stamp)
                finish(active, null, fix)
            }
            if (operation === active) active.cancelSource = cancel else cancel()
        } catch (_: Exception) { finish(active, "Location is unavailable. Check Android location settings or continue station work.") }
    }
    private fun error(id: String, message: String) { reply(JSONObject().put("operationId", id).put("ok", false).put("error", message)) }
    private fun finish(active: Operation, message: String?, fix: JSONObject? = null) {
        if (operation !== active) return
        operation = null
        active.timeout?.let(handler::removeCallbacks); active.timeout = null
        active.launcher?.unregister(); active.launcher = null
        active.cancelSource?.invoke(); active.cancelSource = null
        active.job?.cancel(); active.job = null; active.authorization = null
        if (message != null) error(active.id, message)
        else reply(JSONObject().put("operationId", active.id).put("ok", true).put("fix", fix))
    }

    private object PlatformSource : Source {
        @SuppressLint("MissingPermission") // Both foreground grants checked immediately before entry and callback.
        @Suppress("DEPRECATION")
        override fun request(activity: FragmentActivity, receive: (Location?) -> Unit): () -> Unit {
            val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val providers = manager.getProviders(true)
            val fine = ContextCompat.checkSelfPermission(activity, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            val provider = listOfNotNull("fused", if (fine) LocationManager.GPS_PROVIDER else null, LocationManager.NETWORK_PROVIDER).firstOrNull { it in providers }
                ?: error("No enabled foreground location provider")
            if (Build.VERSION.SDK_INT >= 30) {
                val cancellation = CancellationSignal()
                manager.getCurrentLocation(provider, cancellation, ContextCompat.getMainExecutor(activity), receive)
                return { cancellation.cancel() }
            }
            val listener = object : LocationListener {
                override fun onLocationChanged(location: Location) = receive(location)
                override fun onProviderDisabled(provider: String) = receive(null)
                override fun onProviderEnabled(provider: String) {}
                @Deprecated("Legacy Android callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
            }
            manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            return { manager.removeUpdates(listener) }
        }
    }
    companion object {
        internal fun scope(profile: JSONObject?): String = if (profile == null) "" else org.json.JSONArray(listOf(profile.optString("role"),profile.optString("checkerId"),profile.optBoolean("active"),profile.optBoolean("scanner"),profile.optBoolean("helpdesk"),profile.optString("station"),profile.optBoolean("nameConfirmed",true))).toString()
        private val uuid = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOption.IGNORE_CASE)
        private val iso = Regex("^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2})(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:\\d{2})$")
        internal fun serverEpoch(value: String): Long {
            val parts = iso.matchEntire(value) ?: error("Invalid server timestamp")
            val normalized = parts.groupValues[1] + "." + parts.groupValues[2].padEnd(3, '0').take(3) + parts.groupValues[3]
            val position = ParsePosition(0)
            val date = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply { isLenient = false }.parse(normalized, position)
            require(date != null && position.index == normalized.length)
            return date.time
        }
        private suspend fun prepare(activity: FragmentActivity, requestId: String?): Authorization = withContext(Dispatchers.IO) {
            val runtime = GateRuntime.get(activity)
            require(runtime.privateAccessAllowed())
            val generation = runtime.sessions.generation()
            val session = runtime.sessions.read() ?: error("Sign in again")
            val token = session.getString("token"); val family = session.optString("refreshFamilyId")
            val roleScope = scope(session.optJSONObject("profile"))
            fun current() = runtime.privateAccessAllowed() && runtime.sessions.sameIdentity(generation, token, family) && roleScope == scope(runtime.sessions.read()?.optJSONObject("profile"))
            fun call(action: String): JSONObject {
                require(current())
                val auth = runtime.sessions.read() ?: error("Sign in again")
                val result = runtime.api.call(action, JSONObject().put("eventId", "O9KL3"), auth.getString("token"))
                require(result.status == 200 && result.body.optBoolean("ok") && current())
                return result.body
            }
            val started = SystemClock.elapsedRealtime(); val status = call("locator-status")
            require(status.optBoolean("onDuty") && status.optBoolean("location") && status.optInt("disclosureVersion") == 1)
            var until = started + (serverEpoch(status.getString("expiresAt")) - serverEpoch(status.getString("serverTime"))).coerceIn(0, 3_600_000)
            if (requestId != null) {
                val requestStarted = SystemClock.elapsedRealtime(); val items = call("locator-inbox").getJSONArray("items")
                val request = (0 until items.length()).map { items.getJSONObject(it) }.firstOrNull { it.optString("requestId") == requestId } ?: error("Request expired")
                until = minOf(until, requestStarted + (serverEpoch(request.getString("expiresAt")) - serverEpoch(request.getString("serverTime"))).coerceIn(0, 120_000))
            }
            // Subtracting the entire round trip is conservative: neither local
            // wall-clock changes nor a slow HTTP response extend server expiry.
            require(until > SystemClock.elapsedRealtime() && current())
            Authorization(minOf(until, started + 25_000), ::current)
        }
    }
}
