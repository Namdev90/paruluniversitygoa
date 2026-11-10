package `in`.navrang.gate

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

@Composable
internal fun ScannerScreen(s: GateState, vm: GateViewModel, exit: () -> Unit = { vm.navigate(Destination.Checker) }) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val frameGate = remember { ScannerFrameGate() }
    val currentScope by rememberUpdatedState(s.profile?.scope)
    var exactIdOpen by remember(s.profile?.scope) { mutableStateOf(false) }
    var inspectedResult by remember(s.profile?.scope) { mutableStateOf<ScanResult?>(null) }
    LaunchedEffect(s.result, s.held) {
        // A required issue acknowledgement always takes priority over optional detail.
        if (s.held != null) inspectedResult = null
        else if (inspectedResult != null && inspectedResult?.id == s.result?.id)
            inspectedResult = s.result
    }
    BackHandler(enabled = exactIdOpen && s.held == null && inspectedResult == null) {
        frameGate.invalidate()
        exactIdOpen = false
    }
    if (inspectedResult != null && s.held == null) {
        val result = inspectedResult!!
        AlertDialog(
            onDismissRequest = { frameGate.invalidate(); inspectedResult = null },
            title = { Text(result.title) },
            text = { ClassicScanReceipt(result) },
            confirmButton = {
                ClassicScannerButton(onClick = { frameGate.invalidate(); inspectedResult = null }) { Text("Back to camera") }
            },
        )
    }
    var permission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED
        )
    }
    val request =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
            permission = it
        }
    if (!permission) {
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Allow camera access to scan QR codes, or use a ticket ID.")
            ClassicScannerButton(onClick = { request.launch(Manifest.permission.CAMERA) }, primary = true) {
                Text("Allow camera")
            }
            if (!exactIdOpen) ClassicScannerButton(onClick = { exactIdOpen = true }) {
                Text("Find by ticket ID")
            }
            s.result?.let { result ->
                ClassicScanOutcomeCard(result) { inspectedResult = result }
            }
            if (exactIdOpen) ScannerExactIdPanel(
                enabled = s.held == null && s.profile?.canScan == true,
                onVerify = vm::submit,
                onClose = { exactIdOpen = false },
                cameraAvailable = false,
            )
            ClassicScannerButton(onClick = exit, enabled = s.held == null) { Text("Return to station") }
        }
        return
    }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var torch by remember { mutableStateOf(false) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var maxZoom by remember { mutableFloatStateOf(1f) }
    var status by remember { mutableStateOf("Automatic camera · keep one whole QR visible") }
    val preview = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    val assist = remember { ScannerAssist() }
    val focusUntil = remember { AtomicLong(0) }
    val focusSequence = remember { AtomicLong(0) }
    val startFocus: (MeteringPoint) -> Unit = { point ->
        val c = camera
        val now = SystemClock.elapsedRealtime()
        if (c != null && now >= focusUntil.get()) {
            val action = FocusMeteringAction.Builder(point, FocusMeteringAction.FLAG_AF or FocusMeteringAction.FLAG_AE)
                .setAutoCancelDuration(3, TimeUnit.SECONDS).build()
            if (c.cameraInfo.isFocusMeteringSupported(action)) {
                val request = focusSequence.incrementAndGet()
                focusUntil.set(now + 4500)
                try {
                    c.cameraControl.startFocusAndMetering(action).addListener({
                        if (focusSequence.get() == request) focusUntil.set(0)
                    }, ContextCompat.getMainExecutor(context))
                } catch (_: Exception) { focusUntil.set(0) }
            }
        }
    }
    val held by rememberUpdatedState(s.held != null || s.profile?.canScan != true || exactIdOpen || inspectedResult != null)
    LaunchedEffect(held, camera, s.profile?.scope) {
        frameGate.invalidate()
        if (held) {
            assist.paused()
            torch = false
            camera?.cameraControl?.enableTorch(false)
            camera?.cameraControl?.cancelFocusAndMetering()
            focusSequence.incrementAndGet()
            focusUntil.set(0)
        }
    }
    DisposableEffect(owner, preview) {
        val worker = Executors.newSingleThreadExecutor()
        val active = AtomicBoolean(true)
        val foreground = AtomicBoolean(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))
        val lifecycleObserver = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                foreground.set(true)
            } else if (event == Lifecycle.Event.ON_PAUSE || event == Lifecycle.Event.ON_STOP) {
                foreground.set(false)
                frameGate.invalidate()
                assist.paused()
                torch = false
                camera?.cameraControl?.enableTorch(false)
                camera?.cameraControl?.cancelFocusAndMetering()
                focusSequence.incrementAndGet()
                focusUntil.set(0)
            }
        }
        owner.lifecycle.addObserver(lifecycleObserver)
        val main = ContextCompat.getMainExecutor(context)
        var provider: ProcessCameraProvider? = null
        val future = ProcessCameraProvider.getInstance(context)
        GateUpdater.scanActive = true
        future.addListener(
            {
                try {
                    if (!active.get()) return@addListener
                    provider = future.get()
                    val view =
                        Preview.Builder().build().also {
                            it.setSurfaceProvider(preview.surfaceProvider)
                        }
                    val analyzer =
                        ImageAnalysis.Builder()
                            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
                            .build()
                    var last = 0L
                    var lastHint = 0L
                    var frameBytes = ByteArray(0)
                    analyzer.setAnalyzer(worker) { frame ->
                        val now = SystemClock.elapsedRealtime()
                        val frameGeneration = frameGate.capture()
                        val frameScope = currentScope
                        try {
                            if (!active.get() || !foreground.get() || held || now - last < 100) return@setAnalyzer
                            last = now
                            val plane = frame.planes[0]
                            val width = frame.width
                            val height = frame.height
                            if (frameBytes.size != width * height)
                                frameBytes = ByteArray(width * height)
                            val data = frameBytes
                            ScannerQrReader.copyLuminance(plane.buffer, width, height, plane.rowStride, plane.pixelStride, data)
                            val found = ScannerQrReader.inspect(data, width, height)
                            if (frameScope != currentScope || !frameGate.accepts(frameGeneration, now, SystemClock.elapsedRealtime(), active.get(), foreground.get(), held)) return@setAnalyzer
                            val health = if (now - lastHint > 500 && found.value == null) {
                                lastHint = now
                                CameraHealth.measure(data, width, height)
                            } else null
                            main.execute {
                                // Final authorization/freshness gate precedes latch observation.
                                // Delivered QR values stay latched across acknowledgement/resume.
                                if (frameScope == currentScope && frameGate.accepts(frameGeneration, now, SystemClock.elapsedRealtime(), active.get(), foreground.get(), held)) {
                                    val fresh = frameGate.observeRead(frameGeneration, now, SystemClock.elapsedRealtime(), active.get(), foreground.get(), held, found.value)
                                    if (fresh && found.value != null) {
                                        assist.read(now)
                                        GateFeedback.play(context, "scan")
                                        vm.scanned(found.value)
                                        status = "QR read · awaiting server confirmation"
                                    } else if (health != null) {
                                        val c = camera
                                        val decision = assist.inspect(
                                            now, true, health.dark(), health.luminance > 165, health.soft(),
                                            found, zoom, maxZoom, torch, true,
                                            c?.cameraInfo?.hasFlashUnit() == true, now < focusUntil.get(),
                                        )
                                        if (decision.torch >= 0) {
                                            torch = decision.torch == 1
                                            c?.cameraControl?.enableTorch(torch)
                                        }
                                        if (decision.focus && c != null) {
                                            // Raw ImageAnalysis coordinates: CameraX handles the surface
                                            // aspect ratio, so off-centre focus does not guess screen rotation.
                                            val point = SurfaceOrientedMeteringPointFactory(width.toFloat(), height.toFloat(), analyzer)
                                                .createPoint(decision.focusX * width, decision.focusY * height)
                                            startFocus(point)
                                        }
                                        if (decision.zoom > 0) {
                                            zoom = decision.zoom
                                            c?.cameraControl?.setZoomRatio(zoom)
                                        }
                                        if (decision.hint.isNotBlank()) status = decision.hint
                                    }
                                }
                            }
                        } catch (_: Exception) {
                            main.execute {
                                if (frameScope == currentScope && frameGate.accepts(frameGeneration, now, SystemClock.elapsedRealtime(), active.get(), foreground.get(), held))
                                    status = "Could not read frame. Hold steady or use exact ID."
                            }
                        } finally {
                            frame.close()
                        }
                    }
                    camera =
                        provider!!.bindToLifecycle(
                            owner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            view,
                            analyzer,
                        )
                    maxZoom = camera?.cameraInfo?.zoomState?.value?.maxZoomRatio ?: 1f
                } catch (_: Exception) {
                    if (active.get())
                        status =
                            "Camera unavailable. Close other camera apps or use exact ticket ID."
                }
            },
            main,
        )
        onDispose {
            active.set(false)
            frameGate.invalidate()
            foreground.set(false)
            owner.lifecycle.removeObserver(lifecycleObserver)
            assist.paused()
            focusSequence.incrementAndGet()
            focusUntil.set(0)
            GateUpdater.scanActive = false
            camera?.cameraControl?.enableTorch(false)
            provider?.unbindAll()
            worker.shutdown()
            camera = null
        }
    }
    ClassicScannerCameraLayout(
        s = s,
        exactIdOpen = exactIdOpen,
        onExactIdOpen = { frameGate.invalidate(); exactIdOpen = it },
        onVerify = vm::submit,
        onDetails = { frameGate.invalidate(); inspectedResult = it },
        status = when {
            exactIdOpen -> "QR reading paused · ticket ID"
            inspectedResult != null -> "Camera open · QR reading paused for details"
            else -> status
        },
        onFocus = { point ->
            if (!held && owner.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                assist.manualFocus(SystemClock.elapsedRealtime())
                startFocus(preview.meteringPointFactory.createPoint(point.x, point.y))
                status = "Focusing · hold steady"
            }
        },
        previewContent = { AndroidView(factory = { preview }, modifier = Modifier.fillMaxSize()) },
    )
}

/** The real scanner layout is also rendered with a clearly synthetic preview in UI tests. */
@Composable
internal fun ClassicScannerCameraLayout(
    s: GateState,
    exactIdOpen: Boolean,
    onExactIdOpen: (Boolean) -> Unit,
    onVerify: (String) -> Unit,
    onDetails: (ScanResult) -> Unit,
    status: String,
    onFocus: (Offset) -> Unit,
    previewContent: @Composable BoxScope.() -> Unit,
) {
    Layout(
        modifier = Modifier.fillMaxSize(),
        content = {
            Box(
                Modifier.background(Color.Black).pointerInput(onFocus) {
                    detectTapGestures { point -> onFocus(point) }
                }
            ) {
                previewContent()
                Column(Modifier.fillMaxSize()) {
                    Surface(
                        color = Color.Black.copy(alpha = .72f),
                        contentColor = Color.White,
                        modifier = Modifier.fillMaxWidth().testTagCompat("scanner-status"),
                    ) {
                        Text(status, Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        // Size against space remaining below the status, never the whole screen.
                        if (!exactIdOpen && maxHeight >= 48.dp) {
                            val frameSize = minOf(220.dp, maxHeight * .85f, maxWidth * .75f)
                            Box(Modifier.align(Alignment.Center).size(frameSize)
                                .border(2.dp, ScannerGold, RoundedCornerShape(20.dp))
                                .testTagCompat("scanner-frame")) {
                                if (s.held == null && s.result == null && !s.appearance.reducedMotion) ScannerSweep()
                            }
                        }
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                s.result?.let { result ->
                    ClassicScanOutcomeCard(result) { onDetails(result) }
                }
                if (exactIdOpen) ScannerExactIdPanel(
                    enabled = s.held == null && s.profile?.canScan == true,
                    onVerify = onVerify,
                    onClose = { onExactIdOpen(false) },
                )
                if (!exactIdOpen) ClassicScannerButton(
                    onClick = { onExactIdOpen(true) },
                    enabled = s.held == null,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Find ID") }
                Text(
                    "${s.pending} pending · ${if(s.online)"Connected"else"Offline — wait for confirmation"}",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        },
    ) { (preview, controls), bounds ->
        // Remeasure the same preview and controls when the window resizes.
        val width = bounds.maxWidth
        val height = bounds.maxHeight
        val sideBySide = width >= 560.dp.roundToPx() && width > height
        val controlsWidth = if (sideBySide) minOf(width / 2, 360.dp.roundToPx())
            else minOf(width, 520.dp.roundToPx())
        val controlsHeight = if (sideBySide) height else minOf(
            height,
            maxOf(48.dp.roundToPx(), (height * (if (exactIdOpen) .7f else .55f)).toInt()),
        )
        val panel = controls.measure(
            Constraints(minWidth = controlsWidth, maxWidth = controlsWidth, maxHeight = controlsHeight),
        )
        val camera = if (sideBySide) preview.measure(Constraints.fixed(width - panel.width, height))
            else preview.measure(Constraints.fixed(width, height - panel.height))
        layout(width, height) {
            camera.placeRelative(0, 0)
            if (sideBySide) panel.placeRelative(camera.width, 0)
            else panel.placeRelative((width - panel.width) / 2, camera.height)
        }
    }
}

@Composable
private fun BoxScope.ScannerSweep() {
    val context = LocalContext.current
    val motionEnabled = remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) > 0f
    }
    if (!motionEnabled) return
    val transition = rememberInfiniteTransition(label = "Scanner sweep")
    val position by transition.animateFloat(
        .12f, .88f,
        infiniteRepeatable(tween(1800, easing = EaseInOutSine), RepeatMode.Reverse),
        label = "Sweep position",
    )
    val brush = remember {
        Brush.horizontalGradient(listOf(Color.Transparent, ScannerGold.copy(alpha = .7f), Color.Transparent))
    }
    Canvas(Modifier.matchParentSize().testTagCompat("scanner-sweep")) {
        val y = size.height * position
        drawLine(
            brush,
            Offset(0f, y), Offset(size.width, y), strokeWidth = 2.dp.toPx(),
        )
    }
}
