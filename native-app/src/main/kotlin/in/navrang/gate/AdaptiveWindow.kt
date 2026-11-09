package `in`.navrang.gate

import android.graphics.Color
import android.graphics.Rect
import android.os.Build
import android.view.RoundedCorner
import android.view.View
import androidx.activity.ComponentActivity
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsCompat.Type
import androidx.core.view.doOnAttach
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

internal data class DisplaySeam(val bounds: Rect, val vertical: Boolean)

/** Window-local geometry. Keep one complete work surface clear of every separating hinge. */
internal fun largestUsablePane(width: Int, height: Int, edges: Insets, seams: List<DisplaySeam>): Rect {
    val safe = Rect(edges.left, edges.top, width - edges.right, height - edges.bottom)
    if (safe.isEmpty) return Rect(0, 0, width, height)
    var panes = listOf(safe)
    for ((fold, vertical) in seams) {
        panes = panes.flatMap { pane ->
            if (fold.right <= pane.left || fold.left >= pane.right ||
                fold.bottom <= pane.top || fold.top >= pane.bottom
            ) {
                listOf(pane)
            } else if (vertical) {
                listOf(Rect(pane.left, pane.top, fold.left, pane.bottom),
                    Rect(fold.right, pane.top, pane.right, pane.bottom)).filterNot { it.isEmpty }
            } else {
                listOf(Rect(pane.left, pane.top, pane.right, fold.top),
                    Rect(pane.left, fold.bottom, pane.right, pane.bottom)).filterNot { it.isEmpty }
            }
        }
    }
    return panes.maxByOrNull { it.width().toLong() * it.height() } ?: safe
}

internal fun ComponentActivity.fitNavrangWindow(view: View) {
    WindowCompat.setDecorFitsSystemWindows(window, false)
    view.setBackgroundColor(Color.rgb(16, 13, 21))
    val bars = Type.systemBars() or Type.displayCutout()
    val ime = Type.ime()
    var edges = Insets.NONE
    var folds = emptyList<DisplaySeam>()
    val origin = IntArray(2)

    fun place() {
        val width = view.width
        val height = view.height
        if (width <= 0 || height <= 0) return
        view.getLocationInWindow(origin)
        val localFolds = folds.map { seam ->
            seam.copy(bounds = Rect(seam.bounds).apply { offset(-origin[0], -origin[1]) })
        }
        val pane = largestUsablePane(width, height, edges, localFolds)
        val right = width - pane.right
        val bottom = height - pane.bottom
        if (view.paddingLeft != pane.left || view.paddingTop != pane.top ||
            view.paddingRight != right || view.paddingBottom != bottom
        ) view.setPadding(pane.left, pane.top, right, bottom)
    }

    ViewCompat.setOnApplyWindowInsetsListener(view) { _, insets ->
        val gestures = insets.getInsets(Type.systemGestures())
        val waterfall = insets.displayCutout?.waterfallInsets ?: Insets.NONE
        val safe = Insets.max(insets.getInsets(bars or ime), waterfall)
        val corners = if (Build.VERSION.SDK_INT >= 31) insets.toWindowInsets() else null
        val top = if (Build.VERSION.SDK_INT >= 31 && corners != null) maxOf(
            safe.top,
            corners.getRoundedCorner(RoundedCorner.POSITION_TOP_LEFT)?.radius ?: 0,
            corners.getRoundedCorner(RoundedCorner.POSITION_TOP_RIGHT)?.radius ?: 0,
        ) else safe.top
        val bottom = if (Build.VERSION.SDK_INT >= 31 && corners != null) maxOf(
            safe.bottom,
            corners.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT)?.radius ?: 0,
            corners.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_RIGHT)?.radius ?: 0,
        ) else safe.bottom
        edges = Insets.of(maxOf(safe.left, gestures.left), top, maxOf(safe.right, gestures.right), bottom)
        place()
        // The host has reserved these pixels. Forward zero values so WebView clears stale insets.
        WindowInsetsCompat.Builder(insets)
            .setInsets(bars or ime, Insets.NONE)
            .setInsetsIgnoringVisibility(bars, Insets.NONE)
            .setInsets(Type.systemGestures(), Insets.of(0, gestures.top, 0, gestures.bottom))
            .setDisplayCutout(null)
            .build()
    }
    view.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> place() }
    view.doOnAttach { ViewCompat.requestApplyInsets(it) }
    lifecycleScope.launch {
        repeatOnLifecycle(Lifecycle.State.STARTED) {
            WindowInfoTracker.getOrCreate(this@fitNavrangWindow)
                .windowLayoutInfo(this@fitNavrangWindow).collect { layout ->
                    folds = layout.displayFeatures.filterIsInstance<FoldingFeature>()
                        .filter { it.isSeparating || it.occlusionType == FoldingFeature.OcclusionType.FULL }
                        .map { DisplaySeam(Rect(it.bounds), it.orientation == FoldingFeature.Orientation.VERTICAL) }
                    place()
                }
        }
    }
}
