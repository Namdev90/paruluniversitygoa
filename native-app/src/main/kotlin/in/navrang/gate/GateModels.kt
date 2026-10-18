package `in`.navrang.gate

import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.text(key: String, fallback: String = "") =
    if (isNull(key)) fallback else optString(key, fallback)

internal fun JSONArray.objects() = (0 until length()).mapNotNull { optJSONObject(it) }

internal fun json(vararg pairs: Pair<String, Any?>) =
    JSONObject().apply { pairs.forEach { (k, v) -> put(k, v ?: JSONObject.NULL) } }

internal fun JSONObject.fields(): Map<String, String> =
    keys().asSequence().associateWith { text(it) }

data class Profile(
    val id: String,
    val name: String,
    val role: String,
    val method: String,
    val active: Boolean,
    val scanner: Boolean,
    val helpdesk: Boolean,
    val reports: Boolean,
    val station: String,
    val requestedRole: String,
    val reportsRequested: Boolean,
    val nameConfirmed: Boolean,
    val expiresAt: String,
    val sessionExpiresAt: String = "",
) {
    private val expiresMillis =
        listOf(expiresAt, sessionExpiresAt)
            .filter { it.isNotBlank() }
            .map { value ->
                try {
                    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
                        .apply { isLenient = false }
                        .parse(value.replace(Regex("\\.\\d+"), ""))
                        ?.time ?: 0L
                } catch (_: Exception) {
                    0L
                }
            }
            .minOrNull()
    val expired
        get() = expiresMillis != null && System.currentTimeMillis() >= expiresMillis

    val admin
        get() = active && !expired && role == "admin"

    val canScan
        get() = admin || active && !expired && scanner && station == "checker" && nameConfirmed

    val canDesk
        get() = admin || active && !expired && helpdesk && station == "helpdesk" && nameConfirmed

    val canReport
        get() = admin || active && !expired && reports

    val scope
        get() =
            listOf(id, role, active, scanner, helpdesk, reports, station, nameConfirmed, expiresAt)
                .joinToString("|")

    companion object {
        fun from(p: JSONObject): Profile =
            Profile(
                p.text("checkerId", p.text("role")),
                p.text("name"),
                p.text("role"),
                p.text("method"),
                p.optBoolean("active"),
                p.optBoolean("scanner"),
                p.optBoolean("helpdesk"),
                p.optBoolean("reports"),
                p.text("station"),
                p.text("requestedRole"),
                p.optBoolean("reportsRequested"),
                p.optBoolean("nameConfirmed", true),
                p.text("accessExpiresAt"),
                p.text("expiresAt"),
            )
    }
}

data class Ticket(
    val id: String,
    val name: String,
    val eligible: Boolean,
    val reason: String,
    val amount: String,
    val quantity: String,
    val refund: String,
    val description: String,
) {
    companion object {
        fun from(o: JSONObject) =
            Ticket(
                o.text("id"),
                o.text("name"),
                o.optBoolean("eligible"),
                o.text("reason"),
                o.text("amount"),
                o.text("quantity"),
                o.text("refund"),
                o.text("description"),
            )
    }
}

internal fun Ticket.registrationPayload(): JSONObject {
    val amountValue = amount.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }
    val quantityValue = quantity.trim().toIntOrNull()?.takeIf { it > 0 }
    val refundValue = refund.trim().toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }
    require(amountValue != null && quantityValue != null && refundValue != null) {
        "Enter numeric non-negative amount/refund and a positive whole quantity."
    }
    return json(
        "id" to id,
        "name" to name,
        "amount" to amountValue,
        "quantity" to quantityValue,
        "refund" to refundValue,
        "description" to description,
    )
}

data class Receipt(
    val id: String,
    val seq: Long,
    val name: String,
    val checker: String,
    val recordedAt: String,
    val basis: String,
    val actualAt: String,
    val observedAt: String,
    val note: String,
    val source: String = "",
) {
    val correction
        get() = basis == "organizer_confirmed"

    val hasScanDetails
        get() = checker.isNotBlank() || recordedAt.isNotBlank() || actualAt.isNotBlank() ||
            observedAt.isNotBlank() || note.isNotBlank() || source.isNotBlank() || seq > 0 || correction

    val timeLabel
        get() = if (correction) "Correction recorded" else "Entry confirmed"

    val time
        get() = if (correction) recordedAt else actualAt.ifBlank { recordedAt }

    companion object {
        fun from(o: JSONObject) =
            Receipt(
                o.text("ticketId"),
                o.optLong("seq"),
                o.text("name", "Name not supplied"),
                o.text("checker"),
                o.text("at"),
                o.text("admissionBasis"),
                o.text("actualAdmittedAt"),
                o.text("observedScanAt"),
                o.text("note"),
                o.text("source"),
            )
    }
}

data class Staff(
    val id: String,
    val name: String,
    val email: String,
    val method: String,
    val active: Boolean,
    val scanner: Boolean,
    val helpdesk: Boolean,
    val station: String,
    val requested: String,
    val expiry: String,
    val entries: Long,
) {
    companion object {
        fun from(o: JSONObject) =
            Staff(
                o.text("id"),
                o.text("name"),
                o.text("email"),
                o.text("method"),
                o.optBoolean("active"),
                o.optBoolean("scanner"),
                o.optBoolean("helpdesk"),
                o.text("station"),
                o.text("requestedRole"),
                o.text("accessExpiresAt"),
                o.optLong("entries"),
            )
    }
}

data class Faculty(
    val id: String,
    val name: String,
    val email: String,
    val enabled: Boolean,
    val requested: Boolean,
    val eligible: Boolean,
) {
    companion object {
        fun from(o: JSONObject) =
            Faculty(
                o.text("id"),
                o.text("name"),
                o.text("email"),
                o.optBoolean("teacher"),
                o.optBoolean("requested"),
                !o.optBoolean("scanner") &&
                    !o.optBoolean("helpdesk") &&
                    o.optBoolean("nameConfirmed", true),
            )
    }
}

data class DeskDetails(
    val name: String = "",
    val email: String = "",
    val phone: String = "",
    val quantity: String = "1",
) {
    fun payload(): JSONObject {
        require(name.trim().isNotEmpty() && name.length <= 128) {
            "Enter the student's name (up to 128 characters)."
        }
        require(
            Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(email.trim()) && email.length <= 254
        ) {
            "Enter a valid email address."
        }
        require(
            Regex("^[+()\\d .-]+$").matches(phone) &&
                phone.count(Char::isDigit) in 7..15 &&
                phone.length <= 24
        ) {
            "Enter a valid mobile number."
        }
        val count = quantity.toIntOrNull()
        require(count != null && count in 1..20) { "Quantity must be a whole number from 1 to 20." }
        require(listOf(name, email, phone).none { s -> s.any { it.code < 32 || it.code == 127 } }) {
            "Remove control characters."
        }
        return json(
            "name" to name.trim(),
            "email" to email.trim().lowercase(Locale.ROOT),
            "phone" to phone.trim(),
            "quantity" to count,
        )
    }
}

data class DeskCase(
    val id: String,
    val version: Int,
    val ticket: String,
    val status: String,
    val details: DeskDetails,
    val creator: String,
    val created: String,
    val reviewer: String,
    val reviewed: String,
) {
    companion object {
        fun from(o: JSONObject): DeskCase {
            val d = o.optJSONObject("details") ?: JSONObject()
            return DeskCase(
                o.text("id"),
                o.optInt("version"),
                o.text("ticket_id"),
                o.text("status"),
                DeskDetails(
                    d.text("name"),
                    d.text("email"),
                    d.text("phone"),
                    d.text("quantity", "1"),
                ),
                o.text("created_by_name"),
                o.text("created_at"),
                o.text("reviewed_by_name"),
                o.text("reviewed_at"),
            )
        }
    }
}

/** Only fields actually returned for this authorized scan. Never joins a local roster. */
data class ScanRecordDetails(
    val amount: String,
    val quantity: String,
    val refund: String,
    val description: String,
    val eligible: Boolean?,
    val reason: String,
    val paymentAt: String,
    val paymentMethod: String,
    val paymentReference: String,
    val source: String,
) {
    val hasValues
        get() = eligible != null || listOf(amount, quantity, refund, description, reason,
            paymentAt, paymentMethod, paymentReference, source).any { it.isNotBlank() }

    companion object {
        fun from(o: JSONObject) = ScanRecordDetails(
            o.text("amount"),
            o.text("quantity"),
            o.text("refund"),
            o.text("description"),
            if (o.opt("eligible") is Boolean) o.getBoolean("eligible") else null,
            o.text("reason"),
            o.text("paymentAt"),
            o.text("paymentMethod"),
            o.text("paymentReference"),
            o.text("source"),
        )
    }
}

/** No truncation: an overlong pasted ID must never verify a different ticket. */
internal fun exactScannerId(raw: String): String? =
    raw.trim().uppercase(Locale.ROOT).takeIf { Regex("[A-Z0-9]{8}").matches(it) }

data class ScanResult(
    val id: String,
    val code: String,
    val name: String,
    val message: String,
    val receipt: Receipt? = null,
    val record: ScanRecordDetails? = null,
) {
    val confirmed
        get() = code == "admitted"

    val pending
        get() = code == "pending"

    val title
        get() =
            when (code) {
                "admitted" -> "Entry confirmed"
                "duplicate" -> "Already entered"
                "pending" -> "Awaiting confirmation"
                "blocked" -> "Payment or eligibility issue"
                "not_found" -> "Unknown ticket"
                "invalid" -> "Invalid QR"
                "update_in_progress" -> "Finish app update"
                else -> "Entry not confirmed"
            }

    companion object {
        fun from(o: JSONObject): ScanResult {
            val e = o.optJSONObject("entry")
            return ScanResult(
                o.text("id", e?.text("ticketId") ?: ""),
                o.text("code"),
                e?.text("name") ?: o.optJSONObject("record")?.text("name") ?: "",
                o.text("message"),
                e?.let(Receipt::from),
                o.optJSONObject("record")?.let(ScanRecordDetails::from),
            )
        }
    }
}

enum class Destination(val label: String) {
    Station("Station"),
    Checker("Checker"),
    Scanner("Scanner"),
    Entries("Entry log"),
    Students("Students"),
    Staff("Staff"),
    Summary("Summary"),
    Desk("Help Desk"),
    Reports("Faculty reports"),
    Settings("Account"),
}

data class PageState(val index: Int = 0, val size: Int = 25) {
    fun bounded(total: Int) = copy(index = index.coerceIn(0, ((total - 1).coerceAtLeast(0) / size)))

    fun pages(total: Int) = maxOf(1, (total + size - 1) / size)

    fun <T> rows(items: List<T>) = items.drop(bounded(items.size).index * size).take(size)
}

data class Appearance(
    val mode: String = "system",
    val dynamic: Boolean = true,
    val reducedMotion: Boolean = false,
)

data class GateState(
    val signOutPending: Boolean = false,
    val ready: Boolean = false,
    val profile: Profile? = null,
    val destination: Destination = Destination.Station,
    val busy: Boolean = false,
    val message: String = "",
    val online: Boolean = false,
    val stats: Map<String, String> = emptyMap(),
    val tickets: List<Ticket> = emptyList(),
    val entries: List<Receipt> = emptyList(),
    val staff: List<Staff> = emptyList(),
    val pending: Int = 0,
    val studentQuery: String = "",
    val studentFilter: String = "All",
    val entryQuery: String = "",
    val studentPage: PageState = PageState(),
    val entryPage: PageState = PageState(),
    val deskRows: List<DeskCase> = emptyList(),
    val deskTotal: Int = 0,
    val deskPage: Int = 0,
    val deskQuery: String = "",
    val deskFilter: String = "all",
    val deskLoading: Boolean = false,
    val deskError: String = "",
    val draft: DeskDetails = DeskDetails(),
    val editing: DeskCase? = null,
    val pendingSave: Boolean = false,
    val reportSummary: Map<String, String> = emptyMap(),
    val faculty: List<Faculty> = emptyList(),
    val reportKind: String = "all",
    val reportError: String = "",
    val result: ScanResult? = null,
    val held: ScanResult? = null,
    val update: Map<String, String> = emptyMap(),
    val appearance: Appearance = Appearance(),
    val selectedTicket: Ticket? = null,
    val selectedStaff: Staff? = null,
    val selectedCase: DeskCase? = null,
    val importCount: Int = 0,
    val modal: String = "",
    val staffCode: String = "",
    val intro: Boolean = false,
    val exportReady: Boolean = false,
    val exportPreparing: Boolean = false,
)

internal fun displayTime(value: String): String {
    if (value.isBlank()) return "Unknown"
    return try {
        val parse = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        val date = parse.parse(value.replace(Regex("\\.\\d+"), "")) ?: return "Unknown"
        SimpleDateFormat("dd MMM yyyy, HH:mm:ss 'IST'", Locale.forLanguageTag("en-IN"))
            .apply { timeZone = TimeZone.getTimeZone("Asia/Kolkata") }
            .format(date)
    } catch (_: Exception) {
        "Unknown"
    }
}
