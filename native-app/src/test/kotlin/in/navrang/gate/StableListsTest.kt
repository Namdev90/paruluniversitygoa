package `in`.navrang.gate

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
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
class StableListsTest {
    @get:Rule val compose = createComposeRule()
    private val vm by lazy {
        GateViewModel(ApplicationProvider.getApplicationContext<Application>(), false)
    }

    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(250)
        compose.waitForIdle()
        val dir = java.io.File(requireNotNull(System.getProperty("navrang.screenshot.dir")))
        dir.mkdirs()
        java.io.File(dir, name + ".png").outputStream().use {
            compose
                .onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test
    fun studentsScrollWithoutMovingSearchOrPager() {
        val rows =
            (1..60).map {
                Ticket(
                    "S%07d".format(it),
                    "Synthetic long student name for wrapping $it",
                    true,
                    "",
                    "100",
                    "1",
                    "0",
                    "",
                )
            }
        compose.setContent {
            NavrangTheme(Appearance()) {
                Surface(Modifier.size(360.dp, 650.dp)) {
                    StudentsScreen(GateState(tickets = rows), vm)
                }
            }
        }
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        val search = compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("student-list").performScrollToIndex(20)
        compose.onNodeWithContentDescription("Edit registration S0000021").assertExists()
        assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
        assertEquals(
            search,
            compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot,
        )
        compose.onNodeWithText("Previous").assertIsNotEnabled()
        compose.onNodeWithText("Next").assertIsEnabled()
        screenshot("students-synthetic")
    }

    @Test
    fun receiptsScrollAndKeepCorrectionMeaning() {
        val rows =
            (1..40).map {
                Receipt(
                    "R%07d".format(it),
                    it.toLong(),
                    "Synthetic student $it",
                    "Synthetic organizer",
                    "2026-10-18T00:00:00Z",
                    if (it == 21) "organizer_confirmed" else "server_validated",
                    "",
                    "",
                    "",
                )
            }
        compose.setContent {
            NavrangTheme(Appearance()) {
                Surface(Modifier.size(360.dp, 650.dp)) {
                    EntriesScreen(GateState(entries = rows, stats = mapOf("admitted" to "793")), vm)
                }
            }
        }
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        val search = compose.onNodeWithTag("entry-search").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("entry-list").performScrollToIndex(20)
        compose
            .onNodeWithText("Physical entry time: unknown · payment verification: unknown")
            .assertExists()
        assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
        assertEquals(
            search,
            compose.onNodeWithTag("entry-search").fetchSemanticsNode().boundsInRoot,
        )
        compose.onNodeWithText("40 receipts loaded · server total 793").assertExists()
        screenshot("entries-synthetic")
    }

    @Test
    fun studentControlsStayFixedAcrossEmptyLoadingErrorAndLastPage() {
        val rows =
            (1..51).map {
                Ticket(
                    "S%07d".format(it),
                    "Synthetic long wrapping name $it",
                    true,
                    "",
                    "100",
                    "1",
                    "0",
                    "",
                )
            }
        var state by mutableStateOf(GateState())
        compose.setContent {
            NavrangTheme(Appearance(mode = "dark", dynamic = false)) {
                Surface(Modifier.size(360.dp, 650.dp)) { StudentsScreen(state, vm) }
            }
        }
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        val search = compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot
        for (next in
            listOf(
                GateState(busy = true),
                GateState(message = "Synthetic connection error"),
                GateState(tickets = rows.take(1)),
                GateState(tickets = rows),
                GateState(tickets = rows, studentPage = PageState(2)),
            )) {
            compose.runOnIdle { state = next }
            assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
            assertEquals(
                search,
                compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot,
            )
        }
        compose.onNodeWithText("Previous").assertIsEnabled()
        compose.onNodeWithText("Next").assertIsNotEnabled()
        compose.onNodeWithContentDescription("Edit registration S0000051").assertExists()
        screenshot("students-last-page-dark")
    }

    @Test
    fun entryControlsRemainReachableAtDoubleFontScale() {
        val rows =
            (1..51).map {
                Receipt(
                    "R%07d".format(it),
                    it.toLong(),
                    "Synthetic long name $it",
                    "Synthetic staff",
                    "2026-10-18T00:00:00Z",
                    "server_validated",
                    "",
                    "",
                    "",
                )
            }
        var state by mutableStateOf(GateState())
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(LocalDensity.current.density, 2f)
            ) {
                NavrangTheme(Appearance(mode = "light", dynamic = false)) {
                    Surface(Modifier.size(360.dp, 650.dp)) { EntriesScreen(state, vm) }
                }
            }
        }
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        val search = compose.onNodeWithTag("entry-search").fetchSemanticsNode().boundsInRoot
        for (next in
            listOf(
                GateState(busy = true),
                GateState(message = "Synthetic error"),
                GateState(entries = rows.take(1)),
                GateState(entries = rows),
                GateState(entries = rows, entryPage = PageState(2)),
            )) {
            compose.runOnIdle { state = next }
            assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
            assertEquals(
                search,
                compose.onNodeWithTag("entry-search").fetchSemanticsNode().boundsInRoot,
            )
        }
        compose.onNodeWithText("Previous").assertIsDisplayed().assertIsEnabled()
        compose.onNodeWithText("Next").assertIsDisplayed().assertIsNotEnabled()
        assertTrue(
            compose.onNodeWithTag("entry-list").fetchSemanticsNode().boundsInRoot.bottom <=
                pager.top
        )
        screenshot("entries-large-font-light")
    }
}
