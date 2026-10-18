# App updates from 0.4 onward

The current signed download is [0.7.8](../downloads/Navrang-Gate-0.7.8.apk). Install it over the existing app without uninstalling. Versions before 0.4 have no app-update client and need a manual upgrade to the current release; there is no need to install each intermediate version. Dataset updates already sync independently from the event server.

The APK checks this repository's `updates/latest.json` on startup/resume (five-minute throttle), while foregrounded every five minutes, and through Android's periodic network job (minimum 15 minutes; device power/network policy can delay it). Automatic checks/downloads can be disabled in Account. Notification permission is optional; the Account screen also shows update status. The scanner takes priority: automatic update work waits/yields while it is open.

Metadata must use the exact repository HTTPS channel, a higher version code, a valid version name, bounded size and SHA256. The downloader writes a private temporary APK, verifies the size/hash, and checks that its package, version and signing certificate match the installed app before marking it ready. It re-verifies before installation. No downloaded HTML/JavaScript is injected into the running app.

A ready update appears in Account and, if allowed, as a notification. Tap Install update while your station is idle. Android may first ask to allow installs from Navrang Gate and then shows its package installation confirmation. Cancellation leaves the installed app working. App data stays in the same package. Installation is not silently forced during a check-in. Automatic silent installation is not promised; this channel explicitly requests user confirmation, including on Android versions that can support limited unattended self-update cases.

## Interrupted installation recovery

The scanner's admission fence is rebuilt from this app's Android-owned installer sessions before new requests can be queued, including after process recreation or reboot. Pending or idle sessions keep scanning blocked. An installer query failure also keeps scanning blocked until state can be checked. This stores no attendee data and does not change the RAM-only outbox policy.

The Account screen keeps **Finish app update** available while an installation is outstanding, even if the downloaded APK or cached release metadata is missing. If Android has delivered a confirmation Intent to the reopened app, the button opens that same confirmation. Otherwise the button requests cancellation of the interrupted attempt. Scanning remains blocked until a matching terminal callback arrives or Android reports the session no longer exists. If cancellation is still pending, wait and retry; once it is cleared, tap Install again to reverify and start a fresh update. Recovered sessions are never blindly re-committed because older Android releases can re-enter installation while earlier work is already running.

The deterministic updater regression harness recreates the app runtime while retaining fake Android installer state; it covers API-level branches, multiple/stale sessions, missing callbacks, delayed/failed cancellation and query failures. These are host-side tests, not physical Android process-kill or reboot validation. Before venue use, verify upgrade, cancellation, process recreation and reboot on the intended phones.

References:
- [Owned sessions and session lookup](https://developer.android.com/reference/android/content/pm/PackageInstaller#getMySessions())
- [Session lifecycle and commit contract](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session#commit(android.content.IntentSender))
- [Android 7 installer session implementation](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-7.0.0_r1/services/core/java/com/android/server/pm/PackageInstallerSession.java)
- [Android 10 installer session implementation](https://raw.githubusercontent.com/aosp-mirror/platform_frameworks_base/android-10.0.0_r1/services/core/java/com/android/server/pm/PackageInstallerSession.java)

## Publishing the next app version

1. Coordinate an unused `versionName` and strictly higher `versionCode` in `release.json`; obtain matching final-source approval and device evidence or a genuinely applicable waiver. Keep the original private signing key in its retained environment.
2. Run `python3 tools/build.py` using that environment's verified Android SDK/JDK and privately configured `NAVRANG_SIGNING_KEY`. The default delegates to `tools/build-native.py`, which builds, signs and verifies a candidate in `dist/`. **The default build does not call `prepare-release.py` and does not publish an update.**
3. Independently inspect the actual candidate package/version, original signer certificate, source assets, byte length and SHA-256. After artifact/publication approval, set `NAVRANG_BUILD_TOOLS` to the verified SDK build-tools directory (or correctly configure `NAVRANG_ANDROID_SDK`), then separately run `python3 tools/prepare-release.py`. `ANDROID_HOME` alone is not this script's build-tools override. This step prepares `downloads/Navrang-Gate-<version>.apk`, `updates/latest.json` and the checksum line, with no overwrite/rollback allowed.
4. Review and commit the exact source/artifact/manifest/checksum through the normal authorized repository process. A source-only push, unsigned assembly or local candidate does not create an installable update. No signing key belongs in GitHub or CI.
5. Re-download the public manifest/APK/checksum, verify exact identity and original signature, and check every historical APK is unchanged. Installed upgrade/reboot/phone acceptance must be verified or explicitly reported as unverified. See [the current release procedure](RELEASE-PROCEDURE.md).

Official references:
- https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)
- https://developer.android.com/guide/playcore/in-app-updates (the separate Google Play distribution workflow)

Release preparation refuses changed bytes for an existing downloadable version and refuses older/reused update version codes. An identical rerun is allowed. Keep the original signing key in a private backup; it must never enter this public repository.

## Historical GitHub Releases

The additive [archive migration](history/GITHUB-RELEASES.md) attaches the already-published APK bytes to versioned GitHub Releases. It does not rebuild/sign APKs or change `updates/latest.json`. Original archive commit dates remain in release notes; GitHub records the actual migration publication time.
