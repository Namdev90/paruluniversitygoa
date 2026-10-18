package in.navrang.gate;

import com.google.zxing.*;
import com.google.zxing.common.GlobalHistogramBinarizer;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.*;

/** Full-frame, local-only QR decoding. Finder bounds are hints, never entry authority. */
public final class ScannerQrReader {
    public static final class Attempt {
        public final String value;
        public final int points;
        public final float minX, minY, maxX, maxY, span, centerX, centerY;
        private final boolean zoomGeometryKnown;
        private final float safeMinX, safeMinY, safeMaxX, safeMaxY;
        Attempt(String value, List<ResultPoint> points, int width, int height) {
            this.value = value;
            this.points = points.size();
            float left = 1, top = 1, right = 0, bottom = 0;
            for (ResultPoint p : points) {
                left = Math.min(left, p.getX() / width); right = Math.max(right, p.getX() / width);
                top = Math.min(top, p.getY() / height); bottom = Math.max(bottom, p.getY() / height);
            }
            minX = points.isEmpty() ? .5f : left; maxX = points.isEmpty() ? .5f : right;
            minY = points.isEmpty() ? .5f : top; maxY = points.isEmpty() ? .5f : bottom;
            centerX = (minX + maxX) / 2; centerY = (minY + maxY) / 2;
            span = points.size() < 2 ? 0 : Math.max((maxX - minX) * width, (maxY - minY) * height) / Math.min(width, height);
            // A failed decode exposes unordered finder candidates, not a verified QR boundary.
            // Only an unambiguous three-point, near-right-angle candidate can guide zoom.
            boolean known = false;
            float sx0 = 0, sy0 = 0, sx1 = 1, sy1 = 1;
            if (points.size() == 3) {
                ResultPoint[] triangle = points.toArray(new ResultPoint[0]);
                ResultPoint.orderBestPatterns(triangle);
                ResultPoint a = triangle[0], b = triangle[1], c = triangle[2];
                float ux = a.getX() - b.getX(), uy = a.getY() - b.getY();
                float vx = c.getX() - b.getX(), vy = c.getY() - b.getY();
                double u = Math.hypot(ux, uy), v = Math.hypot(vx, vy);
                known = u > 4 && v > 4 && u / v >= .5 && u / v <= 2
                    && Math.abs(ux * vx + uy * vy) / (u * v) <= .25;
                float fourthX = a.getX() + c.getX() - b.getX();
                float fourthY = a.getY() + c.getY() - b.getY();
                // Version 1 is the largest border/quiet-zone proportion: 7.5/14.
                // Use .6 on BOTH finder axes, including rotated fourth-corner extents.
                float padX = .6f * (Math.abs(ux) + Math.abs(vx));
                float padY = .6f * (Math.abs(uy) + Math.abs(vy));
                sx0 = (Math.min(minX * width, fourthX) - padX) / width;
                sx1 = (Math.max(maxX * width, fourthX) + padX) / width;
                sy0 = (Math.min(minY * height, fourthY) - padY) / height;
                sy1 = (Math.max(maxY * height, fourthY) + padY) / height;
            }
            zoomGeometryKnown = known;
            safeMinX = sx0; safeMinY = sy0; safeMaxX = sx1; safeMaxY = sy1;

        }
        /** Include room beyond the finder centres for the QR border and quiet zone. */
        public boolean fitsZoom(float factor) {
            if (!zoomGeometryKnown || !Float.isFinite(factor) || factor < 1) return false;
            return .5f + (safeMinX - .5f) * factor >= .08f
                && .5f + (safeMaxX - .5f) * factor <= .92f
                && .5f + (safeMinY - .5f) * factor >= .08f
                && .5f + (safeMaxY - .5f) * factor <= .92f;
        }
    }

    public static Attempt inspect(byte[] frame, int width, int height) {
        if (frame == null || width <= 0 || height <= 0 || (long) width * height > frame.length)
            return new Attempt(null, Collections.emptyList(), 1, 1);
        PlanarYUVLuminanceSource source = new PlanarYUVLuminanceSource(frame, width, height, 0, 0, width, height, false);
        Attempt best = read(new BinaryBitmap(new HybridBinarizer(source)), width, height);
        if (best.value != null) return best;
        Attempt inverted = read(new BinaryBitmap(new HybridBinarizer(source.invert())), width, height);
        if (inverted.value != null) return inverted;
        if (inverted.points > best.points) best = inverted;
        if (best.points >= 2) {
            Attempt global = read(new BinaryBitmap(new GlobalHistogramBinarizer(source)), width, height);
            if (global.value != null || global.points > best.points) best = global;
        }
        return best;
    }

    private static Attempt read(BinaryBitmap bitmap, int width, int height) {
        List<ResultPoint> points = new ArrayList<>();
        EnumMap<DecodeHintType, Object> hints = new EnumMap<>(DecodeHintType.class);
        hints.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        hints.put(DecodeHintType.NEED_RESULT_POINT_CALLBACK, (ResultPointCallback) p -> {
            if (points.size() < 24 && points.stream().noneMatch(q -> ResultPoint.distance(p, q) < 2)) points.add(p);
        });
        QRCodeReader reader = new QRCodeReader();
        try {
            Result result = reader.decode(bitmap, hints);
            // Successful results provide the actual selected QR, not candidates from other regions.
            List<ResultPoint> selected = result.getResultPoints() == null ? points : Arrays.asList(result.getResultPoints());
            return new Attempt(result.getText(), selected, width, height);
        } catch (ReaderException | IllegalArgumentException ignored) {
            return new Attempt(null, points, width, height);
        } finally { reader.reset(); }
    }
}
