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
        }
        /** Include room beyond the finder centres for the QR border and quiet zone. */
        public boolean fitsZoom(float factor) {
            if (points < 3 || !Float.isFinite(factor) || factor < 1) return false;
            float padX = (maxX - minX) * .3f, padY = (maxY - minY) * .3f;
            return .5f + (minX - padX - .5f) * factor >= .08f
                && .5f + (maxX + padX - .5f) * factor <= .92f
                && .5f + (minY - padY - .5f) * factor >= .08f
                && .5f + (maxY + padY - .5f) * factor <= .92f;
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
