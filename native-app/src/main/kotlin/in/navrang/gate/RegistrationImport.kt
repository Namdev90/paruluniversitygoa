package `in`.navrang.gate

import android.util.Xml
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.zip.ZipInputStream
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser

/** In-memory, bounded reader. No file paths are extracted and XML entities are never expanded. */
object RegistrationImport {
    const val MAX_FILE = 8 * 1024 * 1024
    private const val MAX_MEMBER = 16 * 1024 * 1024
    private const val MAX_EXPANDED = 32 * 1024 * 1024

    fun readBounded(input: InputStream, limit: Int = MAX_FILE): ByteArray {
        val out = ByteArrayOutputStream()
        val b = ByteArray(16384)
        while (true) {
            val n = input.read(b)
            if (n < 0) break
            require(out.size() + n <= limit) { "File exceeds the safe import size." }
            out.write(b, 0, n)
        }
        return out.toByteArray()
    }

    fun parse(bytes: ByteArray): JSONArray {
        require(bytes.size <= MAX_FILE) { "File exceeds 8 MiB." }
        val rows =
            if (bytes.size > 3 && bytes[0] == 80.toByte() && bytes[1] == 75.toByte()) xlsx(bytes)
            else csv(bytes.toString(Charsets.UTF_8))
        require(rows.size in 2..50001) { "Import must contain 1–50,000 transaction rows." }
        val headers = rows.first()
        val required =
            listOf(
                "TransactionID",
                "Customer",
                "LinkID",
                "Amount",
                "Quantity",
                "RefundAmount",
                "Description",
            )
        require(required.all { headers.count { h -> h == it } == 1 }) {
            "Required transaction columns are missing or duplicated."
        }
        val index = required.associateWith { headers.indexOf(it) }
        val records = linkedMapOf<String, JSONObject>()
        rows
            .drop(1)
            .filter { r -> r.any { it.isNotBlank() } }
            .forEachIndexed { i, r ->
                fun cell(key: String) = r.getOrElse(index.getValue(key)) { "" }.trim()
                val id = cell("TransactionID")
                require(Regex("[A-Z0-9]{8}").matches(id)) { "Invalid ticket ID at row ${i+2}." }
                require(cell("LinkID") == "O9KL3") { "Wrong event at row ${i+2}." }
                fun number(key: String): Double? {
                    val t = cell(key)
                    if (!Regex("[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)").matches(t)) return null
                    return t.toDoubleOrNull()?.takeIf { it.isFinite() }
                }
                val row =
                    json(
                        "id" to id,
                        "name" to cell("Customer"),
                        "amount" to number("Amount"),
                        "quantity" to number("Quantity"),
                        "refund" to number("RefundAmount"),
                        "description" to cell("Description"),
                    )
                val old = records[id]
                require(old == null || old.toString() == row.toString()) {
                    "Conflicting duplicate ticket at row ${i+2}. Import cancelled."
                }
                records[id] = row
            }
        require(records.isNotEmpty()) { "No transaction records found." }
        return JSONArray().apply { records.values.forEach { put(it) } }
    }

    private fun csv(raw: String): List<List<String>> {
        val input = raw.removePrefix("\uFEFF")
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var closed = false
        var i = 0
        fun addCell() {
            require(cell.length <= 10000)
            row.add(cell.toString())
            cell.setLength(0)
            closed = false
            require(row.size <= 256) { "Too many columns." }
        }
        fun addRow() {
            addCell()
            rows.add(row)
            row = mutableListOf()
            require(rows.size <= 50001) { "Too many rows." }
        }
        while (i < input.length) {
            val c = input[i++]
            if (quoted) {
                if (c == '"') {
                    if (i < input.length && input[i] == '"') {
                        cell.append('"')
                        i++
                    } else {
                        quoted = false
                        closed = true
                    }
                } else cell.append(c)
            } else
                when (c) {
                    '"' -> {
                        require(cell.isEmpty() && !closed) { "Malformed CSV quoting." }
                        quoted = true
                    }
                    ',' -> addCell()
                    '\r',
                    '\n' -> {
                        if (c == '\r' && i < input.length && input[i] == '\n') i++
                        addRow()
                    }
                    else -> {
                        require(!closed) { "Unexpected text after a quoted CSV value." }
                        cell.append(c)
                    }
                }
            require(cell.length <= 10000) { "Cell exceeds safe size." }
        }
        require(!quoted) { "Unclosed CSV quote." }
        if (cell.isNotEmpty() || row.isNotEmpty() || closed) addRow()
        return rows
    }

    private fun xlsx(bytes: ByteArray): List<List<String>> {
        val members = linkedMapOf<String, ByteArray>()
        var total = 0
        var count = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                require(++count <= 512) { "Too many workbook members." }
                require(
                    e.name.length < 256 &&
                        !e.name.split('/').contains("..") &&
                        !e.name.startsWith('/')
                ) {
                    "Invalid workbook member."
                }
                require(e.size <= MAX_MEMBER) { "Workbook member exceeds safe expansion size." }
                // nextEntry/closeEntry drain unread data. Even directory entries can carry
                // compressed bytes, so reject their payload through the same bounded reader.
                val limit = if (e.isDirectory) 0 else minOf(MAX_MEMBER, MAX_EXPANDED - total)
                val data = readBounded(z, limit)
                z.closeEntry()
                if (e.isDirectory) continue
                total += data.size
                require(!members.containsKey(e.name)) { "Duplicate workbook member." }
                members[e.name] = data
            }
        }
        require(
            members.containsKey("[Content_Types].xml") && members.containsKey("xl/workbook.xml")
        ) {
            "This is not an XLSX workbook."
        }
        val strings = mutableListOf<String>()
        members["xl/sharedStrings.xml"]?.let { data ->
            val p = parser(data)
            var item: StringBuilder? = null
            var inText = false
            while (p.eventType != XmlPullParser.END_DOCUMENT) {
                when (p.eventType) {
                    XmlPullParser.START_TAG ->
                        when (p.name) {
                            "si" -> item = StringBuilder()
                            "t" -> inText = true
                        }
                    XmlPullParser.TEXT -> if (inText) item?.append(p.text)
                    XmlPullParser.END_TAG ->
                        when (p.name) {
                            "t" -> inText = false
                            "si" -> {
                                strings.add(item.toString())
                                require(strings.size <= 200000)
                                item = null
                            }
                        }
                }
                require((item?.length ?: 0) <= 10000)
                p.next()
            }
        }
        val sheets =
            members.keys.filter { it.matches(Regex("xl/worksheets/sheet\\d+\\.xml")) }.sorted()
        require(sheets.size == 1) {
            "Use a workbook with exactly one transaction worksheet, or export CSV."
        }
        val p = parser(members.getValue(sheets.single()))
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        var value = StringBuilder()
        var col = 0
        var type = ""
        var insideValue = false
        while (p.eventType != XmlPullParser.END_DOCUMENT) {
            when (p.eventType) {
                XmlPullParser.START_TAG ->
                    when (p.name) {
                        "row" -> row = mutableListOf()
                        "c" -> {
                            val ref = p.getAttributeValue(null, "r") ?: ""
                            val letters = ref.takeWhile { it in 'A'..'Z' }
                            col = letters.fold(0) { n, c -> n * 26 + (c - 'A' + 1) } - 1
                            require(col in 0..255) { "Unsupported worksheet column." }
                            type = p.getAttributeValue(null, "t") ?: ""
                            value = StringBuilder()
                        }
                        "v",
                        "t" -> insideValue = true
                    }
                XmlPullParser.TEXT -> if (insideValue) value.append(p.text)
                XmlPullParser.END_TAG ->
                    when (p.name) {
                        "v",
                        "t" -> insideValue = false
                        "c" -> {
                            while (row.size <= col) row.add("")
                            row[col] =
                                if (type == "s")
                                    strings.getOrNull(value.toString().toIntOrNull() ?: -1)
                                        ?: throw IllegalArgumentException("Invalid shared string.")
                                else value.toString()
                        }
                        "row" -> {
                            if (row.any { it.isNotBlank() }) rows.add(row)
                            require(rows.size <= 50001) { "Too many rows." }
                        }
                    }
            }
            require(value.length <= 10000)
            p.next()
        }
        members.values.forEach { it.fill(0) }
        return rows
    }

    private fun parser(data: ByteArray): XmlPullParser {
        require(!data.toString(Charsets.UTF_8).contains("<!DOCTYPE", true)) {
            "Workbook document types are not allowed."
        }
        return Xml.newPullParser().apply {
            setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, true)
            setInput(ByteArrayInputStream(data), "UTF-8")
        }
    }
}
