# Approved combined Navrang / Parul branding

The owner approved the Navrang artwork with the horizontal **Parul University Goa** wordmark below, on a maroon background. The combined transparent PNG is used without cropping, stretching, recolouring, retyping or redrawing either mark.

- File: `app/assets/art/navrang-parul-combined.png`
- Dimensions: 2400 × 1280 pixels; aspect ratio 15:8
- SHA-256: `8744a792295a49aad9c6ff65fae4f3bf1f6fbb66c766c59acfa4616f179e3397`
- University artwork source: [official Parul University Goa horizontal SVG](https://goa.paruluniversity.ac.in/logo.svg)
- Maroon field: radial gradient from `#680724` at the centre to `#260919` at the edges

The full composition appears at a readable size on launch and sign-in. Separate university logos are removed from those regions. Operational headers keep the compact Navrang mark and page title rather than squeezing the full composition into an unreadably small app bar. Footers use a concise text identity. The original square launcher and native scanner icon remain unchanged.

The supplied Navrang artwork's original lower-edge detail is preserved, not reconstructed. The source PNG has transparent padding; layout uses `object-fit: contain` and the original aspect ratio, without clipping away that padding.

This is a source-only branding change after published 0.7.9/code17. It does not change the published APK, updater manifest, release version, signing identity, authentication, permissions, reports or backend. A later signed APK requires a newly coordinated version and source-scoped release verification; the existing 0.7.9 approval cannot authorize changed runtime source.
