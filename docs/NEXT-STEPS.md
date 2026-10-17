# Version 0.6 phone and laptop trial

1. Install signed 0.6 over the existing app, or use 0.4 Account → Check/Install update after release publication. Keep the original signing identity.
2. Open the laptop portal at https://navrang-gate-admin.namubhai.chatgpt.site/#desk. Choose Help Desk on Android login. Sign in with the assigned staff account; admin enables its Help Desk access under Admin → Checkers.
3. On a dedicated authorized test person, verify name, email, mobile and quantity, pending save receipt, server visibility on the other interface, admin editing/approval and college CSV download. Do not register real admissions just for testing.
4. Verify startup full media volume, strong scan vibration, activity brightness, camera/notification prompts and denied-permission recovery on the actual phone. Device/DND policy may limit sound or notifications.
5. Test the four-field form, quantity controls, keyboard, saved-list paging and admin review at the smallest phone and laptop sizes. Rendered preview is unavailable in this environment; DOM checks are not visual QA.
6. The server is the permanent student record. The app/browser keeps temporary RAM copies only. Keep the app open during uncertain submissions and retry the same request. Pending requests do not survive process death; re-scan after reopening to obtain the server result. Never admit on amber.
7. Check camera torch/focus/zoom, inverted/glare QR, duplicate refusal across phones and manually acknowledged payment issues on dedicated test records. The latest Google callback logs show invalid_client: the provider client secret is invalid. Replace it in Supabase from the matching Google Web OAuth client, then verify sign-in end to end on the phone.
8. App updates still need a higher signed APK and manifest to be published. Source-only pushes do not distribute an APK. Android confirms installation; do not expect a silent replacement during scanning.
9. Send future organizer workbooks in the chat for a shared server import. Approved Help Desk tickets and confirmed admissions are preserved.

Current organizer dataset: revision11, 1,124 registrations, 1,041 eligible, 83 blocked, plus any subsequently approved Help Desk registrations. Database tests are rollback-only and leave no synthetic people or admissions.

10. Verify no blue press/long-press wash, the raised button states, branded close warning, complete dancer feet and separate skirt, and all distinct always-on stock scan/result sounds on the intended phone. Physical audio loudness and rendered animation smoothness are not established by DOM tests.
