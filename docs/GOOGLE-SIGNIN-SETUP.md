# Enable actual Google checker sign-in

Google sign-in was reported fully working by the organizer on 17 October 2026 at 12:37 IST. Version 0.7 preserves the provider, callback, PKCE and verified-email identity flow. Its changes happen after sign-in: real-name confirmation, station selection and admin-assigned access. The earlier client-secret failure is resolved; do not replace working credentials for this release.

1. Open Google Auth Platform in your Google Cloud project: https://console.cloud.google.com/auth/overview . Set the app name to Navrang Gate and configure the support/owner contact.
2. Configure audience. During Testing, add every volunteer's Google email as a test user; otherwise configure an audience that permits the intended volunteers. Request only openid, email and profile.
3. Create a **Web application** OAuth client. Use this exact authorized redirect URI:
   https://mzesveurjzxjybkejqmx.supabase.co/auth/v1/callback
4. Open the dedicated Supabase project provider page:
   https://supabase.com/dashboard/project/mzesveurjzxjybkejqmx/auth/providers
   Enable Google, enter the client ID and client secret there, and save. Keep the secret out of the app, GitHub and chat.
5. In Supabase Authentication → URL Configuration, allow:
   - navranggate://auth-callback** (Android PKCE callback; its state query is generated per sign-in)
   - https://navrang-gate-admin.namubhai.chatgpt.site/
   If Google browser sign-in will be used at the hosted app, add that HTTPS origin to Google's authorized JavaScript origins too.
6. Open the Android app, tap Continue with Google and finish in the system browser. The app receives a short-lived authorization code, checks the saved state and exchanges with its saved PKCE verifier.
7. Each verified email retains one staff identity and immutable internal account key. New Google users save their name and choose Checker or Help Desk to request access. Admin approves and assigns the station in Admin → Staff → Manage access; the request itself never grants permission. Existing approved checkers keep their access. Repeated Google login preserves names, assigned permissions and suspensions; it never creates an admin account.
8. Verify the complete Android sign-in, real-name confirmation and matching checker row in Admin. Version 0.6 parses provider errors from both callback query and fragment, checks state and shows a setup-specific message. The organizer confirmed the Google login itself; verify the new station selection on the actual phone.

The APK uses browser-based Supabase OAuth, not an embedded Google WebView. It does not require a client secret in the app or the Google Play Services sign-in SDK. Install the signed 0.7.0 update over the existing app.

References: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/sessions/pkce-flow .
