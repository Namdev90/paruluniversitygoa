# Version 0.7 phone and laptop trial

1. Install signed 0.7.0 over the existing app. Account → Check / Install update uses the same original signing identity.
2. Google sign-in is retained and was confirmed working by the organizer. Sign in, save your real name and select a station. The camera starts only after choosing an approved Checker station.
3. New Google users request Checker or Help Desk access. In Admin → Staff, requests appear first. Open Manage access, save the real name, assign Checker, Help Desk or both and enable access.
4. Test Help Desk-only and Checker-only codes shared privately with the organizer. These are temporary: expiry appears in the app and Admin. Use Create named staff code for real volunteers; production codes are random and tied to the admin-assigned name and permissions.
5. On Android and https://navrang-gate-admin.namubhai.chatgpt.site/#desk, choose Help Desk and verify the four fields, pending receipt and admin-only editing/payment verification. Ordinary desk staff only see their own saved cases.
6. Confirm that Help Desk-only users cannot scan, enter a ticket manually or fetch the checker roster, and Checker-only users cannot read Help Desk contacts. Requesting another role must wait for admin approval.
7. On dedicated test records, test cross-phone duplicate refusal and manual acknowledgment of payment/ticket issues. Never register real admissions just for testing. Backend regression fixtures are rolled back.
8. The server is the permanent record. Roster, receipts, drafts and unconfirmed requests are temporary RAM copies. Keep the app open while confirming a request. Re-scan after process death to obtain the server result; never admit on amber.
9. Physical Android tests are still needed for camera assistance, permissions, audio, vibration, brightness, install prompts, keyboard and animation smoothness. Unit/DOM tests do not establish device behavior. The supported rendered preview was unavailable due to an environment mount-permission failure.
10. Send future organizer workbooks privately in the chat for a shared server import. Approved Help Desk tickets and confirmed entry history are preserved. Google provider credentials and test codes are not published in the repository.

Dataset at release: revision11, 1,124 canonical registrations, 1,041 eligible and 83 blocked, plus any later approved Help Desk registrations. No real admissions are created for release verification.
