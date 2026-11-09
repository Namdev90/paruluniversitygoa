package `in`.navrang.gate

import android.os.Looper
import android.os.SystemClock
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** In-memory existing-API fixtures; no SDK, sockets, microphone, or provider. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
@LooperMode(LooperMode.Mode.PAUSED)
class GateVoiceAuthorityTest {
    private val worker = Executors.newSingleThreadExecutor()
    private var authority: GateVoiceAuthority? = null
    private val current = AtomicBoolean(true)
    private val calls = CopyOnWriteArrayList<Pair<String, JSONObject>>()
    private val owner = VoiceAuthority.Identity("a".repeat(64), "synthetic-scope", 1)
    private fun now() = TIME + SystemClock.elapsedRealtime()
    private fun date(value: Long): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(value))
    private fun base() = JSONObject().put("ok", true).put("serverTime", now())
    private fun descriptor(lease: String = LEASE, generation: Long = 1) = JSONObject()
        .put("provider", "daily").put("roomId", "nv_" + "b".repeat(32))
        .put("roomUrl", "https://fixture.daily.co/nv_" + "b".repeat(32))
        .put("identity", IDENTITY).put("leaseId", lease).put("generation", generation)
        .put("expiresAt", date(now() + 15_000)).put("token", "synthetic.native.only")
    private fun response(action: String): JSONObject = when (action) {
        "duty-join" -> base().put("dutyId", DUTY).put("sessionId", CHANNEL).put("expiresAt", date(now() + 60_000))
        "voice-join" -> base().put("state", "idle").put("dutyId", DUTY).put("sessionId", CHANNEL)
            .put("dutyExpiresAt", date(now() + 60_000)).put("receive", JSONObject.NULL)
        "voice-floor", "voice-renew" -> base().put("state", "active").put("sessionId", CHANNEL)
            .put("leaseId", LEASE).put("generation", 1).put("expiresAt", date(now() + 15_000)).put("transmit", descriptor())
        else -> base()
    }
    private fun start(enabled: Boolean = true, server: (String, JSONObject) -> JSONObject = { action, _ -> response(action) }): GateVoiceAuthority {
        return GateVoiceAuthority({ action, payload, identity ->
            assertSame(owner, identity)
            calls.add(action to JSONObject(payload.toString()))
            server(action, payload)
        }, { current.get() }, "fixture.daily.co", "voice-fixture-installation", enabled, worker).also { authority = it }
    }
    private class Reply<T> : VoiceAuthority.Result<T> {
        val completed = CountDownLatch(1)
        var value: T? = null
        var failures = 0
        override fun success(value: T) { this.value = value; completed.countDown() }
        override fun failure() { failures++; completed.countDown() }
        fun await(): Reply<T> { assertTrue("Native fixture did not settle", completed.await(3, TimeUnit.SECONDS)); return this }
    }
    @After fun stop() { authority?.close(); worker.shutdownNow(); worker.awaitTermination(2, TimeUnit.SECONDS) }

    @Test fun disabledOrChangedIdentityMakesNoServerRequest() {
        val api = start(false)
        val reply = Reply<VoiceAuthority.Join>()
        api.join(owner, "channel", reply)
        assertEquals(1, reply.await().failures)
        assertTrue(calls.isEmpty())
        assertFalse(api.configured())
    }
    @Test fun unknownSessionUrlFailsBeforeDutyCreation() {
        val api = start()
        val reply = Reply<VoiceAuthority.Join>()
        api.join(owner, "https://foreign.invalid/room", reply)
        assertEquals(1, reply.await().failures)
        assertTrue(calls.isEmpty())
    }
    @Test fun idleJoinRetainsOpaqueMembershipWithoutFabricatingAudio() {
        val api = start()
        val reply = Reply<VoiceAuthority.Join>()
        api.join(owner, "channel", reply)
        val joined = requireNotNull(reply.await().value)
        assertEquals(CHANNEL, joined.sessionId)
        assertNull(joined.receive)
        assertEquals(listOf("duty-join", "voice-join"), calls.map { it.first })
        assertEquals(CHANNEL, calls.last().second.getString("sessionId"))
    }
    @Test fun broadcastDiscoveryRefreshesTheBaseChannelInsteadOfGettingStuckInBroadcast() {
        var reads = 0
        val api = start { action, _ ->
            val value = response(action)
            if (action == "voice-join" && reads++ == 0) value.put("state", "listening").put("sessionId", BROADCAST).put("receive", descriptor())
            value
        }
        val first = Reply<VoiceAuthority.Join>()
        api.join(owner, "channel", first)
        val joined = requireNotNull(first.await().value)
        assertEquals(BROADCAST, joined.sessionId)
        assertNotNull(joined.receive)
        assertEquals("DailyNativeCredential[redacted]", joined.receive.toString())
        val refreshed = Reply<VoiceAuthority.Join>()
        api.refresh(owner, joined, refreshed)
        assertEquals(CHANNEL, refreshed.await().value?.sessionId)
        assertEquals(CHANNEL, calls.last { it.first == "voice-join" }.second.getString("sessionId"))
        assertEquals(1, calls.count { it.first == "duty-heartbeat" })
        joined.receive.destroy()
    }
    @Test fun floorAndRenewUseOnlyExistingPublicPayloadAndExactCommittedBindings() {
        val api = start()
        val floor = Reply<VoiceAuthority.Floor>()
        api.floor(owner, CHANNEL, floor)
        assertEquals(LEASE, floor.await().value?.leaseId)
        assertTrue(PushPolicy.id(calls.first().second.getString("requestId")))
        val renewed = Reply<VoiceAuthority.Floor>()
        api.renew(owner, CHANNEL, LEASE, 1, renewed)
        assertNotNull(renewed.await().value)
        assertEquals(setOf("sessionId", "leaseId"), calls.last().second.keys().asSequence().toSet())
        floor.value!!.transmit.destroy(); renewed.value!!.transmit.destroy()
    }
    @Test fun mismatchedFloorLeaseNeverReachesTheCaller() {
        val api = start { action, _ -> response(action).put("leaseId", BROADCAST) }
        val reply = Reply<VoiceAuthority.Floor>()
        api.floor(owner, CHANNEL, reply)
        assertEquals(1, reply.await().failures)
        assertNull(reply.value)
    }
    @Test fun wrongHostAndStringTimingAreRejectedBeforeMediaCanJoin() {
        for (wrongHost in listOf(false, true)) {
            val api = start { action, _ ->
                val value = response(action)
                if (wrongHost) value.getJSONObject("transmit").put("roomUrl", "https://other.daily.co/nv_" + "b".repeat(32))
                else value.put("serverTime", now().toString())
                value
            }
            val reply = Reply<VoiceAuthority.Floor>()
            api.floor(owner, CHANNEL, reply)
            assertEquals(1, reply.await().failures)
        }
    }
    @Test fun identityChangeDuringServerWorkDiscardsLateCredential() {
        val api = start { action, _ -> response(action).also { current.set(false) } }
        val reply = Reply<VoiceAuthority.Floor>()
        api.floor(owner, CHANNEL, reply)
        assertEquals(1, reply.await().failures)
        assertNull(reply.value)
    }
    @Test fun parserHandlesPostgresMicrosecondsAndOffsetsConservativelyOnApi24() {
        val expected = 1_800_000_000_123L
        val iso = date(expected)
        assertEquals(expected, GateVoiceAuthority.millis(iso))
        assertEquals(expected, GateVoiceAuthority.millis(iso.replace("123Z", "123999+00:00")))
        assertEquals(GateVoiceAuthority.millis("2026-10-25T06:00:00Z"), GateVoiceAuthority.millis("2026-10-25T11:30:00+05:30"))
        for (bad in listOf("2026-02-30T00:00:00Z", "2026-10-25T06:00:00+14:01", "2026-10-25T06:00:00Zsecret")) {
            assertThrows(IllegalArgumentException::class.java) { GateVoiceAuthority.millis(bad) }
        }
    }
    @Test fun hungReplyIsBoundedAndLateSuccessCannotRestoreARejectedRequest() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val api = start { action, _ ->
            val value = response(action)
            entered.countDown()
            while (release.count > 0) try { release.await() } catch (_: InterruptedException) { }
            value
        }
        val reply = Reply<VoiceAuthority.Floor>()
        api.floor(owner, CHANNEL, reply)
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idleFor(6_100, TimeUnit.MILLISECONDS)
        assertEquals(1, reply.await().failures)
        release.countDown()
        assertNull(reply.value)
    }
    companion object {
        private const val TIME = 1_800_000_000_000L
        private const val CHANNEL = "11111111-1111-4111-8111-111111111111"
        private const val BROADCAST = "22222222-2222-4222-8222-222222222222"
        private const val DUTY = "33333333-3333-4333-8333-333333333333"
        private const val LEASE = "44444444-4444-4444-8444-444444444444"
        private const val IDENTITY = "55555555-5555-4555-8555-555555555555"
    }
}
