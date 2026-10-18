# Portal publication checklist

The existing browser companion is [Navrang Gate](https://navrang-gate-admin.namubhai.chatgpt.site). Its publication is independent of an Android release or repository push. The hosted interface has not yet been verified against the next reviewed candidate, and production reporting readiness remains unverified.

## Before publication

- Use the implementation lead's exact reviewed source commit, passing checks and resolved independent-review findings. Do not publish an unfinished candidate or synthetic screenshot wrapper.
- Confirm current hosting ownership and access in the authorized management interface. Preserve the existing site, audience, domain, authentication, server permissions and login redirects.
- Confirm that the deployed services support the candidate's required contracts. Resolve compatibility issues through a separately reviewed, authorized change before publishing dependent features. Do not change backend data, schema, grants or authentication as an incidental website step.
- Generate a clean browser package with `python3 tools/package-web.py .build/web-portal`. Verify every referenced script, stylesheet, image and audio resource exists and matches the reviewed source.
- Include only production assets and reviewed owner-supplied/approved artwork with accurate credits. Exclude private records, workbooks, credentials, signing material, synthetic transport, debug files and internal deployment records.
- Render each affected page and state at phone, tablet, laptop and short-height sizes. Check large text, keyboard access, scrolling/search, empty/loading/error states, intro overlap and permission-appropriate present-only detail cards. Missing fields/sections stay hidden; meaningful zero/false values remain visible.
- Test reports and exports only with authorized isolated fixtures. Record mock/source checks separately from authenticated hosted acceptance. Do not create real admissions or staff permissions for deployment testing.
- Complete the requested independent reviews. Android camera, Credential Manager, native import/export and installer behavior require their own checks.

## Publish and verify

Use the existing site's supported source/version/deployment workflow, preserving its audience and hosting settings. Publish only the reviewed package. Keep operational identifiers and credential-bearing commands out of public documentation.

Require a terminal successful deployment and verify the intended live URL, entry point, resources and access behavior. A saved version, source push or deployment request alone is not completion. Record verification limits plainly; do not describe live reporting as available until the service and hosted acceptance evidence supports it.

A suitable public description before reporting acceptance is: “Navrang Gate operations for Parul University Goa: staff sign-in, single-entry verification and Help Desk.” Keep the established title and accurate artwork credits.

Retain the previous deployable version through the hosting service. Rollback and backend changes are separate coordinated decisions that must preserve current data and access.
