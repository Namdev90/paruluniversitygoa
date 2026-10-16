# Event readiness and follow-up plan

## Before live entry
The hosted list is currently empty. Uploading the supplied private workbook to the new Supabase destination was blocked by automatic approval review; the owner can authorize that transfer or use the admin import interface.
1. Complete Google OAuth provider setup if Google login is required; otherwise create named checker codes in Admin → Checkers.
2. Install the same signed 0.2 APK on all 6–8 Android phones and sign in before reaching the venue.
3. On test-only registrations, try QR scanning, a different QR while a result is visible, a duplicate on a second phone, airplane-mode queuing and force-close/reopen recovery. Do not admit real tickets during rehearsal.
4. Import the latest complete Easebuzz export. Missing newer transactions remain unavailable until an admin import or verified manual update.
5. Use green for final admission, amber for waiting/help desk. Test actual venue Wi-Fi latency and coverage; browser update cadence is two seconds, and final approval requires a server response.

## Next iteration after the phone trial
- Adjust scan distance, preview sizing, autofocus and card placement for actual devices based on observed results.
- Complete rendered 390px and desktop visual review when the supported preview is available.
- Add signed organizer update packages and explicit device-backup restore with conflict review.
- Add checker/device health and queued-request visibility when devices reconnect.
- A local shared-network server can be planned as an event fallback if internet availability cannot support strict universal entry. Independent disconnected phones cannot enforce global uniqueness.

The source already includes the themed app icon, actual supplied art, short skippable opening, raised controls, reduced-motion transitions, swipe-down scanner entry and persistent continuous camera with automatic result overlays.
