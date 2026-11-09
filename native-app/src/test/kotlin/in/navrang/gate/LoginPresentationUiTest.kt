package `in`.navrang.gate

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Synthetic production-UI renders. No authentication request or network startup occurs. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w360dp-h800dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LoginPresentationUiTest {
    @get:Rule val compose = createComposeRule()

    @Suppress("UNCHECKED_CAST")
    private fun show(mode: String = "light", dynamic: Boolean = false, fontScale: Float = 1f) {
        val vm = GateViewModel(ApplicationProvider.getApplicationContext<Application>(), false)
        val field = GateViewModel::class.java.getDeclaredField("mutable")
        field.isAccessible = true
        (field.get(vm) as MutableStateFlow<GateState>).value =
            GateState(ready = true, appearance = Appearance(mode, dynamic, reducedMotion = true))
        compose.setContent {
            CompositionLocalProvider(
                LocalDensity provides Density(LocalDensity.current.density, fontScale)
            ) {
                GateApp(vm, {}, {}, {}, {})
            }
        }
        compose.waitForIdle()
    }

    private fun button(label: String) = compose.onNode(hasText(label) and hasClickAction())

    private fun assertTouchHeight(label: String) {
        val bounds = button(label).fetchSemanticsNode().boundsInRoot
        assertTrue("$label must be at least 48dp high: $bounds", bounds.height >= 48 * compose.density.density)
    }

    private fun screenshot(name: String) {
        compose.mainClock.advanceTimeBy(250)
        compose.waitForIdle()
        val dir = java.io.File(requireNotNull(System.getProperty("navrang.screenshot.dir")))
        dir.mkdirs()
        java.io.File(dir, "$name.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    private fun enterSyntheticSecret(admin: Boolean = false) {
        val method = if (admin) "Administrator" else "Assigned staff code"
        val fieldLabel = if (admin) "Administrator password" else "Assigned code"
        // Lazy items outside a short viewport are not composed until the list scrolls.
        compose.onNode(hasScrollAction()).performScrollToNode(hasText(method) and hasClickAction())
        button(method)
            .performScrollTo().performClick()
        compose.onNode(hasScrollAction()).performScrollToNode(hasText(fieldLabel))
        compose.onNodeWithText(fieldLabel)
            .performScrollTo().performTextInput("SYNTHETIC")
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)).assertIsFocused()
        button("Sign in").performScrollTo().assertIsDisplayed().assertIsEnabled()
        assertTouchHeight("Sign in")
    }

    @Test fun defaultGoogleLight() {
        show()
        button("Continue with Google").assertIsDisplayed()
        assertTouchHeight("Continue with Google")
        assertTouchHeight("Use Google sign-in in browser")
        assertTouchHeight("Assigned staff code")
        assertTouchHeight("Administrator")
        screenshot("login-google-light")
    }

    @Test fun staffFieldLightUnfocusedAndFocused() {
        show()
        button("Assigned staff code").performScrollTo().performClick()
        button("Sign in").performScrollTo().assertIsNotEnabled()
        screenshot("login-staff-light-unfocused")
        enterSyntheticSecret()
        screenshot("login-staff-light-focused")
    }

    @Test fun administratorDarkMasked() {
        show(mode = "dark")
        enterSyntheticSecret(admin = true)
        screenshot("login-admin-dark-focused")
    }

    @Test fun staffDynamicLight() {
        show(dynamic = true)
        enterSyntheticSecret()
        screenshot("login-staff-dynamic-light-focused")
    }

    @Test fun administratorDynamicDark() {
        show(mode = "dark", dynamic = true)
        enterSyntheticSecret(admin = true)
        screenshot("login-admin-dynamic-dark-focused")
    }

    @Test
    @Config(qualifiers = "w320dp-h480dp")
    fun compactLargeTextKeepsMaskedFieldAndActionReachable() {
        show(fontScale = 1.6f)
        enterSyntheticSecret()
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.Password)).assertIsDisplayed()
        screenshot("login-staff-compact-large-text")
    }

    @Test
    @Config(qualifiers = "w840dp-h600dp")
    fun wideLoginKeepsBoundedContent() {
        show()
        val bounds = button("Continue with Google").fetchSemanticsNode().boundsInRoot
        assertTrue("Login content must stay within 560dp minus padding: $bounds", bounds.width <= 512 * compose.density.density + 1)
        screenshot("login-google-wide-light")
    }
}
