package `in`.navrang.gate

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h800dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ClassicScannerUiTest {
    @get:Rule val compose = createComposeRule()

    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(250)
        val dir = java.io.File(requireNotNull(System.getProperty("navrang.screenshot.dir")))
        dir.mkdirs()
        java.io.File(dir, "$name.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test fun exactIdVerifiesExplicitlyWithoutCallingCloseAndRejectsLongPaste() {
        val submitted = mutableListOf<String>()
        var closed = 0
        compose.setContent {
            ClassicScannerTheme {
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(16.dp)) {
                        ScannerExactIdPanel(true, { submitted += it }, { closed++ })
                    }
                }
            }
        }
        compose.onNodeWithText("Verify entry").assertIsNotEnabled()
        compose.onNodeWithTag("scanner-exact-id").performTextInput("TEST00010")
        compose.onNodeWithText("Verify entry").assertIsNotEnabled()
        compose.onNodeWithTag("scanner-exact-id").performTextReplacement("test0001")
        screenshot("classic-scanner-exact-id")
        compose.onNodeWithText("Verify entry").performClick()
        assertEquals(listOf("TEST0001"), submitted)
        assertEquals(0, closed)
        assertEquals("", compose.onNodeWithTag("scanner-exact-id").fetchSemanticsNode().config[SemanticsProperties.EditableText].text)
        compose.onNodeWithText("Resume camera").performClick()
        assertEquals(1, closed)
    }

    @Test fun heldIssuePreventsExactIdSubmission() {
        var submitted = false
        compose.setContent {
            ClassicScannerTheme {
                ScannerExactIdPanel(false, { submitted = true }, {})
            }
        }
        compose.onNodeWithTag("scanner-exact-id").assertIsNotEnabled()
        compose.onNodeWithText("Verify entry").assertIsNotEnabled()
        assertFalse(submitted)
    }

    @Test fun duplicateDetailsRemainScrollableAndOmitMissingPaymentFields() {
        val result = ScanResult.from(json(
            "code" to "duplicate", "id" to "TEST0001",
            "record" to json("name" to "Synthetic student", "amount" to 100,
                "quantity" to 1, "refund" to 0, "description" to "Transaction completed successfully", "eligible" to true),
            "entry" to json("ticketId" to "TEST0001", "name" to "Synthetic student",
                "checker" to "Original synthetic checker", "at" to "2026-10-10T10:11:12Z", "seq" to 71),
        ))
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                ClassicScannerTheme {
                    Surface(Modifier.fillMaxSize()) { Column(Modifier.padding(16.dp)) { ClassicScanReceipt(result) } }
                }
            }
        }
        compose.onNodeWithText("Payment date and time").assertDoesNotExist()
        compose.onNodeWithText("Payment method").assertDoesNotExist()
        compose.onNodeWithText("Not recorded").assertDoesNotExist()
        compose.onNodeWithText("Previous accepted entry").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Original synthetic checker").performScrollTo().assertIsDisplayed()
        screenshot("classic-scanner-previous-entry-large-text")
        compose.onNodeWithText("Entry receipt number").performScrollTo().assertIsDisplayed()
    }

    @Composable
    private fun CameraFixture(onVerify: (String) -> Unit, initialResult: ScanResult? = null) {
        var idOpen by remember { mutableStateOf(false) }
        ClassicScannerTheme {
            Surface(Modifier.fillMaxSize()) {
                ClassicScannerCameraLayout(
                    s = GateState(ready = true, online = true, result = initialResult,
                        profile = Profile.from(json("role" to "admin", "active" to true))),
                    exactIdOpen = idOpen,
                    onExactIdOpen = { idOpen = it },
                    onVerify = onVerify,
                    onDetails = {},
                    status = if (idOpen) "Camera open · QR reading paused for exact ID" else "Synthetic camera preview · no live camera",
                    torchMode = 0, hasFlash = true, onTorch = {},
                    zoom = 1f, maxZoom = 3f, onZoom = {}, onFocus = {},
                    previewContent = {
                        Box(Modifier.fillMaxSize().background(Color(0xff1b171a)).testTagCompat("synthetic-camera-preview"), contentAlignment = Alignment.Center) {
                            Text("SYNTHETIC CAMERA FIXTURE", color = ScannerGold)
                        }
                    },
                )
            }
        }
    }

    @Test fun actualCameraLayoutKeepsPreviewMountedDuringExactIdEntry() {
        val verified = mutableListOf<String>()
        compose.setContent { CameraFixture({ verified += it }) }
        compose.onNodeWithTag("scanner-frame").assertIsDisplayed()
        screenshot("classic-scanner-camera-layout")
        compose.onNodeWithText("Find ID").performClick()
        compose.onNodeWithTag("scanner-exact-id").performScrollTo().performTextInput("TEST0001")
        compose.onNodeWithTag("synthetic-camera-preview").assertIsDisplayed()
        screenshot("classic-scanner-camera-id-focused")
        compose.onNodeWithText("Verify entry").performScrollTo().performClick()
        assertEquals(listOf("TEST0001"), verified)
        compose.onNodeWithTag("scanner-id-panel").assertExists()
        compose.onNodeWithTag("synthetic-camera-preview").assertIsDisplayed()
        compose.onNodeWithText("Resume camera").performScrollTo().performClick()
        compose.onNodeWithTag("scanner-id-panel").assertDoesNotExist()
        compose.onNodeWithTag("scanner-frame").assertIsDisplayed()
    }

    @Test
    @Config(sdk = [35], qualifiers = "w640dp-h360dp")
    fun compactCameraViewportKeepsIdActionAndResultAccessible() {
        val result = ScanResult.from(json("code" to "admitted", "id" to "TEST0001", "record" to json("name" to "Synthetic student")))
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.3f)) {
                CameraFixture({}, result)
            }
        }
        compose.onNodeWithText("Find ID").performScrollTo().performClick()
        compose.onNodeWithTag("scanner-exact-id").performScrollTo().performTextInput("TEST0002")
        compose.onNodeWithText("Verify entry").performScrollTo().assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithTag("synthetic-camera-preview").assertIsDisplayed()
        compose.onNodeWithTag("scanner-frame").assertDoesNotExist()
        screenshot("classic-scanner-compact-id-controls")
        compose.onNodeWithText("Entry confirmed").performScrollTo().assertIsDisplayed()
        screenshot("classic-scanner-compact-confirmed-result")
    }

    @Test fun partialResultOmitsMissingFieldsButKeepsZeroAndFalse() {
        val result = ScanResult.from(json("code" to "blocked", "id" to "TEST0004",
            "record" to json("amount" to 0, "refund" to 0, "eligible" to false)))
        compose.setContent {
            ClassicScannerTheme {
                Surface(Modifier.fillMaxSize()) { Column(Modifier.padding(16.dp)) { ClassicScanReceipt(result) } }
            }
        }
        compose.onNodeWithText("Name").assertDoesNotExist()
        compose.onNodeWithText("Ticket quantity").assertDoesNotExist()
        compose.onNodeWithText("Payment method").assertDoesNotExist()
        compose.onNodeWithText("Payment date and time").assertDoesNotExist()
        compose.onNodeWithText("Accepted entry receipt").assertDoesNotExist()
        compose.onAllNodesWithText("0").assertCountEquals(2)
        compose.onNodeWithText("Blocked in returned registration").assertExists()
        screenshot("classic-scanner-partial-result")
    }

    @Test fun emptyDetailSectionsAreOmitted() {
        val result = ScanResult.from(json("code" to "not_found", "id" to "TEST0005", "record" to json(), "entry" to json()))
        compose.setContent { ClassicScannerTheme { ClassicScanReceipt(result) } }
        compose.onNodeWithText("Registration and payment").assertDoesNotExist()
        compose.onNodeWithText("Accepted entry receipt").assertDoesNotExist()
        compose.onNodeWithText("Not recorded").assertDoesNotExist()
    }

}
