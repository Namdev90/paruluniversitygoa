# Navrang assets

- event-poster.jpg: unchanged artwork supplied by the organizer; actual Parul University Goa wordmark and Navrang event art are displayed from this source.
- app-icon.png and app/res/drawable/app_icon.png: identical original Navrang Gate mark created with built-in image generation. No official university seal or wordmark was invented.

Prompt: Square Android launcher icon for Navrang Gate, a student entry scanner for the Navratri celebration at Parul University Goa. Premium 3D skeuomorphic icon, admission check and crossed dandiya, full-bleed burgundy satin enamel tile with fine warm gold rim, ivory check inset in a gold medallion, patterned red/gold sticks. Embossed metal, soft depth, crisp silhouette readable at 48px, centered with launcher margins, warm light. Burgundy #850034, cream #F9EBCF, gold #D7A64D, tiny navy accents. No text, QR, watermark, invented university seal or wordmark.


Version 0.3.0 uses the organizer-approved Navrang / Parul University Goa generated logo from the current design thread, resized for icon packaging. The separate official wordmark (`parul-goa.svg`) is copied without redrawing from https://goa.paruluniversity.ac.in/hero-logo.svg, supplied via the organizer’s official-logo reference. University/event branding is used for this organizer-requested event app; it does not establish a general license. Synthetic SIM ticket QR images are generated with the bundled ZXing writer and contain sample identifiers only. The opening, navigation and result bell WAV files are original mathematical synthesis, with no external recording. Chota Namu uses a labeled CN guide medallion; no personal portrait was generated.

Version 0.4 replaces the stacked mark with the exact horizontal SVG from https://goa.paruluniversity.ac.in/logo.svg, rendered to `parul_line.png` for the native camera header. The revised Navrang raster icon uses this horizontal reference. The opening foreground `navrang-dancers.webp` was produced through the built-in image editor from the organizer's supplied poster, isolating its two prominent dancers with transparency, then resized/encoded for the app. The poster itself is no longer the opening background. Current image-edit prompts requested horizontal branding only, preserving the existing dandiya/diya/Navrang treatment, and isolated dancers with no poster text/background. No stacked university logo or rehearsal QR is used by the current interface.


## Version 0.6 complete figures

Mode: built-in image generation/editing with the prior organizer-derived dancer artwork as reference, transparent background. The shared clipped foreground has been replaced by two independent full figures. The original horizontal official university SVG is unchanged.

- Male source output: `/workspace/scratch/ac51eea4322a/generated_images/exec-8347fa14-98df-450b-a429-630cd9767643.png`; shipped as `art/dancer-male.webp`.
- Female source output: `/workspace/scratch/ac51eea4322a/generated_images/exec-380064d0-0f23-4e13-a87a-23c584111e60.png`; shipped as `art/dancer-female.webp`.
- Male prompt: one standalone blue embroidered kediyu dancer with magenta scarf and cream dhoti matching the reference; remove the woman and every skirt fragment; face right holding two dandiya sticks; reconstruct the entire figure including both legs, ankles and mojari shoes; keep the full silhouette inside a transparent canvas with no text/background.
- Female prompt: one standalone dancer in the reference blue/magenta chaniya choli, gold trim, flowing dupatta and hair; remove the man; face left holding two dandiya sticks; preserve the complete skirt hem and show both legs/mojari shoes; full figure inside a transparent canvas with no other figure fragments, text or background.

Both output images were inspected at full figure size, then resized to 900×1350 and encoded as WebP without compositing or cropping. Full-device animation layout still needs phone review.

Sound source details, hashes and CC0 license texts are in `app/assets/audio/`. The ten cues use Kenney Interface Sounds, UI Audio and Music Jingles; no oscillator synthesis is used in the current live client/native feedback. Samples were loudness-normalized; hardware and OS policies determine actual output volume.


## Production sign-in branding

`google-g.png` is the unchanged official current gradient Google G from `https://developers.google.com/static/identity/images/g-logo.png`, linked from Google's Sign in with Google branding guidelines at `https://developers.google.com/identity/branding-guidelines` (retrieved 17 October 2026). It is used only next to the "Continue with Google" sign-in action, with its original aspect ratio preserved on a white background. The previous hand-typed blue G was removed. The PNG is bundled locally so sign-in artwork requires no external image request. Brand use is governed by Google's branding guidelines; it is not a newly generated mark.
