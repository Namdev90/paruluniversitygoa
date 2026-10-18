package `in`.navrang.gate

import java.io.ByteArrayInputStream
import java.util.zip.ZipInputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class NativeDomainTest {
    private fun result(id: String, code: String) = ScanResult(id, code, "Synthetic fixture", "")

    @Test
    fun registrationEditsRejectMalformedFinancialValues() {
        val ticket = Ticket("TEST0001", "Synthetic", true, "", "100", "1", "0", "")
        assertEquals(100.0, ticket.registrationPayload().getDouble("amount"), 0.0)
        for (invalid in
            listOf(
                ticket.copy(amount = "1O0"),
                ticket.copy(amount = "NaN"),
                ticket.copy(amount = "Infinity"),
                ticket.copy(amount = "-1"),
                ticket.copy(quantity = "1.5"),
                ticket.copy(quantity = "0"),
                ticket.copy(refund = "invalid"),
                ticket.copy(refund = "-1"),
            )) {
            try {
                invalid.registrationPayload()
                fail("Malformed financial value was accepted")
            } catch (_: IllegalArgumentException) {}
        }
    }

    @Test
    fun pendingRetriesDoNotResetDeadline() {
        val q = ScanOutcomes()
        q.receive(result("TEST0001", "pending"), 0)
        q.receive(result("TEST0001", "pending"), 2400)
        q.tick(2500)
        assertTrue(q.held!!.pending)
        assertFalse(q.held!!.confirmed)
    }

    @Test
    fun lateReceiptDoesNotDismissRequiredAcknowledgement() {
        val q = ScanOutcomes()
        q.receive(result("TEST0001", "pending"), 0)
        q.tick(2500)
        q.receive(result("TEST0001", "admitted"), 2600)
        assertEquals("admitted", q.held!!.code)
        q.acknowledge(2700)
        assertNull(q.held)
    }

    @Test
    fun outcomesQueuedBehindIssueRemainVisible() {
        val q = ScanOutcomes()
        q.receive(result("TEST0001", "blocked"), 0)
        q.receive(result("TEST0002", "admitted"), 1)
        q.receive(result("TEST0003", "duplicate"), 2)
        q.acknowledge(3)
        assertEquals("TEST0002", q.current!!.id)
        q.tick(1202)
        assertNull(q.held)
        q.tick(1203)
        assertEquals("TEST0003", q.held!!.id)
    }

    @Test
    fun acknowledgementDoesNotCreateSuccess() {
        val q = ScanOutcomes()
        q.receive(result("TEST0001", "pending"), 0)
        q.tick(2500)
        q.acknowledge(2600)
        q.receive(result("TEST0001", "pending"), 2700)
        q.tick(6000)
        assertNull(q.held)
        assertFalse(q.current!!.confirmed)
        q.clear()
        assertNull(q.current)
    }

    @Test
    fun exactQrContract() {
        assertEquals("TEST0001", GateQr.ticket("TEST0001"))
        for (s in
            listOf(
                " TEST0001",
                "test0001",
                "https://example.invalid/TEST0001",
                "{\"ticketId\":\"TEST0001\"}",
                "TEST00010",
            )) assertNull(GateQr.ticket(s))
    }

    @Test
    fun correctionTimeIsExplicit() {
        val r =
            Receipt.from(
                json(
                    "ticketId" to "TEST0001",
                    "admissionBasis" to "organizer_confirmed",
                    "at" to "2026-10-18T00:00:00Z",
                )
            )
        assertTrue(r.correction)
        assertEquals("Correction recorded", r.timeLabel)
        assertEquals("", r.actualAt)
    }

    @Test
    fun pagingUsesCompleteDataset() {
        val p = PageState(5, 25)
        val items = (1..793).toList()
        assertEquals(32, p.pages(items.size))
        assertEquals(126, p.rows(items).first())
        assertEquals(0, p.bounded(0).index)
        assertEquals(793, PageState(31).rows(items).last())
    }

    @Test
    fun serverAuthorityIsRequired() {
        val p =
            Profile.from(
                json(
                    "role" to "checker",
                    "active" to false,
                    "scanner" to true,
                    "station" to "checker",
                    "nameConfirmed" to true,
                )
            )
        assertFalse(p.canScan)
        assertFalse(p.canDesk)
        assertFalse(p.canReport)
        assertFalse(p.admin)
    }

    @Test
    fun deskValidationAndFormulaSafeExports() {
        assertEquals(
            2,
            DeskDetails("Fixture Student", "fixture@example.invalid", "9999999999", "2")
                .payload()
                .getInt("quantity"),
        )
        assertThrows(IllegalArgumentException::class.java) {
            DeskDetails("Fixture", "x", "9", "0").payload()
        }
        assertTrue(
            String(ReportEncoder.csv(listOf(listOf("=1+1", "\tcommand", "फक्त चाचणी"))))
                .contains("'=1+1")
        )
    }

    @Test
    fun xlsxUsesLiteralStringsNeverFormulaElements() {
        val bytes = ReportEncoder.xlsx(listOf(listOf("=HYPERLINK(\"bad\")", "A&B")))
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            var found = false
            while (true) {
                val entry = z.nextEntry ?: break
                if (entry.name == "xl/worksheets/sheet1.xml") {
                    val xml = z.readBytes().toString(Charsets.UTF_8)
                    assertTrue(xml.contains("inlineStr"))
                    assertTrue(xml.contains("A&amp;B"))
                    assertFalse(xml.contains("<f>"))
                    found = true
                }
            }
            assertTrue(found)
        }
    }

    @Test
    fun exportBuffersAreErased() {
        val d = ExportDocument("fixture.csv", "text/csv", byteArrayOf(1, 2, 3), 7)
        d.clear()
        assertArrayEquals(byteArrayOf(0, 0, 0), d.bytes)
    }

    @Test
    fun importValidatesEventAndRejectsDuplicateConflicts() {
        val head = "TransactionID,Customer,LinkID,Amount,Quantity,RefundAmount,Description\n"
        val row = "TEST0001,Synthetic Student,O9KL3,100,1,0,Transaction completed successfully\n"
        assertEquals(1, RegistrationImport.parse((head + row + row).toByteArray()).length())
        assertThrows(IllegalArgumentException::class.java) {
            RegistrationImport.parse((head + row.replace("O9KL3", "OTHER")).toByteArray())
        }
        assertThrows(IllegalArgumentException::class.java) {
            RegistrationImport.parse((head + row + row.replace("100,1,0", "200,1,0")).toByteArray())
        }
    }

    @Test
    fun importPreflightMeasuresExactUtf8Envelope() {
        val rows = org.json.JSONArray().put(json("id" to "TEST0001", "name" to "Synthetic"))
        assertEquals(rows, RegistrationImport.payload(rows).getJSONArray("records"))
        val oversized = org.json.JSONArray().put(json("description" to "é".repeat(4 * 1024 * 1024)))
        assertTrue(oversized.toString().length < RegistrationImport.MAX_FILE)
        assertThrows(IllegalArgumentException::class.java) { RegistrationImport.payload(oversized) }
    }

    @Test
    fun importsRejectUnboundedExpansionBeforeXmlParsing() {
        val zip = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(zip).use { z ->
            z.putNextEntry(java.util.zip.ZipEntry("xl/worksheets/sheet1.xml"))
            val block = ByteArray(1024 * 1024)
            repeat(17) { z.write(block) }
            z.closeEntry()
        }
        assertThrows(IllegalArgumentException::class.java) {
            RegistrationImport.parse(zip.toByteArray())
        }
    }

    @Test
    fun directoryEntriesCannotBypassExpansionLimits() {
        val zip = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(zip).use { z ->
            // Streaming ZIP entries omit their size until the data descriptor.
            z.putNextEntry(java.util.zip.ZipEntry("unused/"))
            z.write(ByteArray(32768))
            z.closeEntry()
        }
        val failure =
            assertThrows(IllegalArgumentException::class.java) {
                RegistrationImport.parse(zip.toByteArray())
            }
        // Reject directory data immediately, before nextEntry can silently drain it.
        assertEquals("File exceeds the safe import size.", failure.message)
    }

    @Test
    fun xlsxImportPreservesLiteralUnicode() {
        val rows =
            listOf(
                listOf(
                    "TransactionID",
                    "Customer",
                    "LinkID",
                    "Amount",
                    "Quantity",
                    "RefundAmount",
                    "Description",
                ),
                listOf(
                    "TEST0001",
                    "Synthetic Unicode चाचणी",
                    "O9KL3",
                    "100",
                    "1",
                    "0",
                    "Transaction completed successfully",
                ),
            )
        assertEquals(
            "Synthetic Unicode चाचणी",
            RegistrationImport.parse(ReportEncoder.xlsx(rows)).getJSONObject(0).getString("name"),
        )
        val withDirectory = java.io.ByteArrayOutputStream()
        java.util.zip.ZipOutputStream(withDirectory).use { out ->
            out.putNextEntry(java.util.zip.ZipEntry("xl/"))
            out.closeEntry()
            ZipInputStream(ByteArrayInputStream(ReportEncoder.xlsx(rows))).use { input ->
                while (true) {
                    val entry = input.nextEntry ?: break
                    out.putNextEntry(java.util.zip.ZipEntry(entry.name))
                    input.copyTo(out)
                    out.closeEntry()
                }
            }
        }
        assertEquals(
            "Synthetic Unicode चाचणी",
            RegistrationImport.parse(withDirectory.toByteArray())
                .getJSONObject(0)
                .getString("name"),
        )
    }

    @Test
    fun expiredAccessCannotRetainLocalPrivilegesOffline() {
        val p =
            Profile.from(
                json(
                    "role" to "admin",
                    "active" to true,
                    "scanner" to true,
                    "reports" to true,
                    "helpdesk" to true,
                    "station" to "checker",
                    "accessExpiresAt" to "2000-01-01T00:00:00.000Z",
                )
            )
        assertTrue(p.expired)
        assertFalse(p.admin)
        assertFalse(p.canScan)
        assertFalse(p.canDesk)
        assertFalse(p.canReport)
        val session =
            Profile.from(
                json("role" to "admin", "active" to true, "expiresAt" to "2000-01-01T00:00:00Z")
            )
        assertTrue(session.expired)
        assertFalse(session.admin)
    }
}
