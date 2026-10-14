# Creator home media — 2026-10-14

The shared home preview reuses `CreatorMediaPanel` and the existing public media sources. All published person/group pages receive it; the RUN&MUSIC brand page keeps its current layout. Existing authentication, membership visibility, source errors and retries remain authoritative. No schema, account connection, collection service or dependency was added.

## Source inventory

The production public creator directory and each creator's `/api/celebrities/{slug}/media?locale=ko`, `/youtube` and `/instagram` endpoints were read on 2026-10-14. Jenny's registered CHZZK feed was also read. These are the current connected public records, not an inventory of every post on the social platforms.

| Page | Available public media | Home preview |
| --- | --- | --- |
| elina | 6 official YouTube uploads | 3 videos |
| changha | 6 official YouTube uploads | 3 videos |
| yuna | 6 official YouTube uploads | 3 videos |
| aryeom | 6 official YouTube uploads | 3 videos |
| nchive | 6 official YouTube uploads | 3 videos |
| wena | 4 registered group photos, Baby Step MV, 6 official YouTube uploads | 3 videos and 3 photos; registered MV first |
| jenny-jeong | 5 CHZZK posts, including 4 image posts | 3 photos (broadcast schedule posters) |
| park-myungho | No connected public media items | Official social links retained; no empty media section |
| ifewknow | No connected public media items | Official social links retained; no empty media section |
| thisisj-official | No connected public media items | Official social links retained; no empty media section |

All 10 Instagram responses returned zero current public items. Profile/portrait/landscape renditions are image roles, not a photo gallery; they are not duplicated into one. Each page keeps the official account links from the published DB record. Future connected public items flow through the same existing sources.

## Presentation and navigation

- Up to three items per video/photo/replay group. Registered notice media leads automatic uploads. Duplicate YouTube recordings are collapsed in the home preview.
- Photos retain their natural ratio, including all four We;Na members and the full CHZZK poster. Existing optimized We;Na WebP assets are reused. The 16:9 YouTube frame removes the source thumbnail's black horizontal margins; embedded blurred side panels belong to the source thumbnail.
- A video player mounts only after the localized play button is activated. Only one player is active; keyboard focus moves into it. The title/source/date link opens the original page. External links reuse the common UTM and click tracking with placement `content`.
- More opens the existing media board with the matching filter and locale. Notice photos retain a return path to their creator home. Empty sources disappear; failed sources retain retry controls. Empty raffle previews are omitted on person/group homes while results and the Events tab remain available.

## Validation context

Evidence is preserved in the original checkout at `work/fanpage-media-20261014/`. Local production build at port 3105 used the actual CMS/official-media/CHZZK/LIVE routes. The local environment cannot read the protected production YouTube/Instagram secret values. For these two public GET route families only, Ego Lite supplied the exact production JSON captured above at page initialization. No private or authenticated response was substituted; no API implementation or production configuration changed. Screenshots are local product renders with real captured public responses, not production deployment captures.

Direct visual inspection of Elina, We;Na and Jenny at 390/1440px passed independently, including original images, full group composition, poster contents, source labels and controls. Long home-card titles intentionally clamp at two lines; the source link retains the complete accessible title. Long screenshot captures preserve the requested width and increase viewport height so fixed bottom navigation does not obscure the captured section; no product DOM or CSS was hidden for capture.

The browser matrix covered 51 distinct cases: all 10 pages at 390/1440px, We;Na's shared structure in 11 languages at 390/1440px and KO/JA/VI/TH at 360/768px, plus Elina at 768/1024px and Jenny at 768px. No horizontal overflow, broken media image or media-source error was observed. The saved matrix contains requested locales alongside the actual rendered localized headings. Fourteen changed-region axe scans passed with zero violations.

A broader scan of the unchanged Park Myungho page found an existing color-contrast issue in `features/community-stamps/ui/daily-checkin.module.css` (`.primary`); that component is unchanged by this task and is not included in the changed-region pass.

Keyboard Enter started a real Elina YouTube video; its playing video frame and subtitles were observed. Switching videos left one iframe and restored the previous thumbnail. More opened six videos with the English Videos filter and locale retained. A We;Na photo opened its existing notice and retained the home return link. One original-source link opened the expected YouTube URL with UTM values; the common collector returned HTTP 201 for one `outbound_link_click` with campaign `elina`, placement `content` and kind `external`.

Impact validation: 91 tests across media, fan page, media API and shared design/action contracts passed. Targeted ESLint and production build (including TypeScript) passed. Physical devices, authenticated account mutation, new Instagram connections and final deployment READY were not part of this validation.
