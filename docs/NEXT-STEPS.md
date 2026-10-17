# Version 0.7.3 phone and laptop trial

1. Install signed 0.7.3 over the existing app. Account → Check / Install update uses the same original signing identity.
2. Google sign-in is retained and was confirmed working by the organizer. Sign in, save your real name and select a station once. Later sign-ins open that saved station directly; only admin can change it. The camera starts only after choosing an approved Checker station.
3. New Google users request Checker or Help Desk access. In Admin → Staff, requests appear first. Open Manage access, save the real name, assign Checker or Help Desk and enable access.
4. The original temporary test codes expired at 3 PM IST on 17 October. Use Create named staff code for volunteers; codes are random and tied to the admin-assigned name and station.
5. On Android and https://navrang-gate-admin.namubhai.chatgpt.site/#desk, choose Help Desk and verify the four fields, pending receipt and admin-only editing/payment verification. Ordinary desk staff only see their own saved cases.
6. Confirm that Help Desk-only users cannot scan, enter a ticket manually or fetch the checker roster, and Checker-only users cannot read Help Desk contacts. A second station choice is rejected; Namdev must reassign the station. Both staff dashboards show only My scans and Total entries. The full roster, entry log and event statistics remain admin-only.
7. On dedicated test records, test cross-phone duplicate refusal and manual acknowledgment of payment/ticket issues. Never register real admissions just for testing. Backend regression fixtures are rolled back.
8. Check that Sign out returns immediately to login, even on a slow connection. Expired sessions and revoked Help Desk access clear temporary forms and old rows. The server is the permanent record. Roster, receipts, drafts and unconfirmed requests are temporary RAM copies. Keep the app open while confirming a request. Re-scan after process death to obtain the server result; never admit on amber.
9. Physical Android tests are still needed for camera assistance, permissions, audio, vibration, brightness, install prompts, keyboard and animation smoothness. Unit/DOM tests do not establish device behavior. The supported rendered preview was unavailable due to an environment mount-permission failure.
10. Send future organizer workbooks privately in the chat for a shared server import. Approved Help Desk tickets and confirmed entry history are preserved. Google provider credentials and test codes are not published in the repository.

Original organizer import: revision11, 1,124 canonical registrations, 1,041 eligible and 83 blocked, plus any later approved Help Desk registrations. No real admissions are created for release verification.

The 0.7.3 audit made no live ticket, payment, staff or admission changes. Preserve subsequent organizer edits and the current server revision.
