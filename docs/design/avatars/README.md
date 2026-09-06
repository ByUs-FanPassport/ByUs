# ByUs default avatar catalog

Twelve static characters: star, heart, fairy, ghost × cream, pink, lavender.
Every active account receives one uniformly random ID once; the original assignment persists independently of later photo or character selection.

## Assets

- source/: retained generated PNG originals; generation backend may return a larger square than its requested 1024×1024 output.
- Service assets: apps/web/public/images/avatars/{character-id}.webp, 512×512.
- catalog.html: actual 128, 64 and 32 CSS pixel circular comparison, using service assets.

## Provenance

Generated with the user-requested god-tibo-imagen CLI, private-codex provider, explicit gpt-5.5 model on 2026-09-06. The default gpt-5.4 backend model was unavailable for this account. Cream star, heart and ghost retain the previously selected exploration originals. Fairy proportions were enlarged before producing its color variants. Color variants reference their respective cream PNGs; prompts preserve silhouette, expression, outline and background while replacing body fill with soft pink (#F4C5D6) or lavender (#D9CEF2).

Color variants are generated edits and may contain minor raster differences. These are local product assets, not artist photography. No app-wide mascot placement or other brand surface is changed by this catalog.
