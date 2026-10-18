package `in`.navrang.gate

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun GateDialogs(s: GateState, vm: GateViewModel) {
    key(s.modal, s.selectedTicket?.id, s.selectedStaff?.id, s.selectedCase?.id) {
        when (s.modal) {
            "licences" -> {
                val context = LocalContext.current
                val notices by
                    produceState("Loading licences…") {
                        value =
                            withContext(Dispatchers.IO) {
                                context.assets.open("native-notices.txt").bufferedReader().use {
                                    it.readText()
                                }
                            }
                    }
                FormDialog("Third-party licences", false, vm::closeModal, {}, saveLabel = null) {
                    Text(notices)
                }
            }

            "import" ->
                AlertDialog(
                    onDismissRequest = vm::closeModal,
                    title = { Text("Replace registration list?") },
                    text = {
                        Text(
                            "${s.importCount} validated transaction records are ready in memory. This replaces the active imported registration list. Existing admissions and approved Help Desk registrations are retained. Verify this is the authorized current export."
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = vm::confirmImport, enabled = !s.busy) {
                            Text("Replace current list")
                        }
                    },
                    dismissButton = { TextButton(onClick = vm::closeModal) { Text("Cancel") } },
                )
            "signout" ->
                AlertDialog(
                    onDismissRequest = vm::closeModal,
                    title = { Text("Sign out?") },
                    text = {
                        Text(
                            if (s.pending > 0 || s.pendingSave)
                                "Unconfirmed requests and private drafts are only in memory. Confirm their server status before signing out. Signing out clears this device's pending work."
                            else
                                "Private lists, receipts, searches and drafts will be cleared from memory."
                        )
                    },
                    confirmButton = { TextButton(onClick = vm::signOut) { Text("Sign out") } },
                    dismissButton = {
                        TextButton(onClick = vm::closeModal) { Text("Keep working") }
                    },
                )
            "name" -> {
                var name by remember { mutableStateOf(s.profile?.name ?: "") }
                FormDialog("Your real name", s.busy, vm::closeModal, { vm.saveName(name) }) {
                    Field("Name", name, { name = it.take(40) })
                    Text(
                        "Use your own real name. Admission attribution remains attached to your account."
                    )
                }
            }
            "password" -> {
                var password by remember { mutableStateOf("") }
                var repeat by remember { mutableStateOf("") }
                FormDialog(
                    "Change administrator password",
                    s.busy,
                    vm::closeModal,
                    {
                        if (password == repeat) vm.changePassword(password)
                        else vm.message("Passwords do not match.")
                    },
                ) {
                    OutlinedTextField(
                        password,
                        { password = it },
                        label = { Text("New password · at least 12 characters") },
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    OutlinedTextField(
                        repeat,
                        { repeat = it },
                        label = { Text("Repeat password") },
                        visualTransformation = PasswordVisualTransformation(),
                    )
                    Text("Other administrator sessions will be signed out.")
                }
            }
            "exit" -> {
                val activity = LocalActivity.current
                AlertDialog(
                    onDismissRequest = vm::closeModal,
                    title = { Text("Unconfirmed work remains") },
                    text = {
                        Text(
                            "Pending admissions and drafts are only in memory. Keep this app open until their server status is confirmed. Closing the app may lose unconfirmed work if Android removes the process."
                        )
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                vm.closeModal()
                                activity?.finish()
                            }
                        ) {
                            Text("Close app")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = vm::closeModal) { Text("Keep working") }
                    },
                )
            }
            "studentDetails" ->
                s.selectedTicket?.let { ticket ->
                    val receipt = s.entries.firstOrNull { it.id == ticket.id }
                    FormDialog(
                        "Registration details",
                        s.busy,
                        vm::closeModal,
                        { vm.openTicket(ticket) },
                        "Edit",
                    ) {
                        Text(
                            ticket.name.ifBlank { "Name not supplied" },
                            style = MaterialTheme.typography.titleLarge,
                        )
                        Text(ticket.id)
                        Text(
                            if (ticket.eligible) "Eligible registration"
                            else "Blocked · ${ticket.reason}"
                        )
                        Text(
                            "Amount ₹${ticket.amount.ifBlank { "Unknown" }} · quantity ${ticket.quantity.ifBlank { "Unknown" }} · refund ₹${ticket.refund.ifBlank { "Unknown" }}"
                        )
                        Text(ticket.description)
                        if (receipt == null) Text("No verified entry loaded.")
                        else {
                            Text("Admitted · no re-entry")
                            Text(
                                "${receipt.checker} · ${receipt.timeLabel}: ${displayTime(receipt.time)}"
                            )
                            if (receipt.correction)
                                Text(
                                    "Organizer-confirmed · physical entry time and payment verification are unknown."
                                )
                            if (receipt.note.isNotBlank()) Text(receipt.note)
                        }
                    }
                }
            "ticket" -> {
                val t = s.selectedTicket
                var id by remember { mutableStateOf(t?.id ?: "") }
                var name by remember { mutableStateOf(t?.name ?: "") }
                var amount by remember { mutableStateOf(t?.amount ?: "") }
                var quantity by remember { mutableStateOf(t?.quantity ?: "1") }
                var refund by remember { mutableStateOf(t?.refund ?: "0") }
                var description by remember {
                    mutableStateOf(t?.description ?: "Transaction completed successfully")
                }
                FormDialog(
                    if (t == null) "Add registration" else "Edit ${t.id}",
                    s.busy,
                    vm::closeModal,
                    {
                        vm.saveTicket(
                            Ticket(id, name, false, "", amount, quantity, refund, description)
                        )
                    },
                ) {
                    Field("Ticket ID", id, { id = it.uppercase().take(8) }, t == null)
                    Field("Student name", name, { name = it })
                    Field("Amount ₹", amount, { amount = it })
                    Field("Quantity", quantity, { quantity = it })
                    Field("Refund ₹", refund, { refund = it })
                    Field("Payment result", description, { description = it })
                    Text(
                        "Server eligibility rules apply. This update does not admit a ticket or alter an existing receipt."
                    )
                }
            }
            "staff",
            "newStaff" -> {
                val staff = s.selectedStaff
                var name by remember { mutableStateOf(staff?.name ?: "") }
                var active by remember { mutableStateOf(staff?.active ?: true) }
                var role by remember {
                    mutableStateOf(
                        if (staff == null || staff.scanner && !staff.helpdesk) "checker"
                        else if (staff.helpdesk && !staff.scanner) "helpdesk"
                        else if (staff.scanner && staff.helpdesk) "both" else "none"
                    )
                }
                FormDialog(
                    if (staff == null) "Create staff code" else "Manage staff",
                    s.busy,
                    vm::closeModal,
                    {
                        if (active && role == "none")
                            vm.message("Assign a station or disable access.")
                        else vm.saveStaff(name, active, role)
                    },
                    saveLabel = if (s.staffCode.isNotBlank()) null else "Save",
                ) {
                    if (s.staffCode.isNotBlank()) {
                        Text("Code created", style = MaterialTheme.typography.titleMedium)
                        Text(s.staffCode, style = MaterialTheme.typography.headlineMedium)
                        Text(
                            "Give this code privately to the intended staff member. It will be cleared when this dialog closes."
                        )
                    } else {
                        Field("Real name", name, { name = it.take(40) })
                        Choice(
                            "Assignment",
                            role,
                            linkedMapOf(
                                "checker" to "Checker",
                                "helpdesk" to "Help Desk",
                                "both" to "Both stations",
                                "none" to "No station",
                            ),
                        ) {
                            role = it
                        }
                        if (staff != null) {
                            Toggle("Account active", active) { active = it }
                            Text(
                                "Saved station: ${staff.station.ifBlank{"Not selected"}}\nExpiry: ${displayTime(staff.expiry)}"
                            )
                        }
                        Text(
                            "The server decides access and station changes. Faculty approval is managed separately in reports."
                        )
                    }
                }
            }
            "deskForm" ->
                FormDialog(
                    if (s.editing == null) "New Help Desk case" else "Edit pending case",
                    s.busy,
                    { if (!s.pendingSave) vm.closeModal() },
                    vm::saveDesk,
                    if (s.pendingSave) "Retry same save" else "Save case",
                ) {
                    val d = s.draft
                    Field(
                        "Student name",
                        d.name,
                        { vm.draft(d.copy(name = it.take(128))) },
                        !s.pendingSave,
                    )
                    Field(
                        "Email",
                        d.email,
                        { vm.draft(d.copy(email = it.take(254))) },
                        !s.pendingSave,
                    )
                    Field(
                        "Mobile number",
                        d.phone,
                        { vm.draft(d.copy(phone = it.take(24))) },
                        !s.pendingSave,
                    )
                    Field(
                        "Quantity",
                        d.quantity,
                        { vm.draft(d.copy(quantity = it.take(2))) },
                        !s.pendingSave,
                    )
                    Text("Fee preview: ₹${(d.quantity.toIntOrNull()?:0)*100} · ₹100 per person")
                    Text(
                        if (s.pendingSave)
                            "Save is unconfirmed. Details and request ID are locked so retrying is safe. Do not assume the case was saved."
                        else
                            "Saving records a pending case. Payment and identity still require administrator verification."
                    )
                }
            "deskReview" ->
                s.selectedCase?.let { r ->
                    var verified by remember { mutableStateOf(false) }
                    FormDialog(
                        "${r.ticket} · ${r.status}",
                        s.busy,
                        vm::closeModal,
                        {},
                        saveLabel = null,
                    ) {
                        Text(r.details.name, style = MaterialTheme.typography.titleLarge)
                        Text(
                            "${r.details.email}\n${r.details.phone}\nQuantity ${r.details.quantity}\nVersion ${r.version}"
                        )
                        Text("Recorded by ${r.creator}\n${displayTime(r.created)}")
                        if (r.reviewed.isNotBlank())
                            Text("Reviewed by ${r.reviewer}\n${displayTime(r.reviewed)}")
                        if (s.profile?.admin == true && r.status == "pending") {
                            TextButton(onClick = { vm.editCase(r) }) {
                                Text("Edit pending details")
                            }
                            Toggle("I verified the same person and payment", verified) {
                                verified = it
                            }
                            Button(
                                onClick = { vm.reviewCase(true, verified) },
                                enabled = verified && !s.busy,
                            ) {
                                Text("Approve verified case")
                            }
                            OutlinedButton(
                                onClick = { vm.openModal("rejectCase") },
                                enabled = !s.busy,
                            ) {
                                Text("Reject case")
                            }
                        }
                    }
                }
            "rejectCase" ->
                AlertDialog(
                    onDismissRequest = vm::closeModal,
                    title = { Text("Reject this case?") },
                    text = {
                        Text(
                            "${s.selectedCase?.ticket} · ${s.selectedCase?.details?.name}\nThis decision is recorded in the server audit."
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { vm.reviewCase(false, false) }, enabled = !s.busy) {
                            Text("Confirm rejection")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { vm.openModal("deskReview") }) { Text("Back") }
                    },
                )
        }
    }
}

@Composable
private fun FormDialog(
    title: String,
    busy: Boolean,
    close: () -> Unit,
    save: () -> Unit,
    saveLabel: String? = "Save",
    content: @Composable ColumnScope.() -> Unit,
) {
    AlertDialog(
        onDismissRequest = close,
        title = { Text(title) },
        text = {
            Column(
                Modifier.fillMaxWidth()
                    .heightIn(max = 520.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                content = content,
            )
        },
        confirmButton = {
            if (saveLabel != null) Button(onClick = save, enabled = !busy) { Text(saveLabel) }
        },
        dismissButton = { TextButton(onClick = close, enabled = !busy) { Text("Close") } },
    )
}

@Composable
private fun Field(label: String, value: String, change: (String) -> Unit, enabled: Boolean = true) {
    OutlinedTextField(
        value,
        change,
        label = { Text(label) },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
    )
}
