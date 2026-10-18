package `in`.navrang.gate

import java.util.Locale
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** All ticket/payment/operator values in this file are synthetic. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class ClassicScannerDetailsTest {
    @Test fun exactIdDoesNotTruncateOrSubmitArbitraryQrContent() {
        assertEquals("TEST0001", exactScannerId(" test0001 "))
        for (raw in listOf("", "TEST001", "TEST00010", "TEST 001", "TEST-001", "TEßT001", "ABﬀCD12", "https://fixture.invalid/TEST0001", "{\"id\":\"TEST0001\"}"))
            assertNull(raw, exactScannerId(raw))
    }

    @Test fun exactIdNormalizationDoesNotDependOnDeviceLanguage() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("tr-TR"))
            assertEquals("ID000001", exactScannerId("id000001"))
        } finally { Locale.setDefault(before) }
    }

    @Test fun existingContractKeepsAllRegistrationAndOriginalReceiptFacts() {
        val result = ScanResult.from(json(
            "code" to "duplicate", "id" to "TEST0001",
            "record" to json("name" to "Synthetic student", "amount" to 100,
                "quantity" to 1, "refund" to 0, "description" to "Transaction completed successfully",
                "eligible" to true, "reason" to ""),
            "entry" to json("ticketId" to "TEST0001", "name" to "Synthetic student",
                "checker" to "Original synthetic checker", "at" to "2026-10-10T10:11:12Z",
                "seq" to 71, "source" to "Synthetic workbook", "checkerId" to "synthetic-checker-17"),
        ))
        assertFalse(result.confirmed)
        assertEquals("100", result.record!!.amount)
        assertEquals("1", result.record!!.quantity)
        assertEquals("0", result.record!!.refund)
        assertEquals(true, result.record!!.eligible)
        assertEquals("Transaction completed successfully", result.record!!.description)
        assertEquals("Original synthetic checker", result.receipt!!.checker)
        assertEquals("2026-10-10T10:11:12Z", result.receipt!!.time)
        assertEquals("Synthetic workbook", result.receipt!!.source)
        assertEquals("synthetic-checker-17", result.receipt!!.checkerId)
        assertEquals("", result.record!!.paymentAt)
        assertEquals("", result.record!!.paymentMethod)
        assertEquals("", result.record!!.paymentReference)
    }

    @Test fun missingRegistrationDoesNotInventPaymentOrEligibility() {
        val missing = ScanResult.from(json("code" to "not_found", "id" to "TEST0002"))
        assertNull(missing.record)
        assertNull(missing.receipt)
        val empty = ScanResult.from(json("code" to "pending", "record" to json()))
        assertFalse(empty.record!!.hasValues)
        assertNull(empty.record!!.eligible)
        assertEquals("", empty.record!!.amount)
        assertEquals("", empty.record!!.paymentAt)
        assertEquals("", empty.record!!.paymentMethod)
        assertNull(empty.receipt)
        assertFalse(empty.confirmed)
    }

    @Test fun optionalPaymentFieldsComeOnlyFromReturnedRegistration() {
        val result = ScanResult.from(json(
            "code" to "blocked",
            "record" to json("amount" to 75, "eligible" to false, "reason" to "Synthetic unpaid balance",
                "paymentAt" to "2026-10-10T08:00:00Z", "paymentMethod" to "Synthetic method",
                "paymentReference" to "SYNTHETIC-REFERENCE", "source" to "Synthetic import"),
        ))
        assertTrue(result.record!!.hasValues)
        assertEquals(false, result.record!!.eligible)
        assertEquals("Synthetic unpaid balance", result.record!!.reason)
        assertEquals("2026-10-10T08:00:00Z", result.record!!.paymentAt)
        assertEquals("Synthetic method", result.record!!.paymentMethod)
        assertEquals("SYNTHETIC-REFERENCE", result.record!!.paymentReference)
        assertEquals("Synthetic import", result.record!!.source)
    }

    @Test fun zeroPaymentsAndFalseEligibilityRemainVisibleData() {
        val record = ScanRecordDetails.from(json("amount" to 0, "refund" to 0, "eligible" to false))
        assertTrue(record.hasValues)
        assertEquals("0", record.amount)
        assertEquals("0", record.refund)
        assertEquals(false, record.eligible)
        assertFalse(Receipt.from(json()).hasScanDetails)
    }

    @Test fun correctionDoesNotConvertRecordCreationIntoPhysicalAdmissionOrPayment() {
        val result = ScanResult.from(json("code" to "duplicate", "entry" to json(
            "ticketId" to "TEST0003", "admissionBasis" to "organizer_confirmed",
            "checker" to "Synthetic organizer", "at" to "2026-10-11T11:00:00Z",
            "observedScanAt" to "2026-10-10T10:00:00Z", "note" to "Synthetic correction",
        )))
        assertTrue(result.receipt!!.correction)
        assertEquals("Correction recorded", result.receipt!!.timeLabel)
        assertEquals("", result.receipt!!.actualAt)
        assertEquals("2026-10-10T10:00:00Z", result.receipt!!.observedAt)
        assertEquals("Synthetic correction", result.receipt!!.note)
        assertNull(result.record)
    }
}
