# Optional Daily SDK source

Checked 25 October 2026. These classes are excluded from the default Gradle source sets and have no production authority or media factory binding. `VOICE_ENABLED` remains false. No CallClient was instantiated during validation, and no provider request, microphone capture, credential minting, signing or deployment was performed.

`DailyNativeCredential` is a native-only, single-consumption descriptor. It validates an exact approved owner host, HTTPS room path, room/identity/lease syntax, generation and a monotonic deadline of at most 15 seconds. The caller must first authorize the descriptor against the current server session; syntax validation is not authorization. Tokens are neither logged nor exposed to JavaScript. The owned character array is cleared when consumed/destroyed. The SDK requires a temporary immutable String, so this does not promise complete memory erasure. The caller owns and must clear its original input buffer.

`DailySdkSession` serializes one slot through an injected owner loop. Every join starts with camera, microphone, screen input and publishing explicitly disabled. It emits readiness only after the matching join acknowledgement. Listener credentials cannot enable a microphone. Publisher enable acknowledgement is tied to its slot and input revision. Cancellation, replacement and expiry invalidate late callbacks. A superseded enable callback or timeout cannot close a newer input operation.

Close immediately issues local disable intent. Replacement waits for disable and leave acknowledgements, then releases the old client before creating another. The total close deadline is 1.5 seconds. A missing/failed acknowledgement or release exception forces release, poisons that session owner, and rejects further opens. Join and input acknowledgement also have 1.5-second deadlines, shortened by credential expiry. There is no automatic retry or reconnect. These are conservative source-level bounds; SDK acknowledgements do not establish physical capture-stop latency, native request ordering, relay revocation or behavior after process death.

`DailySdkDriver` calls the actual pinned SDK and enforces a single Handler thread. A revision fence prevents a late publishing-enable acknowledgement from issuing a microphone-enable request after disable. It is a lower-level asynchronous wrapper, not an implementation of `VoiceMediaTransport` and not a registered runtime factory. Future integration must preserve receive/publisher switching, fresh authority, immediate stop intent and acknowledged readiness in the coordinator. Daily's documented join API expects required audio/video permissions before joining; a muted listener join without microphone permission still requires an isolated device/provider test before any production binding. No default microphone prompt may be added to work around this uncertainty.

Production handler/private RPC/runtime factory wiring remains unmodified following an automatic approval-review rejection of the separate multi-file wiring action. This optional source and its isolated checks do not retry that action. Owner/provider configuration, packaging, strict relay enforcement and device acceptance remain blockers to working voice.

## Pinned artifacts and size

Artifacts came from [Maven Central](https://repo.maven.apache.org/maven2/co/daily/client/0.41.0/), with SHA-256 checked against the published checksum files:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `co.daily:client:0.41.0` AAR | 33,088,604 | `bdf35d710bcdc567944904270fd718cf3de4489bee8e01a97fae108444345d1b` |
| Sources JAR | 375,015 | `b02b0d068f727bf019dd64896851eaad78aa9eb86e3a945edc2eee138f005274` |

The AAR includes native libraries for arm64-v8a, armeabi-v7a and x86_64. Its compressed native payload is roughly 31 MB in total, before adding this app. Adding the universal SDK to the current app would exceed its 25 MiB updater APK limit. No dependency or ABI packaging change was made. An approved packaging strategy must measure the final APK and its updater compatibility; choosing an ABI filter silently would exclude devices.

The POM declares Kotlin stdlib 2.2.20, lifecycle-common/runtime-ktx 2.5.1, AndroidX annotation 1.7.1, serialization-json 1.6.0 and coroutines-core 1.7.3. A future approved compile experiment would use the exact `co.daily:client:0.41.0` dependency and explicitly include this source directory, while keeping the voice build flag false. Runtime dependency resolution, native packaging and transitive notices require separate review. The [BSD-2-Clause notice](THIRD-PARTY-NOTICES.txt) stays at this optional boundary because the default app does not package Daily.

## Reproducible checks

Run `python tests/native-daily-session-check.py` with JDK 21 `java` and `javac` on PATH. It compiles the production session/credential sources with `--release 17 -Xlint:all -Werror`, then exercises 73 assertions with synthetic time and fake drivers. Cases include hostile descriptors, single-use tokens, no microphone on join, listener restrictions, delayed/duplicate join, cancellation, matching enable acknowledgements, stale enable after close, superseded enable callbacks/timeouts, replacement ordering, mute/leave timeout, failed release, expired queued credentials and no automatic reconnect.

The separate `tests/native-daily-sdk-compile.py` verifies the exact AAR hash, extracts only `classes.jar` into a temporary build directory and compiles all three optional classes against real SDK signatures. Supply `--sdk-aar`, `--android-jar`, `--kotlin-jar`, `--lifecycle-jar`, `--annotation-jar` and `--serialization-jar`. Validation used Android 37.0 `android.jar`, Kotlin stdlib 2.3.21, lifecycle-common-jvm 2.11.0, annotation-jvm 1.10.0 and serialization-core-jvm 1.7.3 from this project's existing local caches. This checks Java source/API compatibility, not a Gradle runtime graph or Android device behavior.

The downloaded AAR, source JAR and extracted classes remain outside the repository at the task workspace's `daily-sdk/`; supporting jars are in `gradle-cache/` and Android tools in `toolchain/`. No SDK or compiler binary belongs in the source ZIP. The tests do not download dependencies, instantiate the SDK or make network calls.

## Official references

- [Android SDK release repository](https://github.com/daily-co/daily-client-android)
- [CallClient constructor and threading](https://reference-android.daily.co/daily-android/co.daily/-call-client/-call-client.html)
- [Join settings and permission precondition](https://reference-android.daily.co/daily-android/co.daily/-call-client/join.html)
- [Input acknowledgement](https://reference-android.daily.co/daily-android/co.daily/-call-client/set-inputs-enabled.html)
- [Publishing acknowledgement](https://reference-android.daily.co/daily-android/co.daily/-call-client/set-is-publishing.html)
- [Leave](https://reference-android.daily.co/daily-android/co.daily/-call-client/leave.html) and [release](https://reference-android.daily.co/daily-android/co.daily/-call-client/release.html)
