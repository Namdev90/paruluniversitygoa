# Enable actual Google checker sign-in

The Android external-browser OAuth + PKCE flow and server verification are implemented. Google sign-in was confirmed working by the owner on Android on 17 October 2026. Assigned checker codes work independently; the app labels the two methods separately.

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
7. Every verified Google account automatically becomes an active checker. Each verified email has one checker row and a unique immutable `checker_<UUID>` username. Repeat login reuses that account. Admin suspension remains effective across sign-ins. Google checkers never receive admin privileges.
8. Verify the full flow on the actual Android phone. The owner confirmed successful phone sign-in; retest scanning with the intended checker account.

The APK uses browser-based Supabase OAuth, not an embedded Google WebView or a fabricated identity. It does not require shipping a client secret or the Google Play Services sign-in SDK. Android app data is preserved by installing the signed 0.2.0 APK over 0.1.0; do not uninstall or clear data during live use.

References: https://supabase.com/docs/guides/auth/social-login/auth-google and https://supabase.com/docs/guides/auth/sessions/pkce-flow .
