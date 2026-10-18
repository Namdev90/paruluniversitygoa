package `in`.navrang.gate
/** Ticket QR payloads are exact transaction IDs, matching the deployed scanner contract. */
object GateQr {
    fun ticket(raw: String): String? = raw.takeIf { Regex("[A-Z0-9]{8}").matches(it) }
}
