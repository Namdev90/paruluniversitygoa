package `in`.navrang.gate

import android.app.Application
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Synthetic UI fixtures only. Runtime/network startup is disabled; no provider is contacted. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h800dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeWorkflowUiTest {
    @get:Rule val compose = createComposeRule()
    private val vm by lazy {
        GateViewModel(ApplicationProvider.getApplicationContext<Application>(), false)
    }

    // Keep fixture injection entirely in the test source set, with no production state setter.
    @Suppress("UNCHECKED_CAST")
    private fun seed(state: GateState) {
        val field = GateViewModel::class.java.getDeclaredField("mutable")
        field.isAccessible = true
        (field.get(vm) as MutableStateFlow<GateState>).value = state
    }

    private fun profile(
        role: String = "admin",
        scanner: Boolean = false,
        reports: Boolean = false,
    ) =
        Profile.from(
            json(
                "checkerId" to "synthetic-account",
                "name" to "Synthetic staff",
                "role" to role,
                "method" to "google",
                "active" to true,
                "scanner" to scanner,
                "reports" to reports,
                "station" to if (scanner) "checker" else "",
                "nameConfirmed" to true,
            )
        )

    private fun tickets() =
        (1..60).map {
            Ticket("S%07d".format(it), "Synthetic student $it", true, "", "100", "1", "0", "")
        }

    private fun show(
        initial: GateState,
        fontScale: Float = 1f,
        google: () -> Unit = {},
        browser: () -> Unit = {},
    ) {
        seed(initial)
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(LocalDensity.current.density, fontScale)
            ) {
                GateApp(vm, google, browser, {}, {})
            }
        }
        compose.waitForIdle()
    }

    private fun button(label: String) = compose.onNode(hasText(label) and hasClickAction())

    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(250)
        val dir = java.io.File(requireNotNull(System.getProperty("navrang.screenshot.dir")))
        dir.mkdirs()
        java.io.File(dir, "$name.png").outputStream().use {
            compose
                .onRoot()
                .captureToImage()
                .asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test
    fun fullShellKeepsControlsStableAndPagingSearchDetailsWork() {
        show(
            GateState(
                ready = true,
                profile = profile(),
                destination = Destination.Students,
                tickets = tickets(),
                online = true,
                appearance = Appearance(dynamic = false),
            )
        )
        val search = compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        val navigation = compose.onNodeWithTag("navigation").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("student-list").performScrollToIndex(20)
        assertEquals(
            search,
            compose.onNodeWithTag("student-search").fetchSemanticsNode().boundsInRoot,
        )
        assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
        assertEquals(
            navigation,
            compose.onNodeWithTag("navigation").fetchSemanticsNode().boundsInRoot,
        )
        screenshot("full-shell-students")
        button("Next").performClick()
        compose.onNodeWithContentDescription("Page 2 of 3, 60 results").assertIsDisplayed()
        compose.onNodeWithTag("student-search").performTextInput("Synthetic student 51")
        compose.onNodeWithContentDescription("Page 1 of 1, 1 results").assertIsDisplayed()
        button("Next").assertIsNotEnabled()
        compose
            .onNodeWithContentDescription("Details for registration S0000051")
            .performScrollTo()
            .performClick()
        compose.onNodeWithText("Registration details").assertIsDisplayed()
        compose.onNodeWithText("No verified entry loaded.").assertExists()
        button("Close").performClick()
        assertEquals("", vm.state.value.modal)
    }

    @Test
    @Config(qualifiers = "w640dp-h360dp")
    fun compactLandscapeKeepsRowsAndPagingReachableAtLargeText() {
        show(
            GateState(
                ready = true,
                profile = profile(),
                destination = Destination.Students,
                tickets = tickets(),
                online = true,
                appearance = Appearance(dynamic = false),
            ),
            2f,
        )
        val list = compose.onNodeWithTag("student-list").fetchSemanticsNode().boundsInRoot
        val pager = compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "Rows must have usable vertical space: $list",
            list.height >= 48 * compose.density.density,
        )
        button("Previous").assertIsDisplayed()
        button("Next").assertIsDisplayed().performClick()
        assertEquals(1, vm.state.value.studentPage.index)
        compose.onNodeWithTag("student-list").performScrollToIndex(20)
        assertEquals(pager, compose.onNodeWithTag("pager").fetchSemanticsNode().boundsInRoot)
        screenshot("compact-large-text-students")
        compose.onNodeWithContentDescription("Filter students: All").performClick()
        button("Blocked").performClick()
        compose.onNodeWithContentDescription("Page 1 of 1, 0 results").assertExists()
        compose.onNodeWithContentDescription("Registration actions").performClick()
        button("Add registration").assertIsDisplayed()
        button("Import registrations").assertIsDisplayed()
    }

    @Test
    fun signedOutControlsUseCallbacksMaskSecretsAndRespectBusyState() {
        var google = 0
        var browser = 0
        show(GateState(ready = true), google = { google++ }, browser = { browser++ })
        button("Continue with Google").performScrollTo().performClick()
        button("Use Google sign-in in browser").performScrollTo().performClick()
        assertEquals(1, google)
        assertEquals(1, browser)
        button("Assigned staff code").performScrollTo().performClick()
        compose.onNodeWithText("Assigned code").performScrollTo().performTextInput("SYNTHETIC")
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)).assertExists()
        button("Administrator").performScrollTo().performClick()
        compose
            .onNodeWithText("Administrator password")
            .performScrollTo()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.EditableText,
                    androidx.compose.ui.text.AnnotatedString(""),
                )
            )
        button("Sign in").assertIsNotEnabled()
        compose.runOnIdle { seed(vm.state.value.copy(busy = true)) }
        button("Continue with Google").performScrollTo().assertIsNotEnabled()
        button("Use Google sign-in in browser").performScrollTo().assertIsNotEnabled()
    }

    @Test
    fun pendingDeskSaveLocksDraftAndDismissalAndBlocksNavigation() {
        val draft = DeskDetails("Synthetic student", "fixture@example.invalid", "9999999999", "2")
        show(
            GateState(
                ready = true,
                profile = profile(),
                destination = Destination.Desk,
                pendingSave = true,
                draft = draft,
            )
        )
        button("Resume unconfirmed save").performClick()
        compose.onNodeWithText("Student name").assertIsNotEnabled()
        compose.onNodeWithText("Email").assertIsNotEnabled()
        button("Retry same save").assertIsEnabled()
        button("Close").assertIsNotEnabled()
        compose.runOnIdle {
            vm.draft(DeskDetails())
            vm.navigate(Destination.Students)
        }
        assertEquals(draft, vm.state.value.draft)
        assertEquals(Destination.Desk, vm.state.value.destination)
        assertEquals("deskForm", vm.state.value.modal)
    }

    @Test
    @Config(sdk = [24])
    fun pendingDialogRendersWithoutNavigation() {
        val s =
            GateState(
                ready = true,
                profile = profile(),
                pendingSave = true,
                draft =
                    DeskDetails("Synthetic student", "fixture@example.invalid", "9999999999", "2"),
                modal = "deskForm",
            )
        seed(s)
        compose.setContent { NavrangTheme(Appearance()) { GateDialogs(s, vm) } }
        button("Close").assertIsNotEnabled()
        button("Retry same save").assertIsDisplayed()
    }

    @Test
    fun helpDeskFormAcceptsEditsAndKeepsActionsReachable() {
        show(GateState(ready = true, profile = profile(), destination = Destination.Desk))
        button("New case").performClick()
        compose
            .onNodeWithText("Student name")
            .performScrollTo()
            .performTextInput("Synthetic edited student")
        compose.onNodeWithText("Email").performScrollTo().performTextInput("edited@example.invalid")
        compose.onNodeWithText("Mobile number").performScrollTo().performTextInput("9999999999")
        compose.onNodeWithText("Quantity").performScrollTo().performTextReplacement("3")
        assertEquals(
            DeskDetails("Synthetic edited student", "edited@example.invalid", "9999999999", "3"),
            vm.state.value.draft,
        )
        button("Save case").assertIsDisplayed()
        button("Close").assertIsDisplayed().performClick()
        assertEquals("", vm.state.value.modal)
    }

    @Test
    @Config(qualifiers = "w640dp-h360dp")
    fun compactEntryLogKeepsRowsAndCountsReachableAtLargeText() {
        val rows =
            (1..60).map {
                Receipt(
                    "R%07d".format(it),
                    it.toLong(),
                    "Synthetic student $it",
                    "Synthetic checker",
                    "2026-10-18T00:00:00Z",
                    "server_validated",
                    "",
                    "",
                    "",
                )
            }
        show(
            GateState(
                ready = true,
                profile = profile(),
                destination = Destination.Entries,
                entries = rows,
                stats = mapOf("admitted" to "793"),
                online = true,
                appearance = Appearance(dynamic = false),
            ),
            2f,
        )
        val list = compose.onNodeWithTag("entry-list").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "Entry rows need usable space: $list",
            list.height >= 48 * compose.density.density,
        )
        button("Next").assertIsDisplayed().performClick()
        assertEquals(1, vm.state.value.entryPage.index)
        compose
            .onNodeWithContentDescription("60 receipts loaded · server total 793")
            .assertIsDisplayed()
        screenshot("compact-large-text-entries")
    }

    @Test
    @Config(qualifiers = "w640dp-h360dp")
    fun navigationRailRetainsAccountSettings() {
        show(GateState(ready = true, profile = profile(), destination = Destination.Students))
        button("Account").performScrollTo().performClick()
        assertEquals(Destination.Settings, vm.state.value.destination)
        button("Sign out").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun ordinaryCheckerCannotOpenAdministratorOrFacultyRoutes() {
        show(
            GateState(
                ready = true,
                profile = profile("checker", scanner = true),
                destination = Destination.Checker,
            )
        )
        button("Open scanner").assertIsDisplayed()
        for (destination in
            listOf(
                Destination.Students,
                Destination.Entries,
                Destination.Staff,
                Destination.Summary,
                Destination.Reports,
                Destination.Desk,
            )) {
            compose.runOnIdle { vm.navigate(destination) }
            assertEquals(Destination.Checker, vm.state.value.destination)
        }
        compose.onNodeWithTag("student-list").assertDoesNotExist()
        compose.onNodeWithTag("entry-list").assertDoesNotExist()
    }

    @Test
    fun signOutClearsPrivateViewsDraftsAndSearchImmediately() {
        show(
            GateState(
                ready = true,
                profile = profile(),
                destination = Destination.Students,
                tickets = tickets(),
                studentQuery = "Synthetic",
                pending = 1,
                draft = DeskDetails("Synthetic private draft"),
                modal = "signout",
            )
        )
        compose
            .onNodeWithText(
                "Unconfirmed requests and private drafts are only in memory.",
                substring = true,
            )
            .assertExists()
        button("Sign out").performClick()
        compose.runOnIdle {
            val s = vm.state.value
            assertNull(s.profile)
            assertTrue(s.tickets.isEmpty())
            assertTrue(s.entries.isEmpty())
            assertEquals("", s.studentQuery)
            assertEquals(DeskDetails(), s.draft)
            assertEquals(0, s.pending)
        }
        compose.onNodeWithTag("student-list").assertDoesNotExist()
        button("Continue with Google").performScrollTo().assertExists()
    }

    @Test
    fun reportErrorDoesNotHideDownloadsAndPreparationCanBeCancelled() {
        show(
            GateState(
                ready = true,
                profile = profile("checker", reports = true),
                destination = Destination.Reports,
                reportError = "Synthetic member-list failure",
                busy = true,
                exportPreparing = true,
            )
        )
        button("CSV").performScrollTo().assertIsNotEnabled()
        button("Cancel export").performScrollTo().performClick()
        assertFalse(vm.state.value.exportPreparing)
        button("CSV").assertIsEnabled()
        button("Excel").assertIsEnabled()
        button("PDF summary").assertIsEnabled()
        button("Cancel export").assertDoesNotExist()
    }
}
