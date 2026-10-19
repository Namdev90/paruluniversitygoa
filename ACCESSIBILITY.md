# Accessibility

This document records the interface's existing accessibility-related features, verification limits and how to report a barrier. It does not claim WCAG conformance, accessibility certification or compatibility with every assistive technology.

## Existing interface support

The current shared interface includes:

- Visible labels and accessible names on key form, navigation and scanner controls.
- Text descriptions of scan outcomes alongside visual and sound feedback; selected connection/result updates use live status announcements.
- Visible keyboard focus styling and focusable scrolling regions for entry and Help Desk lists.
- A skippable opening animation and reduced-motion CSS for supported motion effects.
- Responsive layouts, wrapping labels and bounded content scrolling, including the phone report-download area.
- Exact ticket-ID entry inside the native camera screen as an alternative to decoding a QR code. It uses the same authorization and admission safeguards.

These are implementation features, not proof that every screen is accessible. See [interface and accessibility details](docs/FEATURES.md#branding-interface-and-accessibility) and the [shared interface source](app/assets/index.html).

## Verification and known limits

The repository contains synthetic layout, large-text and interaction checks. Read the [verification record](docs/VERIFICATION-2026-10-18.md), [native parity reference](docs/NATIVE-PARITY.md) and [0.7.9 release evidence](docs/RESTORATION-RELEASE-0.7.9.md) for their source versions and scope. Dated evidence describes those checkpoints; it does not certify later changes.

Physical-device accessibility acceptance remains unverified in the recorded release evidence. Full TalkBack/screen-reader operation, switch access, keyboard-only completion, operating-system font/display scaling, browser zoom, all contrast states and performance on actual devices need dedicated testing. A synthetic screenshot, automated layout pass or owner-deferred device check must not be reported as a completed accessibility audit.

## Report an accessibility barrier

Use the [issue tracker](https://github.com/Namdev90/paruluniversitygoa/issues) for a non-sensitive accessibility report. Include only what you are comfortable sharing publicly:

- App version or source commit; device, operating system and browser/WebView version.
- Affected screen and role, the task you were trying to finish, and the barrier encountered.
- Relevant assistive technology and settings, such as TalkBack, keyboard navigation, text size, zoom or reduced motion.
- Reproduction steps, expected behavior and a synthetic or carefully redacted screenshot if helpful.

You do not need to disclose a diagnosis or personal medical information. Never attach attendee records, staff codes, credentials or private payment details. Use the [security reporting guidance](SECURITY.md) if the issue would expose private information.

## Review accessibility changes

Preserve readable labels, keyboard focus, status text, reduced-motion behavior and access to primary actions. Check narrow and short viewports, long content, enlarged text, loading/error/empty states and repeated interactions. Test changes with the relevant assistive technology on real devices when possible, and record any remaining checks honestly. Follow [Contributing](CONTRIBUTING.md) for regression checks and synthetic-data requirements.
