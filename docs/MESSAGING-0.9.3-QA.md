# Navrang 0.9.3 verification

The candidate restores the message bell and unread count in the shared Android
and browser interface. Administrators can select recipients by name or role.
Staff can send Acknowledged, On my way or Need help. Urgent messages open the
message dialog once per signed-in session, when another dialog is not open.
The server preserves the first reply and makes retries idempotent.

Updates download automatically after metadata verification while the scanner is
idle. Installation uses Android's existing confirmation flow. Code and resource
shrinking are enabled, with the existing Java bridge and reflection keep rules.

The hosted service has `server/message-replies-v093.sql`, Edge Function version 11
and `notification_config.center_enabled` enabled for candidate testing.
Anonymous clients have no direct reply-function access.
This candidate does not enable background
message delivery. That requires the owner Firebase Android configuration and
verification of device registration, the delivery worker and notification
permission. The existing published 0.9.2 channel remains the release baseline.

Local verification includes the complete source suite, 212 browser checks,
173 checks of the actual native updater, and transactional PostgreSQL reply
tests using synthetic accounts. The original-key APK upgraded 0.9.2 on the
dedicated emulator while retaining its app ID, data directory and install time.
The owner requested publication on 10 November 2026 after the test-build report.
Physical-phone notification, scanner and curved-screen behaviour remain untested.

The shared navigation and controls were reviewed across sign-in, Scan, Help Desk,
Entries, Account, Settings, Admin and Reports, including form dialogs. Stable
navigation, labelled fields, familiar search/filter controls, explicit save and
download actions, and a common Back/Close convention apply across those routes.
The Android host adds its native scanner and system installation/permission UI.
This review does not establish usability acceptance by real staff.
