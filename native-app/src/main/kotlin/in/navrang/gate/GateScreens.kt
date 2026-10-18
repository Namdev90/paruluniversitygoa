@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package `in`.navrang.gate

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

@Composable
internal fun Pager(
    page: Int,
    pages: Int,
    total: Int,
    previous: () -> Unit,
    next: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(tonalElevation = 2.dp, modifier = modifier.fillMaxWidth().testTagCompat("pager")) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(onClick = previous, enabled = page > 0) { Text("Previous") }
            Text(
                "${page+1} / $pages · $total",
                style = MaterialTheme.typography.labelLarge,
                modifier =
                    Modifier.semantics {
                        contentDescription = "Page ${page+1} of $pages, $total results"
                    },
            )
            TextButton(onClick = next, enabled = page + 1 < pages) { Text("Next") }
        }
    }
}

@Composable
internal fun EmptyRows(text: String) {
    Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) { Text(text) }
}

@Composable
internal fun StudentsScreen(s: GateState, vm: GateViewModel) {
    val importer =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(), vm::readImport)
    val admitted = remember(s.entries) { s.entries.map { it.id }.toSet() }
    val rows =
        remember(s.tickets, s.entries, s.studentQuery, s.studentFilter) {
            s.tickets.filter { t ->
                (s.studentQuery.isBlank() ||
                    t.id.contains(s.studentQuery, true) ||
                    t.name.contains(s.studentQuery, true)) &&
                    when (s.studentFilter) {
                        "Eligible" -> t.eligible
                        "Blocked" -> !t.eligible
                        "Admitted" -> t.id in admitted
                        "No entry" -> t.eligible && t.id !in admitted
                        else -> true
                    }
            }
        }
    val page = s.studentPage.bounded(rows.size)
    val list = rememberLazyListState()
    LaunchedEffect(page.index, s.studentQuery, s.studentFilter) { list.scrollToItem(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 360.dp
        Column(Modifier.fillMaxSize()) {
            if (compact) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        s.studentQuery,
                        vm::studentSearch,
                        label = { Text("Students · search") },
                        singleLine = true,
                        modifier = Modifier.weight(1f).testTagCompat("student-search"),
                    )
                    var filtersOpen by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { filtersOpen = true }) {
                            Icon(Icons.Default.FilterList, "Filter students: ${s.studentFilter}")
                        }
                        DropdownMenu(filtersOpen, { filtersOpen = false }) {
                            listOf("All", "Eligible", "Blocked", "Admitted", "No entry").forEach {
                                filter ->
                                DropdownMenuItem(
                                    text = { Text(filter) },
                                    modifier =
                                        Modifier.semantics { selected = s.studentFilter == filter },
                                    onClick = {
                                        filtersOpen = false
                                        vm.studentFilter(filter)
                                    },
                                )
                            }
                        }
                    }
                    var actionsOpen by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { actionsOpen = true }) {
                            Icon(Icons.Default.MoreVert, "Registration actions")
                        }
                        DropdownMenu(actionsOpen, { actionsOpen = false }) {
                            DropdownMenuItem(
                                text = { Text("Add registration") },
                                onClick = {
                                    actionsOpen = false
                                    vm.openTicket(null)
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Import registrations") },
                                enabled = !s.busy,
                                onClick = {
                                    actionsOpen = false
                                    importer.launch(
                                        arrayOf(
                                            "text/csv",
                                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                        )
                                    )
                                },
                            )
                        }
                    }
                }
            } else {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Students",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleLarge,
                    )
                    TextButton(
                        onClick = {
                            importer.launch(
                                arrayOf(
                                    "text/csv",
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                )
                            )
                        },
                        enabled = !s.busy,
                    ) {
                        Text("Import")
                    }
                    TextButton(onClick = { vm.openTicket(null) }) { Text("Add") }
                }
                OutlinedTextField(
                    s.studentQuery,
                    vm::studentSearch,
                    label = { Text("Search name or ticket ID") },
                    singleLine = true,
                    modifier =
                        Modifier.fillMaxWidth()
                            .padding(horizontal = 16.dp)
                            .testTagCompat("student-search"),
                )
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(listOf("All", "Eligible", "Blocked", "Admitted", "No entry")) { filter ->
                        FilterChip(
                            s.studentFilter == filter,
                            { vm.studentFilter(filter) },
                            label = { Text(filter) },
                        )
                    }
                }
            }
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().testTagCompat("student-list"),
                state = list,
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (rows.isEmpty())
                    item {
                        EmptyRows(
                            if (s.online) "No matching registrations."
                            else "Waiting for authorized registration data. Refresh when connected."
                        )
                    }
                items(page.rows(rows), key = { it.id }) { t ->
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp)) {
                            Text(
                                t.name.ifBlank { "Name not supplied" },
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(t.id, style = MaterialTheme.typography.labelLarge)
                            Text(
                                if (t.id in admitted) "Admitted · no re-entry"
                                else if (t.eligible) "Eligible · no verified entry"
                                else "Blocked · ${t.reason}"
                            )
                            Text(
                                "Amount ₹${t.amount.ifBlank{"Unknown"}} · quantity ${t.quantity.ifBlank{"Unknown"}} · refund ₹${t.refund.ifBlank{"Unknown"}}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            TextButton(
                                onClick = { vm.inspectTicket(t) },
                                modifier =
                                    Modifier.semantics {
                                        contentDescription = "Details for registration ${t.id}"
                                    },
                            ) {
                                Text("Details")
                            }
                            TextButton(
                                onClick = { vm.openTicket(t) },
                                modifier =
                                    Modifier.semantics {
                                        contentDescription = "Edit registration ${t.id}"
                                    },
                            ) {
                                Text("Edit")
                            }
                        }
                    }
                }
            }
            Pager(
                page.index,
                page.pages(rows.size),
                rows.size,
                { vm.page(true, -1, rows.size) },
                { vm.page(true, 1, rows.size) },
            )
        }
    }
}

@Composable
internal fun EntriesScreen(s: GateState, vm: GateViewModel) {
    val rows =
        remember(s.entries, s.entryQuery) {
            s.entries.filter {
                listOf(it.id, it.name, it.checker, it.note).any { v ->
                    v.contains(s.entryQuery, true)
                }
            }
        }
    val page = s.entryPage.bounded(rows.size)
    val list = rememberLazyListState()
    LaunchedEffect(page.index, s.entryQuery) { list.scrollToItem(0) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val compact = maxHeight < 360.dp
        Column(Modifier.fillMaxSize()) {
            if (!compact)
                Text(
                    "Entry log",
                    Modifier.padding(horizontal = 16.dp),
                    style = MaterialTheme.typography.titleLarge,
                )
            Text(
                if (compact) "${s.entries.size} loaded / ${s.stats["admitted"]?:"unknown"} server"
                else
                    "${s.entries.size} receipts loaded · server total ${s.stats["admitted"]?:"unknown"}",
                Modifier.padding(horizontal = 16.dp).semantics {
                    contentDescription =
                        "${s.entries.size} receipts loaded · server total ${s.stats["admitted"]?:"unknown"}"
                },
                style = MaterialTheme.typography.labelMedium,
            )
            OutlinedTextField(
                s.entryQuery,
                vm::entrySearch,
                label = { Text(if (compact) "Entry log · search" else "Search receipts") },
                singleLine = true,
                modifier =
                    Modifier.fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = if (compact) 0.dp else 16.dp)
                        .testTagCompat("entry-search"),
            )
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth().testTagCompat("entry-list"),
                state = list,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (rows.isEmpty()) item { EmptyRows("No matching receipts loaded.") }
                items(page.rows(rows), key = { it.id }) { r ->
                    OutlinedCard(Modifier.fillMaxWidth()) {
                        Column(
                            Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(r.name, style = MaterialTheme.typography.titleMedium)
                            Text("${r.id} · ${r.checker}")
                            Text("${r.timeLabel}: ${displayTime(r.time)}")
                            if (r.correction) {
                                Text(
                                    "Admitted — registration data missing",
                                    style = MaterialTheme.typography.labelLarge,
                                )
                                Text("Physical entry time: unknown · payment verification: unknown")
                                if (r.observedAt.isNotBlank())
                                    Text("Observed scan: ${displayTime(r.observedAt)}")
                                if (r.note.isNotBlank()) Text(r.note)
                            }
                        }
                    }
                }
            }
            Pager(
                page.index,
                page.pages(rows.size),
                rows.size,
                { vm.page(false, -1, rows.size) },
                { vm.page(false, 1, rows.size) },
            )
        }
    }
}

@Composable
internal fun StaffScreen(s: GateState, vm: GateViewModel) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Staff access", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            Button(onClick = { vm.openStaff(null) }) { Text("Create code") }
        }
        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (s.staff.isEmpty()) item { EmptyRows("No staff loaded. Refresh to retry.") }
            items(s.staff, key = { it.id }) { r ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(r.name, style = MaterialTheme.typography.titleMedium)
                        Text(r.email.ifBlank { r.method })
                        Text(
                            "${if(r.active)"Active"else"Disabled / awaiting approval"} · ${r.station.ifBlank{"No station selected"}}"
                        )
                        if (r.requested.isNotBlank()) Text("Requested: ${r.requested}")
                        if (r.expiry.isNotBlank()) Text("Expires: ${displayTime(r.expiry)}")
                        Text("Confirmed entries: ${r.entries}")
                        TextButton(onClick = { vm.openStaff(r) }) { Text("Manage ${r.name}") }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SummaryScreen(stats: Map<String, String>, title: String) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text(title, style = MaterialTheme.typography.headlineMedium) }
        items(stats.toList(), key = { it.first }) { (key, value) ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(statLabel(key), Modifier.weight(1f))
                Text(if (key == "generatedAt") displayTime(value) else value)
            }
        }
        item {
            Text(
                "No verified entry does not establish absence. Organizer confirmations do not establish payment or an exact physical entry time."
            )
        }
    }
}

internal fun statLabel(key: String) =
    mapOf(
        "attended" to "Total admitted",
        "admitted" to "Total admitted",
        "registeredAttended" to "Registered admissions (excluding organizer confirmations)",
        "organizerConfirmed" to "Organizer-confirmed admissions",
        "noShow" to "Eligible with no verified entry",
        "serverIssues" to "Recorded issue attempts",
        "issueTickets" to "Tickets with issues",
        "lastMinute" to "Scanner admissions · last minute",
        "lastFiveMinutes" to "Scanner admissions · last five minutes",
    )[key] ?: key.replace(Regex("([a-z])([A-Z])"), "$1 $2").replaceFirstChar { it.uppercase() }

@Composable
internal fun DeskScreen(s: GateState, vm: GateViewModel) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Help Desk", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            Button(onClick = vm::newDesk, enabled = !s.pendingSave) { Text("New case") }
        }
        if (s.pendingSave)
            Button(
                onClick = { vm.openModal("deskForm") },
                modifier = Modifier.padding(horizontal = 16.dp),
            ) {
                Text("Resume unconfirmed save")
            }
        OutlinedTextField(
            s.deskQuery,
            vm::deskSearch,
            label = { Text("Search your authorized cases") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(listOf("all", "pending", "approved", "rejected")) { filter ->
                FilterChip(
                    s.deskFilter == filter,
                    { vm.deskFilter(filter) },
                    label = { Text(filter.replaceFirstChar { it.uppercase() }) },
                )
            }
        }
        Box(Modifier.height(4.dp).fillMaxWidth()) {
            if (s.deskLoading) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        if (s.deskError.isNotBlank())
            Text(s.deskError, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
        LazyColumn(
            Modifier.weight(1f),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (s.deskRows.isEmpty())
                item { EmptyRows(if (s.deskLoading) "Loading cases…" else "No matching cases.") }
            items(s.deskRows, key = { it.id }) { r ->
                OutlinedCard(modifier = Modifier.fillMaxWidth(), onClick = { vm.openCase(r) }) {
                    Column(Modifier.padding(16.dp)) {
                        Text(r.details.name, style = MaterialTheme.typography.titleMedium)
                        Text("${r.ticket} · ${r.status}")
                        Text(r.details.email)
                        Text("${r.details.phone} · quantity ${r.details.quantity}")
                        Text(
                            "Recorded by ${r.creator} · ${displayTime(r.created)}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        TextButton(onClick = { vm.openCase(r) }) { Text("View case") }
                    }
                }
            }
        }
        Pager(
            s.deskPage,
            maxOf(1, (s.deskTotal + 7) / 8),
            s.deskTotal,
            { vm.deskPage(-1) },
            { vm.deskPage(1) },
        )
    }
}

@Composable
internal fun ReportsScreen(s: GateState, vm: GateViewModel) {
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Text("Faculty reports", style = MaterialTheme.typography.headlineMedium)
            Text("Read-only server reports · ${s.profile?.name}")
        }
        if (s.reportError.isNotBlank())
            item {
                Text(s.reportError, color = MaterialTheme.colorScheme.error)
                Button(onClick = vm::loadReports) { Text("Retry reports") }
            }
        items(s.reportSummary.toList(), key = { "stat-" + it.first }) { (key, value) ->
            Row(Modifier.fillMaxWidth()) {
                Text(statLabel(key), Modifier.weight(1f))
                Text(if (key == "generatedAt") displayTime(value) else value)
            }
        }
        item {
            Text(
                "No verified entry does not prove absence. Corrections retain unknown payment and exact entry time."
            )
            Choice("Dataset", s.reportKind, ReportEncoder.kinds, vm::reportKind)
        }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { vm.prepareExport("csv") }, enabled = !s.busy) { Text("CSV") }
                Button(onClick = { vm.prepareExport("xlsx") }, enabled = !s.busy) { Text("Excel") }
                OutlinedButton(onClick = { vm.prepareExport("pdf") }, enabled = !s.busy) {
                    Text("PDF summary")
                }
                if (s.exportPreparing)
                    TextButton(onClick = vm::cancelExport) { Text("Cancel export") }
            }
            Text(
                "Documents are saved only to a location you choose. Saved copies cannot be retracted on access revocation."
            )
        }
        if (s.profile?.admin == true) {
            item {
                HorizontalDivider()
                Text("Faculty approvals", style = MaterialTheme.typography.titleLarge)
            }
            items(s.faculty, key = { "faculty-" + it.id }) { member ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp)) {
                        Text(member.name, style = MaterialTheme.typography.titleMedium)
                        Text(member.email)
                        Text(
                            if (member.requested) "Reporting access requested"
                            else if (member.enabled) "Reporting approved" else "No reporting access"
                        )
                        Button(
                            onClick = { vm.grantFaculty(member) },
                            enabled = !s.busy && (member.enabled || member.eligible),
                        ) {
                            Text(if (member.enabled) "Revoke reports" else "Approve reports")
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SettingsScreen(s: GateState, vm: GateViewModel, update: (String) -> Unit) {
    val context = LocalContext.current
    val notifications =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            vm.message(
                if (it) "Notifications enabled."
                else "Notifications remain off. You can change this in Android settings."
            )
        }
    val activity = LocalActivity.current
    var readiness by
        remember(activity) {
            mutableStateOf(activity?.let { GateReadiness.status(it).fields() } ?: emptyMap())
        }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(activity, lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME)
                readiness = activity?.let { GateReadiness.status(it).fields() } ?: emptyMap()
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text("Account and preferences", style = MaterialTheme.typography.headlineMedium)
            Text(s.profile?.name ?: "")
            Text("${s.profile?.method} · ${s.profile?.station?.ifBlank{"No station"}}")
            if (s.profile?.method == "google")
                TextButton(onClick = { vm.openModal("name") }) { Text("Edit real name") }
            OutlinedButton(onClick = { vm.openModal("signout") }) { Text("Sign out") }
        }
        item {
            Choice(
                "Appearance",
                s.appearance.mode,
                linkedMapOf("system" to "Follow system", "light" to "Light", "dark" to "Dark"),
            ) {
                vm.appearance(s.appearance.copy(mode = it))
            }
            Toggle(
                "Wallpaper colours (Android 12+)",
                s.appearance.dynamic,
                Build.VERSION.SDK_INT >= 31,
            ) {
                vm.appearance(s.appearance.copy(dynamic = it))
            }
            Toggle("Reduce motion", s.appearance.reducedMotion) {
                vm.appearance(s.appearance.copy(reducedMotion = it))
            }
        }
        item {
            Text("Scanner readiness", style = MaterialTheme.typography.titleLarge)
            Text(
                "Camera permission: ${readiness["camera"]} · vibration available: ${readiness["vibration"]}"
            )
            Text(
                "Admission sounds and vibration are enabled. Device policy may limit them. Volume keys control media; adaptive brightness affects this app window."
            )
            TextButton(
                onClick = {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:${context.packageName}"),
                        )
                    )
                }
            ) {
                Text("Open Android app settings")
            }
            TextButton(
                onClick = {
                    if (Build.VERSION.SDK_INT >= 33)
                        notifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    else if (Build.VERSION.SDK_INT >= 26)
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                        )
                    else
                        context.startActivity(
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:${context.packageName}"),
                            )
                        )
                }
            ) {
                Text("Notification controls")
            }
        }
        item {
            HorizontalDivider()
            Text("App updates", style = MaterialTheme.typography.titleLarge)
            Text("Installed ${s.update["currentVersion"]?:BuildConfig.VERSION_NAME}")
            Text(s.update["message"] ?: "Checking installation status…")
            if (s.update["downloading"] == "true")
                LinearProgressIndicator(
                    progress = {
                        ((s.update["progress"]?.toFloatOrNull() ?: 0f) / 100).coerceIn(0f, 1f)
                    },
                    modifier = Modifier.fillMaxWidth(),
                )
            Toggle("Automatic updates", s.update["automatic"] == "true", !BuildConfig.DEBUG) {
                update("auto")
            }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = { update("check") }) { Text("Check") }
                if (s.update["available"] == "true" && s.update["ready"] != "true")
                    Button(onClick = { update("download") }) { Text("Download") }
                if (s.update["ready"] == "true" || s.update["installing"] == "true")
                    Button(onClick = { update("install") }) { Text("Finish app update") }
            }
        }
        if (s.profile?.admin == true)
            item {
                HorizontalDivider()
                Button(onClick = { vm.prepareExport("csv", contacts = true) }, enabled = !s.busy) {
                    Text("College contacts CSV")
                }
                if (s.exportPreparing)
                    TextButton(onClick = vm::cancelExport) { Text("Cancel export") }
                TextButton(onClick = { vm.openModal("password") }) {
                    Text("Change administrator password")
                }
            }
        item {
            TextButton(onClick = { vm.openModal("licences") }) {
                Text("Third-party licences and artwork")
            }
            Text(
                "Navrang Gate · ${BuildConfig.VERSION_NAME}\nAuthentic event and university artwork. Audio: Kenney, CC0. QR decoding: ZXing, Apache 2.0. AndroidX and Kotlin: Apache 2.0.",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
internal fun Toggle(
    label: String,
    checked: Boolean,
    enabled: Boolean = true,
    change: (Boolean) -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(
            checked,
            change,
            enabled = enabled,
            modifier = Modifier.semantics { contentDescription = label },
        )
    }
}

@Composable
internal fun Choice(
    label: String,
    value: String,
    options: Map<String, String>,
    change: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Box {
            OutlinedButton(onClick = { open = true }) { Text(options[value] ?: value) }
            DropdownMenu(open, { open = false }) {
                options.forEach { (id, text) ->
                    DropdownMenuItem(
                        text = { Text(text) },
                        onClick = {
                            open = false
                            change(id)
                        },
                    )
                }
            }
        }
    }
}
