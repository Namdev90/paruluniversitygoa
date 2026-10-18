package `in`.navrang.gate

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun ScannerScreen(s: GateState, vm: GateViewModel, exit: () -> Unit = { vm.navigate(Destination.Checker) }) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var exactIdOpen by remember(s.profile?.scope) { mutableStateOf(false) }
    var inspectedResult by remember(s.profile?.scope) { mutableStateOf<ScanResult?>(null) }
    LaunchedEffect(s.result, s.held) {
        // A required issue acknowledgement always takes priority over optional detail.
        if (s.held != null) inspectedResult = null
        else if (inspectedResult != null && inspectedResult?.id == s.result?.id)
            inspectedResult = s.result
    }
    BackHandler(enabled = exactIdOpen && s.held == null && inspectedResult == null) {
        exactIdOpen = false
    }
    if (inspectedResult != null && s.held == null) {
        val result = inspectedResult!!
        AlertDialog(
            onDismissRequest = { inspectedResult = null },
            title = { Text(result.title) },
            text = { ClassicScanReceipt(result) },
            confirmButton = {
                ClassicScannerButton(onClick = { inspectedResult = null }) { Text("Back to camera") }
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
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Camera access is needed to scan ticket QR codes.")
            Button(onClick = { request.launch(Manifest.permission.CAMERA) }) {
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
    var torchMode by remember { mutableIntStateOf(0) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var maxZoom by remember { mutableFloatStateOf(1f) }
    var status by remember { mutableStateOf("Center one QR · tap to focus") }
    val preview = remember {
        PreviewView(context).apply {
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
            scaleType = PreviewView.ScaleType.FILL_CENTER
        }
    }
    val held by rememberUpdatedState(s.held != null || s.profile?.canScan != true || exactIdOpen || inspectedResult != null)
    DisposableEffect(owner, preview) {
        val worker = Executors.newSingleThreadExecutor()
        val active = AtomicBoolean(true)
        val main = ContextCompat.getMainExecutor(context)
        val latch = ScanLatch()
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
                    var lastRead = 0L
                    var lastTorch = 0L
                    var lastZoom = 0L
                    var darkFrames = 0
                    var brightFrames = 0
                    var frameBytes = ByteArray(0)
                    analyzer.setAnalyzer(worker) { frame ->
                        try {
                            val now = SystemClock.elapsedRealtime()
                            if (!active.get() || held || now - last < 100) return@setAnalyzer
                            last = now
                            val plane = frame.planes[0]
                            val buffer = plane.buffer
                            val width = frame.width
                            val height = frame.height
                            if (frameBytes.size != width * height)
                                frameBytes = ByteArray(width * height)
                            val data = frameBytes
                            val base = buffer.position()
                            for (y in 0 until height) for (x in 0 until width) data[y * width + x] =
                                buffer.get(base + y * plane.rowStride + x * plane.pixelStride)
                            val found = QrCodec.inspect(data, width, height)
                            val fresh = latch.observe(found.value, now)
                            if (fresh && found.value != null) {
                                lastRead = now
                                main.execute {
                                    if (active.get() && !held) {
                                        GateFeedback.play(context, "scan")
                                        vm.scanned(found.value)
                                        status = "QR read · awaiting server confirmation"
                                    }
                                }
                            } else if (now - lastHint > 500) {
                                lastHint = now
                                val health = CameraHealth.measure(data, width, height)
                                darkFrames = if (health.dark()) darkFrames + 1 else 0
                                brightFrames = if (health.luminance > 165) brightFrames + 1 else 0
                                main.execute {
                                    if (active.get()) {
                                        val c = camera
                                        if (
                                            torchMode == 0 &&
                                                c?.cameraInfo?.hasFlashUnit() == true &&
                                                now - lastTorch > 5000
                                        ) {
                                            val next =
                                                if (darkFrames >= 3) true
                                                else if (brightFrames >= 5 && found.points == 0)
                                                    false
                                                else torch
                                            if (next != torch) {
                                                torch = next
                                                c.cameraControl.enableTorch(next)
                                                lastTorch = now
                                            }
                                        }
                                        status =
                                            when {
                                                health.dark() ->
                                                    if (torch)
                                                        "Low light · hold steady or increase ticket brightness"
                                                    else "Low light · automatic torch is available"
                                                found.points >= 2 &&
                                                    health.soft() &&
                                                    now - lastRead > 1600 -> {
                                                    c?.cameraControl?.startFocusAndMetering(
                                                        FocusMeteringAction.Builder(
                                                                preview.meteringPointFactory
                                                                    .createPoint(
                                                                        preview.width / 2f,
                                                                        preview.height / 2f,
                                                                    )
                                                            )
                                                            .build()
                                                    )
                                                    "Image may be soft · hold steady, clean lens or tap to focus"
                                                }
                                                found.points >= 2 &&
                                                    found.span > 0 &&
                                                    zoom < minOf(maxZoom, 1.8f) &&
                                                    found.span < minOf(width, height) * .24f &&
                                                    now - lastZoom > 2200 -> {
                                                    zoom = minOf(zoom + .25f, maxZoom, 1.8f)
                                                    c?.cameraControl?.setZoomRatio(zoom)
                                                    lastZoom = now
                                                    "Small QR · adjusting zoom. Keep the whole code visible"
                                                }
                                                else -> "Center one QR · avoid glare · tap to focus"
                                            }
                                        if (
                                            now - lastRead > 6000 &&
                                                now - lastZoom > 6000 &&
                                                torchMode == 0
                                        ) {
                                            zoom = 1f
                                            c?.cameraControl?.setZoomRatio(1f)
                                            lastZoom = now
                                        }
                                    }
                                }
                            }
                        } catch (_: Exception) {
                            main.execute {
                                if (active.get())
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
        onExactIdOpen = { exactIdOpen = it },
        onVerify = vm::submit,
        onDetails = { inspectedResult = it },
        status = when {
            exactIdOpen -> "Camera open · QR reading paused for exact ID"
            inspectedResult != null -> "Camera open · QR reading paused for details"
            else -> status
        },
        torchMode = torchMode,
        hasFlash = camera?.cameraInfo?.hasFlashUnit() == true,
        onTorch = {
            torchMode = (torchMode + 1) % 3
            torch = torchMode == 1
            camera?.cameraControl?.enableTorch(torch)
        },
        zoom = zoom,
        maxZoom = maxZoom,
        onZoom = {
            zoom = it
            camera?.cameraControl?.setZoomRatio(it)
        },
        onFocus = { point ->
            camera?.cameraControl?.startFocusAndMetering(
                FocusMeteringAction.Builder(preview.meteringPointFactory.createPoint(point.x, point.y)).build()
            )
            status = "Focusing · hold steady"
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
    torchMode: Int,
    hasFlash: Boolean,
    onTorch: () -> Unit,
    zoom: Float,
    maxZoom: Float,
    onZoom: (Float) -> Unit,
    onFocus: (Offset) -> Unit,
    previewContent: @Composable BoxScope.() -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val controlsHeight = maxHeight * (if (exactIdOpen) .7f else .55f)
        Column(Modifier.fillMaxSize()) {
            Box(
                Modifier.weight(1f).fillMaxWidth().background(Color.Black).pointerInput(onFocus) {
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
                        Text(status, Modifier.padding(12.dp))
                    }
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        // Size against space remaining below the status, never the whole screen.
                        if (!exactIdOpen && maxHeight >= 48.dp) {
                            val frameSize = minOf(220.dp, maxHeight * .85f, maxWidth * .75f)
                            Box(Modifier.align(Alignment.Center).size(frameSize)
                                .border(2.dp, Color.White, RoundedCornerShape(20.dp))
                                .testTagCompat("scanner-frame"))
                        }
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth()
                    .heightIn(max = controlsHeight)
                    .verticalScroll(rememberScrollState())
                    .padding(12.dp),
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
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ClassicScannerButton(
                        onClick = onTorch,
                        enabled = hasFlash,
                    ) {
                        Text(
                            when (torchMode) {
                                0 -> "Light: auto"
                                1 -> "Light: on"
                                else -> "Light: off"
                            }
                        )
                    }
                    ClassicScannerButton(
                        onClick = { onZoom(1f) }
                    ) {
                        Text("Reset zoom")
                    }
                    ClassicScannerButton(
                        onClick = { onExactIdOpen(!exactIdOpen) },
                        enabled = s.held == null,
                    ) { Text(if (exactIdOpen) "Hide ID" else "Find ID") }
                }
                if (maxZoom > 1f)
                    Slider(
                        value = zoom,
                        onValueChange = onZoom,
                        valueRange = 1f..minOf(maxZoom, 5f),
                    )
                Text(
                    "${s.pending} pending · ${if(s.online)"Connected"else"Offline — wait for confirmation"}",
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        }
    }
}
