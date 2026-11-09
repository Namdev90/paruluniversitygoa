# Project history and commit ledger

Snapshot: **9 November 2026 (UTC)**, through published main commit [`b21798702fe2a99e1d419e15b8d31011f2fc7fa6`](https://github.com/Namdev90/paruluniversitygoa/commit/b21798702fe2a99e1d419e15b8d31011f2fc7fa6). This narrative is reconstructed from reachable Git history, merged PR metadata, artifact records and GitHub Releases, not recollection. Original plans and dated evidence remain intact.

[Current status](../CURRENT-STATUS.md) · [Version-by-version changelog](../../CHANGELOG.md) · [Archive policy](GITHUB-RELEASES.md) · [Documentation index](../README.md)

## Development milestones

- **16 October 2026:** [initial repository](https://github.com/Namdev90/paruluniversitygoa/commit/7e12af3) and [0.1.0 offline Android prototype](https://github.com/Namdev90/paruluniversitygoa/commit/294dcf6), followed by [0.2.0 shared server-backed admission](https://github.com/Namdev90/paruluniversitygoa/commit/a192e29), named checkers, live administration and continuous scanning. The offline prototype is historical, not the current admission model.
- **17 October:** 0.3–0.7.5 added the dark interface, signed updater, server-saved Help Desk/laptop companion, audio/readiness, station roles, privacy/session guards and pending-scan/update protection. [PR #1](https://github.com/Namdev90/paruluniversitygoa/pull/1) merged scan reliability fixes. See the changelog for each version and artifact.
- **18 October:** [0.7.6](https://github.com/Namdev90/paruluniversitygoa/commit/0a5c8a2) improved responsiveness/camera startup. [PR #3](https://github.com/Namdev90/paruluniversitygoa/pull/3) added installer lifecycle recovery. Reporting, safe imports and a native Compose rebuild were integrated around [PR #7 / 0.7.7](https://github.com/Namdev90/paruluniversitygoa/pull/7). [PR #9 / 0.7.8](https://github.com/Namdev90/paruluniversitygoa/pull/9) restored the original interface while retaining native engines.
- **18 October UTC / 19 October India time:** [PR #12 / 0.7.9](https://github.com/Namdev90/paruluniversitygoa/pull/12) refined the original design, in-camera exact-ID checks, report scrolling/download reachability and publication evidence. Archive dates in older documentation retain their original timezone.
- **19 October:** [PR #15 / 0.8.0](https://github.com/Namdev90/paruluniversitygoa/pull/15) published combined artwork/maroon presentation and UI refinements, with new communications deferred. PRs [#16](https://github.com/Namdev90/paruluniversitygoa/pull/16), [#17](https://github.com/Namdev90/paruluniversitygoa/pull/17), [#18](https://github.com/Namdev90/paruluniversitygoa/pull/18) and [#19](https://github.com/Namdev90/paruluniversitygoa/pull/19) preserved/reconciled the 17-version archive, navigation and publication receipts. [PR #14](https://github.com/Namdev90/paruluniversitygoa/pull/14) closed without merge; its communications proposal was not a shipped release.
- **Late October–5 November:** retained plans and dated recovery records describe session renewal, app lock, locator, voice/notifications, database boundaries and optional ABI/Opus work. [Recovery integration](https://github.com/Namdev90/paruluniversitygoa/commit/12b39239e53f) entered the ancestry later published by PR #21. These source/diagnostic records do not by themselves establish feature activation or final release acceptance.
- **8–9 November UTC:** Account/Admin/Reports and scanner layouts were refined; [source 9914009](https://github.com/Namdev90/paruluniversitygoa/commit/9914009) narrowed the release by excluding deferred communications. [Final reviewed source 885cf33](https://github.com/Namdev90/paruluniversitygoa/commit/885cf33d587a78ba5040109a8e0d7e3a665046b1) includes later compact/large-text refinements. Final signed upgrade evidence and artifact preparation preceded [PR #21 / 0.9.0](https://github.com/Namdev90/paruluniversitygoa/pull/21). The final record covers an API 37 emulator, not the owner's physical phone.

## What is and is not included

The complete ledger below contains **all 146 commits reachable from the pinned main baseline**, including merged side-branch commits. It is not a list of every local, deleted or unmerged commit. Topological order preserves parent relationships; original committer timestamps include timezone offsets and need not be monotonic.

At this snapshot, [PR #20](https://github.com/Namdev90/paruluniversitygoa/pull/20), from `navrang-0.9.0-phone-verified`, remained open. Its name and evidence do not override final main/PR #21. Other retained staging/feature branches are preserved rather than represented as releases. Recheck GitHub before acting on their status.

A commit subject is a historical description, not independent proof that a test passed, a service deployed or a feature was accepted. Use the linked diff, source-bound receipts and actual published artifacts. The repository contains dated checkpoints that were superseded; [current status](../CURRENT-STATUS.md) resolves today's documented baseline.

## Published GitHub Releases

The Releases API returned **19 non-draft releases** at this snapshot. The table records GitHub's actual publication timestamps, not original build/archive/installation dates. The [bounded original inventory](apk-inventory.json) covers only 0.1.0–0.7.9 (17 APKs); do not rewrite that historical verification scope to imply it included newer artifacts.

| Version | GitHub publication (UTC) | APK bytes | Artifact scope |
|---|---|---:|---|
| [v0.1.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.1.0) | 2026-10-19T06:51:07Z | 603,116 | Historical archive |
| [v0.2.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.2.0) | 2026-10-19T06:51:15Z | 5,125,967 | Historical archive |
| [v0.3.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.3.0) | 2026-10-19T06:51:24Z | 1,349,790 | Historical archive |
| [v0.4.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.4.0) | 2026-10-19T06:51:34Z | 1,701,765 | Historical archive |
| [v0.5.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.5.0) | 2026-10-19T06:51:44Z | 1,710,021 | Historical archive |
| [v0.6.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.6.0) | 2026-10-19T06:51:53Z | 1,891,593 | Historical archive |
| [v0.6.1](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.6.1) | 2026-10-19T06:52:02Z | 1,891,593 | Historical archive |
| [v0.7.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.0) | 2026-10-19T06:52:12Z | 1,891,593 | Historical archive |
| [v0.7.1](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.1) | 2026-10-19T06:52:21Z | 1,895,689 | Historical archive |
| [v0.7.2](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.2) | 2026-10-19T06:52:31Z | 1,895,689 | Historical archive |
| [v0.7.3](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.3) | 2026-10-19T06:52:40Z | 1,936,718 | Historical archive |
| [v0.7.4](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.4) | 2026-10-19T06:52:50Z | 1,936,718 | Historical archive |
| [v0.7.5](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.5) | 2026-10-19T06:52:59Z | 1,936,718 | Historical archive |
| [v0.7.6](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.6) | 2026-10-19T06:53:09Z | 1,940,814 | Historical archive |
| [v0.7.7](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.7) | 2026-10-19T06:53:21Z | 19,823,096 | Historical archive |
| [v0.7.8](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.8) | 2026-10-19T06:53:32Z | 21,176,693 | Historical archive |
| [v0.7.9](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.7.9) | 2026-10-19T06:53:43Z | 22,630,853 | Historical archive |
| [v0.8.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.8.0) | 2026-10-19T15:56:59Z | 23,634,731 | Prior published version |
| [v0.9.0](https://github.com/Namdev90/paruluniversitygoa/releases/tag/v0.9.0) | 2026-11-09T19:24:12Z | 24,673,136 | Current published version |

Each release lists an APK and checksum asset. Availability/digests do not constitute a fresh signature check or device trial. Historical Releases were additive archives of already retained bytes, not rebuilds or newly signed replacements. See the original [publication receipt](publication-receipt-2026-10-19.json), [0.8.0 record](../RESTORATION-RELEASE-0.8.0.md) and [corrected final 0.9.0 record](../RESTORATION-RELEASE-0.9.0.md).

## Complete reachable commit ledger

To reproduce this scope from a full clone:

```sh
git log --reverse --topo-order --format='%H|%cI|%s' b21798702fe2a99e1d419e15b8d31011f2fc7fa6
```

| Commit | Original committer timestamp | Recorded subject |
|---|---|---|
| [7e12af39c42c](https://github.com/Namdev90/paruluniversitygoa/commit/7e12af39c42c59d6d9fc488a4cbf04f9188e526c) | 2026-10-16T21:19:59+05:30 | Initial commit |
| [294dcf600e7c](https://github.com/Namdev90/paruluniversitygoa/commit/294dcf600e7c8ab3367d38a1de18b047bf4e6be7) | 2026-10-16T22:00:13+05:30 | Add offline Android QR scanner prototype and installable APK |
| [a192e292fd9e](https://github.com/Namdev90/paruluniversitygoa/commit/a192e292fd9e90282dbd1d39660446008927c1b0) | 2026-10-16T23:23:13+05:30 | Release Navrang Gate 0.2: shared admission, named checkers, live admin and continuous Android scanning |
| [bea4023dfddc](https://github.com/Namdev90/paruluniversitygoa/commit/bea4023dfddcc4df616a68f1859f1e5ea8403e7f) | 2026-10-16T23:32:57+05:30 | docs: record approved private registration import and verified totals |
| [bc4a74a6bb73](https://github.com/Namdev90/paruluniversitygoa/commit/bc4a74a6bb73427a3b4ed5f49da74e5be09dbfc0) | 2026-10-17T09:11:48+05:30 | Automatically activate Google checkers with unique usernames and email deduplication |
| [82b603ef4693](https://github.com/Namdev90/paruluniversitygoa/commit/82b603ef46936c721c95fa90974e4b8d81dc6788) | 2026-10-17T09:51:33+05:30 | Release Navrang Gate 0.3 prototype: dark app, admin rehearsal, real-name checkers and scanner assistance |
| [18278c9cd6c6](https://github.com/Namdev90/paruluniversitygoa/commit/18278c9cd6c6f5fef479de8f0630fe6a2db0fa0f) | 2026-10-17T10:52:41+05:30 | Release Navrang Gate 0.4: horizontal branding, motion polish and signed app updates |
| [c9c43bbc46c3](https://github.com/Namdev90/paruluniversitygoa/commit/c9c43bbc46c3a1e9a1e9c7349fc16cd55e28cb92) | 2026-10-17T11:26:06+05:30 | Release Navrang Gate 0.5: server Help Desk, laptop portal and Android station readiness |
| [fbc636da9a38](https://github.com/Namdev90/paruluniversitygoa/commit/fbc636da9a3823a5426d6c20a22442d6db9e0410) | 2026-10-17T12:17:53+05:30 | Release 0.6: four-field Help Desk, stock scan audio, tactile UI and complete dancer artwork |
| [5dd887975985](https://github.com/Namdev90/paruluniversitygoa/commit/5dd88797598584e309f3b6561a7aa6ad9011c38b) | 2026-10-17T12:21:54+05:30 | Release 0.6.1: preserve text editing while suppressing blue control highlights |
| [ee0249470e1e](https://github.com/Namdev90/paruluniversitygoa/commit/ee0249470e1e14276c1c83874614c19b68582464) | 2026-10-17T13:03:23+05:30 | Release 0.7: station picker, named staff access and server-enforced roles; retain Google sign-in |
| [2dd3647240ee](https://github.com/Namdev90/paruluniversitygoa/commit/2dd3647240eeefb219c3e013a068267001a025a1) | 2026-10-17T13:36:20+05:30 | Release 0.7.1: clear expired sessions and guard late private responses |
| [f762dae0fa8d](https://github.com/Namdev90/paruluniversitygoa/commit/f762dae0fa8da76a4f8d1bf491a0d9465b11efc2) | 2026-10-17T14:02:57+05:30 | Release 0.7.2: remember staff station and restrict sync to two counters |
| [65f7cd0611fa](https://github.com/Namdev90/paruluniversitygoa/commit/65f7cd0611fa25134bbc9946b929ba73d471eaf2) | 2026-10-17T16:46:30+05:30 | Release 0.7.3: production audit, scanner lifecycle fixes, privacy guards and polished interface |
| [aa14bbefb998](https://github.com/Namdev90/paruluniversitygoa/commit/aa14bbefb99838ab31c8fff87081807541387045) | 2026-10-17T17:02:34+05:30 | Fix native profile-save races, scanner warning queue and popup layout; release 0.7.4 |
| [c0456c8a378b](https://github.com/Namdev90/paruluniversitygoa/commit/c0456c8a378b14b2377ac43c0d7f8b249f4b04a7) | 2026-10-17T19:01:48+05:30 | Fix pending scan warning recovery and guard Android update installation |
| [734bb60eaf1e](https://github.com/Namdev90/paruluniversitygoa/commit/734bb60eaf1e6373b116703c7278ef80aaddf6bf) | 2026-10-17T19:03:13+05:30 | Merge pending scan reliability fixes (#1) |
| [85fc4dd306d8](https://github.com/Namdev90/paruluniversitygoa/commit/85fc4dd306d8c49c68a14af128ecb5de4657e489) | 2026-10-17T19:26:17+05:30 | Release Navrang Gate 0.7.5 (13) with merged PR #1 pending scan and update safeguards |
| [5bcdda5cd75e](https://github.com/Namdev90/paruluniversitygoa/commit/5bcdda5cd75e17515816e4350601a257f5d1b3c9) | 2026-10-18T09:25:32+05:30 | Fix delayed buttons and blocking scanner startup |
| [0a5c8a2bd577](https://github.com/Namdev90/paruluniversitygoa/commit/0a5c8a2bd577ab5afddc96ef7ed22e28fa3cc19e) | 2026-10-18T09:33:12+05:30 | Release Navrang Gate 0.7.6 (14) with responsive navigation and camera startup |
| [7f0085dfaa7a](https://github.com/Namdev90/paruluniversitygoa/commit/7f0085dfaa7afc47457511c4e4c5df65dff5de71) | 2026-10-18T10:33:19+05:30 | Add service-only teacher reporting permissions and dataset RPC |
| [24184926fbff](https://github.com/Namdev90/paruluniversitygoa/commit/24184926fbff656c184f138cadaf76735ede6b6f) | 2026-10-18T10:33:56+05:30 | Route authorized teacher reports through service-only API |
| [630ac0b0fb55](https://github.com/Namdev90/paruluniversitygoa/commit/630ac0b0fb5501c3d98765d1df5078f7d4ffaa6c) | 2026-10-18T10:33:59+05:30 | Route authorized teacher reports through service-only API |
| [cc892f43cc20](https://github.com/Namdev90/paruluniversitygoa/commit/cc892f43cc20306a0e85e8a8769aa738eb89b6cf) | 2026-10-18T10:34:02+05:30 | Route authorized teacher reports through service-only API |
| [17bc0d787dff](https://github.com/Namdev90/paruluniversitygoa/commit/17bc0d787dff934efd367c29e9ec062344f76ef6) | 2026-10-18T10:36:05+05:30 | Add offline CSV, real XLSX and summary PDF export generators |
| [5dc966495b1f](https://github.com/Namdev90/paruluniversitygoa/commit/5dc966495b1f2a704697d8f16fa8d68ec8b0c193) | 2026-10-18T10:37:13+05:30 | Add teacher-only attendance report dashboard and approval workflow |
| [bd0a45be429c](https://github.com/Namdev90/paruluniversitygoa/commit/bd0a45be429cf393eacb4103835906dc486551fd) | 2026-10-18T10:38:05+05:30 | Integrate Teacher Reports UI and export assets into Navrang app |
| [0fce377ca39d](https://github.com/Namdev90/paruluniversitygoa/commit/0fce377ca39d87629b78204f11a6ef7e9521a678) | 2026-10-18T10:38:07+05:30 | Integrate Teacher Reports UI and export assets into Navrang app |
| [feb04452871b](https://github.com/Namdev90/paruluniversitygoa/commit/feb04452871b0692b60a6cb496b66cb74d6b9591) | 2026-10-18T10:38:09+05:30 | Integrate Teacher Reports UI and export assets into Navrang app |
| [c4503f6ade36](https://github.com/Namdev90/paruluniversitygoa/commit/c4503f6ade36173c045f6b660fa6d179be66f569) | 2026-10-18T10:38:12+05:30 | Integrate Teacher Reports UI and export assets into Navrang app |
| [db77211d071c](https://github.com/Namdev90/paruluniversitygoa/commit/db77211d071cd3bd84e5138a6ffc625c386bdc05) | 2026-10-18T10:38:49+05:30 | Route approved teacher accounts to read-only Reports view |
| [47c7f06c62dd](https://github.com/Namdev90/paruluniversitygoa/commit/47c7f06c62dd8f9d9fb5b4c1d2891c94e26eb21f) | 2026-10-18T10:39:45+05:30 | Add permission-scoped Android document saving for teacher reports |
| [990049b66a6c](https://github.com/Namdev90/paruluniversitygoa/commit/990049b66a6cce3188290ba4ef802b29f1471f44) | 2026-10-18T10:40:23+05:30 | Keep report downloads stable across unchanged session refreshes |
| [789fb0b04b1c](https://github.com/Namdev90/paruluniversitygoa/commit/789fb0b04b1ccd1ee9d29b2406e9074d726bfe8f) | 2026-10-18T10:42:00+05:30 | Keep teacher access mutually exclusive with gate station permissions |
| [b6e4dac149e8](https://github.com/Namdev90/paruluniversitygoa/commit/b6e4dac149e808775f4fbfcdce3253fa206c6b5f) | 2026-10-18T10:42:55+05:30 | Test CSV formula safety, XLSX structure, PDF summary and Android report integration |
| [e4f5d93b9182](https://github.com/Namdev90/paruluniversitygoa/commit/e4f5d93b91827cbe063348667b722b55112efc2e) | 2026-10-18T10:43:19+05:30 | Verify teacher report authentication, role checks, validation and denial |
| [5ce6e2c38420](https://github.com/Namdev90/paruluniversitygoa/commit/5ce6e2c38420c53048e808101bebcdf2681536e4) | 2026-10-18T10:44:16+05:30 | Include teacher report regressions in full test suite |
| [4783f2353ea8](https://github.com/Namdev90/paruluniversitygoa/commit/4783f2353ea84bbf325ed01f56f75c65c2f4e259) | 2026-10-18T10:44:31+05:30 | Run full Navrang test suite on teacher reporting branch and PR |
| [92a7dfc59fbc](https://github.com/Namdev90/paruluniversitygoa/commit/92a7dfc59fbc5ff5e3306a6f36da399b9ede18db) | 2026-10-18T10:46:46+05:30 | Fix ambiguous checker alias found in SQL security regression |
| [926d168c1de0](https://github.com/Namdev90/paruluniversitygoa/commit/926d168c1de059c1b8a47c1e35389f5923598428) | 2026-10-18T11:03:51+05:30 | Specify official-brand shell, faculty request and admission provenance regressions |
| [d177cb1e92d6](https://github.com/Namdev90/paruluniversitygoa/commit/d177cb1e92d63c9cffec6ee0ceb118b199b6eb3a) | 2026-10-18T11:10:21+05:30 | Use official brochure branding, separated account entrances and fluid dancer motion |
| [53be7cc76217](https://github.com/Namdev90/paruluniversitygoa/commit/53be7cc7621768259cce22e9db2adf8abb104958) | 2026-10-18T11:13:05+05:30 | Refine Navrang into restrained branded event operations UI with accessible motion |
| [9a3391bfdf99](https://github.com/Namdev90/paruluniversitygoa/commit/9a3391bfdf993a1c3f355b4b6d469bc84d57164a) | 2026-10-18T11:16:41+05:30 | Load official-brand presentation layer without changing gate control IDs |
| [f4ec2ac90aa5](https://github.com/Namdev90/paruluniversitygoa/commit/f4ec2ac90aa5ae1cf359db1bb2fcf4977679e3fa) | 2026-10-18T11:18:18+05:30 | Record narrowly scoped organizer-confirmed attendance without altering registration or scan evidence |
| [1680e82d2c8d](https://github.com/Namdev90/paruluniversitygoa/commit/1680e82d2c8d6c22c1fdc30abc89ec74e43915e5) | 2026-10-18T11:22:26+05:30 | Include organizer-confirmed admissions with truthful provenance and server-approved faculty requests |
| [44aef099e654](https://github.com/Namdev90/paruluniversitygoa/commit/44aef099e6546b43951412e86565e094a64d5785) | 2026-10-18T11:24:26+05:30 | Validate explicit faculty requests and correction reports without granting client-supplied privileges |
| [3828303cc9dd](https://github.com/Namdev90/paruluniversitygoa/commit/3828303cc9dd96bd6807fdc358120fd399284b86) | 2026-10-18T11:26:22+05:30 | Refresh faculty request state from protected RPC while keeping core login independent of reporting outages |
| [60c17f31d96a](https://github.com/Namdev90/paruluniversitygoa/commit/60c17f31d96a003e27940271d6084b0c3dab76da) | 2026-10-18T11:36:57+05:30 | Pin reporting SQL literal integrity and faculty request validation |
| [fd225eea0445](https://github.com/Namdev90/paruluniversitygoa/commit/fd225eea0445b15322811b261f370091168d072d) | 2026-10-18T11:38:07+05:30 | Show total and organizer-confirmed attendance separately with a dedicated missing-data dataset |
| [31d78932b79d](https://github.com/Namdev90/paruluniversitygoa/commit/31d78932b79da99f0d2a289d4c5bf2e93c74baae) | 2026-10-18T11:46:27+05:30 | Specify reproducible official launcher/scanner artwork and native branding compile checks |
| [71b1217c7f89](https://github.com/Namdev90/paruluniversitygoa/commit/71b1217c7f8915f4574f51a5de4ddfffcad56e32) | 2026-10-18T11:48:37+05:30 | Generate exact official Navrang launcher and scanner assets from the unchanged brochure |
| [7e14402c5b1e](https://github.com/Namdev90/paruluniversitygoa/commit/7e14402c5b1e16eb702862e733ccb9e4fdd1e1b7) | 2026-10-18T11:49:17+05:30 | Apply official native scanner branding without changing scan, session or admission logic |
| [9776710476a0](https://github.com/Namdev90/paruluniversitygoa/commit/9776710476a05f544e50c40d085c71b33d747e9d) | 2026-10-18T11:49:59+05:30 | Register the native branding layer while preserving all Android permissions and update components |
| [cdb83b1d8a90](https://github.com/Namdev90/paruluniversitygoa/commit/cdb83b1d8a9061022aee05979d9d8a4337b54b93) | 2026-10-18T11:50:40+05:30 | Build official event branding before resource packaging with the original signer guard unchanged |
| [a93a4b141919](https://github.com/Namdev90/paruluniversitygoa/commit/a93a4b1419196ee5464889483bbeed8ab7296dfb) | 2026-10-18T11:51:56+05:30 | Validate Python release-tool syntax without opening keys or building artifacts |
| [4c9ffc6d88cf](https://github.com/Namdev90/paruluniversitygoa/commit/4c9ffc6d88cff90a334f418ea343e8d19d0beaeb) | 2026-10-18T11:56:34+05:30 | Fix the dex input path caught by the release-tool syntax regression |
| [3fb78ea46451](https://github.com/Namdev90/paruluniversitygoa/commit/3fb78ea46451a25033cddcdc4fd625dd89e41492) | 2026-10-18T11:57:50+05:30 | Require the PDF to distinguish registered admissions from organizer-confirmed missing-data admissions |
| [60c950af0fb3](https://github.com/Namdev90/paruluniversitygoa/commit/60c950af0fb38680e0c0edf66f2918fdf1942f34) | 2026-10-18T12:07:31+05:30 | Add bounded source-only responsive review and reproducible public source artifact |
| [3d3ec15ba4b5](https://github.com/Namdev90/paruluniversitygoa/commit/3d3ec15ba4b5edd75b349ea11d9827c8ba86beb0) | 2026-10-18T12:53:51+05:30 | Refine responsive screen hierarchy and original white-logo contrast |
| [8cf3cf25d31a](https://github.com/Namdev90/paruluniversitygoa/commit/8cf3cf25d31a73191c7c0a4a421e766be1453574) | 2026-10-18T12:56:00+05:30 | Add synthetic-only rendered checks across phone tablet desktop and short landscape |
| [7f5d86f57985](https://github.com/Namdev90/paruluniversitygoa/commit/7f5d86f5798518bf087ae5ab315dc7c4e002d9e4) | 2026-10-18T12:58:35+05:30 | Regress missing portal assets and admin reports during member-management outages |
| [7b7bfa5b1b1e](https://github.com/Namdev90/paruluniversitygoa/commit/7b7bfa5b1b1e1814aa0f91198d74c8c8d994f517) | 2026-10-18T12:58:52+05:30 | Guard fresh report bootstrap and later canonical-registration reconciliation |
| [36c9c2a2aad6](https://github.com/Namdev90/paruluniversitygoa/commit/36c9c2a2aad6d2897da167e32748ce3b5213e9a2) | 2026-10-18T13:09:37+05:30 | Document the complete Navrang feature and version history with reviewed release handoff |
| [d3a17ec802a1](https://github.com/Namdev90/paruluniversitygoa/commit/d3a17ec802a17b33b563b5d8a44016351290ee7c) | 2026-10-18T13:10:57+05:30 | Apply exact reviewed source integration and synthetic screenshots without APK or backend publication |
| [8f145f4916bc](https://github.com/Namdev90/paruluniversitygoa/commit/8f145f4916bc2d6eed0a226bca774ae7ffe31bf6) | 2026-10-18T11:43:54+05:30 | Fix Android installer recovery across process restarts (#3) |
| [8ed659eba51c](https://github.com/Namdev90/paruluniversitygoa/commit/8ed659eba51c1c22e952a201fa5b51accde43aec) | 2026-10-18T07:41:12Z | Merge commit '8f145f4916bc2d6eed0a226bca774ae7ffe31bf6' into feature/navrang-responsive-handoff |
| [2e01326d3f0e](https://github.com/Namdev90/paruluniversitygoa/commit/2e01326d3f0ec51e3dd48e8dd5c9bb6fd951460e) | 2026-10-18T07:42:30Z | Preserve installer lifecycle and finalize tested responsive reporting source [skip ci] |
| [c0f09c36f4eb](https://github.com/Namdev90/paruluniversitygoa/commit/c0f09c36f4eb3eae6b90e2fbf13417f3c61fcab9) | 2026-10-18T06:04:33Z | Prevent denial of service from XLSX ZIP expansion in workbook imports |
| [d8b8dec1863c](https://github.com/Namdev90/paruluniversitygoa/commit/d8b8dec1863c3a39cc595cc54f3e2c3f77242070) | 2026-10-18T15:47:39+05:30 | Integrate reviewed bounded workbook imports into native migration baseline |
| [4ed74552bb0b](https://github.com/Namdev90/paruluniversitygoa/commit/4ed74552bb0b662f0dcf96fe7011dc177f72ecef) | 2026-10-18T15:47:46+05:30 | Repair report provenance and keep portal list controls fixed |
| [4b322f6c09ca](https://github.com/Namdev90/paruluniversitygoa/commit/4b322f6c09ca52a094c012e62f43f637f8a7553d) | 2026-10-18T15:48:12+05:30 | Implement native Compose workflows with guarded auth and release evidence |
| [1fa233ee0e2c](https://github.com/Namdev90/paruluniversitygoa/commit/1fa233ee0e2cda21565fd60ba21a6d36687c2f8e) | 2026-10-18T15:50:16+05:30 | Install supported Android SDK packages in native CI |
| [57ad0e89b398](https://github.com/Namdev90/paruluniversitygoa/commit/57ad0e89b398c73c2b536d962e396b0c6ccfc74a) | 2026-10-18T16:20:24+05:30 | Fix compact native layouts and form stability with full-shell regressions |
| [89147fb4c015](https://github.com/Namdev90/paruluniversitygoa/commit/89147fb4c0153bd4e9e6a03115a144aea290bbe9) | 2026-10-18T16:41:38+05:30 | Address CodeRabbit audit follow-up and honor branding deferral |
| [62d40b01133b](https://github.com/Namdev90/paruluniversitygoa/commit/62d40b01133b444cbc8e771e85a920b397261df7) | 2026-10-18T16:56:27+05:30 | Record owner release approval while retaining verification gates |
| [7a922b07e645](https://github.com/Namdev90/paruluniversitygoa/commit/7a922b07e645ca0d8c744a0903320a733b9ce104) | 2026-10-18T17:08:22+05:30 | Scope owner verification waiver to native 0.7.7 release |
| [369892121082](https://github.com/Namdev90/paruluniversitygoa/commit/3698921210829a31dc9a27de953ae646c3275ed1) | 2026-10-18T17:14:54+05:30 | Fix release review lifecycle, sign-out and registration issues |
| [96e48d0de057](https://github.com/Namdev90/paruluniversitygoa/commit/96e48d0de0571bc4aec4291bac83901fac5a53f4) | 2026-10-18T17:16:41+05:30 | Record owner-scoped native release waiver and verification evidence |
| [38cc5a591091](https://github.com/Namdev90/paruluniversitygoa/commit/38cc5a591091272939c9d85d08d8cc847a0a849e) | 2026-10-18T17:51:14+05:30 | Order profile refreshes and retain failed sign-out revocation token |
| [2ce2b547aa13](https://github.com/Namdev90/paruluniversitygoa/commit/2ce2b547aa133b092ccec26d9de57c58635713dd) | 2026-10-18T17:57:19+05:30 | Pin final authentication source and record private original-key recovery |
| [921fd3bfb20d](https://github.com/Namdev90/paruluniversitygoa/commit/921fd3bfb20d1b12edc1607dc88ada39dd22fae1) | 2026-10-18T18:42:10+05:30 | Release original-key-signed native Compose 0.7.7 (15) |
| [987632021acc](https://github.com/Namdev90/paruluniversitygoa/commit/987632021acc1924a48c873d82cb214de9eeac75) | 2026-10-18T18:47:58+05:30 | Release Navrang Gate native Compose 0.7.7 (15) |
| [c11b48fd5a13](https://github.com/Namdev90/paruluniversitygoa/commit/c11b48fd5a13742b7db86b05aaab9e5632b58e6b) | 2026-10-18T19:17:31+05:30 | Restore original Navrang interface and gold logo while retaining native engines |
| [a7a6cbad03ed](https://github.com/Namdev90/paruluniversitygoa/commit/a7a6cbad03eda3e05471082da8ff033e2e9cf656) | 2026-10-18T19:25:42+05:30 | Preserve restoration release gates and verify original interface previews |
| [2a7a698b7bb0](https://github.com/Namdev90/paruluniversitygoa/commit/2a7a698b7bb07c8b52943994aec90a5a0695ae68) | 2026-10-18T19:41:13+05:30 | Retain import, dual-station grants and expiry protections in original interface |
| [4a077f8775b2](https://github.com/Namdev90/paruluniversitygoa/commit/4a077f8775b2bfc44ac7042d63ab6ec170163025) | 2026-10-18T19:46:42+05:30 | Record verified original-design source and final regression receipts |
| [26462bc981e9](https://github.com/Namdev90/paruluniversitygoa/commit/26462bc981e9b64a70095392c6d23e024dee99f4) | 2026-10-18T21:51:45+05:30 | Resolve restoration review findings and preserve server station boundaries |
| [f14fcc88ce27](https://github.com/Namdev90/paruluniversitygoa/commit/f14fcc88ce2745761d2950d8c146b2ed43d21204) | 2026-10-18T21:53:35+05:30 | Record owner approval and scoped acceptance waiver for restoration 0.7.8 |
| [3549c1983f24](https://github.com/Namdev90/paruluniversitygoa/commit/3549c1983f24eaaa95efbcc74cd51e81e2862212) | 2026-10-18T22:06:01+05:30 | Restore explicit native browser sign-in fallback for provider failures |
| [083034045146](https://github.com/Namdev90/paruluniversitygoa/commit/08303404514689ebd94e1cc532669fe716b275a9) | 2026-10-18T22:07:00+05:30 | Bind approved restoration release to verified browser-fallback source |
| [c82598ed8a3e](https://github.com/Namdev90/paruluniversitygoa/commit/c82598ed8a3e5c81c9bb743187ee23f78c7607f2) | 2026-10-18T22:16:33+05:30 | Release original-key-signed Navrang Gate 0.7.8 with original design and logo |
| [6c20848f22a1](https://github.com/Namdev90/paruluniversitygoa/commit/6c20848f22a1475c07f3aeef3d6b7572a8b8d5cc) | 2026-10-18T22:21:50+05:30 | Release Navrang Gate 0.7.8 (16) with original design and logo |
| [bfeae23e511e](https://github.com/Namdev90/paruluniversitygoa/commit/bfeae23e511ef05077f21069fec5430c7f62a80a) | 2026-10-18T22:54:52+05:30 | Improve original Navrang depth, scrolling and in-camera ID verification |
| [95721dc7c54a](https://github.com/Namdev90/paruluniversitygoa/commit/95721dc7c54a51c80838088b10e248c58e522017) | 2026-10-18T23:12:23+05:30 | Fix independent visual and safety review findings before release |
| [a42cb1be6124](https://github.com/Namdev90/paruluniversitygoa/commit/a42cb1be61249a49d68a562ff869ce6b796911aa) | 2026-10-18T23:21:53+05:30 | Complete review refinements and publish safe documentation/history tooling |
| [795ed2fe2259](https://github.com/Namdev90/paruluniversitygoa/commit/795ed2fe225930fbe68132c3d94fbb248063241b) | 2026-10-19T00:09:33+05:30 | Bound automatic camera assistance and finish compact list layouts |
| [9a3d0d5700a0](https://github.com/Namdev90/paruluniversitygoa/commit/9a3d0d5700a056cb8eed28f9991fb9197bc0023e) | 2026-10-19T00:20:12+05:30 | Reject stale camera callbacks and preserve full rotated QR bounds |
| [a1c839ad92a5](https://github.com/Namdev90/paruluniversitygoa/commit/a1c839ad92a5bd51efac3762454520171730ee5a) | 2026-10-19T02:02:33+05:30 | Complete faithful logo, report downloads, raised controls and persistent release updates |
| [ef74f58ea3ee](https://github.com/Namdev90/paruluniversitygoa/commit/ef74f58ea3ee9828f69e54f9ebc4f82c52bd12cf) | 2026-10-19T02:11:49+05:30 | Keep saved Help Desk records and review controls reachable at compact heights |
| [41fb0eaf88e3](https://github.com/Namdev90/paruluniversitygoa/commit/41fb0eaf88e34f01916fcd9d92812c509d093638) | 2026-10-19T02:17:20+05:30 | Wrap Help Desk footer and keep review actions accessible on compact screens |
| [df7c5d57ed82](https://github.com/Namdev90/paruluniversitygoa/commit/df7c5d57ed827013e90736f4131bf4f181de38c2) | 2026-10-19T02:24:06+05:30 | Allocate 0.7.9 code 17 candidate and verify modal controls in the top layer |
| [12385318ca6e](https://github.com/Namdev90/paruluniversitygoa/commit/12385318ca6e614e2306f325433396c7a075cea3) | 2026-10-19T02:32:09+05:30 | Exercise report downloads with paced user clicks and durable failure diagnostics |
| [289067b498eb](https://github.com/Namdev90/paruluniversitygoa/commit/289067b498eb979977f729aa862b015cdc75d29e) | 2026-10-19T02:51:51+05:30 | Record owner-scoped post-release device checks for verified 0.7.9 source |
| [2801f8c0fc33](https://github.com/Namdev90/paruluniversitygoa/commit/2801f8c0fc332ec29ccc906a50ea478cb2233422) | 2026-10-19T03:23:37+05:30 | Keep report downloads reachable on phones inside the fixed app shell |
| [cbbfbf147893](https://github.com/Namdev90/paruluniversitygoa/commit/cbbfbf147893e6545ff59f96dca62c93f4fd71b5) | 2026-10-19T03:25:04+05:30 | Bound report scrolling to the remaining app height |
| [275c0cfd64d1](https://github.com/Namdev90/paruluniversitygoa/commit/275c0cfd64d13ab1e78523bcc02d91715adc328c) | 2026-10-19T03:25:26+05:30 | Verify Reports remains bounded by the phone content viewport |
| [1a1a5551dc94](https://github.com/Namdev90/paruluniversitygoa/commit/1a1a5551dc941f8fda84b95baf550455785d62e5) | 2026-10-19T03:26:08+05:30 | Record owner acceptance and reviewed phone report-layout release source |
| [899d295cae93](https://github.com/Namdev90/paruluniversitygoa/commit/899d295cae93f75cf61fd863cfa4eaa29b48197b) | 2026-10-19T03:59:06+05:30 | Publish verified original-key-signed Navrang Gate 0.7.9 with reachable report downloads |
| [6f450eb5b031](https://github.com/Namdev90/paruluniversitygoa/commit/6f450eb5b03183d5cd2a15de48a33ab820e94f93) | 2026-10-19T04:05:12+05:30 | Merge pull request #12 from Namdev90/feature/navrang-depth-search-079 |
| [0b2494d6b8a7](https://github.com/Namdev90/paruluniversitygoa/commit/0b2494d6b8a7491670c1fffd99802eaa41b80388) | 2026-10-19T11:04:49+05:30 | docs: add repository navigation and reconcile current release guidance |
| [036173342826](https://github.com/Namdev90/paruluniversitygoa/commit/03617334282608b2077cd98de27565359a116aa4) | 2026-10-19T11:10:07+05:30 | Merge pull request #17 from Namdev90/docs/repository-navigation |
| [8d285fa43931](https://github.com/Namdev90/paruluniversitygoa/commit/8d285fa43931309ebb7840a4960bc7562ed911ea) | 2026-10-19T10:33:40+05:30 | Complete 17-APK history inventory and enforce original-signature verification |
| [e1176bf7c1eb](https://github.com/Namdev90/paruluniversitygoa/commit/e1176bf7c1ebecca1f1e2de08cb0a3d8934bb9bf) | 2026-10-19T11:12:39+05:30 | Merge pull request #16 from Namdev90/chore/verified-history-through-079 |
| [a8bcc53f4d2a](https://github.com/Namdev90/paruluniversitygoa/commit/a8bcc53f4d2a7e2d63b063d04b6d64a0960316a1) | 2026-10-19T12:30:20+05:30 | Record verified publication of all historical Releases |
| [88ee17bee51e](https://github.com/Namdev90/paruluniversitygoa/commit/88ee17bee51e29157b00f4a73e5e4c209df3c259) | 2026-10-19T04:48:04+05:30 | Use approved combined Navrang and Parul lockup on maroon |
| [7ef350ae75d3](https://github.com/Namdev90/paruluniversitygoa/commit/7ef350ae75d3f3c1af9a070080d129bf75b59c8f) | 2026-10-19T09:47:47+05:30 | Prepare Navrang 0.8.0 UI release; defer communications |
| [59938aa8d306](https://github.com/Namdev90/paruluniversitygoa/commit/59938aa8d30653b4a28665cfc4922806965d23cd) | 2026-10-19T09:56:52+05:30 | Keep teacher access reachable in short landscape at large text |
| [c3ef38196b08](https://github.com/Namdev90/paruluniversitygoa/commit/c3ef38196b0830383456708afd4a73fa07553772) | 2026-10-19T10:05:55+05:30 | Record approved 0.8.0 signing checkout and verified-source handoff |
| [833ba457093f](https://github.com/Namdev90/paruluniversitygoa/commit/833ba457093f00d9d0907adfbdfdf316afa7fcd7) | 2026-10-19T12:19:28+05:30 | Release original-key-signed Navrang Gate 0.8.0 (18) and preserve APK history |
| [f5c8614b0aea](https://github.com/Namdev90/paruluniversitygoa/commit/f5c8614b0aea64d5e6bc4d6b50acf94bf8596ff3) | 2026-10-19T12:28:43+05:30 | Release Navrang Gate 0.8.0 (18) with verified original signature |
| [e20f2e86fa95](https://github.com/Namdev90/paruluniversitygoa/commit/e20f2e86fa95e76a486a7d7168de203bf8dec208) | 2026-10-19T12:33:21+05:30 | Reconcile archive receipt with independently published 0.8.0 main |
| [cf7c6f44eed5](https://github.com/Namdev90/paruluniversitygoa/commit/cf7c6f44eed55b7ab4d88efd69965e3eabe45dc6) | 2026-10-19T12:49:20+05:30 | Merge pull request #18 from Namdev90/docs/published-history-receipt |
| [f25258d1e4f8](https://github.com/Namdev90/paruluniversitygoa/commit/f25258d1e4f8219d263dbf10a3b854727db71407) | 2026-10-19T21:27:55+05:30 | docs: correct current download status to 0.8.0 |
| [549cb80c5e7c](https://github.com/Namdev90/paruluniversitygoa/commit/549cb80c5e7c492b2a972cfe8710cbce40fcee8b) | 2026-10-19T21:39:30+05:30 | docs: append verified 0.8.0 publication receipt |
| [b8605c5e5e69](https://github.com/Namdev90/paruluniversitygoa/commit/b8605c5e5e694bc741a3d36b26bf76c8ab7f4ac1) | 2026-10-19T22:05:29+05:30 | Merge pull request #19: reconcile 0.8.0 publication status |
| [12b39239e53f](https://github.com/Namdev90/paruluniversitygoa/commit/12b39239e53f035b6d586a1d081294a289bd4dbb) | 2026-11-06T01:04:00+05:30 | Integrate verified Navrang recovery on published main |
| [b950a5bd07d2](https://github.com/Namdev90/paruluniversitygoa/commit/b950a5bd07d286f5bc3fc26ab39329375d0f1f6e) | 2026-11-08T14:25:01+05:30 | Prepare Navrang 0.9.0 with reviewed Edge configuration |
| [a92b2607ad9f](https://github.com/Namdev90/paruluniversitygoa/commit/a92b2607ad9f6a000f373b1e56e059a7f4bb2352) | 2026-11-08T19:52:51+05:30 | Keep Navrang navigation reachable on long screens |
| [b4dc603e3438](https://github.com/Namdev90/paruluniversitygoa/commit/b4dc603e34384f72db8c28fc5e302a1a88ed2be3) | 2026-11-08T20:04:34+05:30 | Add swipe navigation and dedicated Admin location and audio controls |
| [bd0bf71a4506](https://github.com/Namdev90/paruluniversitygoa/commit/bd0bf71a4506276519eaa1128228e30e19353a6e) | 2026-11-08T21:35:28+05:30 | Organize Navrang admin tools in Account and refine all screens |
| [3196c3bfa6a1](https://github.com/Namdev90/paruluniversitygoa/commit/3196c3bfa6a1ca72c5695a1358960de3f22309d7) | 2026-11-08T21:44:52+05:30 | Verify Admin Reports live under Account |
| [5c3bd3a47b18](https://github.com/Namdev90/paruluniversitygoa/commit/5c3bd3a47b184f8f5580269be19362ad87554494) | 2026-11-09T04:05:12+05:30 | Apply reviewed Navrang navigation and scanner design |
| [5522e7253000](https://github.com/Namdev90/paruluniversitygoa/commit/5522e7253000a1f4a61575c9a453dc11b7ec22ef) | 2026-11-09T15:23:00+05:30 | Restore the local voice relay runtime test |
| [8e2a816595de](https://github.com/Namdev90/paruluniversitygoa/commit/8e2a816595de9c3df7b04f0b1f1f2e1420a3b480) | 2026-11-09T17:53:41+05:30 | Pin the Navrang voice gateway to its controller |
| [44461d71e217](https://github.com/Namdev90/paruluniversitygoa/commit/44461d71e217879a1d20185f2b9f96007cf4415a) | 2026-11-09T18:16:04+05:30 | Clear idle immutable relay memberships safely |
| [34d9ba129a30](https://github.com/Namdev90/paruluniversitygoa/commit/34d9ba129a30762870dba1f11feda7c68e5d3bf8) | 2026-11-09T19:59:34+05:30 | Offer voice join before starting the audio service |
| [9914009c24e8](https://github.com/Namdev90/paruluniversitygoa/commit/9914009c24e81a22d031f7ff029277a0e1e7e2a9) | 2026-11-09T23:15:08+05:30 | Ship the redesigned 0.9.0 without deferred communications |
| [a9dfe8271744](https://github.com/Namdev90/paruluniversitygoa/commit/a9dfe8271744af19d95dbcb9168f34caa898527d) | 2026-11-09T23:28:06+05:30 | Record approval and upgrade evidence for Navrang 0.9.0 |
| [868a542ac855](https://github.com/Namdev90/paruluniversitygoa/commit/868a542ac855e3b7c4ca7accd066d170f676c535) | 2026-11-09T23:28:50+05:30 | Stage the verified Navrang 0.9.0 release |
| [ecaf4346ca4a](https://github.com/Namdev90/paruluniversitygoa/commit/ecaf4346ca4a09c2ec7108ac6fcf49db40094218) | 2026-11-09T23:30:13+05:30 | Revert "Stage the verified Navrang 0.9.0 release" |
| [d5eb48687241](https://github.com/Namdev90/paruluniversitygoa/commit/d5eb48687241ca8a2b99412509868241d69c3c59) | 2026-11-09T23:30:13+05:30 | Disable the dormant voice service in the release manifest |
| [be0fd26af72b](https://github.com/Namdev90/paruluniversitygoa/commit/be0fd26af72b71020bd1cbf9c144afb1e0c0d5ef) | 2026-11-10T00:35:39+05:30 | Tighten Navrang layouts across stations |
| [885cf33d587a](https://github.com/Namdev90/paruluniversitygoa/commit/885cf33d587a78ba5040109a8e0d7e3a665046b1) | 2026-11-10T00:38:58+05:30 | Keep the scan action readable at enlarged text sizes |
| [8e0d5fee3238](https://github.com/Namdev90/paruluniversitygoa/commit/8e0d5fee32388a558e7c6f87f07869405a02e907) | 2026-11-10T00:45:09+05:30 | Record signed 0.9.0 upgrade verification |
| [7546776d0f36](https://github.com/Namdev90/paruluniversitygoa/commit/7546776d0f360709affbaaf31db91d90728637ff) | 2026-11-10T00:45:14+05:30 | Prepare the signed Navrang 0.9.0 update |
| [b21798702fe2](https://github.com/Namdev90/paruluniversitygoa/commit/b21798702fe2a99e1d419e15b8d31011f2fc7fa6) | 2026-11-10T00:52:44+05:30 | Release Navrang 0.9.0 |
