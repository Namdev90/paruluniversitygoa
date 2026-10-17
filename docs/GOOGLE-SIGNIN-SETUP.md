# Enable actual Google checker sign-in

The Android external-browser OAuth + PKCE flow and server verification are implemented. The latest recorded failures on 17 October 2026 have been diagnosed in Supabase Auth logs: Google returned `invalid_client` with “The provided client secret is invalid.” Provider enablement alone does not prove sign-in works. Assigned checker codes remain available independently.

Copy the current secret directly from the matching Google **Web application** OAuth client into Supabase Authentication → Sign In / Providers → Google, alongside that same client’s ID. Do not transcribe a screenshot, include quotes/spaces, put the secret in the APK/GitHub, or send it in chat. If it was lost, add/rotate a secret in Google, save the new value in Supabase, then retire the invalid secret after a successful test. This configuration needs account-owner access; it cannot be repaired in an APK.

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
7. Every verified Google account automatically becomes an active checker. Each verified email has one checker row and a unique immutable internal account key. The displayed username is the checker’s real name, confirmed in the app before scanning. Repeat login reuses that account. Admin suspension remains effective across sign-ins. Google checkers never receive admin privileges.
8. Verify the complete Android sign-in, real-name confirmation and matching checker row in Admin. Version 0.6 parses provider errors from both callback query and fragment, checks state and shows a setup-specific message. No successful end-to-end Google login is claimed by this release.

The APK uses browser-based Supabase OAuth, not an embedded Google WebView. It does not require a client secret in the app or the Google Play Services sign-in SDK. Install the signed 0.6.0 update over the existing app.

References: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/sessions/pkce-flow .
