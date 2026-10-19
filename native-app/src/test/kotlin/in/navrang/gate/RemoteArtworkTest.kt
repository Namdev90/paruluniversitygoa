package `in`.navrang.gate

import android.net.Uri
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class RemoteArtworkTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val bytes = "synthetic public artwork".toByteArray()
    private val hash get() = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
    private val uri = Uri.parse("file:///android_asset/art/navrang-parul-combined.png")
    private fun spec(size: Int = bytes.size) = JSONObject().put("art/navrang-parul-combined.png", JSONObject()
        .put("revision", "a".repeat(40)).put("sha256", hash).put("size", size).put("mime", "image/png"))
    @Before fun clear() { File(context.cacheDir, "navrang-public-art").deleteRecursively() }

    @Test fun firstRequestFetchesOnlyPinnedPublicImageThenReusesVerifiedCache() {
        var calls = 0
        val provider = RemoteArtwork(context, spec()) { url, limit ->
            calls++; assertEquals(bytes.size, limit)
            assertEquals("https://raw.githubusercontent.com/Namdev90/paruluniversitygoa/" + "a".repeat(40) + "/app/assets/art/navrang-parul-combined.png", url)
            bytes
        }
        assertEquals(0, calls)
        repeat(2) { assertArrayEquals(bytes, provider.intercept(uri)!!.data.readBytes()) }
        assertEquals(1, calls)
    }
    @Test fun corruptedPublicCacheIsNeverUsed() {
        val cache = File(context.cacheDir, "navrang-public-art").apply { mkdirs() }
        File(cache, hash).writeText("wrong")
        var calls = 0
        val provider = RemoteArtwork(context, spec()) { _, _ -> calls++; bytes }
        assertArrayEquals(bytes, provider.intercept(uri)!!.data.readBytes())
        assertEquals(1, calls)
    }
    @Test fun mismatchedDownloadUsesLocalFallbackAndIsNotCached() {
        val provider = RemoteArtwork(context, spec()) { _, _ -> "tampered".toByteArray() }
        val response = provider.intercept(uri)!!
        assertEquals("image/svg+xml", response.mimeType)
        assertTrue(response.data.readBytes().decodeToString().contains("Parul University Goa"))
        assertFalse(File(context.cacheDir, "navrang-public-art/$hash").exists())
    }
    @Test fun networkFailureDoesNotPreventCoreInterfaceFromLoading() {
        val provider = RemoteArtwork(context, spec()) { _, _ -> throw java.io.IOException("offline fixture") }
        assertEquals("image/svg+xml", provider.intercept(uri)!!.mimeType)
        assertNull(provider.intercept(Uri.parse("file:///android_asset/index.html")))
    }
    @Test fun unlistedExternalAndModifiedUrisNeverReachDownloader() {
        val provider = RemoteArtwork(context, spec()) { _, _ -> fail("Unexpected download"); bytes }
        for (value in listOf("https://attacker.invalid/art/example.png", uri.toString()+"?token=fixture", "file:///android_asset/art/unlisted.png"))
            assertNull(provider.intercept(Uri.parse(value)))
    }
    @Test fun oversizedSpecificationIsRejectedWithoutNetwork() {
        val provider = RemoteArtwork(context, spec(2 * 1024 * 1024 + 1)) { _, _ -> fail("Oversized download"); bytes }
        assertEquals("image/svg+xml", provider.intercept(uri)!!.mimeType)
    }
}
