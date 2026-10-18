@file:OptIn(
    androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class,
)

package `in`.navrang.gate

import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.adaptive.currentWindowAdaptiveInfo
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.*
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import kotlinx.coroutines.delay

private val Wine = Color(0xff702449)
private val Gold = Color(0xff76551b)

@Composable
fun NavrangTheme(appearance: Appearance, content: @Composable () -> Unit) {
    val dark =
        when (appearance.mode) {
            "dark" -> true
            "light" -> false
            else -> isSystemInDarkTheme()
        }
    val context = LocalContext.current
    val colors =
        if (appearance.dynamic && Build.VERSION.SDK_INT >= 31) {
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        } else if (dark)
            darkColorScheme(
                primary = Color(0xffffb1d0),
                secondary = Color(0xffedc477),
                background = Color(0xff191116),
                surface = Color(0xff21191e),
            )
        else
            lightColorScheme(
                primary = Wine,
                secondary = Gold,
                background = Color(0xfffff8f8),
                surface = Color(0xfffff8f8),
            )
    MaterialTheme(
        colorScheme = colors,
        shapes =
            Shapes(
                small = RoundedCornerShape(12.dp),
                medium = RoundedCornerShape(20.dp),
                large = RoundedCornerShape(28.dp),
            ),
        content = content,
    )
}

@Composable
fun GateApp(
    vm: GateViewModel,
    google: () -> Unit,
    browser: () -> Unit,
    pickExport: () -> Unit,
    update: (String) -> Unit,
) {
    val s by vm.state.collectAsStateWithLifecycle()
    NavrangTheme(s.appearance) {
        Surface(Modifier.fillMaxSize()) {
            key(s.profile?.scope) {
                if (!s.ready)
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                else if (s.intro) Intro(s.appearance.reducedMotion, vm::endIntro)
                else {
                    LaunchedEffect(s.exportReady) { if (s.exportReady) pickExport() }
                    BackHandler(s.modal.isNotEmpty()) {
                        if (!s.pendingSave) vm.closeModal()
                        else vm.message("The save is unconfirmed. Retry this same request.")
                    }
                    BackHandler(
                        s.profile != null &&
                            s.modal.isEmpty() &&
                            s.destination != Destination.Station
                    ) {
                        vm.navigate(
                            if (s.destination == Destination.Scanner) Destination.Checker
                            else Destination.Station
                        )
                    }
                    BackHandler(
                        s.profile != null &&
                            s.modal.isEmpty() &&
                            s.destination == Destination.Station &&
                            (s.pending > 0 || s.pendingSave)
                    ) {
                        vm.openModal("exit")
                    }
                    val snackbars = remember { SnackbarHostState() }
                    LaunchedEffect(s.message) {
                        if (s.message.isNotBlank()) {
                            snackbars.showSnackbar(
                                s.message,
                                actionLabel = "Dismiss",
                                duration = SnackbarDuration.Long,
                            )
                            if (vm.state.value.message == s.message) vm.clearMessage()
                        }
                    }
                    val destinations = destinations(s.profile)
                    BoxWithConstraints(Modifier.fillMaxSize()) {
                        val wide =
                            currentWindowAdaptiveInfo()
                                .windowSizeClass
                                .isWidthAtLeastBreakpoint(840) ||
                                (maxWidth >= 600.dp && maxHeight < 480.dp)
                        Row(Modifier.fillMaxSize()) {
                            if (wide && s.profile != null)
                                NavigationRail(
                                    Modifier.fillMaxHeight().verticalScroll(rememberScrollState())
                                ) {
                                    destinations.forEach { d ->
                                        NavigationRailItem(
                                            selected = s.destination == d,
                                            onClick = { vm.navigate(d) },
                                            icon = { Text(d.label.take(1)) },
                                            label = { Text(d.label) },
                                        )
                                    }
                                }
                            Scaffold(
                                modifier = Modifier.weight(1f),
                                topBar = {
                                    Column {
                                        TopAppBar(
                                            title = {
                                                Text("Navrang Gate", fontWeight = FontWeight.Bold)
                                            },
                                            actions = {
                                                if (s.profile != null)
                                                    TextButton(
                                                        onClick = vm::refresh,
                                                        enabled = !s.busy,
                                                    ) {
                                                        Text("Refresh")
                                                    }
                                            },
                                        )
                                        if (s.profile != null) {
                                            Text(
                                                "${s.profile?.name} · ${if(s.online)"Connected" else "Connecting / offline"} · ${s.pending} pending",
                                                Modifier.padding(
                                                    horizontal = 16.dp,
                                                    vertical = 4.dp,
                                                ),
                                                style = MaterialTheme.typography.labelMedium,
                                            )
                                            if (!wide)
                                                LazyRow(
                                                    Modifier.fillMaxWidth()
                                                        .testTagCompat("navigation"),
                                                    contentPadding =
                                                        PaddingValues(horizontal = 12.dp),
                                                    horizontalArrangement =
                                                        Arrangement.spacedBy(8.dp),
                                                ) {
                                                    items(destinations, key = { it.name }) { d ->
                                                        FilterChip(
                                                            selected = s.destination == d,
                                                            onClick = { vm.navigate(d) },
                                                            label = { Text(d.label) },
                                                        )
                                                    }
                                                }
                                        }
                                        Box(Modifier.height(4.dp).fillMaxWidth()) {
                                            if (s.busy)
                                                LinearProgressIndicator(Modifier.fillMaxWidth())
                                        }
                                    }
                                },
                                bottomBar = {
                                    if (s.profile != null && !wide)
                                        Surface(tonalElevation = 3.dp) {
                                            Row(
                                                Modifier.fillMaxWidth()
                                                    .navigationBarsPadding()
                                                    .padding(horizontal = 16.dp),
                                                horizontalArrangement = Arrangement.SpaceBetween,
                                                verticalAlignment = Alignment.CenterVertically,
                                            ) {
                                                Text(
                                                    s.destination.label,
                                                    style = MaterialTheme.typography.labelLarge,
                                                )
                                                TextButton(
                                                    onClick = { vm.navigate(Destination.Settings) }
                                                ) {
                                                    Text("Account")
                                                }
                                            }
                                        }
                                },
                                snackbarHost = { SnackbarHost(snackbars) },
                            ) { padding ->
                                Column(Modifier.padding(padding).imePadding().fillMaxSize()) {
                                    if (s.profile == null)
                                        LoginScreen(s.busy, google, browser, vm::login)
                                    else NativeDestinations(s, vm, update)
                                }
                            }
                        }
                    }
                    GateDialogs(s, vm)
                    s.held?.let { result ->
                        AlertDialog(
                            onDismissRequest = {},
                            title = { Text(result.title) },
                            text = { ReceiptText(result) },
                            confirmButton = {
                                Button(onClick = vm::acknowledge) {
                                    Text(
                                        if (result.pending) "Acknowledge · still pending"
                                        else "Acknowledge"
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

private fun destinations(p: Profile?): List<Destination> {
    if (p == null) return emptyList()
    return buildList {
        add(Destination.Station)
        if (p.canScan) add(Destination.Checker)
        if (p.admin)
            addAll(
                listOf(
                    Destination.Students,
                    Destination.Entries,
                    Destination.Staff,
                    Destination.Summary,
                )
            )
        if (p.canDesk) add(Destination.Desk)
        if (p.canReport) add(Destination.Reports)
    }
}

@Composable
fun BrandMarks() {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(color = Color(0xfffcf3e0), shape = RoundedCornerShape(16.dp)) {
            Image(
                painterResource(R.drawable.navrang_wordmark),
                "Navrang event",
                Modifier.widthIn(max = 300.dp).fillMaxWidth().height(110.dp).padding(10.dp),
            )
        }
        Surface(color = Color(0xff20241f)) {
            Image(
                painterResource(R.drawable.parul_line),
                "Parul University Goa",
                Modifier.widthIn(max = 300.dp).fillMaxWidth().height(55.dp).padding(8.dp),
            )
        }
    }
}

@Composable
private fun Intro(reduced: Boolean, done: () -> Unit) {
    val context = LocalContext.current
    val noMotion =
        reduced ||
            Settings.Global.getFloat(
                context.contentResolver,
                Settings.Global.ANIMATOR_DURATION_SCALE,
                1f,
            ) == 0f
    LaunchedEffect(Unit) {
        GateFeedback.play(context, "intro")
        delay(if (noMotion) 1200 else 4500)
        done()
    }
    DisposableEffect(Unit) { onDispose { GateFeedback.play(context, "stop-intro") } }
    val transition = rememberInfiniteTransition(label = "Dancers")
    val sway by
        transition.animateFloat(
            -5f,
            5f,
            infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
            label = "Gentle sway",
        )
    Column(
        Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        BrandMarks()
        Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
            Image(
                painterResource(R.drawable.dancer_female),
                null,
                Modifier.weight(1f).graphicsLayer { rotationZ = if (noMotion) 0f else sway },
            )
            Image(
                painterResource(R.drawable.dancer_male),
                null,
                Modifier.weight(1f).graphicsLayer { rotationZ = if (noMotion) 0f else -sway },
            )
        }
        Text("Welcome to Navrang", style = MaterialTheme.typography.headlineMedium)
        TextButton(onClick = done) { Text("Skip") }
    }
}

@Composable
private fun LoginScreen(
    busy: Boolean,
    google: () -> Unit,
    browser: () -> Unit,
    login: (String, org.json.JSONObject) -> Unit,
) {
    var mode by remember { mutableStateOf("Google") }
    var secret by remember { mutableStateOf("") }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { BrandMarks() }
        item { Text("Your station starts here", style = MaterialTheme.typography.headlineMedium) }
        item { Text("Checker · Help Desk · Faculty", style = MaterialTheme.typography.titleMedium) }
        item {
            OutlinedButton(
                onClick = google,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                colors =
                    ButtonDefaults.outlinedButtonColors(
                        containerColor = Color.White,
                        contentColor = Color(0xff1f1f1f),
                    ),
            ) {
                Image(painterResource(R.drawable.google_g), null, Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Text("Continue with Google")
            }
        }
        item {
            TextButton(onClick = browser, enabled = !busy) { Text("Use Google sign-in in browser") }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    mode == "Code",
                    {
                        mode = "Code"
                        secret = ""
                    },
                    label = { Text("Assigned staff code") },
                )
                FilterChip(
                    mode == "Admin",
                    {
                        mode = "Admin"
                        secret = ""
                    },
                    label = { Text("Administrator") },
                )
            }
        }
        if (mode != "Google") {
            item {
                Text(
                    if (mode == "Admin") "Administrator access" else "Staff code sign-in",
                    style = MaterialTheme.typography.titleLarge,
                )
                OutlinedTextField(
                    secret,
                    { secret = it },
                    label = {
                        Text(if (mode == "Admin") "Administrator password" else "Assigned code")
                    },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Button(
                    enabled = !busy && secret.isNotBlank(),
                    onClick = {
                        login(
                            if (mode == "Admin") "login" else "checker-login",
                            json(
                                (if (mode == "Admin") "password" else "code") to secret,
                                "username" to if (mode == "Admin") "namdev" else "",
                            ),
                        )
                        secret = ""
                    },
                ) {
                    Text("Sign in")
                }
            }
        }
        item {
            Text(
                "Google sign-in identifies your account. Station and reporting access require administrator approval.",
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
}

@Composable
private fun StationScreen(s: GateState, vm: GateViewModel) {
    val p = s.profile ?: return
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text("Choose your station", style = MaterialTheme.typography.headlineMedium)
            Text("${p.name} · ${p.method}")
        }
        if (!p.nameConfirmed)
            item {
                Text("Save your real name before requesting access.")
                Button(onClick = { vm.openModal("name") }) { Text("Save real name") }
            }
        item {
            Text(
                if (p.active) "Account active"
                else "Access pending, suspended or expired — administrator approval is required."
            )
            if (p.expiresAt.isNotBlank()) Text("Access expiry: ${displayTime(p.expiresAt)}")
            if (p.station.isNotBlank())
                Text("Saved station: ${p.station}. Only an administrator can change it.")
        }
        items(listOf("checker" to "Checker", "helpdesk" to "Help Desk")) { (id, label) ->
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    Text(label, style = MaterialTheme.typography.titleLarge)
                    Text(
                        if (id == "checker") "Verify one admission per ticket."
                        else "Record and review registration cases."
                    )
                    Button(
                        onClick = {
                            if (id == "checker" && p.canScan) vm.navigate(Destination.Checker)
                            else if (id == "helpdesk" && p.canDesk) vm.navigate(Destination.Desk)
                            else vm.station(id)
                        },
                        enabled =
                            !s.busy &&
                                p.nameConfirmed &&
                                (p.admin || p.station.isBlank() || p.station == id),
                    ) {
                        Text(
                            if ((id == "checker" && p.canScan) || (id == "helpdesk" && p.canDesk))
                                "Open $label"
                            else "Request $label"
                        )
                    }
                }
            }
        }
        item {
            ElevatedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(20.dp)) {
                    Text("Faculty", style = MaterialTheme.typography.titleLarge)
                    Text("Approved read-only reports and downloads.")
                    Button(
                        onClick = {
                            if (p.canReport) vm.navigate(Destination.Reports)
                            else vm.requestFaculty()
                        },
                        enabled =
                            !s.busy && p.nameConfirmed && (!p.reportsRequested || p.canReport),
                    ) {
                        Text(
                            if (p.canReport) "Open reports"
                            else if (p.reportsRequested) "Approval requested"
                            else "Request faculty access"
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ReceiptText(r: ScanResult) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (r.id.isNotEmpty()) Text(r.id, style = MaterialTheme.typography.titleMedium)
        if (r.name.isNotBlank()) Text(r.name)
        Text(
            r.message.ifBlank {
                if (r.confirmed) "Saved on the server. One entry only."
                else if (r.code == "duplicate") "Already admitted. No re-entry."
                else if (r.pending) "Do not assume admission. Waiting for the server receipt."
                else "Ask the Help Desk to review this ticket."
            }
        )
        r.receipt?.let {
            Text("${it.checker} · ${it.timeLabel}: ${displayTime(it.time)}")
            if (it.correction)
                Text("Exact physical entry time and payment verification are unknown.")
        }
    }
}

@Composable
private fun CheckerScreen(s: GateState, vm: GateViewModel) {
    var id by remember { mutableStateOf("") }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item {
            Text("Ready at the gate", style = MaterialTheme.typography.headlineMedium)
            Text(
                "My scans: ${s.stats["ownScans"]?:"—"} · Total entries: ${(s.stats["totalEntries"]?:s.stats["admitted"])?:"—"}"
            )
        }
        item {
            Button(
                onClick = { vm.navigate(Destination.Scanner) },
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            ) {
                Text("Open scanner")
            }
        }
        item {
            OutlinedTextField(
                id,
                { id = it.take(8) },
                label = { Text("Exact ticket ID") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    vm.submit(id)
                    id = ""
                },
                enabled = id.length == 8 && s.held == null,
            ) {
                Text("Verify entry")
            }
        }
        item {
            Text(
                "Only a confirmed server receipt permits entry. Pending requests retry safely with their original request ID."
            )
        }
        s.result?.let { r -> item { OutcomeCard(r) } }
    }
}

@Composable
fun OutcomeCard(r: ScanResult) {
    val color =
        when {
            r.confirmed -> Color(0xffc8efd5)
            r.pending -> Color(0xffffe4a3)
            else -> MaterialTheme.colorScheme.errorContainer
        }
    Card(
        colors = CardDefaults.cardColors(containerColor = color, contentColor = Color(0xff211d20)),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                r.title,
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            ReceiptText(r)
        }
    }
}

internal fun Modifier.testTagCompat(tag: String) = this.then(Modifier.semantics { testTag = tag })

@Composable
private fun NativeDestinations(s: GateState, vm: GateViewModel, update: (String) -> Unit) {
    val controller = rememberNavController()
    LaunchedEffect(s.destination) {
        controller.navigate(s.destination.name) {
            popUpTo(controller.graph.startDestinationId)
            launchSingleTop = true
        }
    }
    NavHost(
        controller,
        startDestination = Destination.Station.name,
        modifier = Modifier.fillMaxSize(),
        enterTransition = { androidx.compose.animation.EnterTransition.None },
        exitTransition = { androidx.compose.animation.ExitTransition.None },
    ) {
        Destination.entries.forEach { destination ->
            composable(destination.name) {
                if (destination == s.destination)
                    when (destination) {
                        Destination.Station -> StationScreen(s, vm)
                        Destination.Checker -> CheckerScreen(s, vm)
                        Destination.Scanner -> ScannerScreen(s, vm)
                        Destination.Students -> StudentsScreen(s, vm)
                        Destination.Entries -> EntriesScreen(s, vm)
                        Destination.Staff -> StaffScreen(s, vm)
                        Destination.Summary -> SummaryScreen(s.stats, "Live gate summary")
                        Destination.Desk -> DeskScreen(s, vm)
                        Destination.Reports -> ReportsScreen(s, vm)
                        Destination.Settings -> SettingsScreen(s, vm, update)
                    }
            }
        }
    }
}
