# App updates from 0.4 onward

Install the signed 0.4 APK manually once. Earlier APKs have no app-update client and cannot discover this bootstrap update automatically. Dataset updates already sync independently from the event server.

The APK checks this repository's `updates/latest.json` on startup/resume (five-minute throttle), while foregrounded every five minutes, and through Android's periodic network job (minimum 15 minutes; device power/network policy can delay it). Automatic checks/downloads can be disabled in Account. Notification permission is optional; the Account screen also shows update status. The scanner takes priority: automatic update work waits/yields while it is open.

Metadata must use the exact repository HTTPS channel, a higher version code, a valid version name, bounded size and SHA256. The downloader writes a private temporary APK, verifies the size/hash, and checks that its package, version and signing certificate match the installed app before marking it ready. It re-verifies before installation. No downloaded HTML/JavaScript is injected into the running app.

A ready update appears in Account and, if allowed, as a notification. Tap Install update while your station is idle. Android may first ask to allow installs from Navrang Gate and then shows its package installation confirmation. Cancellation leaves the installed app working. App data stays in the same package. Installation is not silently forced during a check-in. Automatic silent installation is not promised; this channel explicitly requests user confirmation, including on Android versions that can support limited unattended self-update cases.

## Publishing the next app version

1. Increase `versionCode` and `versionName` in `release.json`. Keep the original private signing key; a new test key cannot update existing installations.
2. Run `python tools/build.py` using the established Android SDK/JDK setup. It signs/verifies the APK and invokes `tools/prepare-release.py` to create `downloads/Navrang-Gate-<version>.apk`, `updates/latest.json` and the checksum line.
3. Commit and push those release files along with the source. Installed 0.4+ clients can then discover/download that release. A source-only Git push does not build or distribute a new APK by itself; no secret-bearing GitHub signing workflow has been configured.
4. Check the public manifest and APK hash after pushing. Test a real upgrade on the intended Android phone before relying on it at the venue.

Official references:
- https://developer.android.com/reference/android/content/pm/PackageInstaller.SessionParams#setRequireUserAction(int)
- https://developer.android.com/guide/playcore/in-app-updates (the separate Google Play distribution workflow)
