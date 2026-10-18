package `in`.navrang.gate

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp

internal val ScannerGold = Color(0xffe5be7d)
internal val ScannerWine = Color(0xff402333)

/** The original fixed palette also covers dialogs; device dynamic colors are not applied. */
@Composable
internal fun ClassicScannerTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = ScannerGold, onPrimary = Color(0xff201219),
            background = Color(0xff100d15), surface = Color(0xff211923),
            surfaceContainerHigh = Color(0xff211923),
            onSurface = Color(0xfff9e9dc), onSurfaceVariant = Color(0xffd4c3bc),
            secondary = Color(0xffdcb071), outline = Color(0xff82634e),
        ),
        shapes = Shapes(
            small = RoundedCornerShape(9.dp), medium = RoundedCornerShape(12.dp),
            large = RoundedCornerShape(18.dp),
        ),
        content = content,
    )
}

@Composable
internal fun ScannerExactIdPanel(
    enabled: Boolean,
    onVerify: (String) -> Unit,
    onClose: () -> Unit,
    cameraAvailable: Boolean = true,
) {
    var input by remember { mutableStateOf("") }
    val normalized = exactScannerId(input)
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val verify = {
        if (enabled && normalized != null) {
            focus.clearFocus()
            keyboard?.hide()
            onVerify(normalized)
            input = ""
        }
    }
    Column(
        Modifier.fillMaxWidth().testTagCompat("scanner-id-panel"),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Find by ticket ID", style = MaterialTheme.typography.titleMedium, color = ScannerGold)
        Text(
            "Verify entry checks the server and records admission for an eligible ticket. Only a confirmed receipt permits entry.",
            style = MaterialTheme.typography.bodySmall,
        )
        OutlinedTextField(
            value = input,
            onValueChange = { input = it },
            label = { Text("Exact eight-character ticket ID") },
            singleLine = true,
            enabled = enabled,
            isError = input.isNotBlank() && normalized == null,
            supportingText = {
                Text(if (input.isNotBlank() && normalized == null) "Use exactly eight letters or digits."
                     else if (cameraAvailable) "Camera stays open; QR reading is paused while you enter the ID."
                     else "You can verify an ID without camera permission.")
            },
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { verify() }),
            modifier = Modifier.fillMaxWidth().testTagCompat("scanner-exact-id"),
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(
                onClick = { verify() },
                enabled = enabled && normalized != null,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text("Verify entry") }
            OutlinedButton(
                onClick = {
                    focus.clearFocus()
                    keyboard?.hide()
                    onClose()
                },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text(if (cameraAvailable) "Resume camera" else "Hide ID entry") }
        }
    }
}

@Composable
internal fun ClassicScanOutcomeCard(result: ScanResult, onDetails: () -> Unit) {
    val accent = when {
        result.confirmed -> Color(0xffbfe4c8)
        result.pending -> ScannerGold
        else -> Color(0xffffbdad)
    }
    Surface(
        modifier = Modifier.fillMaxWidth().shadow(8.dp, RoundedCornerShape(12.dp)),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, ScannerGold.copy(alpha = .38f)),
        color = Color(0xff211923),
    ) {
        Column(
            Modifier.background(Brush.verticalGradient(listOf(ScannerWine, Color(0xff211923))))
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(result.title, color = accent, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            Text(listOf(result.id, result.name).filter { it.isNotBlank() }.joinToString(" · "))
            if (result.pending) Text("Wait for the server receipt. Entry is not confirmed.", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = onDetails, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Text("View ticket and entry details")
            }
        }
    }
}

@Composable
private fun ScannerDetail(label: String, value: String) {
    if (value.isBlank()) return
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, color = ScannerGold, style = MaterialTheme.typography.labelMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Show only supplied fields from this authorized response; never invent missing details. */
@Composable
internal fun ClassicScanReceipt(result: ScanResult) {
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).testTagCompat("scanner-receipt-details"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ScannerDetail("Ticket ID", result.id)
        ScannerDetail("Name", result.name)
        Text(result.message.ifBlank {
            when {
                result.confirmed -> "Saved on the server. One entry only."
                result.code == "duplicate" -> "Already admitted. This verification did not create another entry."
                result.pending -> "Entry is not confirmed. Waiting for the server receipt."
                else -> "Ask the Help Desk to review this ticket."
            }
        })
        val record = result.record
        val source = record?.source.orEmpty()
        if (record?.hasValues == true || source.isNotBlank()) {
            HorizontalDivider(color = ScannerGold.copy(alpha = .3f))
            Text("Registration and payment", style = MaterialTheme.typography.titleMedium)
            if (result.pending) Text("These saved registration details do not confirm this attempt.", style = MaterialTheme.typography.bodySmall)
            if (record != null) {
                ScannerDetail("Amount (₹)", record.amount)
                ScannerDetail("Ticket quantity", record.quantity)
                ScannerDetail("Refund amount (₹)", record.refund)
                ScannerDetail("Payment result in registration", record.description)
                ScannerDetail("Ticket eligibility", when (record.eligible) {
                    true -> "Eligible in returned registration"
                    false -> "Blocked in returned registration"
                    null -> ""
                })
                ScannerDetail("Eligibility note", record.reason)
                ScannerDetail("Payment date and time", scannerTime(record.paymentAt))
                ScannerDetail("Payment method", record.paymentMethod)
                ScannerDetail("Payment reference", record.paymentReference)
            }
            ScannerDetail("Registration source", source)
        }
        val receipt = result.receipt
        if (receipt != null && receipt.hasScanDetails) {
            HorizontalDivider(color = ScannerGold.copy(alpha = .3f))
            Text(if (result.code == "duplicate") "Previous accepted entry" else "Accepted entry receipt", style = MaterialTheme.typography.titleMedium)
            ScannerDetail(if (receipt.correction) "Recorded by" else "Entry checked by", receipt.checker)
            ScannerDetail(receipt.timeLabel, scannerTime(receipt.time))
            ScannerDetail("Original scan observed", scannerTime(receipt.observedAt))
            if (receipt.seq > 0) ScannerDetail("Entry receipt number", receipt.seq.toString())
            ScannerDetail("Entry source", receipt.source)
            ScannerDetail("Entry note", receipt.note)
            if (receipt.correction) Text("Organizer-confirmed correction; the recorded time is not the physical entry time.")
        }
    }
}

private fun scannerTime(value: String): String =
    if (value.isBlank()) "" else displayTime(value).takeUnless { it == "Unknown" } ?: value
