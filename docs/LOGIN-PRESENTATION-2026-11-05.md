# Login presentation review

## Production route and classic shell

The production manifest launches `MainActivity`, which extends the generated
`ClassicActivity` host and loads `file:///android_asset/index.html`. The retained
Compose `GateApp` is not called by this launcher. Compose screenshots therefore
do not validate the shipped login.

The production change is a narrow `#view-login` CSS override in
`app/assets/art/classic-restore.css`: quiet dark inner panels, flat rounded fields,
explicit high-contrast focus, flat maroon primary actions and 48px minimum input
and action heights. It preserves the existing dark shell, approved maroon brand
surround, combined artwork and all staged sign-in DOM and JavaScript. No scanner
selectors are changed. A new light theme is not introduced to the classic shell.

The existing production-DOM browser harness now supports `--login-only`. It
exercises welcome, role selection, Google sign-in, focused masked staff-code and
administrator forms at normal and 1.6x synthetic text size. Run:

`python3 tests/responsive-browser-check.py --login-only --sizes 320x480,390x844,1366x768 --output .build/classic-login-review`

Initial execution was blocked before rendering by Chromium's local socket
permission (`process_singleton_posix.cc: socket() failed: Operation not permitted`).
No classic-login screenshot or browser pass is claimed from that attempt.
The 29 auth-flow, classic-restoration and compact-layout regression tests passed,
including production launcher reachability and login-only styling contracts.

## Retained Compose login

This focused source change adapts the inspected reference's quiet panel, concise
heading and softly rounded neutral field treatment to Navrang's existing login.
It retains the official artwork and maroon primary, bounds the form to 560dp on
wide windows, wraps the sign-in method chips, and gives the login actions explicit
48dp minimum heights. Field fill and focus colors derive from the active theme;
dark and dynamic appearance selection remain intact. The static light theme's
background and surface are now neutral near-white instead of pink-white.

No new font, asset, animation, decorative gradient, OTP entry, or success state is
introduced. The reference's lower shading was a caption overlay, not a design
element. Existing password masking, secret clearing, sign-in callbacks, role
approval wording and reduced-motion handling are unchanged. Scanner components,
dialogs, authentication implementation, media, backend and database code are not
part of this pass.

## Source verification

- `python3 tests/native-login-presentation-check.py`: passed, 4 source contracts.
- `python3 tests/native-scanner-details-check.py`: passed, 4 existing contracts.
- `git diff --check`: passed.

After the toolchain became available, `LoginPresentationUiTest` passed all seven
synthetic Android tests and generated eight renders: Google light and wide,
staff light unfocused/focused, administrator dark focused, dynamic light/dark,
and staff at 320x480 with 1.6x text. Visual inspection found readable fields,
distinct focus outlines, preserved masking and bounded/wrapping layouts in those
fixtures. The small-screen fixture verifies scrolling/reachability, not a real
IME keyboard. An initial test failure was corrected to scroll lazy items into
composition before querying them; no production fix was required.

Physical-device acceptance, real IME behavior, TalkBack, measured contrast and
real authentication remain unverified. Synthetic Compose renders do not establish
classic WebView layout or runtime accessibility conformance.

## Production browser verification on the laptop

The existing official Chrome 156 and existing Playwright runtime executed the actual production DOM/CSS/JS with synthetic transport and blocked network. All 64 inputs in a new isolated fixture copy were verified against cloud source. The first run exposed the old Back-selector priority and cramped enlarged text. Three login-only CSS fixes preserve 48px Back controls, allow Google action text to grow vertically, and wrap long headings.

The final 30 cases passed with zero failures, JavaScript errors or unexpected requests at 320x480, 390x844 and 1366x768 with normal/1.6x synthetic text. Final narrow staff/admin, enlarged role picker and wide welcome pixels were reviewed with no overlap observed. High-contrast focus and masking remained visible. The test distinguishes harmless visible font extents from actual clipping; horizontal overflow, touch targets and focus remain strict.

CSS SHA-256: `5ead41ffe774925f295ba8ac434bd98dc970b5e8aafdd3f1dec8a4a85d7bf42b`. Harness SHA-256: `35d9a0178d2ebd23bc2bd15673b61fa821d5205335bf5b16969b630121ac12f4`. Result JSON SHA-256: `7d553d6034ff57f3f708c0e54d2be12197d7c4dc00d935b259de94688e06a289`. Browser screenshots were not uploaded. This remains synthetic desktop Chromium evidence, not Android WebView, physical keyboard, IME or TalkBack acceptance. The corrected assets require a fresh APK receipt.
