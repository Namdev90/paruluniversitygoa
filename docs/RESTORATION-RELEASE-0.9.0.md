# Navrang 0.9.0 release record

Android version code 19. Reviewed source commit `9914009c24e81a22d031f7ff029277a0e1e7e2a9`.

This release refines Account, Admin, Reports, and scanning. It includes swipe navigation, app lock, and a collapsible desktop menu. Location & audio and event notifications are excluded from the app and browser package. Android app update alerts use the existing updater.

The exact signed APK upgraded from the published 0.8.0 on an isolated Android API 37 emulator. The package retained its app ID, installation time, and app data directory, then launched successfully. The owner’s physical phone was excluded from this release check.

All 388 browser checks passed across four screen sizes. The signing check verified the original certificate, launcher artwork, APK identity, and the exclusion of location and microphone permissions and deferred web assets.

- APK size `24,669,040` bytes
- SHA-256 `24f8705db9e8207af420ae5f56e57c34fcb0ad6ecc8f06006f749eb4853c7183`
