package in.navrang.gate;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.ResultPoint;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.util.*;

/** Synthetic-only decode and policy checks, executable without Android or a camera. */
public final class ScannerAssistCheck {
    private static int checks;
    private static void check(boolean ok, String why) { checks++; if (!ok) throw new AssertionError(why); }
    private static ScannerQrReader.Attempt candidate(float x, float y, float size) {
        return new ScannerQrReader.Attempt(null, Arrays.asList(
            new ResultPoint(x, y), new ResultPoint(x + size, y), new ResultPoint(x, y + size)), 1000, 1000);
    }
    private static ScannerQrReader.Attempt blank() { return ScannerQrReader.inspect(new byte[32 * 32], 32, 32); }
    private static ScannerAssist.Decision step(ScannerAssist a, long t, boolean dark, boolean bright, boolean soft,
            ScannerQrReader.Attempt q, float zoom, float max, boolean torch, boolean auto, boolean flash, boolean focusing) {
        return a.inspect(t, true, dark, bright, soft, q, zoom, max, torch, auto, flash, focusing);
    }
    public static void main(String[] args) throws Exception {
        decodeFixtures();
        ScannerQrReader.Attempt small = candidate(450, 450, 100), edge = candidate(20, 450, 100), none = blank();
        check(small.fitsZoom(1.2f), "centred small candidate has safe room");
        check(!edge.fitsZoom(1.2f), "off-centre candidate must not be clipped by zoom");
        check(!small.fitsZoom(Float.NaN), "invalid zoom ratio is rejected");
        ScannerAssist a = new ScannerAssist();
        check(step(a, 0, false, false, true, small, 1, 4, false, true, true, false).focus, "initial soft candidate autofocus");
        check(!step(a, 500, false, false, true, small, 1, 4, false, true, true, false).focus, "focus cooldown prevents half-second hunting");
        check(!step(a, 3000, false, false, true, small, 1, 4, false, true, true, true).focus, "in-flight focus blocks new focus");
        ScannerAssist.Decision focused = step(a, 3500, false, false, true, edge, 1, 4, false, true, true, false);
        check(focused.focus && focused.focusX < .2f, "focus follows an off-centre target in analyzer coordinates");
        a.manualFocus(4000);
        check(!step(a, 4500, false, false, true, small, 1, 4, false, true, true, false).focus, "manual focus is respected");
        ScannerAssist light = new ScannerAssist();
        check(step(light, 0, true, false, false, none, 1, 4, false, true, true, false).torch == -1, "one dark sample cannot enable torch");
        check(step(light, 500, true, false, false, none, 1, 4, false, true, true, false).torch == -1, "two dark samples cannot enable torch");
        check(step(light, 1000, true, false, false, none, 1, 4, false, true, true, false).torch == 1, "stable darkness enables torch");
        for (int i = 1; i <= 5; i++) check(step(light, 1000 + i * 500, false, true, false, none, 1, 4, true, true, true, false).torch == -1, "torch cooldown avoids flicker");
        check(step(light, 6000, false, true, false, none, 1, 4, true, true, true, false).torch == -1, "sample gap resets bright evidence");
        for (int i = 1; i < 4; i++) step(light, 6000 + i * 500, false, true, false, none, 1, 4, true, true, true, false);
        check(step(light, 8000, false, true, false, none, 1, 4, true, true, true, false).torch == 0, "stable bright scene releases torch");
        ScannerAssist noFlash = new ScannerAssist();
        for (int i = 0; i < 10; i++) check(step(noFlash, i * 500, true, false, false, none, 1, 1, false, true, false, false).torch == -1, "no-flash device never gets torch command");
        ScannerAssist zoom = new ScannerAssist();
        check(step(zoom, 0, false, false, false, small, 1, 4, false, true, true, false).zoom == 1.2f, "small centred candidate gently zooms");
        check(step(zoom, 500, false, false, false, small, 1.2f, 4, false, true, true, false).zoom == 0, "zoom cooldown avoids pumping");
        check(step(zoom, 3000, false, false, false, edge, 1.2f, 4, false, true, true, false).zoom == 0, "near-edge candidate gets framing advice instead of crop");
        check(step(zoom, 9500, false, false, false, none, 1.2f, 4, false, false, true, false).zoom == 1, "automatic zoom resets even when light is manually controlled");
        check(step(new ScannerAssist(), 0, false, false, false, small, 1, 1, false, true, true, false).zoom == 0, "fixed-zoom camera is supported");
        check(step(new ScannerAssist(), 0, false, false, false, small, 1.8f, 4, false, true, true, false).zoom == 0, "automatic zoom never exceeds 1.8x");
        ScannerAssist manual = new ScannerAssist(); manual.manualZoom(0);
        check(step(manual, 1000, false, false, false, small, 1, 4, false, true, true, false).zoom == 0, "recent manual zoom is respected");
        ScannerAssist.Decision paused = manual.inspect(1500, false, true, false, true, small, 1, 4, false, true, true, false);
        check(paused.zoom == 0 && paused.torch == -1 && !paused.focus, "pending, role, ID, and lifecycle pause disables all assist actions");
        ScannerAssist read = new ScannerAssist(); read.read(0);
        check(step(read, 500, false, false, true, small, 1, 4, false, true, true, false).zoom == 0, "recent successful read suppresses zoom");
        check(!step(read, 1000, false, false, true, small, 1, 4, false, true, true, false).focus, "recent successful read suppresses focus");
        System.out.println("PASS native automatic camera: " + checks + " synthetic decoder and bounded-assistance checks.");
    }

    private static void decodeFixtures() throws Exception {
        BitMatrix qr = new QRCodeWriter().encode("SYNTH001", BarcodeFormat.QR_CODE, 200, 200);
        BufferedImage ticket = new BufferedImage(200, 200, BufferedImage.TYPE_BYTE_GRAY);
        for (int y = 0; y < 200; y++) for (int x = 0; x < 200; x++) ticket.setRGB(x, y, qr.get(x, y) ? 0 : 0xffffff);
        int[][] centres = {{400, 300}, {160, 160}, {640, 440}};
        for (int angle : new int[] {0, 30, 90, 135, 180, 270}) for (int[] centre : centres) {
            BufferedImage frame = new BufferedImage(800, 600, BufferedImage.TYPE_BYTE_GRAY);
            Graphics2D graphics = frame.createGraphics(); graphics.setColor(Color.WHITE); graphics.fillRect(0, 0, 800, 600);
            graphics.translate(centre[0], centre[1]); graphics.rotate(Math.toRadians(angle)); graphics.drawImage(ticket, -100, -100, null); graphics.dispose();
            byte[] normal = new byte[800 * 600], inverted = new byte[normal.length], low = new byte[normal.length];
            for (int y = 0; y < 600; y++) for (int x = 0; x < 800; x++) {
                int value = frame.getRGB(x, y) & 255, k = y * 800 + x;
                normal[k] = (byte) value; inverted[k] = (byte) (255 - value); low[k] = (byte) (value == 0 ? 90 : 150);
            }
            for (byte[] data : new byte[][] {normal, inverted, low}) {
                ScannerQrReader.Attempt result = ScannerQrReader.inspect(data, 800, 600);
                check("SYNTH001".equals(result.value), "rotated/off-centre/contrast fixture " + angle + " at " + centre[0]);
                check(Math.abs(result.centerX - centre[0] / 800f) < .08f, "finder coordinates stay in raw analyzer orientation");
            }
        }
        check(ScannerQrReader.inspect(null, 0, 0).value == null, "invalid input cannot decode");
        check(blank().value == null, "blank frame cannot decode");
    }
}
