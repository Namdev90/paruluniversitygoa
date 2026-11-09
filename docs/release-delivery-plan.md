# Compatible delivery and version proposal

This is preparation, not publication or signing. Remote main was rechecked at 2026-10-26T03:24:57+00:00 and remains b8605c5e; published v0.8.0/code18 is unchanged. Version codes below are proposals, not reservations. Recheck at source freeze.

## Direct path

Prefer final v0.9.0/code19, same package and original certificate, if the final feature-complete universal APK is <=25MiB. Keep its legacy filename at downloads/Navrang-Gate-0.9.0.apk and the old latest.json core fields. New clients may use independently signed ABI entries; old clients still download the authenticated-by-APK universal entry. The final Cloudflare/native adapter may change dependencies and size; it is not accepted yet. Do not reuse the current old-version diagnostic hash as v0.9 metadata.

## Explicit migration alternative

If final universal remains too large, a separately approved 0.8.1/code19 updater bridge could fit the existing cap, followed by final v0.9.0/code20. The bridge preserves the existing v0.8 workflows and signer; it is not a substitute for all agreed v0.9 features. It needs its own reviewed source, signed metadata, size/upgrade tests and explicit intermediate-release scope approval. Do not silently publish it under the v0.9 name. No bridge branch/build was created by this plan.

The current ABI-aware updater still requires a universal <=25MiB channel entry before variant routing, so a bridge alone does NOT solve a38.55MiB final universal with the current schema. A genuinely variant-only final channel would require a separately reviewed protocol implemented in the bridge: old updaters must remain on a compatible legacy channel, while the bridge uses a distinct authenticated channel requiring a device-compatible standalone artifact. That entails dedicated endpoint/manifest separation, original-key proofs, fail-closed missing-ABI handling and upgrade tests. It must never put a too-large or wrong-ABI APK in old latest.json. This protocol is not implemented or approved here. If the final all-feature universal fits, avoid this extra migration.

## Prepared metadata and staging

release-candidate-plan.json holds non-publishable templates. Size, hash and proof are null, deliberately rejected by production metadata validation; three rejection checks ran. Actual release.json, updates/latest.json, SHA256SUMS and downloads remain unchanged. Final APK/version and every metadata core proof must come from actual original-signed, accepted bytes. ABI names are bound through allowlisted signed URLs. Metadata core remains navrang-release-v1; optional notes/publishedAt are not claimed to be covered by that core signature.

The public-only staging helper is being prepared separately. It must inspect externally signed APKs, verify supplied original-public-certificate metadata proofs and stage into a new local directory only. No private key/password/signing call belongs in that helper. Its receipt does not replace source-freeze, feature, budget or phone acceptance.

## Release ordering and recovery

1. Freeze the accepted relay/native/app source and verify all requirements, including real codec/media cutoff and INR0 quota behavior. Existing fail-closed voice is not completion.
2. Recheck remote/version availability, select the direct or explicitly approved migration path, and record actual accepted source/version and device evidence. No physical waiver is implied.
3. Prepare reviewed, backward-compatible backend activation under its separate scoped authorization. Test older-client auth and new refresh policy; keep unrelated grants/configuration out.
4. Build final optimized artifacts serially. Verify minimum API, standalone ABI/library coverage, reflection/JNI/callback paths, package/version, original certificate and file sizes. Preserve historical outputs.
5. Use the retained original signing custodian only when gates allow; verify public APK/metadata proofs and stage immutable new bytes/checksums. Never overwrite a published version.
6. Obtain app-scoped phone-test permission for an in-place signed upgrade, then verify scanner/offline queues, auth/biometric lifecycle, permissions, communications/voice/locator, exports and rollback/recovery behavior.
7. Publish accepted bytes through the established workflow, independently download and verify hashes/certificate/version. Only then send a public version/hash invalidation hint if live FCM is configured; never download/install automatically.
8. On failure, stop publication or fix forward with a higher versionCode. Keeping old APKs is not a promise that Android will accept a downgrade. Preserve app data and original signing identity.

## Decisions still required

No new signing-key recovery decision is needed. The final transport and its quota/deadline acceptance must complete. Then choose direct delivery if it fits; otherwise explicitly approve/design a bridge plus separate authenticated final channel. No account/credential/deployment/billing approval is supplied by this document. All agreed v0.9 features remain required.
