# Navrang 0.9.3 test candidate

The candidate restores the message bell and unread count in the shared Android
and browser interface. Administrators can select recipients by name or role.
Staff can send Acknowledged, On my way or Need help. Urgent messages open the
message dialog once per signed-in session, when another dialog is not open.
The server preserves the first reply and makes retries idempotent.

Updates download automatically after metadata verification while the scanner is
idle. Installation uses Android's existing confirmation flow. Code and resource
shrinking are enabled, with the existing Java bridge and reflection keep rules.

Before enabling messaging on the hosted service, apply
`server/message-replies-v093.sql`, deploy the matching Edge Function, and enable
`notification_config.center_enabled`. This candidate does not enable background
message delivery. That requires the owner Firebase Android configuration and
verification of device registration, the delivery worker and notification
permission. The existing published 0.9.2 channel remains the release baseline.

Local verification includes the complete source suite and transactional
PostgreSQL reply tests using synthetic accounts. Real-phone notification,
upgrade, scanner and optimized-package acceptance remains required before
publication. The owner requested implementation followed by testing.
