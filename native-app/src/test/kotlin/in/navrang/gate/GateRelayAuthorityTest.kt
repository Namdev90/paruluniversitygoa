package `in`.navrang.gate

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
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

/** Offline actor-bound descriptors and muted native admission; no provider, socket or device I/O. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 28])
@LooperMode(LooperMode.Mode.PAUSED)
class GateRelayAuthorityTest {
    private val worker = Executors.newFixedThreadPool(2)
    private val current = AtomicBoolean(true)
    private val calls = CopyOnWriteArrayList<Pair<String, JSONObject>>()
    private val owner = VoiceAuthority.Identity("a".repeat(64), "synthetic-scope", 7)
    private var api: GateRelayAuthority? = null
    private var probes = 0
    private var preparations = 0
    private var cancelled = false
    private var enabledInput = false
    private var autoAdmit = true
    private var failAfterAdmit = false
    private var invalidateOnProbe = false
    private var events: RelayMediaOwner.PreparationEvents? = null
    private val observed = CountDownLatch(1)
    private val released = CountDownLatch(1)
    private val nativeClosed = CountDownLatch(1)
    private fun now() = TIME + SystemClock.elapsedRealtime()
    private val expiry get() = TIME + 12_000
    private val loop = object : WebSocketAudioRelayTransport.Scheduler {
        override fun now() = SystemClock.elapsedRealtime()
        override fun delay(task: Runnable, delayMs: Long): VoiceAuthority.Pending {
            val main = Handler(Looper.getMainLooper())
            main.postDelayed(task, delayMs)
            return VoiceAuthority.Pending { main.removeCallbacks(task) }
        }
    }
    private val media = RelayMediaOwner(object : RelayMediaOwner.Factory {
        override fun configured() = true
        override fun canPublish() = true
        override fun create(room: String, retired: RelayV1Driver.RetiredEpochs): RelayMediaOwner.Slot {
            val clock = RelayClock(loop, 0, 0)
            return object : RelayMediaOwner.Slot {
                override fun room() = room
                override fun clock() = clock
                override fun activateMedia() {}
                override fun receive(credential: RelayNativeCredential, result: VoiceMediaTransport.Result<VoiceMediaTransport.Receiver>): VoiceAuthority.Pending {
                    result.ready(VoiceMediaTransport.Receiver {})
                    return VoiceAuthority.Pending {}
                }
                override fun prepare(admission: RelayMediaOwner.Admission, callback: RelayMediaOwner.PreparationEvents): VoiceAuthority.Pending {
                    preparations++; events = callback; observed.countDown()
                    if (autoAdmit) callback.admitted()
                    if (failAfterAdmit) callback.failed()
                    return VoiceAuthority.Pending { cancelled = true }
                }
                override fun close(released: WebSocketAudioRelayTransport.Completion) { cancelled = true; nativeClosed.countDown(); released.complete(true) }
            }
        }
    }, loop).apply { foreground(true) }
    private val admission = object : GateRelayAuthority.Admission {
        override fun probe(identity: VoiceAuthority.Identity, credential: RelayNativeCredential, result: VoiceAuthority.Result<Boolean>): VoiceAuthority.Pending {
            probes++
            val elapsed = SystemClock.elapsedRealtime()
            result.success(media.observeAuthenticated(credential.room(), now(), elapsed, elapsed))
            if (invalidateOnProbe) current.set(false)
            return VoiceAuthority.Pending { media.discardRoom(credential.room()) }
        }
        override fun prepare(identity: VoiceAuthority.Identity, value: RelayMediaOwner.Admission, result: RelayMediaOwner.PreparedResult): VoiceAuthority.Pending = media.prepare(value, result)
    }
    private fun date(value: Long) = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT)
        .apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(value))
    private fun base() = JSONObject().put("ok", true).put("serverTime", now())
    private fun descriptor(role: String = "speaker") = JSONObject().put("provider", "navrang-relay-v1")
        .put("origin", ORIGIN).put("roomId", ROOM).put("identity", SUBJECT).put("role", role)
        .put("leaseId", LEASE).put("generation", 2).put("expiresAt", date(expiry)).put("token", "synthetic.native.only")
    private fun response(action: String, payload: JSONObject): JSONObject = when (action) {
        "duty-join" -> base().put("dutyId", DUTY).put("sessionId", SESSION)
        "voice-join" -> base().put("state", "idle").put("sessionId", SESSION).put("dutyId", DUTY)
            .put("dutyExpiresAt", date(now() + 60_000)).put("receive", JSONObject.NULL)
        "voice-floor", "voice-renew" -> base().put("state", if (payload.getString("phase") == "prepare") "prepared" else "active")
            .put("operationId", OPERATION).put("sessionId", SESSION).put("dutyId", DUTY).put("leaseId", LEASE)
            .put("generation", 2).put("expiresAt", date(expiry)).also {
                if (payload.getString("phase") == "prepare") it.put("transmit", descriptor())
                else {
                    events?.granted(RelayMediaOwner.Binding(ROOM, SUBJECT, LEASE, 2, GRANT, 3, expiry))
                    it.put("grant", JSONObject().put("grantId", GRANT).put("epoch", 3).put("deadline", expiry))
                }
            }
        else -> base()
    }
    private fun start(enabled: Boolean = true, server: (String, JSONObject) -> JSONObject = ::response): GateRelayAuthority {
        return GateRelayAuthority({ action, payload, identity ->
            assertSame(owner, identity); calls.add(action to JSONObject(payload.toString()))
            if (action == "voice-release") released.countDown()
            server(action, payload)
        }, { current.get() }, admission, ORIGIN, "relay-fixture-installation", enabled, worker).also { api = it }
    }
    private class Reply<T> : VoiceAuthority.Result<T> {
        private val complete = CountDownLatch(1)
        var value: T? = null
        var failures = 0
        override fun success(value: T) { this.value = value; complete.countDown() }
        override fun failure() { failures++; complete.countDown() }
        fun await(): Reply<T> { assertTrue("Relay authority fixture timed out", complete.await(4, TimeUnit.SECONDS)); return this }
    }
    @After fun stop() { api?.close(); media.close(); worker.shutdownNow(); worker.awaitTermination(2, TimeUnit.SECONDS) }

    @Test fun disabledMakesNoAuthorityOrAdmissionRequest() {
        val value = Reply<VoiceAuthority.Floor>(); start(false).floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertTrue(calls.isEmpty()); assertEquals(0, probes)
    }
    @Test fun idleJoinHasNoFabricatedCredentialOrRoomProbe() {
        val value = Reply<VoiceAuthority.Join>(); start().join(owner, "channel", value)
        assertNull(value.await().value!!.receive); assertEquals(0, probes); assertEquals(0, preparations)
    }
    @Test fun floorPreparesMutedSocketBeforeSameRequestCommitAndReturnsOnlyTicket() {
        val value = Reply<VoiceAuthority.Floor>(); start().floor(owner, SESSION, value)
        val floor = requireNotNull(value.await().value)
        assertEquals(1, probes); assertEquals(1, preparations); assertFalse(enabledInput)
        assertFalse(floor.transmit is RelayNativeCredential)
        assertEquals("RelayPreparedHandle[redacted]", floor.transmit.toString())
        val phases = calls.filter { it.first == "voice-floor" }.map { it.second }
        assertEquals(listOf("prepare", "commit"), phases.map { it.getString("phase") })
        assertEquals(phases[0].getString("requestId"), phases[1].getString("requestId"))
        assertEquals(OPERATION, phases[1].getString("operationId")); assertEquals(2, phases[1].getInt("generation"))
        assertEquals(expiry, floor.expiresAtMs); floor.transmit.destroy()
    }
    @Test fun foreignOriginOrWrongRoleDescriptorNeverAdmits() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also { if (action == "voice-floor") it.getJSONObject("transmit").put("origin", "https://foreign.invalid") } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertEquals(0, probes); assertEquals(0, preparations)
        assertTrue(released.await(2, TimeUnit.SECONDS))
    }
    @Test fun listenerRoleCannotBeUsedToAcquirePublisherFloor() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-floor") it.getJSONObject("transmit").put("role", "listener")
        } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertEquals(0, probes); assertEquals(0, preparations)
    }
    @Test fun unexpectedDescriptorFieldFailsBeforeNativeAdmission() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-floor") it.getJSONObject("transmit").put("roomUrl", "https://foreign.invalid")
        } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertEquals(0, probes); assertEquals(0, preparations)
    }
    @Test fun changedCommitExpiryNeverReturnsTicketAndCancelsPreparedMedia() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-floor" && payload.getString("phase") == "commit") it.put("expiresAt", date(expiry + 1000))
        } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertTrue(cancelled); assertFalse(enabledInput)
        assertTrue(released.await(2, TimeUnit.SECONDS))
    }
    @Test fun mismatchedObservedGrantCannotBecomeFloorEvenAfterBackendActiveReply() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-floor" && payload.getString("phase") == "commit") it.getJSONObject("grant").put("epoch", 4)
        } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertTrue(cancelled); assertFalse(enabledInput)
    }
    @Test fun identityLostDuringPrepareResponseRevokesWithoutOpeningMedia() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also { if (action == "voice-floor") current.set(false) } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertEquals(0, preparations); assertEquals(0, probes)
        assertTrue(released.await(2, TimeUnit.SECONDS))
    }
    @Test fun cancellingWhileNativeAdmissionIsPendingPreventsCommitAndReleasesLease() {
        autoAdmit = false
        val value = Reply<VoiceAuthority.Floor>(); val pending = start().floor(owner, SESSION, value)
        assertTrue(observed.await(2, TimeUnit.SECONDS)); pending.cancel()
        assertTrue(released.await(2, TimeUnit.SECONDS)); assertTrue(nativeClosed.await(2, TimeUnit.SECONDS)); assertTrue(cancelled); assertNull(value.value)
        assertEquals(listOf("prepare"), calls.filter { it.first == "voice-floor" }.map { it.second.getString("phase") })
    }
    @Test fun listeningDescriptorProbesExactRoomBeforeReturningUnusedNativeCredential() {
        val value = Reply<VoiceAuthority.Join>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-join") it.put("state", "listening").put("leaseId", LEASE).put("generation", 2).put("receive", descriptor("listener"))
        } }.join(owner, "channel", value)
        val joined = requireNotNull(value.await().value)
        assertEquals(1, probes); assertEquals(0, preparations)
        val credential = joined.receive as RelayNativeCredential
        assertEquals(ROOM, credential.room()); assertTrue(credential.claimUpgrade()); credential.destroy()
    }
    @Test fun renewalKeepsOriginalRetryAndOldLeaseAcrossBothPhases() {
        val value = Reply<VoiceAuthority.Floor>(); val authority = start()
        authority.renew(owner, SESSION, DUTY, 1, value)
        val floor = requireNotNull(value.await().value)
        assertTrue(authority.rotatesTransportOnRenew())
        val phases = calls.filter { it.first == "voice-renew" }.map { it.second }
        assertEquals(2, phases.size)
        assertTrue(phases.all { !it.has("requestId") && it.getString("leaseId") == DUTY })
        assertEquals(setOf("sessionId", "leaseId", "phase"), phases[0].keys().asSequence().toSet())
        assertEquals(setOf("sessionId", "leaseId", "phase", "operationId", "generation"), phases[1].keys().asSequence().toSet())
        assertEquals(LEASE, floor.leaseId); assertEquals(2L, floor.generation); floor.transmit.destroy()
    }
    @Test fun refreshKeepsOriginalMembershipBaseInsteadOfDiscoveredRoom() {
        var joins = 0
        val authority = start { action, payload -> response(action, payload).also {
            if (action == "voice-join" && joins++ == 0) it.put("state", "listening").put("sessionId", OPERATION)
                .put("leaseId", LEASE).put("generation", 2).put("receive", descriptor("listener"))
        } }
        val first = Reply<VoiceAuthority.Join>(); authority.join(owner, "channel", first)
        val joined = requireNotNull(first.await().value)
        val refreshed = Reply<VoiceAuthority.Join>(); authority.refresh(owner, joined, refreshed)
        assertEquals(SESSION, refreshed.await().value!!.sessionId)
        assertEquals(SESSION, calls.last { it.first == "voice-join" }.second.getString("sessionId"))
        assertEquals(1, calls.count { it.first == "duty-heartbeat" }); joined.receive.destroy()
    }
    @Test fun identityLostDuringProbeCancelsBeforeMutedSocketPreparation() {
        invalidateOnProbe = true
        val value = Reply<VoiceAuthority.Floor>(); start().floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertEquals(1, probes); assertEquals(0, preparations)
        assertTrue(released.await(2, TimeUnit.SECONDS))
    }
    @Test fun configuredOriginRejectsIpLiteralsPathsAndQueries() {
        for (origin in listOf("https://127.0.0.1", "https://[::ffff:127.0.0.1]", "$ORIGIN/", "$ORIGIN?extra=1")) {
            assertThrows(IllegalArgumentException::class.java) {
                GateRelayAuthority({ _, _, _ -> base() }, { true }, admission, origin, "relay-fixture-installation", true, worker)
            }
        }
        assertTrue(calls.isEmpty())
    }
    @Test fun hungNativeAdmissionTimesOutOnceAndCannotCommitLater() {
        autoAdmit = false
        val value = Reply<VoiceAuthority.Floor>(); start().floor(owner, SESSION, value)
        assertTrue(observed.await(2, TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idleFor(6_100, TimeUnit.MILLISECONDS)
        assertEquals(1, value.await().failures)
        assertTrue(released.await(2, TimeUnit.SECONDS)); assertTrue(nativeClosed.await(2, TimeUnit.SECONDS))
        events!!.admitted()
        assertNull(value.value)
        assertEquals(listOf("prepare"), calls.filter { it.first == "voice-floor" }.map { it.second.getString("phase") })
    }
    @Test fun lateRemoteCommitAfterCancellationGetsAnotherRevocation() {
        val entered = CountDownLatch(1)
        val allowReply = CountDownLatch(1)
        val cleanups = CountDownLatch(2)
        val value = Reply<VoiceAuthority.Floor>()
        val authority = start { action, payload ->
            if (action == "voice-release") cleanups.countDown()
            if (action == "voice-floor" && payload.getString("phase") == "commit") {
                entered.countDown()
                while (allowReply.count > 0) try { allowReply.await() } catch (_: InterruptedException) {}
            }
            response(action, payload)
        }
        val pending = authority.floor(owner, SESSION, value)
        assertTrue(entered.await(2, TimeUnit.SECONDS))
        pending.cancel()
        assertTrue(released.await(2, TimeUnit.SECONDS))
        allowReply.countDown()
        assertTrue("Late committed reply must be revoked after initial cancellation cleanup", cleanups.await(2, TimeUnit.SECONDS))
        assertNull(value.value); assertFalse(enabledInput)
    }
    @Test fun commitCannotReplaceCredentialOrAddAmbiguousGrantFields() {
        val value = Reply<VoiceAuthority.Floor>()
        start { action, payload -> response(action, payload).also {
            if (action == "voice-floor" && payload.getString("phase") == "commit") it.getJSONObject("grant").put("subject", DUTY)
        } }.floor(owner, SESSION, value)
        assertEquals(1, value.await().failures); assertTrue(cancelled); assertNull(value.value)
    }
    @Test fun nativeInvalidationAfterAdmittedPreventsBackendCommit() {
        failAfterAdmit = true
        val value = Reply<VoiceAuthority.Floor>(); start().floor(owner, SESSION, value)
        assertEquals(1, value.await().failures)
        assertTrue(cancelled); assertNull(value.value)
        assertEquals(listOf("prepare"), calls.filter { it.first == "voice-floor" }.map { it.second.getString("phase") })
        assertTrue(released.await(2, TimeUnit.SECONDS))
    }
    companion object {
        private const val TIME = 1_800_000_000_000L
        private const val ORIGIN = "https://fixture.workers.dev"
        private const val SESSION = "11111111-1111-4111-8111-111111111111"
        private const val DUTY = "22222222-2222-4222-8222-222222222222"
        private const val LEASE = "33333333-3333-4333-8333-333333333333"
        private const val OPERATION = "44444444-4444-4444-8444-444444444444"
        private const val SUBJECT = "55555555-5555-4555-8555-555555555555"
        private const val GRANT = "66666666-6666-4666-8666-666666666666"
        private const val ROOM = "nr_33333333333343338333333333333333"
    }
}
