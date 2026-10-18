package `in`.navrang.gate

import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class AuthorizedDocumentWriterTest {
    private class ProbeStream(
        private val failWrite: Boolean = false,
        private val failFlush: Boolean = false,
        private val failClose: Boolean = false,
        private val afterWrite: (() -> Unit)? = null,
        private val duringClose: (() -> Unit)? = null,
    ) : ByteArrayOutputStream() {
        var writes = 0
        var flushes = 0
        var closes = 0

        override fun write(bytes: ByteArray, offset: Int, count: Int) {
            writes++
            if (failWrite) throw IOException("Synthetic write failure")
            super.write(bytes, offset, count)
            afterWrite?.invoke()
        }

        override fun flush() {
            flushes++
            if (failFlush) throw IOException("Synthetic flush failure")
            super.flush()
        }

        override fun close() {
            closes++
            duringClose?.invoke()
            if (failClose) throw IOException("Synthetic close failure")
            super.close()
        }
    }

    @Test fun exactBytesAndChunkBoundariesArePreservedAndClosedBeforeSuccess() {
        for (size in listOf(0, 1, 16383, 16384, 16385, 65537, 12 * 1024 * 1024)) {
            val bytes = ByteArray(size) { (it % 256).toByte() }
            val stream = ProbeStream()
            var authorizationCheckedAfterClose = false
            val result = AuthorizedDocumentWriter.write(bytes, { stream }) {
                if (stream.closes == 1) authorizationCheckedAfterClose = true
                true
            }
            assertEquals(AuthorizedDocumentWriter.Result.SAVED, result)
            assertArrayEquals(bytes, stream.toByteArray())
            assertEquals((size + 16383) / 16384, stream.writes)
            assertEquals(1, stream.flushes)
            assertEquals(1, stream.closes)
            assertTrue(authorizationCheckedAfterClose)
        }
    }

    @Test fun oversizeOrMissingBytesCannotOpenOrTruncateTheDestination() {
        var opens = 0
        for (bytes in listOf(null, ByteArray(12 * 1024 * 1024 + 1))) {
            val result = AuthorizedDocumentWriter.write(bytes, { opens++; ProbeStream() }) { true }
            assertEquals(AuthorizedDocumentWriter.Result.FAILED, result)
        }
        assertEquals(0, opens)
    }

    @Test fun revokedAuthorizationNeverOpensTheDestination() {
        var opens = 0
        val result = AuthorizedDocumentWriter.write(byteArrayOf(1), { opens++; ProbeStream() }) { false }
        assertEquals(AuthorizedDocumentWriter.Result.STALE, result)
        assertEquals(0, opens)
    }

    @Test fun missingOrUnopenableDestinationIsNotSaved() {
        assertEquals(
            AuthorizedDocumentWriter.Result.FAILED,
            AuthorizedDocumentWriter.write(byteArrayOf(1), { null }) { true },
        )
        assertEquals(
            AuthorizedDocumentWriter.Result.FAILED,
            AuthorizedDocumentWriter.write(byteArrayOf(1), { throw IOException("Synthetic open failure") }) { true },
        )
        assertEquals(
            AuthorizedDocumentWriter.Result.FAILED,
            AuthorizedDocumentWriter.write(byteArrayOf(1), { throw SecurityException("Synthetic provider denial") }) { true },
        )
    }

    @Test fun writeFlushAndCloseFailuresNeverReportSavedAndCloseExactlyOnce() {
        for (stream in listOf(ProbeStream(failWrite = true), ProbeStream(failFlush = true), ProbeStream(failClose = true))) {
            val result = AuthorizedDocumentWriter.write(ByteArray(32769), { stream }) { true }
            assertEquals(AuthorizedDocumentWriter.Result.FAILED, result)
            assertEquals(1, stream.closes)
        }
    }

    @Test fun revocationAfterOpeningClosesWithoutWriting() {
        var allowed = true
        val stream = ProbeStream()
        val result = AuthorizedDocumentWriter.write(byteArrayOf(1), { allowed = false; stream }) { allowed }
        assertEquals(AuthorizedDocumentWriter.Result.STALE, result)
        assertEquals(0, stream.writes)
        assertEquals(0, stream.flushes)
        assertEquals(1, stream.closes)
    }

    @Test fun revocationBetweenChunksStopsFurtherWritesAndClosesExactlyOnce() {
        var allowed = true
        val stream = ProbeStream(afterWrite = { allowed = false })
        val result = AuthorizedDocumentWriter.write(ByteArray(32769), { stream }) { allowed }
        assertEquals(AuthorizedDocumentWriter.Result.STALE, result)
        assertEquals(1, stream.writes)
        assertEquals(16384, stream.size())
        assertEquals(0, stream.flushes)
        assertEquals(1, stream.closes)
    }

    @Test fun revocationDuringCloseCannotBecomeASavedReceipt() {
        var allowed = true
        val stream = ProbeStream(duringClose = { allowed = false })
        val result = AuthorizedDocumentWriter.write(byteArrayOf(1), { stream }) { allowed }
        assertEquals(AuthorizedDocumentWriter.Result.STALE, result)
        assertEquals(1, stream.flushes)
        assertEquals(1, stream.closes)
    }

    @Test fun authorizationFailureWhileWritingStillClosesTheDestination() {
        val stream = ProbeStream()
        var guards = 0
        val result = AuthorizedDocumentWriter.write(ByteArray(32769), { stream }) {
            guards++
            if (guards == 3) throw IllegalStateException("Synthetic session read failure")
            true
        }
        assertEquals(AuthorizedDocumentWriter.Result.FAILED, result)
        assertEquals(1, stream.writes)
        assertEquals(1, stream.closes)
    }
}
