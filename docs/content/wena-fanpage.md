# We;Na fan page

Published handle: `/wena` (`/c/wena` remains a supported route).

## Content evidence — checked 2026-10-14 with Ego Lite

- [We;Na Official](https://www.youtube.com/@wena_official): channel ID `UCpiXCVf9CaYppJQDDyiD6nA`. Its channel links identify [Instagram](https://www.instagram.com/wena_official_/).
- [Baby Step official music video](https://www.youtube.com/watch?v=172bEkNPqqs): title verified on the official channel.
- [Like Psycho release credits](https://music.bugs.co.kr/album/20490745): debut single title and release date, **2022-09-05**, verified from the licensed album description and metadata.
- Quiz: debut title, debut release date, and the word completing “Baby Step”. Three questions, four options each, exactly one correct option; uses the existing published quiz/passport flow.
- No member identities, changing lineup, unconfirmed schedules or rewards were inferred from the supplied photos.

## Photography

Four user-supplied JPEGs from `wena_image`, originally long edge 1280px. Upscayl high-fidelity-4x at 2× output was compared with the originals. The service files retain 80% of the Lanczos-upscaled original and mix in 20% of Upscayl to limit smoothing. WebP quality92/effort6/smartSubsample produces long-edge2560px files of 355942, 320788, 304296 and 374574 bytes. This does not recover verifiable detail absent from the originals.

| Role | Source | Framing |
| --- | --- | --- |
| Desktop hero | Photo1, white shirts and denim | Top-aligned cover; separate text column keeps all four faces clear |
| Tablet hero (768–1023px) | Photo1 | Natural ratio, stacked above the text to avoid clipping the outer faces |
| Mobile hero | Photo3, pastel outfits | Natural full-body ratio; text follows the photo |
| Profile/directory/passport | Photo2 | Top square crop,1200×1200; approved role frames |
| Media thumbnails | Photos1–4 | Top-aligned5:4 previews keep the faces; opening a card shows the full photo |
| Notice | Photos1–4 | Entire natural-ratio photographs |

Use the common `CreatorImage`/`CreatorHeroPicture`, CMS image-role revisions, `NoticeBody`, media list, outbound tracker and quiz workflow. Hero compression uses quality90 only for WENA. WENA embeds the verified Baby Step MV instead of the YouTube API feed; Instagram remains an official external link until its account is connected. The unconnected API feeds are intentionally not requested. NCHIVE retains its existing official playlist; the same component now supports WENA’s official Baby Step MV. The uploads playlist’s current Shorts entry produced a YouTube playback error; the explicit MV played successfully in Ego Lite.

## Registration and local artifacts

`scripts/prepare-wena.mjs` defaults to a read-only Dev preflight. `--apply` uses audited admin CMS RPCs; `--production --apply` targets the verified production project. Set `WENA_ADMIN_APP_USER_ID`, `WENA_ADMIN_ALLOWLIST_ID`, and optional `WENA_ASSET_ROOT`; the root must contain `selection.json` and the five `web/*.webp` files. `.env.supabase.local` supplies existing credentials. Never commit credentials.

The original checkout's `outputs/wena-assets/` preserves the originals, web exports, framing manifest, byte-size report and registration results. `work/wena-fanpage-20261014/` preserves research observations, comparison images, browser screenshots, test/build logs and a rollback-only quiz check.

Dev has additional unpublished-to-main notice fields (`liked`, `likeCount`), which the current main strict schema rejects. Final local rendering therefore uses the existing production data configuration. No unrelated Dev schema or application changes are included in this release.
