package `in`.navrang.gate

import android.Manifest
import android.app.Activity
import android.media.AudioManager
import android.os.Looper
import android.os.SystemClock
import java.io.InputStream
import java.io.OutputStream
import java.security.Key
import java.security.KeyStoreSpi
import java.security.Provider
import java.security.Security
import java.security.cert.Certificate
import java.util.Collections
import java.util.Date
import java.util.Enumeration
import java.util.concurrent.ExecutorService
import java.util.concurrent.TimeUnit
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/** Synthetic authority/media only: no SDK, microphone, sockets, or production identities. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
@LooperMode(LooperMode.Mode.PAUSED)
class VoiceCoordinatorTest {
    private lateinit var activityController: ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var runtime: GateRuntime
    private lateinit var authority: FakeAuthority
    private lateinit var media: FakeMedia
    private var coordinator: VoiceCoordinator? = null
    private var originalKeystore: Provider? = null
    private val events = mutableListOf<String>()

    @Before fun setUp() {
        // Exercise the real GateSession.save/read path. Robolectric has no Android
        // keystore implementation, so this fixture supplies one fixed, test-only key.
        originalKeystore = Security.getProvider("AndroidKeyStore")
        Security.removeProvider("AndroidKeyStore")
        Security.addProvider(object : Provider("AndroidKeyStore", 1.0, "Synthetic test session key") {
            init { put("KeyStore.AndroidKeyStore", SyntheticKeyStore::class.java.name) }
        })
        activityController = Robolectric.buildActivity(Activity::class.java).create().start().resume()
        activity = activityController.get()
        shadowOf(activity).denyPermissions(Manifest.permission.RECORD_AUDIO)
        shadowOf(activity.getSystemService(AudioManager::class.java))
            .setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        runtime = GateRuntime.get(activity)
        val generation = runtime.sessions.beginChange()
        assertTrue(runtime.sessions.saveIfCurrent(generation, "synthetic-voice-session", JSONObject()
            .put("role", "admin").put("active", true).put("scanner", true)
            .put("name", "Synthetic Administrator")))
        authority = FakeAuthority(events)
        media = FakeMedia(events)
        // Plain Activity never calls runtime.resume(): the real sync worker stays
        // dormant. Every voice authority and media operation below is injected.
    }

    @After fun tearDown() {
        coordinator?.close()
        shadowOf(Looper.getMainLooper()).idle()
        if (::runtime.isInitialized) {
            runtime.sessions.clear()
            for (name in listOf("sync", "entries", "requests")) {
                val field = GateRuntime::class.java.getDeclaredField(name).apply { isAccessible = true }
                (field.get(runtime) as ExecutorService).shutdownNow()
            }
            runtime.db.close()
            GateRuntime::class.java.getDeclaredField("instance").apply { isAccessible = true }.set(null, null)
        }
        if (::activityController.isInitialized) activityController.pause().stop().destroy()
        Security.removeProvider("AndroidKeyStore")
        originalKeystore?.let { Security.addProvider(it) }
    }

    private fun start(enabled: Boolean = true, host: VoiceHost? = null): VoiceCoordinator =
        (if (host == null) VoiceCoordinator(activity, runtime, authority, media, enabled)
        else VoiceCoordinator(activity, runtime, authority, media, enabled, host)).also {
            coordinator = it
            it.resume()
        }

    private fun command(action: String) {
        requireNotNull(coordinator).command(action, "{}")
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun status() = JSONObject(requireNotNull(coordinator).command("status", "{}"))
    private fun advance(milliseconds: Long) = shadowOf(Looper.getMainLooper()).idleFor(milliseconds, TimeUnit.MILLISECONDS)
    private fun serverNow() = SERVER_TIME + SystemClock.elapsedRealtime()
    private fun allowMicrophone() = shadowOf(activity).grantPermissions(Manifest.permission.RECORD_AUDIO)

    private fun join(): VoiceAuthority.Join {
        command("join")
        val now = serverNow()
        val joined = VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, FakeCredential(now + 60_000))
        authority.joins.last().result.success(joined)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(status().getBoolean("ready"))
        return joined
    }

    private fun floor(lease: String = LEASE_A, generation: Long = 1, duration: Long = 15_000,
                      credentialDuration: Long = duration): VoiceAuthority.Floor {
        val now = serverNow()
        return VoiceAuthority.Floor(SESSION, lease, generation, now, now + duration,
            FakeCredential(now + credentialDuration))
    }

    private fun talk(lease: String = LEASE_A, generation: Long = 1, duration: Long = 15_000): VoiceAuthority.Floor {
        command("press")
        val granted = floor(lease, generation, duration)
        authority.floors.last().result.success(granted)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(media.publishers.last().enabled)
        assertTrue(status().getBoolean("microphone"))
        return granted
    }

    @Test fun disabledBuildCannotJoinRequestPermissionOrTouchMedia() {
        assertFalse("Production voice gate must stay disabled", BuildConfig.VOICE_ENABLED)
        start(false)
        command("join"); command("press")
        assertFalse(status().getBoolean("available"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(authority.joins.isEmpty())
        assertTrue(authority.floors.isEmpty())
        assertTrue(media.receivers.isEmpty())
        assertTrue(media.publishers.isEmpty())
        assertNull(shadowOf(activity).lastRequestedPermission)
        assertNull(shadowOf(activity.getSystemService(AudioManager::class.java)).lastAudioFocusRequest)
    }

    @Test fun configuredTransportCanObtainAuthenticatedTimeBeforeMediaAdmission() {
        media.operational = false
        start()
        assertTrue(status().getBoolean("available"))
        command("join")
        assertEquals(1, authority.joins.size)
        assertTrue(media.receivers.isEmpty())
    }

    @Test fun missingEncoderKeepsListenerButCannotAcquirePublisherFloor() {
        media.publishable = false
        allowMicrophone(); start(); join()
        assertFalse(status().getBoolean("canTalk"))
        command("press")
        assertTrue(authority.floors.isEmpty())
        assertTrue(media.publishers.isEmpty())
        assertTrue(status().getBoolean("ready"))
    }

    @Test fun nativeLifecycleReceivesForegroundAndSynchronousIdentityFence() {
        start()
        assertTrue(events.contains("media:foreground:true"))
        events.clear()
        val bridge = Thread { coordinator!!.identityChanging() }
        bridge.start(); bridge.join(1000)
        assertTrue("Transport fence must run before queued main-thread cleanup", events.contains("media:identity"))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(events.contains("media:stop"))
        events.clear()
        coordinator!!.pause()
        assertTrue(events.contains("media:foreground:false"))
    }

    @Test fun sameBindingDiscoveryKeepsTheCredentialOwnedByTheActiveReceiver() {
        authority.refreshable = true
        start(); command("join")
        val now = serverNow()
        val active = BindingCredential(now + 60_000)
        authority.joins.last().result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, active))
        shadowOf(Looper.getMainLooper()).idle()
        val receiver = media.receivers.single()
        repeat(2) {
            advance(5_100)
            val refreshed = BindingCredential(active.expiresAtMs())
            val stamp = serverNow()
            authority.refreshes.last().result.success(VoiceAuthority.Join(SESSION, DUTY, stamp, stamp + 60_000, refreshed))
            shadowOf(Looper.getMainLooper()).idle()
            assertFalse("Live native credential must not be revoked by discovery refresh", active.destroyed)
            assertTrue("Unused replacement secret must be discarded", refreshed.destroyed)
            assertFalse(receiver.closed)
            assertEquals(1, media.receivers.size)
        }
    }

    private fun renewable(token: String, family: String, expiry: String): JSONObject = JSONObject()
        .put("token", token).put("refreshToken", "b".repeat(64)).put("refreshFamilyId", family)
        .put("refreshExpiresAt", "2099-01-08T00:00:00Z").put("absoluteExpiresAt", "2099-01-30T00:00:00Z")
        .put("profile", JSONObject().put("role", "admin").put("active", true).put("scanner", true)
            .put("name", "Synthetic Administrator").put("expiresAt", expiry))

    @Test fun normalAccessRenewalPreservesVoiceButActualGrantLossStopsIt() {
        val family = "00000000-0000-4000-8000-000000000101"
        val generation = runtime.sessions.generation()
        val initial = renewable("a".repeat(64), family, "2099-01-01T00:15:00Z")
        assertTrue(runtime.sessions.saveBundleIfCurrent(generation, initial))
        val originalOwner = VoiceAuthority.Identity(initial.getString("token"), VoiceCoordinator.scope(initial.getJSONObject("profile")), generation, family)
        allowMicrophone(); start(); join(); talk()
        val receiver = media.receivers.last()
        val publisher = media.publishers.last()
        val pending = requireNotNull(runtime.sessions.prepareRenewal(generation, initial.getString("token")))
        val renewed = renewable("c".repeat(64), family, "2099-01-01T00:30:00Z")
        assertTrue(runtime.sessions.completeRenewalIfCurrent(generation, initial.getString("token"), pending.getString("requestId"), renewed))
        assertEquals(renewed.getString("token"), GateVoiceAuthority.currentToken(runtime, originalOwner))
        runtime.emit("profile", renewed.getJSONObject("profile"))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("Routine access rotation must preserve the existing floor", status().getBoolean("microphone"))
        assertFalse(receiver.closed)
        assertFalse(publisher.closed)
        val lost = JSONObject(renewed.getJSONObject("profile").toString()).put("scanner", false)
        assertTrue(runtime.sessions.refreshIfCurrent(generation, renewed.getString("token"), runtime.sessions.beginProfileRequest(), lost))
        runtime.emit("profile", lost)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(status().getBoolean("microphone"))
        assertTrue(receiver.closed)
        assertTrue(publisher.closed)
    }

    @Test fun aDifferentRefreshFamilyCannotReuseVoiceEvenWithTheSameGrants() {
        val generation = runtime.sessions.generation()
        assertTrue(runtime.sessions.saveBundleIfCurrent(generation, renewable("a".repeat(64),
            "00000000-0000-4000-8000-000000000101", "2099-01-01T00:15:00Z")))
        allowMicrophone(); start(); join(); talk()
        val changed = renewable("c".repeat(64), "00000000-0000-4000-8000-000000000102", "2099-01-01T00:15:00Z")
        assertTrue(runtime.sessions.saveBundleIfCurrent(generation, changed))
        runtime.emit("profile", changed.getJSONObject("profile"))
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(status().getBoolean("ready"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(media.receivers.last().closed)
        assertTrue(media.publishers.last().closed)
    }

    private class ServiceHost : VoiceHost {
        var ongoing = false
        var allowTransmit = true
        override fun prepareReceiving(): Boolean { ongoing = true; return true }
        override fun prepareTransmitting() = allowTransmit && ongoing
        override fun backgroundReceptionAllowed() = ongoing
        override fun requestMicrophonePermission() = false
        override fun transmissionStopped() {}
        override fun statusChanged(status: JSONObject) {}
        override fun stopped() { ongoing = false }
    }

    @Test fun foregroundServiceRetainsOnlyListenerWhenActivityPauses() {
        val host = ServiceHost()
        allowMicrophone(); start(host = host); join(); talk()
        val receiver = media.receivers.last()
        val publisher = media.publishers.last()
        coordinator!!.pause()
        assertTrue(status().getBoolean("ready"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(publisher.closed)
        assertFalse(receiver.closed)
        command("press")
        assertEquals(1, authority.floors.size)
        coordinator!!.resume()
        assertFalse(status().getBoolean("microphone"))
        assertEquals(1, authority.joins.size)
        host.ongoing = false
        coordinator!!.pause()
        assertTrue(receiver.closed)
        assertFalse(status().getBoolean("ready"))
    }

    @Test fun foregroundServiceGestureCancellationRetainsListenerWithoutResumingTalk() {
        val host = ServiceHost()
        allowMicrophone(); start(host = host); join(); talk()
        coordinator!!.windowFocusLost()
        assertTrue(status().getBoolean("ready"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(media.publishers.last().closed)
        command("cancel")
        assertFalse(media.receivers.last().closed)
        host.allowTransmit = false
        command("press")
        assertEquals(1, authority.floors.size)
    }

    @Test fun rotatedRenewalClosesPreviousPublisherBeforeReplacementCanCapture() {
        allowMicrophone(); start(); join(); talk()
        val old = media.publishers.last()
        advance(5_100)
        events.clear()
        authority.renewals.last().result.success(floor(LEASE_B, 2))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(old.closed)
        assertTrue(media.publishers.last().enabled)
        assertTrue(events.indexOf("close:1") < events.indexOf("mic:2:true"))
        assertFalse(authority.released.contains(LEASE_B))
    }

    @Test fun idleChannelJoinAllowsFirstSpeakerWithoutInventingReceiveAudio() {
        allowMicrophone(); start(); command("join")
        val now = serverNow()
        authority.joins.last().result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, null))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(status().getBoolean("ready"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(media.receivers.isEmpty())
        talk()
        assertTrue(status().getBoolean("microphone"))
    }

    @Test fun freshDiscoveryCanMoveAnIdleListenerToBroadcastAndBackWithoutCapturing() {
        authority.refreshable = true
        start(); command("join")
        var now = serverNow()
        authority.joins.last().result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, null))
        shadowOf(Looper.getMainLooper()).idle()
        advance(5_100)
        now = serverNow()
        authority.refreshes.last().result.success(VoiceAuthority.Join(LEASE_B, DUTY, now, now + 60_000, FakeCredential(now + 15_000)))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, media.receivers.size)
        assertTrue(status().getBoolean("ready"))
        assertTrue(media.publishers.isEmpty())
        val broadcast = media.receivers.last()
        advance(5_100)
        now = serverNow()
        authority.refreshes.last().result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, null))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(broadcast.closed)
        assertTrue(status().getBoolean("ready"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(authority.left.isEmpty())
    }

    @Test fun refreshFailureAndLateDiscoveryCannotResumeAStoppedSession() {
        authority.refreshable = true
        start(); join(); advance(5_100)
        val pending = authority.refreshes.last()
        pending.result.failure()
        shadowOf(Looper.getMainLooper()).idle()
        val now = serverNow()
        val credential = FakeCredential(now + 15_000)
        pending.result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, credential))
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(status().getBoolean("ready"))
        assertTrue(credential.destroyed)
        assertEquals(1, media.receivers.size)
        assertEquals(1, authority.joins.size)
    }

    @Test fun refreshNeverReleasesAStillMatchingHeldServerFloor() {
        authority.refreshable = true
        allowMicrophone(); start(); join(); talk()
        advance(5_100)
        val now = serverNow()
        authority.refreshes.last().result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, null, true, LEASE_A, 1))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(status().getBoolean("microphone"))
        assertTrue(authority.released.isEmpty())
        assertTrue(media.receivers.last().closed)
    }

    @Test fun explicitJoinListensWithoutMicrophonePermissionOrImplicitCapture() {
        start()
        assertTrue(authority.joins.isEmpty())
        join()
        assertEquals("listening", status().getString("state"))
        assertFalse(status().getBoolean("microphone"))
        assertTrue(media.publishers.isEmpty())
        assertNull(shadowOf(activity).lastRequestedPermission)
        command("press")
        val request = shadowOf(activity).lastRequestedPermission
        assertNotNull(request)
        assertEquals(VoiceCoordinator.MICROPHONE_PERMISSION, request.requestCode)
        assertArrayEquals(arrayOf(Manifest.permission.RECORD_AUDIO), request.requestedPermissions)
        assertTrue(authority.floors.isEmpty())
        allowMicrophone()
        coordinator!!.permissionResult()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue("Permission grant alone must not request a floor", authority.floors.isEmpty())
        assertFalse(status().getBoolean("microphone"))
    }

    @Test fun releaseBeforeLateGrantCompensatesWithoutPreparingMicrophone() {
        allowMicrophone(); start(); join()
        command("press")
        val pending = authority.floors.single()
        command("release")
        val late = floor()
        pending.result.success(late)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(media.publishers.isEmpty())
        assertFalse(status().getBoolean("microphone"))
        assertEquals(listOf(LEASE_A), authority.released)
        assertTrue((late.transmit as FakeCredential).destroyed)
    }

    @Test fun mainThreadIdentityChangeMutesBeforeReturningOrServerCleanup() {
        allowMicrophone(); start(); join(); talk()
        val publisher = media.publishers.last()
        events.clear()
        assertSame(Looper.getMainLooper(), Looper.myLooper())
        coordinator!!.identityChanging()
        // Intentionally do not idle the main looper: the hook must already mute.
        assertFalse(publisher.enabled)
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("microphone"))
        assertTrue(events.indexOf("mic:1:false") in 0 until events.indexOf("release:$LEASE_A"))
    }

    @Test fun expiredLocalLeaseMutesAndClosesBeforeReleaseRequest() {
        allowMicrophone(); start(); join(); talk(duration = 2_000)
        val publisher = media.publishers.last()
        events.clear()
        advance(2_100)
        assertFalse(publisher.enabled)
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("microphone"))
        assertEquals(listOf(LEASE_A), authority.released)
        val release = events.indexOf("release:$LEASE_A")
        assertTrue(events.indexOf("mic:1:false") in 0 until release)
        assertTrue(events.indexOf("close:1") in 0 until release)
    }

    @Test fun relayRenewalClosesOldPublisherBeforeAwaitingNewAuthority() {
        authority.rotates = true
        allowMicrophone(); start(); join(); talk()
        val previous = media.publishers.last()
        advance(5_100)
        assertEquals(1, authority.renewals.size)
        assertFalse(previous.enabled); assertTrue(previous.closed)
        assertFalse(status().getBoolean("microphone"))
        authority.renewals.single().result.success(floor(LEASE_B, 2))
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(media.publishers.last().enabled)
        assertNotSame(previous, media.publishers.last())
    }

    @Test fun staleRenewalFailureCannotReleaseReplacementFloor() {
        allowMicrophone(); start(); join(); talk()
        advance(5_100)
        val oldRenewal = authority.renewals.single()
        command("release")
        talk(LEASE_B, 2)
        val replacement = media.publishers.last()
        val releasesBefore = authority.released.toList()
        oldRenewal.result.failure()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(replacement.enabled)
        assertFalse(replacement.closed)
        assertEquals(releasesBefore, authority.released)
        assertFalse(authority.released.contains(LEASE_B))
        assertTrue(status().getBoolean("microphone"))
    }

    @Test fun duplicateRenewalReplyCannotRevokeOrReplaceCurrentPublisher() {
        allowMicrophone(); start(); join(); talk()
        advance(5_100)
        val renewal = authority.renewals.single()
        val renewed = floor()
        renewal.result.success(renewed)
        shadowOf(Looper.getMainLooper()).idle()
        val current = media.publishers.last()
        assertTrue(current.enabled)
        val count = media.publishers.size
        // Defensive duplicate handling is tested even though authority promises
        // one terminal callback: replay must not revoke this same active lease.
        val duplicate = floor()
        renewal.result.success(duplicate)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(count, media.publishers.size)
        assertTrue(current.enabled)
        assertTrue(authority.released.isEmpty())
        assertTrue((duplicate.transmit as FakeCredential).destroyed)
        assertFalse((renewed.transmit as FakeCredential).destroyed)
    }

    @Test fun providerCredentialExpiryShortensLocalLease() {
        allowMicrophone(); start(); join(); command("press")
        val shortCredential = floor(duration = 15_000, credentialDuration = 1_000)
        authority.floors.last().result.success(shortCredential)
        shadowOf(Looper.getMainLooper()).idle()
        val publisher = media.publishers.last()
        assertTrue(publisher.enabled)
        advance(1_100)
        assertFalse(publisher.enabled)
        assertTrue(publisher.closed)
        assertEquals(listOf(LEASE_A), authority.released)
    }

    @Test fun asynchronousInputMustBeAcknowledgedBeforeTalkingIsReported() {
        media.deferInputAcknowledgement = true
        allowMicrophone(); start(); join(); command("press")
        authority.floors.last().result.success(floor())
        shadowOf(Looper.getMainLooper()).idle()
        val publisher = media.publishers.last()
        assertNotNull(publisher.pendingEnable)
        assertFalse(publisher.enabled)
        assertFalse(status().getBoolean("microphone"))
        assertEquals("requesting", status().getString("state"))

        publisher.acknowledgeEnable()
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(publisher.enabled)
        assertTrue(status().getBoolean("microphone"))
        assertEquals("talking", status().getString("state"))
    }

    @Test fun releaseInvalidatesLateInputAcknowledgementAndDisablesOldHandle() {
        media.deferInputAcknowledgement = true
        allowMicrophone(); start(); join(); command("press")
        authority.floors.last().result.success(floor())
        shadowOf(Looper.getMainLooper()).idle()
        val publisher = media.publishers.last()
        val pendingEnable = requireNotNull(publisher.pendingEnable)
        command("release")
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("microphone"))
        events.clear()

        // A provider callback can race with cancellation. Deliver its obsolete
        // acknowledgement directly without fabricating a physical microphone.
        pendingEnable.applied(true)
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(publisher.enabled)
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("microphone"))
        assertNotEquals("talking", status().getString("state"))
        assertTrue("Late acknowledgement must issue another disable to its old handle", events.contains("mic:1:false"))
        assertEquals(listOf(LEASE_A), authority.released)
    }

    @Test fun joinTimeoutRejectsLateMembershipAndRequiresExplicitRejoin() {
        start(); command("join")
        val pending = authority.joins.single()
        advance(10_100)
        assertTrue(pending.cancelled)
        val now = serverNow()
        val credential = FakeCredential(now + 60_000)
        pending.result.success(VoiceAuthority.Join(SESSION, DUTY, now, now + 60_000, credential))
        shadowOf(Looper.getMainLooper()).idle()
        assertFalse(status().getBoolean("ready"))
        assertTrue(media.receivers.isEmpty())
        assertEquals(listOf(DUTY), authority.left)
        assertTrue(credential.destroyed)
        assertEquals(1, authority.joins.size)
    }

    @Test fun bridgeThreadIdentityChangeFencesAlreadyQueuedInputAcknowledgement() {
        media.deferInputAcknowledgement = true
        allowMicrophone(); start(); join(); command("press")
        authority.floors.last().result.success(floor())
        shadowOf(Looper.getMainLooper()).idle()
        val publisher = media.publishers.last()
        val reports = mutableListOf<Boolean>()
        val observer = GateRuntime.Listener { event ->
            if (event.optString("type") == "voice") reports.add(event.getJSONObject("data").getBoolean("microphone"))
        }
        runtime.add(observer)
        // This acknowledgement is ahead of the queued SDK stop. The bridge-thread
        // fence must still prevent a transient authoritative "talking" event.
        requireNotNull(publisher.pendingEnable).applied(true)
        val bridge = Thread { requireNotNull(coordinator).identityChanging() }
        bridge.start(); bridge.join(1000)
        assertFalse(bridge.isAlive)
        shadowOf(Looper.getMainLooper()).idle()
        runtime.remove(observer)
        assertFalse(reports.contains(true))
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("microphone"))
    }

    @Test fun windowFocusLossStopsMediaAndResumeDoesNotAutomaticallyRejoin() {
        allowMicrophone(); start(); join(); talk()
        val publisher = media.publishers.last()
        coordinator!!.windowFocusLost()
        assertFalse(publisher.enabled)
        assertTrue(publisher.closed)
        assertFalse(status().getBoolean("ready"))
        coordinator!!.resume()
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(1, authority.joins.size)
        assertFalse(status().getBoolean("microphone"))
        assertFalse(status().getBoolean("ready"))
    }

    @Test fun deadlineSubtractsRequestLatencyAndRejectsInvalidOrExpiredAuthority() {
        assertEquals(16_000L, VoiceCoordinator.deadline(100_000, 115_000, 1_000, 4_000, 15_000))
        assertEquals(-1L, VoiceCoordinator.deadline(100_000, 115_001, 1_000, 1_000, 15_000))
        assertEquals(-1L, VoiceCoordinator.deadline(100_000, 101_000, 1_000, 2_000, 15_000))
        assertEquals(-1L, VoiceCoordinator.deadline(100_000, 115_000, 2_000, 1_000, 15_000))
    }

    private class Request<T>(val result: VoiceAuthority.Result<T>) : VoiceAuthority.Pending {
        var cancelled = false
        override fun cancel() { cancelled = true }
    }

    private class FakeAuthority(private val events: MutableList<String>) : VoiceAuthority {
        var refreshable = false
        var rotates = false
        override fun rotatesTransportOnRenew() = rotates
        val joins = mutableListOf<Request<VoiceAuthority.Join>>()
        val floors = mutableListOf<Request<VoiceAuthority.Floor>>()
        val renewals = mutableListOf<Request<VoiceAuthority.Floor>>()
        val refreshes = mutableListOf<Request<VoiceAuthority.Join>>()
        val released = mutableListOf<String>()
        val left = mutableListOf<String>()
        override fun configured() = true
        override fun supportsRefresh() = refreshable
        override fun refresh(identity: VoiceAuthority.Identity, current: VoiceAuthority.Join, result: VoiceAuthority.Result<VoiceAuthority.Join>): VoiceAuthority.Pending =
            Request(result).also { refreshes.add(it) }
        override fun join(identity: VoiceAuthority.Identity, sessionId: String, result: VoiceAuthority.Result<VoiceAuthority.Join>): VoiceAuthority.Pending =
            Request(result).also { joins.add(it) }
        override fun floor(identity: VoiceAuthority.Identity, sessionId: String, result: VoiceAuthority.Result<VoiceAuthority.Floor>): VoiceAuthority.Pending =
            Request(result).also { floors.add(it) }
        override fun renew(identity: VoiceAuthority.Identity, sessionId: String, leaseId: String, generation: Long, result: VoiceAuthority.Result<VoiceAuthority.Floor>): VoiceAuthority.Pending =
            Request(result).also { renewals.add(it) }
        override fun release(identity: VoiceAuthority.Identity, sessionId: String, leaseId: String) {
            events.add("release:$leaseId"); released.add(leaseId)
        }
        override fun leave(identity: VoiceAuthority.Identity, dutyId: String) { left.add(dutyId) }
    }

    private class FakeCredential(private val expiry: Long) : VoiceMediaTransport.Credential {
        var destroyed = false
        override fun expiresAtMs() = expiry
        override fun destroy() { destroyed = true }
    }

    private class BindingCredential(private val expiry: Long) : VoiceMediaTransport.Credential {
        var destroyed = false
        override fun expiresAtMs() = expiry
        override fun destroy() { destroyed = true }
        override fun sameBinding(other: VoiceMediaTransport.Credential?) = other is BindingCredential && other.expiry == expiry
    }

    private class FakeReceiver : VoiceMediaTransport.Receiver {
        var closed = false
        override fun close() { closed = true }
    }

    private class FakePublisher(private val number: Int, private val events: MutableList<String>,
                                private val deferInputAcknowledgement: Boolean) : VoiceMediaTransport.Publisher {
        var enabled = false
        var closed = false
        var pendingEnable: VoiceMediaTransport.InputResult? = null
        override fun microphone(enabled: Boolean) {
            check(!enabled || !closed) { "Closed synthetic publisher must never reopen" }
            this.enabled = enabled; events.add("mic:$number:$enabled")
        }
        override fun microphone(enabled: Boolean, result: VoiceMediaTransport.InputResult) {
            if (enabled && deferInputAcknowledgement) pendingEnable = result
            else { microphone(enabled); result.applied(enabled) }
        }
        fun acknowledgeEnable() {
            val result = requireNotNull(pendingEnable)
            pendingEnable = null
            microphone(true)
            result.applied(true)
        }
        override fun close() { enabled = false; closed = true; events.add("close:$number") }
    }

    private class FakeMedia(private val events: MutableList<String>) : VoiceMediaTransport {
        val receivers = mutableListOf<FakeReceiver>()
        val publishers = mutableListOf<FakePublisher>()
        var deferInputAcknowledgement = false
        var operational = true
        var publishable = true
        override fun available() = operational
        override fun configured() = true
        override fun canPublish() = publishable
        override fun foreground(value: Boolean) { events.add("media:foreground:$value") }
        override fun authorizationChanged() { events.add("media:identity") }
        override fun stop() { events.add("media:stop") }
        override fun receive(credential: VoiceMediaTransport.Credential, result: VoiceMediaTransport.Result<VoiceMediaTransport.Receiver>): VoiceAuthority.Pending {
            val connection = FakeReceiver(); receivers.add(connection); result.ready(connection)
            return VoiceAuthority.Pending { }
        }
        override fun preparePublisher(credential: VoiceMediaTransport.Credential, result: VoiceMediaTransport.Result<VoiceMediaTransport.Publisher>): VoiceAuthority.Pending {
            val connection = FakePublisher(publishers.size + 1, events, deferInputAcknowledgement)
            assertFalse("Synthetic publishers must start muted", connection.enabled)
            publishers.add(connection); result.ready(connection)
            return VoiceAuthority.Pending { }
        }
    }

    /** Test-only JCA provider. It does not create an Android key or touch a file. */
    class SyntheticKeyStore : KeyStoreSpi() {
        override fun engineGetKey(alias: String, password: CharArray?): Key? =
            if (alias == KEY_ALIAS) SecretKeySpec(ByteArray(32) { 42 }, "AES") else null
        override fun engineContainsAlias(alias: String) = alias == KEY_ALIAS
        override fun engineAliases(): Enumeration<String> = Collections.enumeration(listOf(KEY_ALIAS))
        override fun engineSize() = 1
        override fun engineIsKeyEntry(alias: String) = alias == KEY_ALIAS
        override fun engineIsCertificateEntry(alias: String) = false
        override fun engineGetCertificate(alias: String): Certificate? = null
        override fun engineGetCertificateChain(alias: String): Array<Certificate>? = null
        override fun engineGetCertificateAlias(certificate: Certificate): String? = null
        override fun engineGetCreationDate(alias: String): Date = Date(0)
        override fun engineLoad(input: InputStream?, password: CharArray?) {}
        override fun engineStore(output: OutputStream?, password: CharArray?) {}
        override fun engineSetKeyEntry(alias: String, key: Key, password: CharArray?, chain: Array<Certificate>?) = throw UnsupportedOperationException()
        override fun engineSetKeyEntry(alias: String, key: ByteArray, chain: Array<Certificate>?) = throw UnsupportedOperationException()
        override fun engineSetCertificateEntry(alias: String, certificate: Certificate) = throw UnsupportedOperationException()
        override fun engineDeleteEntry(alias: String) = throw UnsupportedOperationException()
    }

    companion object {
        private const val KEY_ALIAS = "navrang-session-v2"
        private const val SERVER_TIME = 1_800_000_000_000L
        private const val SESSION = "00000000-0000-4000-8000-000000000001"
        private const val DUTY = "00000000-0000-4000-8000-000000000002"
        private const val LEASE_A = "00000000-0000-4000-8000-000000000003"
        private const val LEASE_B = "00000000-0000-4000-8000-000000000004"
    }
}
