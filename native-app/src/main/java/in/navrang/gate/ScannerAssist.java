package in.navrang.gate;

/** Bounded camera-assistance policy. Main-thread only; no frames or ticket values are retained. */
public final class ScannerAssist {
    public static final long FOCUS_COOLDOWN_MS = 2800;
    public static final long TORCH_COOLDOWN_MS = 5000;
    public static final long ZOOM_COOLDOWN_MS = 2400;
    public static final float AUTO_ZOOM_LIMIT = 1.8f;
    private long lastSample = -1, lastFocus = -10000, lastTorch = -10000, lastZoom = -10000;
    private long lastRead = -10000, lastCandidate = -1, manualZoomUntil = -1;
    private int darkSamples, brightSamples;
    private boolean autoZoomed;

    public static final class Decision {
        public final int torch; // -1 unchanged, 0 off, 1 on
        public final boolean focus;
        public final float focusX, focusY, zoom; // zoom=0 means unchanged
        public final String hint;
        Decision(int torch, boolean focus, float x, float y, float zoom, String hint) {
            this.torch = torch; this.focus = focus; focusX = x; focusY = y; this.zoom = zoom; this.hint = hint;
        }
    }
    public void paused() { darkSamples = brightSamples = 0; lastSample = -1; }
    public void read(long now) { lastRead = now; lastCandidate = now; }
    public void manualFocus(long now) { lastFocus = now; }
    public void manualZoom(long now) { manualZoomUntil = now + 12000; autoZoomed = false; }

    public Decision inspect(long now, boolean enabled, boolean dark, boolean bright, boolean soft,
            ScannerQrReader.Attempt qr, float zoom, float maxZoom, boolean torchOn,
            boolean torchAutomatic, boolean hasFlash, boolean focusInFlight) {
        if (!enabled) { paused(); return new Decision(-1, false, .5f, .5f, 0, ""); }
        if (lastSample >= 0 && now - lastSample < 500) return new Decision(-1, false, .5f, .5f, 0, "");
        if (lastSample < 0 || now - lastSample > 1500) darkSamples = brightSamples = 0;
        lastSample = now;
        darkSamples = dark ? darkSamples + 1 : 0;
        brightSamples = bright ? brightSamples + 1 : 0;
        int light = -1;
        if (hasFlash && torchAutomatic && now - lastTorch >= TORCH_COOLDOWN_MS) {
            if (!torchOn && darkSamples >= 3) light = 1;
            else if (torchOn && brightSamples >= 5 && qr.points == 0) light = 0;
            if (light != -1) { lastTorch = now; darkSamples = brightSamples = 0; }
        }
        if (qr.points >= 2) lastCandidate = now;
        boolean settled = now - lastRead >= 1600;
        boolean focus = settled && !focusInFlight && now - lastFocus >= FOCUS_COOLDOWN_MS
            && ((qr.points >= 2 && soft) || (qr.points == 0 && !dark && now - lastFocus >= 6000));
        if (focus) lastFocus = now;
        float nextZoom = 0;
        boolean validZoom = Float.isFinite(zoom) && Float.isFinite(maxZoom) && zoom >= 1 && maxZoom >= 1;
        boolean canZoom = settled && validZoom && now >= manualZoomUntil && now - lastZoom >= ZOOM_COOLDOWN_MS;
        if (canZoom && !focus && !focusInFlight && qr.value == null && qr.points >= 3 && qr.span > 0 && qr.span < .24f && !dark) {
            float candidate = Math.min(zoom + .2f, Math.min(maxZoom, AUTO_ZOOM_LIMIT));
            if (candidate > zoom && qr.fitsZoom(candidate / zoom)) { nextZoom = candidate; autoZoomed = true; }
        }
        // Automatic framing resets independently of a user's light preference.
        if (canZoom && autoZoomed && zoom > 1 && lastCandidate >= 0 && now - lastCandidate >= 6000) {
            nextZoom = 1; autoZoomed = false;
        }
        if (nextZoom > 0) lastZoom = now;
        String hint = dark ? (hasFlash ? "Low light · adjusting light; hold steady" : "Low light · brighten the ticket or move toward light")
            : qr.points >= 2 && !qr.fitsZoom(1) ? "QR near the edge · bring the whole code into view"
            : nextZoom > 1 ? "Small QR · gently adjusting zoom"
            : focus ? "Adjusting focus · keep the whole QR visible"
            : "Automatic camera · keep one whole QR visible";
        return new Decision(light, focus, qr.centerX, qr.centerY, nextZoom, hint);
    }
}
