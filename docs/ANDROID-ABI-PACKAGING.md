# Android ABI candidate packaging and updater metadata

This patch prepares candidate packaging and offline metadata verification. It does
not select a release version, build or sign an APK, access a private key, change
`updates/latest.json`, or publish anything. Continue to use the coordinated,
original-key release procedure for any later authorized release.

## Compatibility contract

- Minimum Android API remains 24. The existing default release build remains
  unminified and unsplit until optimized candidate acceptance is complete.
- `-PnavrangOptimizedRelease=true` enables R8 and resource shrinking with explicit
  preservation of application callbacks/reflection, JavaScript interfaces, JNI
  names, optional Daily classes and dynamically looked-up drawable/raw resources.
- `-PnavrangAbiSplits=true` requests self-contained APKs for `arm64-v8a`,
  `armeabi-v7a`, `x86_64` and `x86`, plus a universal APK. These are complete APKs,
  not Android config splits. Version code/name remain those in approved
  `release.json`; no ABI version offsets are added.
- The top-level channel entry remains the universal APK at the historical URL
  shape `downloads/Navrang-Gate-VERSION.apk`. Older clients ignore `artifacts`.
  The optional `artifacts` object maps known ABI labels to full, individually
  authenticated metadata entries with `-ABI.apk` URLs. Every entry must have the
  same package/version and its own original-key `signature`.
- Signature bytes retain `navrang-release-v1`. Each allowlisted URL, including
  its ABI suffix, is part of that signed payload. Moving a signed entry under a
  different ABI label is rejected. No unsigned metadata is accepted.
- New clients select the first advertised entry in Android `SUPPORTED_ABIS`
  order, otherwise use the authenticated universal APK. Selection never starts
  installation or bypasses scanner, pending-request or Android confirmation
  protections. Cached readiness is cleared when selected bytes change.
- All APKs retain the existing 25 MiB cap, including the universal APK. Increasing
  the new client's cap would not fix old installed clients. The complete channel
  must fit the existing 32 KiB metadata cap.

The historical code-18 metadata has no `signature`; this patch deliberately does
not edit or bless it. Any newly authorized channel needs original-key proofs.

## Serial optimized-build verification (pending)

The release integrator owns the build slot. Do not run these in parallel with
another Gradle task. Run only after integrating and reviewing the final source,
using the existing approved dependency/SDK configuration. `--offline` must fail
if dependencies are absent; do not silently substitute versions.

```powershell
.\gradlew.bat --offline --no-daemon -PnavrangOptimizedRelease=true -PnavrangAbiSplits=true :native-app:assembleRelease :native-app:testDebugUnitTest :native-app:lintRelease
```

Use the same reviewed optional SDK/property settings as the intended candidate.
Read `native-app/build/outputs/apk/release/output-metadata.json` to identify the
universal and ABI outputs; do not infer identity from a filename. Verify the
actual package, approved code/name, API 24, non-debuggable manifest, permissions,
and native library coverage. Every native library in the universal APK must
exist for all four advertised ABIs; each variant must contain only its own ABI.
If a dependency lacks an ABI, stop and coordinate the advertised matrix; do not
ship a purported universal APK with incomplete native coverage.

Inspect `mapping.txt`, `seeds.txt`, `usage.txt`, resources and packaged assets.
Run release-mode physical-device acceptance on API 24 and a current API, ARM32
and ARM64, and x86/x86_64 emulators. Exercise Credential Manager/OAuth callback,
CameraX/QR, JS bridge and downloads, dynamic branding/sounds, biometric lock,
push receivers/jobs, optional JNI/media callbacks and update confirmation,
pending-entry fencing, cancellation, process death and a same-signer upgrade.
Debug unit tests alone do not establish R8 release behavior. Compare baseline
versus optimized per-ABI/universal byte sizes, cold/warm launch time and peak
memory. No reduction or device compatibility is claimed until measured.

The current `tools/build-native.py` expects one unsplit output and has a separate
signing gate. Do not point it at the ABI build or bypass that gate. Integrating
ABI outputs into the authorized original-key signing/publication pipeline is a
separate release-integrator action; this patch adds no signing capability.

## Offline metadata preparation and public verification

`tools/abi_release_metadata.py draft` inspects already signed, approved APKs with
the existing public `apksigner`/`aapt2` policy. It verifies the original signer,
package/version, API 24, self-contained packaging, actual ABI coverage and byte
limits. It writes a new local directory containing `UNSIGNED-review.json` and
one canonical `.payload` per entry. It never accepts a private key and refuses
existing output directories or paths beneath `updates/` and `downloads/`.

Example structure (replace placeholders with approved local paths; no version
is selected by this document):

```text
python tools/abi_release_metadata.py draft --release APPROVED_RELEASE_JSON --build-tools VERIFIED_BUILD_TOOLS --apk universal=APPROVED_UNIVERSAL_APK --apk arm64-v8a=APPROVED_ARM64_APK --apk armeabi-v7a=APPROVED_ARM32_APK --apk x86_64=APPROVED_X64_APK --apk x86=APPROVED_X86_APK --output-dir NEW_LOCAL_REVIEW_DIRECTORY
```

The unsigned draft cannot be used as an update channel. Under separate signing
authorization, the original-key custodian must supply each exact v1 payload's
base64 proof as that entry's `signature`. The existing custodian implementation
already creates v1 proofs from the URL/size/hash fields; this patch extends URL
validation for allowlisted ABI names. This task did not invoke that custodian.

Verify the resulting local manifest with the public original certificate in DER
form; the verifier pins its SHA-256 to the repository's original signer:

```text
python tools/abi_release_metadata.py verify --manifest LOCAL_SIGNED_MANIFEST --certificate ORIGINAL_PUBLIC_DER_CERTIFICATE
```

This is offline cryptographic verification, not network/source/publication
validation. A later reviewed publication must preserve historical APK hashes,
check channel monotonicity, publish all artifacts before the manifest, update
checksums, and independently verify public bytes and a real upgrade. The legacy
`prepare-release.py` generates only a universal entry; running it on an ABI
channel would discard the variant map. Integrate publication deliberately.

## Focused local checks

```text
python tests/native-updater-pending-check.py
python tests/native-release-signature-check.py
python tests/native-update-check-policy.py
python tests/abi-release-metadata-check.py
```

The updater harness uses fake Android/network effects and an ephemeral public
test certificate. It builds no APK, installs nothing and contacts no service.
The ZIP tests mock external APK verification and inspect synthetic ZIP entries;
actual signed APK and optimized-build validation remain pending.
