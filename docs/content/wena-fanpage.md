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
| Mobile hero | Photo1, white shirts and denim | Natural landscape ratio; official logo and bilingual identity follow, keeping the quiz closer to the first viewport |
| Profile/directory/passport | Photo2 | Top square crop,1200×1200; approved role frames |
| Media thumbnails | Photos1–4 | Top-aligned5:4 previews keep the faces; opening a card shows the full photo |
| Notice | Photos1–4 | Entire natural-ratio photographs |

Use the common `CreatorImage`/`CreatorHeroPicture`, CMS image-role revisions, `NoticeBody`, media list, outbound tracker and quiz workflow. Hero compression uses quality90 only for WENA. WENA embeds the verified Baby Step MV instead of the YouTube API feed; Instagram remains an official external link until its account is connected. The unconnected API feeds are intentionally not requested. NCHIVE retains its existing official playlist; the same component now supports WENA’s official Baby Step MV. The uploads playlist’s current Shorts entry produced a YouTube playback error; the explicit MV played successfully in Ego Lite.

## Registration and local artifacts

`scripts/prepare-wena.mjs` defaults to a read-only Dev preflight. `--apply` uses audited admin CMS RPCs; `--production --apply` targets the verified production project. Set `WENA_ADMIN_APP_USER_ID`, `WENA_ADMIN_ALLOWLIST_ID`, and optional `WENA_ASSET_ROOT`; the root must contain `selection.json` and the five `web/*.webp` files. `.env.supabase.local` supplies existing credentials. Never commit credentials.

The original checkout's `outputs/wena-assets/` preserves the originals, web exports, framing manifest, byte-size report and registration results. `work/wena-fanpage-20261014/` preserves research observations, comparison images, browser screenshots, test/build logs and a rollback-only quiz check.

Dev has additional unpublished-to-main notice fields (`liked`, `likeCount`), which the current main strict schema rejects. Final local rendering therefore uses the existing production data configuration. No unrelated Dev schema or application changes are included in this release.

## Brand and fan experience refinement — 2026-10-14

The official YouTube channel currently displays the pink W emblem on black, with **We;Na** below it. Its name is **We;Na Official**, and its featured video is titled **We;Na (위나)**. Preserve the semicolon and W/N capitalization. The local logo is an unmodified 800px channel avatar; its source URL and hash are in `public/images/celebrities/wena/provenance.json`. No agency affiliation or current member roster is inferred from the channel banner.

Ego Lite observations used to shape this page:

- [Weverse · SEVENTEEN](https://weverse.io/seventeen/highlight): actual public desktop/mobile community. Artist branding and a join action lead into separate Highlight/Fan/Artist/Media/Notice navigation; news and artist content appear before optional commerce. Adopt clear identity, visible participation and content-first discovery. Membership-gated behavior was not exercised.
- [TAEMIN · b.stage](https://taemin.bstage.in/): actual public desktop/mobile homepage. The artist mark, visual, social links and LOGIN/SHARE actions form one identity area; HOME/CONTENT/COMMUNITY and notice/schedule entries are distinct. Adopt coherent artist identity and an obvious path to fan conversation, without copying the dark theme or paid features.

WENA home now pairs the existing official MV with a photo entry, followed by the existing fan board. Empty raffle previews are omitted only after a successful empty response; loading/error and active gifts remain visible, and the Events tab remains available. Quiz/passport behavior and all four original photos are preserved. Common image-role resolution owns the WENA mobile landscape source/frame; no unapproved portrait crop is copied onto it. All new UI labels reuse the existing 11-language catalogs.

Evidence: original checkout `work/wena-brand-20261014/` contains official channel source/logo, actual reference screenshots (Weverse desktop-loaded/mobile, TAEMIN b.stage desktop/mobile), local screenshots and validation logs. Earlier `weverse-desktop.png` was taken before all imagery loaded; use `weverse-desktop-loaded.png` instead.

Final production-build validation: 30 locale/viewport combinations (all 11 locales at 390/1440px, plus Korean/Japanese/Vietnamese/Thai at 360/768px) had no horizontal overflow, failed images or browser alerts; eight axe WCAG A/AA runs had zero violations. Direct visual review also covered 1024px and the media sections at 390/768/1440px. Photo navigation shows all four photos, the fan-board entry selects fan posts, and the quiz entry retains its WENA return destination through the guest login dialog. Keyboard focus and common outbound UTM decoration were checked. Relevant component/image-role tests, lint, typecheck and production build passed. Final evidence is under `validated/`; `invalid-overlap/` contains rejected automation captures and is not release evidence. Physical-device and final production-render checks were not repeated.
