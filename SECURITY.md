# Security

Navrang Gate handles event admission and staff workflows. Keep attendee records, payment/contact details, staff credentials and signing material out of public issues, pull requests, screenshots and logs.

## Release scope

Use the current signed download identified in the [README](README.md#current-installation-and-access) and [update manifest](updates/latest.json). [Older APKs](CHANGELOG.md) are retained for historical provenance. Their presence does not promise ongoing security fixes or a supported maintenance window. The repository does not currently publish a security-response deadline or a separate long-term-support policy.

## Report a suspected vulnerability safely

1. Check this repository's [Security page](https://github.com/Namdev90/paruluniversitygoa/security). If GitHub displays **Report a vulnerability**, use that private reporting flow for technical details. The existence of this file does not enable that feature or assert that it is available.
2. If private reporting is unavailable and you already have an established private channel with the project maintainer, ask there how to submit a report securely.
3. Otherwise, open a minimal [issue](https://github.com/Namdev90/paruluniversitygoa/issues) asking the maintainer for a private reporting route. Do not include vulnerability details, exploit instructions, affected personal records or secrets in that public request. Wait for a verified private route before sharing sensitive evidence.

No dedicated security email address is published here. Do not send reports to guessed addresses or unrelated university support contacts.

Once a private route is established, a useful report includes the affected version or commit, component, impact, minimal reproduction using synthetic data, and redacted diagnostic evidence. Do not test against live attendance records, attempt unauthorized access or extract other people's information to demonstrate a bug.

## Security boundaries to preserve

- Admission, staff roles and report permissions are decided by the server. Selecting a station or displaying a success color cannot grant access or prove an admission.
- Operational student caches are transient. Explicitly downloaded reports and captured screenshots can persist outside the app after sign-out; handle those copies securely. Secrets and sensitive exports must not be added to the repository, APK or public review evidence.
- Logout, late-response handling and document saving must preserve current authorization checks.
- Updates must preserve the original signing identity, package, increasing version code, byte-length and hash checks, and installer/pending-admission safeguards.
- The original signing key stays private in its authorized build environment. Never upload it to GitHub, CI or an issue attachment.

See the [feature catalogue](docs/FEATURES.md), [staff access reference](docs/STAFF-ACCESS.md), [release procedure](docs/RELEASE-PROCEDURE.md) and [contribution guidance](CONTRIBUTING.md) for implementation and verification context. These boundaries describe the project's design and review requirements; they are not a guarantee that every vulnerability has been excluded.
