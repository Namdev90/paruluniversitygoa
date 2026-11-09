package `in`.navrang.gate

import android.graphics.Rect
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsCompat.Type
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AdaptiveWindowTest {
    @Test fun keepsCurvedEdgesAndSystemBarsClear() {
        assertEquals(Rect(24, 38, 380, 752),
            largestUsablePane(412, 800, Insets.of(24, 38, 32, 48), emptyList()))
    }

    @Test fun choosesTheWiderPaneAwayFromAVerticalHinge() {
        val hinge = DisplaySeam(Rect(340, 0, 360, 700), vertical = true)
        assertEquals(Rect(360, 24, 788, 676),
            largestUsablePane(800, 700, Insets.of(12, 24, 12, 24), listOf(hinge)))
    }

    @Test fun tabletopFoldAvoidsTheKeyboardAndTheHinge() {
        val fold = DisplaySeam(Rect(0, 340, 640, 340), vertical = false)
        assertEquals(Rect(18, 28, 622, 340),
            largestUsablePane(640, 780, Insets.of(18, 28, 18, 250), listOf(fold)))
    }

    @Test fun comparesEveryTriFoldPaneIncludingZeroWidthCreases() {
        val first = DisplaySeam(Rect(360, 0, 360, 800), vertical = true)
        val second = DisplaySeam(Rect(840, 0, 850, 800), vertical = true)
        assertEquals(Rect(360, 22, 840, 778),
            largestUsablePane(1200, 800, Insets.of(16, 22, 16, 22), listOf(first, second)))
    }

    @Test fun ignoresAFeatureOutsideTheCurrentSplitWindow() {
        val hinge = DisplaySeam(Rect(420, 0, 440, 800), vertical = true)
        assertEquals(Rect(14, 24, 294, 770),
            largestUsablePane(310, 800, Insets.of(14, 24, 16, 30), listOf(hinge)))
    }

    @Test fun keyboardResizeClearsPaddingWhenItCloses() {
        val controller = Robolectric.buildActivity(ComponentActivity::class.java).create()
        try {
            val activity = controller.get()
            val root = FrameLayout(activity)
            activity.setContentView(root)
            root.layout(0, 0, 412, 780)
            activity.fitNavrangWindow(root)
            val normal = WindowInsetsCompat.Builder()
                .setInsets(Type.systemBars(), Insets.of(0, 24, 0, 32))
                .setInsets(Type.systemGestures(), Insets.of(18, 0, 24, 16))
                .build()
            val keyboard = WindowInsetsCompat.Builder(normal)
                .setInsets(Type.ime(), Insets.of(0, 0, 0, 290)).build()
            val forwarded = ViewCompat.dispatchApplyWindowInsets(root, keyboard)
            assertEquals(Insets.NONE, forwarded.getInsets(Type.ime()))
            assertEquals(18, root.paddingLeft)
            assertEquals(24, root.paddingRight)
            assertEquals(290, root.paddingBottom)
            ViewCompat.dispatchApplyWindowInsets(root, normal)
            assertEquals(32, root.paddingBottom)
        } finally {
            controller.destroy()
        }
    }
}
