package `in`.navrang.gate

import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.json.JSONObject

class ExportDocument(
    val filename: String,
    val mime: String,
    val bytes: ByteArray,
    val generation: Long,
    val contacts: Boolean = false,
) {
    init {
        require(bytes.size <= 12 * 1024 * 1024) { "Report exceeds the safe export size." }
    }

    fun clear() {
        bytes.fill(0)
    }
}

object ReportEncoder {
    val kinds =
        linkedMapOf(
            "all" to "Registration and attendance master",
            "attended" to "All confirmed attendees",
            "absent" to "Eligible with no verified entry",
            "blocked" to "Blocked registrations",
            "issues" to "Recorded entry issues",
            "resolved" to "Issues resolved by admission",
            "unresolved" to "Issues without verified entry",
            "duplicates" to "Duplicate attempts",
            "activity" to "Gate activity and timing evidence",
            "helpdesk" to "Help Desk cases",
            "pending" to "Pending Help Desk cases",
            "corrections" to "Admitted — registration data missing",
        )

    fun safeCell(s: String) =
        if (
            Regex("^[\\s\\u0000-\\u001f]*[=+@-]").containsMatchIn(s) ||
                s.startsWith('\t') ||
                s.startsWith('\r') ||
                s.startsWith('\n')
        )
            "'$s"
        else s

    fun csv(rows: List<List<String>>): ByteArray =
        ("\uFEFF" +
                rows.joinToString("\r\n") { r ->
                    r.joinToString(",") { "\"" + safeCell(it).replace("\"", "\"\"") + "\"" }
                } +
                "\r\n")
            .toByteArray(Charsets.UTF_8)

    private fun xml(s: String) =
        s.filter { it == '\n' || it == '\r' || it == '\t' || it.code >= 32 }
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;")

    private fun column(index: Int): String {
        var n = index + 1
        var s = ""
        while (n > 0) {
            s = ('A' + (n - 1) % 26) + s
            n = (n - 1) / 26
        }
        return s
    }

    fun xlsx(rows: List<List<String>>): ByteArray {
        val buffer = ByteArrayOutputStream()
        ZipOutputStream(buffer).use { z ->
            fun add(name: String, value: String) {
                z.putNextEntry(ZipEntry(name).apply { time = 0 })
                z.write(value.toByteArray())
                z.closeEntry()
            }
            add(
                "[Content_Types].xml",
                """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>""",
            )
            add(
                "_rels/.rels",
                """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""",
            )
            add(
                "xl/workbook.xml",
                """<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Navrang" sheetId="1" r:id="rId1"/></sheets></workbook>""",
            )
            add(
                "xl/_rels/workbook.xml.rels",
                """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>""",
            )
            add(
                "xl/worksheets/sheet1.xml",
                buildString {
                    append(
                        "<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>"
                    )
                    rows.forEachIndexed { i, r ->
                        append("<row r=\"").append(i + 1).append("\">")
                        r.forEachIndexed { j, value ->
                            append("<c r=\"")
                                .append(column(j))
                                .append(i + 1)
                                .append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                                .append(xml(value))
                                .append("</t></is></c>")
                        }
                        append("</row>")
                    }
                    append("</sheetData></worksheet>")
                },
            )
        }
        return buffer.toByteArray()
    }

    fun dataset(
        result: JSONObject,
        kind: String,
        format: String,
        generation: Long,
    ): ExportDocument {
        require(kind in kinds && format in listOf("csv", "xlsx"))
        val records = result.getJSONArray("rows").objects()
        require(records.size <= 50000)
        val columns = linkedSetOf<String>()
        records.forEach { columns.addAll(it.keys().asSequence().toList()) }
        columns.add("Report generated UTC")
        val rows =
            listOf(columns.toList()) +
                records.map { r ->
                    columns.map {
                        if (it == "Report generated UTC") result.text("generatedAt") else r.text(it)
                    }
                }
        val bytes = if (format == "csv") csv(rows) else xlsx(rows)
        return ExportDocument(
            "Navrang-$kind-${date()}.$format",
            if (format == "csv") "text/csv"
            else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            bytes,
            generation,
        )
    }

    private fun date() =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())

    fun summary(stats: JSONObject, generation: Long): ExportDocument {
        val labels =
            linkedMapOf(
                "attended" to "Total admitted",
                "registeredAttended" to
                    "From registration master (excluding organizer confirmations)",
                "organizerConfirmed" to "Organizer-confirmed admissions",
                "registered" to "Registrations received",
                "eligible" to "Eligible registrations",
                "noShow" to "Eligible with no verified entry",
                "blocked" to "Blocked registrations",
                "serverIssues" to "Recorded issue attempts",
                "issueTickets" to "Tickets with issues",
                "duplicateAttempts" to "Duplicate attempts",
                "pendingHelpDesk" to "Pending Help Desk cases",
            )
        val pdf = PdfDocument()
        val buffer = ByteArrayOutputStream()
        try {
            val page = pdf.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
            val canvas = page.canvas
            val p = Paint(Paint.ANTI_ALIAS_FLAG)
            p.textSize = 21f
            canvas.drawText("Navrang attendance summary", 40f, 60f, p)
            p.textSize = 11f
            canvas.drawText("Generated: ${displayTime(stats.text("generatedAt"))}", 40f, 88f, p)
            var y = 130f
            labels.forEach { (key, label) ->
                canvas.drawText(label, 40f, y, p)
                canvas.drawText(stats.text(key, "Unknown"), 500f, y, p)
                y += 32f
            }
            val notes =
                listOf(
                    "A summary of aggregate counts; this is not a row-level attendance register.",
                    "Total admitted includes documented organizer confirmations.",
                    "Missing registration data does not establish payment or eligibility.",
                    "No verified entry does not prove absence.",
                    "Correction recording time is separate from physical entry time.",
                    "Exact admission time is unknown for organizer-confirmed corrections.",
                )
            y += 25f
            notes.forEach {
                canvas.drawText(it, 40f, y, p)
                y += 22f
            }
            pdf.finishPage(page)
            pdf.writeTo(buffer)
        } finally {
            pdf.close()
        }
        return ExportDocument(
            "Navrang-Attendance-Summary-${date()}.pdf",
            "application/pdf",
            buffer.toByteArray(),
            generation,
        )
    }
}
