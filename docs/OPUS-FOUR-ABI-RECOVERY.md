# Four-ABI Opus recovery, 5 November 2026

This reconstructs the Android packaging gap after recovered checkpoint `b70be8d`.
It is new source work, not a recovery of missing later binaries or a repeat of their
historical test claims. Voice and push remain disabled. Nothing was deployed,
signed, installed on a device or published.

## Source changes

- Gradle ABI splits and the pinned Opus builder use the same complete list:
  `arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86`. All compiler targets remain API24.
- The source archive remains Xiph Opus 1.6.1 with SHA256
  `6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1`.
  NDK revision remains `30.0.16248370`; the builder uses the Linux host toolchain
  and never installs tools, downloads source or accepts licenses.
- Built and packaged encoder bytes must have the correct ELF class/machine,
  load segments aligned for 16 KiB pages, exactly the three app-owned JNI exports,
  no text relocations and only permitted Android system-library dependencies.
- The diagnostic APK inspector supports each ABI split and `--abi universal`.
  The latter requires every ABI and, with `--require-bundled-opus`, all four
  encoders. Duplicate ZIP entries, missing notices and wrong-ABI binaries fail.
- Existing unsigned-only, package identity, release metadata, API24 minimum,
  API37 target, no-Daily and 25 MiB updater-limit checks remain in place.

## Fresh focused verification

Run the toolchain-independent packaging regressions:

```sh
python3 tests/relay-opus-packaging-check.py
```

Eighteen tests pass, including all four architecture fixtures, wrong-ABI rejection,
missing universal encoder rejection, 16 KiB alignment, JNI exports, dependencies,
notices, a real host-linker ELF fixture, and simulated build commands/receipts for
all four API24 targets. Synthetic ELF fixtures and mocked NDK commands establish
policy coverage, not an Android cross-build.

Run the real host encoder-core check with existing `cc` and `make`:

```sh
python3 tests/relay-opus-core-check.py
```

The checksum-verified source is compiled locally. The actual encoder core produces
and libopus decodes 300 mono 48 kHz, 20 ms, 24 kbps CBR packets from silence, sine
and deterministic noise, and rejects seven invalid inputs. It uses no microphone,
network, Android runtime or JNI. These two checks are included in native CI.

## Approved NDK build and host JNI follow-through

After the user's explicit download/build approval on 5 November, Google's official
Linux NDK r30 archive was downloaded and verified against the published 738,633,529
bytes and SHA1 `5107f898313790e449e87eee2183d9a20602dee9`. Its computed SHA256 is
`753611f410d002cfcd3f3dc2ef49aad532089d3180b436c060a90bf0fcb64df2`. ZIP paths and
symlinks were checked before extraction, and `source.properties` confirms
`30.0.16248370`. No system security setting or private key was changed.

The actual four-ABI API24 build now **passes**. All four resulting libraries pass
the ELF checks above, and their Android identification notes record API24 and NDK
r30/build 16248370. Sizes are 224,704 bytes (ARM64), 220,896 (ARMv7), 240,744
(x86_64) and 237,808 (x86), totaling 924,152 native-library bytes. These are library
sizes, not APK sizes. See `opus-four-abi-evidence-2026-11-05.json` for hashes.

The real Java/native wrapper also **passes** under the existing Java 21 runtime
with `-Xcheck:jni`: 300 encoded packets, invalid inputs, idempotent close, and 100
two-thread encode/close rounds. All 300 output packets decode through pinned
libopus to 960 mono PCM samples. The host build uses the approved NDK's VM-neutral
JNI header and the existing Java compiler module; no additional download was
needed. The earlier absence of a `javac` launcher did not mean that module was
absent. Its missing release-symbol archive prevents `--release 17`, so this is
explicitly a Java 21 host check, not Java 17 or Android runtime acceptance.

## Remaining acceptance gates

**Gradle assembly/lint/unit checks and actual APK inspections have not run** for
this reconstruction in this task. The cloud Android SDK/full build toolchain is
still unavailable to this task. No claim is made about a new APK's size or hash.

With the existing authorized Linux toolchain available, build the diagnostic
profile above, then inspect each split and universal APK, for example:

```sh
python3 tools/inspect-relay-unsigned.py <unsigned-universal.apk> \
  --build-tools <sdk>/build-tools/36.0.0 --abi universal \
  --require-bundled-opus --output .build/opus-universal-inspection.json
```

Physical API24/28/35 codec, microphone, routing, lifecycle, latency and cutoff
acceptance remains separate. Original app identity, original-key approval and
release gates are unchanged; a successful host check or unsigned diagnostic is
not release approval.
