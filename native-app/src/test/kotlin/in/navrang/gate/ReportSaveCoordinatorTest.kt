package `in`.navrang.gate

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test

class ReportSaveCoordinatorTest {
    private fun request(
        generation: Long = 1,
        kind: ReportSaveCoordinator.Kind = ReportSaveCoordinator.Kind.REPORT,
    ) = ReportSaveCoordinator.Request(kind, "22222222-2222-4222-8222-222222222222", generation, "synthetic-session", "synthetic-document")

    @Test fun pickerAndWriterKeepOneSharedSaveBusy() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        assertTrue(coordinator.begin(first))
        val code = coordinator.requestCode(first)
        assertFalse(coordinator.begin(request(kind = ReportSaveCoordinator.Kind.HELP_DESK)))
        assertNull(coordinator.claimPicker(code + 1))
        assertSame(first, coordinator.claimPicker(code))
        assertTrue(coordinator.isCurrent(first))
        assertFalse(coordinator.begin(request()))
        assertNull(coordinator.claimPicker(code))
        assertTrue(coordinator.finish(first))
        assertFalse(coordinator.finish(first))
        assertTrue(coordinator.begin(request()))
    }

    @Test fun duplicatePickerCallbacksCanClaimTheRequestOnlyOnce() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        assertTrue(coordinator.begin(first))
        val code = coordinator.requestCode(first)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val claims = (0..1).map {
                pool.submit<ReportSaveCoordinator.Request?> {
                    start.await()
                    coordinator.claimPicker(code)
                }
            }
            start.countDown()
            assertEquals(1, claims.map { it.get() }.count { it === first })
            assertTrue(coordinator.isCurrent(first))
        } finally {
            pool.shutdownNow()
        }
    }

    @Test fun cancelledPickerFinishesWithoutOpeningAWriter() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        coordinator.begin(first)
        val code = coordinator.requestCode(first)
        val cancelled = coordinator.claimPicker(code)
        assertSame(first, cancelled)
        assertTrue(coordinator.finish(cancelled))
        assertFalse(coordinator.isCurrent(first))
        assertNull(coordinator.claimPicker(code))
    }

    @Test fun revocationDuringPickerOrWriteDropsTheOldRequest() {
        for (writing in listOf(false, true)) {
            val coordinator = ReportSaveCoordinator()
            val first = request()
            coordinator.begin(first)
            val code = coordinator.requestCode(first)
            if (writing) coordinator.claimPicker(code)
            coordinator.retainIf { it.generation == 2L }
            assertFalse(coordinator.isCurrent(first))
            assertFalse(coordinator.finish(first))
            assertNull(coordinator.claimPicker(code))
            assertTrue(coordinator.begin(request(generation = 2)))
        }
    }

    @Test fun oldCompletionCannotClearTheNextAccountSave() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        coordinator.begin(first)
        coordinator.claimPicker(coordinator.requestCode(first))
        coordinator.clear(ReportSaveCoordinator.Kind.REPORT)
        val second = request(generation = 2)
        assertTrue(coordinator.begin(second))
        assertFalse(coordinator.finish(first))
        assertTrue(coordinator.isCurrent(second))
        assertSame(second, coordinator.claimPicker(coordinator.requestCode(second)))
    }

    @Test fun aLateOldAccountPickerCannotClaimTheNewAccountDocument() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        coordinator.begin(first)
        val oldCode = coordinator.requestCode(first)
        coordinator.clear(ReportSaveCoordinator.Kind.REPORT)
        val second = request(generation = 2)
        coordinator.begin(second)
        val newCode = coordinator.requestCode(second)
        assertNotEquals(oldCode, newCode)
        assertNull(coordinator.claimPicker(oldCode))
        assertTrue(coordinator.isCurrent(second))
        assertSame(second, coordinator.claimPicker(newCode))
    }

    @Test fun clearingTheOtherDocumentKindDoesNotReleaseAnActiveSave() {
        val coordinator = ReportSaveCoordinator()
        val first = request()
        coordinator.begin(first)
        coordinator.clear(ReportSaveCoordinator.Kind.HELP_DESK)
        assertTrue(coordinator.isCurrent(first))
        coordinator.clear(ReportSaveCoordinator.Kind.REPORT)
        assertFalse(coordinator.isCurrent(first))
    }

    @Test fun recreatedCoordinatorsCannotReuseAPersistedPickerIdentifier() {
        val reserved = AtomicInteger(4096)
        val firstHost = ReportSaveCoordinator { reserved.getAndIncrement() }
        val first = request()
        firstHost.begin(first)
        val oldCode = firstHost.requestCode(first)
        val secondHost = ReportSaveCoordinator { reserved.getAndIncrement() }
        val second = request(generation = 2)
        secondHost.begin(second)
        assertNull(secondHost.claimPicker(oldCode))
        assertSame(second, secondHost.claimPicker(secondHost.requestCode(second)))
    }

    @Test fun identifierReservationFailureCannotAcceptAnUntrackableSave() {
        for (coordinator in listOf(
            ReportSaveCoordinator { -1 },
            ReportSaveCoordinator { 65536 },
            ReportSaveCoordinator { throw IllegalStateException("Synthetic reservation failure") },
        )) {
            val pending = request()
            assertFalse(coordinator.begin(pending))
            assertFalse(coordinator.busy())
            assertFalse(coordinator.isCurrent(pending))
        }
    }
}
