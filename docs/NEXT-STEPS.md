# Prototype 0.3.0 phone trial

1. Install Android 0.3.0 over the existing signed app. The visible redesign requires this APK; a server change cannot replace already installed HTML/native camera screens.
2. Google sign in from the APK itself. Save the real checker name. Reopen the app and confirm the same name/account is retained. No Google user had completed registration in the last server check before this iteration; do not count a successful redirect as a completed app sign-in.
3. Admin → Simulate → Start auto scan. Try paid, duplicate, failed-payment and unknown samples; acknowledge each help-desk alert. Try sample network offline/online, sample edits and checker activation. The amber strip must remain visible. Nothing from rehearsal should appear in the real ledger.
4. On the target phones, review opening audio, the sound toggle, scan vibration, low light/torch, screen QR glare, inverted QR, small-code auto zoom, tap focus, camera denial and exact ticket-ID fallback. Test held QR and immediate different QR. Do not admit real tickets during rehearsal.
5. Check login, home, account, admin tables and dialogs on the smallest phone with the keyboard open and with larger fonts. Lists page; never hide inaccessible critical controls to make a screenshot fit.
6. On dedicated test records, verify two-phone duplicate prevention, outbox recovery after force-close and response loss, admin suspension during a scan, name attribution, airplane-mode amber status and actual venue network latency.
7. Supply the latest complete organizer workbook in the working chat for an authorized server update. Current app has no import/export/backup UI. Confirmed admissions must survive every update.
8. The hosted Site is no longer the administration workflow; all admin features are in the APK. Its removal was not performed because the connector has no delete/unpublish method, and Google/Supabase currently reference its origin as fallback/home. Retire those references and delete the old Site manually before removing that fallback.
9. If Google is in Testing, add volunteers as Test users or configure its public audience before expecting any Google account to work.

## Next production update

Use the real phone results to adjust focus/torch/zoom thresholds and layout. Do a venue trial before making reliability/throughput claims. The soft-image prompt is heuristic; the code cannot prove a lens is blurry. No physical camera/rendered browser test was available here.

Consider CameraX with a bundled on-device detector for a later scanner engine change. ML Kit's auto-zoom API is documented, but it is not integrated into this small ZXing prototype. Keep any future backend/data update audited, and preserve immutable admissions and checker identity across UI changes.

Official references used for this iteration:
- Android Camera parameters: https://developer.android.com/reference/android/hardware/Camera.Parameters
- ZXing QR reader: https://github.com/zxing/zxing/blob/master/core/src/main/java/com/google/zxing/qrcode/QRCodeReader.java
- ML Kit barcode/auto zoom guidance: https://developers.google.com/ml-kit/vision/barcode-scanning/android
