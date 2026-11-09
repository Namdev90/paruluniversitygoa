package `in`.navrang.gate

import android.media.MediaFormat
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.shadows.MediaCodecInfoBuilder
import org.robolectric.shadows.ShadowMediaCodecList

/** Capability/ownership tests only; synthetic codecs, no media device or network. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 28, 35])
class NativeRelayRuntimeTest {
    @Before fun cleanCodecs() { ShadowMediaCodecList.reset() }
    @After fun resetCodecs() { ShadowMediaCodecList.reset() }

    private fun opusEncoder() {
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, 48000, 1)
        val capabilities = MediaCodecInfoBuilder.CodecCapabilitiesBuilder.newBuilder()
            .setMediaFormat(format).setIsEncoder(true).build()
        ShadowMediaCodecList.addCodec(MediaCodecInfoBuilder.newBuilder().setName("synthetic.opus.encoder")
            .setIsEncoder(true).setCapabilities(capabilities).build())
    }

    @Test fun unsupportedDevicesCannotPublishRegardlessOfSdkNumber() {
        assertNull(NativeRelayAudio.encoderName())
    }

    @Test fun api24And28CanUseAnActuallyAdvertisedOpusEncoder() {
        opusEncoder()
        assertEquals("synthetic.opus.encoder", NativeRelayAudio.encoderName())
    }

    @Test fun runtimeStartsWithoutClockOrMediaWorkAndCloseInvalidatesTiming() {
        val runtime = NativeRelayRuntime(RuntimeEnvironment.getApplication(), "https://fixture.invalid", 50, 1000, true)
        try {
            assertTrue(runtime.configured())
            assertFalse(runtime.available())
            assertFalse(runtime.canPublish())
            val now = runtime.clock().now()
            assertTrue(runtime.observeAuthenticated(1_800_000_000_000, now, now))
            assertTrue(runtime.clock().serverUpperBoundUnixMs() >= 1_800_000_000_050)
            runtime.close()
            assertFalse(runtime.configured())
            assertEquals(-1L, runtime.clock().serverUpperBoundUnixMs())
        } finally { runtime.close() }
    }

    @Test fun disabledRuntimeCannotBecomeOperationalFromTimingOrCodecDiscovery() {
        opusEncoder()
        val runtime = NativeRelayRuntime(RuntimeEnvironment.getApplication(), "https://fixture.invalid", 50, 1000, false)
        try {
            val now = runtime.clock().now()
            assertTrue(runtime.observeAuthenticated(1_800_000_000_000, now, now))
            assertFalse(runtime.configured())
            assertFalse(runtime.available())
            assertFalse(runtime.canPublish())
        } finally { runtime.close() }
    }
}
