# Native voice safety boundary

Checked 25 October 2026. This source implements the Android lifecycle and user-intent boundary. It does not claim a working media transport. `BuildConfig.VOICE_ENABLED` is hardcoded false; production authority and media factories return unavailable. No owner credential, microphone capture, provider connection, background service, or automatic join was used.

The notification center mounts `voice.js`. Join is explicit. Pointer/keyboard hold sends a press once; release, pointer cancellation, lost capture, blur, page hide, offline state, panel closure and identity changes cancel pending talk. Native events cause the UI to query current status instead of trusting queued event contents. The generic JavaScript API rejects all `voice-*` and `duty-*` actions. The dedicated bridge accepts only intent plus an optional opaque session ID and returns public status. Media tokens and room descriptors never enter the WebView.

`VoiceCoordinator` owns the foreground Activity lifecycle and uses the production pure Java `VoiceSafetyState`. Listening requests audio focus after Join without requesting microphone permission. Only an explicit Talk press may show the Android microphone prompt; granting permission does not resume that press. Focus loss, route changes, backgrounding, window focus loss, network loss, session changes, expiry and teardown issue local stop/close before server cleanup. No reconnect automatically resumes listening or publishing. `RECORD_AUDIO` is declared, but the disabled build never requests it.

`VoiceAuthority` and `VoiceMediaTransport` are injected native contracts, not invented responses from the current server. Authority must refresh server access and return only committed relay-enforced grants. Media starts muted and binds callbacks to their connection. Local stop intent precedes server cleanup; physical capture/media termination latency still requires SDK and device evidence. The independent relay must enforce expiry even if the app, UI timer, worker or network stalls.

Authority is bounded to 60 seconds and a floor grant to 15 seconds. Remaining lifetime comes from server expiry minus server time, less the measured request round trip, then uses Android monotonic time. Provider credential expiry can shorten it. A pending renewal never extends the old deadline. Late callbacks cannot reactivate a released press. Replacing publishing credentials closes the old publisher before preparing the new one. Public talking status requires a matching input acknowledgement; a delayed acknowledgement after release cannot restore it. The policy also supports a separately correlated rotated lease with a distinct UUID and higher generation, for future provider integration.

The current boundary disconnects when receive authority expires; no concrete duty-heartbeat/discovery adapter is installed yet. Background listening, foreground service behavior, provider room redistribution and a verified SDK transport remain unfinished. Asynchronous provider calls require bounded cancellation/teardown and evidence that delayed callbacks cannot re-enable capture after release. The build gate stays false until those pieces and device acceptance are complete.

The pure policy harness executes the production state machine with synthetic monotonic time and no Android/media dependencies. Its 104 checks cover stale callbacks, identity changes, focus/permission/background loss, exact expiry, renewal, rotation and clock anomalies. Browser fixtures exercise momentary controls and redacted statuses without media or provider calls. Consult final task evidence for Android compilation, coordinator integration tests and rendered review; source tests do not establish transport acceptance.

Optional source under `native-app/src/daily` explores the pinned Daily 0.41.0 SDK with serialized muted room changes. It is excluded from default source sets and has no production factory/authority binding. The verified Maven AAR is 33,088,604 bytes; its universal native libraries alone exceed the updater's 25 MiB APK limit when added to this app. Packaging strategy and actual transport/device acceptance remain unresolved. No SDK binary or credential is included in the source handoff.

Official references:

- [Android audio focus](https://developer.android.com/media/optimize/audio-focus)
- [Android 17 background audio](https://developer.android.com/about/versions/17/changes/bg-audio)
- [Microphone foreground service restrictions](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [Daily CallClient threading](https://reference-android.daily.co/daily-android/co.daily/-call-client/-call-client.html)
- [Daily input changes](https://reference-android.daily.co/daily-android/co.daily/-call-client/set-inputs-enabled.html) and [resource release](https://reference-android.daily.co/daily-android/co.daily/-call-client/release.html)
