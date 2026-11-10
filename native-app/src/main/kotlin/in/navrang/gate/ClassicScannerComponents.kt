package `in`.navrang.gate

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

internal val ScannerGold = Color(0xffe5be7d)
internal val ScannerWine = Color(0xff402333)

/** The original fixed palette also covers dialogs; device dynamic colors are not applied. */
@Composable
internal fun ClassicScannerTheme(content: @Composable () -> Unit) {
    val typography = Typography()
    MaterialTheme(
        typography = typography.copy(
            headlineSmall = typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
            titleLarge = typography.titleLarge.copy(fontWeight = FontWeight.Bold),
            titleMedium = typography.titleMedium.copy(
                fontSize = 18.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold,
            ),
            labelLarge = typography.labelLarge.copy(fontWeight = FontWeight.SemiBold),
        ),
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


/** Raised rectangular controls match the classic host rather than default pill styling. */
@Composable
internal fun ClassicScannerButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    primary: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
    content: @Composable RowScope.() -> Unit,
) {
    val shape = RoundedCornerShape(12.dp)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val colors = if (primary) listOf(Color(0xffffe6b8), Color(0xffc99557))
                 else listOf(Color(0xff573449), Color(0xff291d2f))
    Button(
        onClick = onClick, enabled = enabled,
        interactionSource = interaction,
        modifier = modifier.heightIn(min = 48.dp).shadow(if (!enabled) 0.dp else if (pressed) 2.dp else 6.dp, shape)
            .background(Brush.verticalGradient(colors), shape),
        shape = shape, border = BorderStroke(1.dp, ScannerGold.copy(alpha = .5f)),
        colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent,
            contentColor = if (primary) Color(0xff201219) else ScannerGold,
            disabledContainerColor = Color(0xff211923), disabledContentColor = Color(0xff8c7c84)),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 0.dp, pressedElevation = 0.dp),
        contentPadding = contentPadding,
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
    var showInfo by remember(enabled) { mutableStateOf(false) }
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
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Find by ticket ID", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, color = ScannerGold)
            IconButton(onClick = { showInfo = true }, enabled = enabled, modifier = Modifier.size(48.dp)) {
                Icon(Icons.Outlined.Info, contentDescription = "About ticket verification", modifier = Modifier.size(17.dp), tint = ScannerGold)
            }
        }
        Text(
            "Verify entry records admission for an eligible ticket. Wait for a confirmed receipt.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text("Eight-character ticket ID", style = MaterialTheme.typography.labelLarge)
        BasicTextField(
            value = input,
            onValueChange = { input = it },
            singleLine = true,
            enabled = enabled,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Color(0xfff9e9dc)),
            cursorBrush = Brush.verticalGradient(listOf(ScannerGold, ScannerGold)),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { verify() }),
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)
                .background(Color(0xff100d15), RoundedCornerShape(12.dp))
                .border(1.dp, if (input.isNotBlank() && normalized == null) Color(0xffffbdad) else ScannerGold.copy(alpha = .65f), RoundedCornerShape(12.dp))
                .padding(14.dp).semantics { contentDescription = "Exact eight-character ticket ID" }
                .testTagCompat("scanner-exact-id"),
        )
        if (input.isNotBlank() && normalized == null) {
            Text("Use exactly eight ASCII letters or digits.", style = MaterialTheme.typography.bodySmall)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ClassicScannerButton(
                onClick = { verify() },
                primary = true,
                enabled = enabled && normalized != null,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text("Verify entry") }
            ClassicScannerButton(
                onClick = {
                    focus.clearFocus()
                    keyboard?.hide()
                    onClose()
                },
                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
            ) { Text(if (cameraAvailable) "Resume camera" else "Close ID entry") }
        }
    }
    if (showInfo) AlertDialog(
        onDismissRequest = { showInfo = false },
        title = { Text("About ticket verification") },
        text = {
            Text(if (cameraAvailable) "QR reading pauses while you type. Resume camera to scan again."
                 else "You can verify a ticket ID without camera access.")
        },
        confirmButton = { TextButton(onClick = { showInfo = false }) { Text("Done") } },
    )
}

@Composable
internal fun ClassicScanOutcomeCard(result: ScanResult, onDetails: () -> Unit) {
    val accent = when {
        result.confirmed -> Color(0xffbfe4c8)
        result.pending -> ScannerGold
        else -> Color(0xffffbdad)
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
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
            ClassicScannerButton(onClick = onDetails, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Text("Ticket details")
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
            ScannerDetail("Checker ID", receipt.checkerId)
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
