# Local staged release bundle

`tools/stage_release_bundle.py` assembles a local review bundle from APKs that
were already signed and channel metadata signed externally. It uses the public
metadata verifier and APK inspection policy. The certificate input must be the
original public DER certificate (`.der` or `.cer`). This helper has no signing
path and does not load private signing code, keys, or passwords.

Example:

```text
python tools/stage_release_bundle.py --certificate original.der --metadata signed-channel.json \
  --apk universal=Navrang-Gate-1.2.3.apk --apk arm64-v8a=Navrang-Gate-1.2.3-arm64-v8a.apk \
  --output-name review-1
```

Supply exactly one APK path for every signed metadata entry, including the
mandatory universal legacy APK. The helper verifies the public metadata proof,
entry labels, package/version, APK signatures, hashes, sizes, and ABI/library
coverage before creating output. It checks the current `release.json`, update
channel, and existing download history without changing those files. Output is
created only as a new directory under `.build/release-staging/` and contains
`bundle/downloads/`, `bundle/updates/latest.json`, `NEW-SHA256SUMS.txt`, and a
review receipt. The receipt states that nothing has been published and that
source-freeze and physical release gates remain pending.

The resulting directory is preparation for review only. It does not select or
edit a release version, publish files, write a live update channel, or replace
existing download history.
