package `in`.navrang.gate

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

/** The retained CameraX engine presented in the original burgundy/gold palette. */
class ClassicScannerActivity : ComponentActivity() {
    private val model: GateViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val state by model.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.ready, state.profile?.canScan) {
                if (state.ready && state.profile?.canScan == true) model.navigate(Destination.Scanner)
            }
            var confirmClose by remember { mutableStateOf(false) }
            val close = {
                if (state.held == null) {
                    if (state.pending > 0) confirmClose = true else finish()
                }
            }
            ClassicScannerTheme {
                Surface(Modifier.fillMaxSize()) {
                    BackHandler { close() }
                    Column(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
                        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Image(painterResource(R.drawable.app_icon), "Navrang", Modifier.size(44.dp))
                            Text("Navrang · live scanner", Modifier.weight(1f).padding(horizontal = 12.dp), style = MaterialTheme.typography.titleMedium)
                            TextButton(onClick = close, enabled = state.held == null) { Text("Close") }
                        }
                        if (state.ready && state.profile?.canScan == true) {
                            Box(Modifier.weight(1f)) { ScannerScreen(state, model, close) }
                        } else if (state.ready) {
                            Text("Scanner access changed. Return to your station.", Modifier.padding(24.dp))
                            Button(onClick = ::finish) { Text("Return to station") }
                        } else CircularProgressIndicator(Modifier.padding(24.dp))
                    }
                    state.held?.let { result ->
                        AlertDialog(
                            onDismissRequest = {}, title = { Text(result.title) },
                            text = { ClassicScanReceipt(result) },
                            confirmButton = {
                                Button(onClick = model::acknowledge) {
                                    Text(if (result.pending) "Acknowledge · still pending" else "Acknowledge")
                                }
                            }
                        )
                    }
                    if (confirmClose && state.held == null) AlertDialog(
                        onDismissRequest = { confirmClose = false },
                        title = { Text("Return to your station?") },
                        text = { Text("Unconfirmed scans remain pending. No entry is confirmed until the server responds. Keep the app open.") },
                        confirmButton = { TextButton(onClick = ::finish) { Text("Return to station") } },
                        dismissButton = { TextButton(onClick = { confirmClose = false }) { Text("Keep scanning open") } }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (model.state.value.profile?.canScan == true) model.navigate(Destination.Scanner)
        model.foreground(true)
    }
    override fun onPause() { model.foreground(false); super.onPause() }
}
