# Version 0.4 phone trial and final release

1. Install signed 0.4 manually over the existing app once. Earlier versions cannot discover app updates automatically. Dataset revision11 already syncs independently: 1,124 registrations, 1,041 eligible and83 blocked.
2. Verify the horizontal university logo on launch, login, header, scanner and app icon. Check the longer dancer reveal and opening sound, skipping and reduced motion. Simulation is removed.
3. In admin, verify scrolling/paging, the keyboard and larger fonts on the smallest phone. Confirm that unchanged polls no longer replace checker buttons or registration rows. Actual frame smoothness requires a phone review.
4. Sign in with Google from the APK, save the checker real name and reopen to verify account retention. Confirm the same email reuses its checker and suspension remains effective. A redirect/provider toggle alone is not proof of full app sign-in.
5. On dedicated test records, try the continuous scanner, held QR, immediate different QR, duplicate on another phone, payment/unknown alerts, exact-ID fallback, haptics, sound off, low light, focus/zoom and glare. Avoid real admissions during rehearsal. The built-in rehearsal tools have been removed after the organizer's trial.
6. Try response loss, airplane mode and force-close/reopen. Pending requests must remain amber until the server confirms; their immutable receipt and attribution must survive retries.
7. In Account, test Check, optional notifications and automatic downloads. After publishing a higher signed version, verify download hash/signature checks and Android install confirmation on the actual phone. Do not promise silent installation or a fixed background-job interval.
8. For future app releases, bump `release.json`, build with the original key and push the generated APK, manifest and checksum. Source-only pushes do not distribute an APK. See APP-UPDATES.md.
9. Supply newer complete organizer exports privately in the chat for an authorized server import. Preserve existing admissions. The app exposes no file import/export/backup tools.
10. Before retiring the old Site manually, remove/replace its Google/Supabase homepage/fallback references. The current connector cannot delete/unpublish it. All operational admin features are embedded in the APK.

Final venue readiness still depends on actual phone camera/install/layout checks and Wi-Fi coverage/latency. No measured near-zero failure rate or frame-rate result has been established in the workspace.
