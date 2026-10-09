---
id: '03'
slug: '03-fan-pulse-spectrum'
name: 'Fan Pulse Spectrum'
family: 'core'
palette: 'single-gradient-highlight'
font: 'pretendard'
source: "live rendered page"
observed-at: "2026-07-20"
ui-contract-updated: "2026-10-09"
theme: "light-only"
ui-font: "Pretendard Variable"
base-spacing: "4px"
radius-scale: "12px / 16px / 20px / pill"
---

# Design System: ByUs Fan Pulse Spectrum

<!-- Maintenance note (2026-09-05): This document describes the Fan Pulse
Spectrum foundation, not a verified 1:1 specification of every current byus.kr
screen. Shared tokens and FanAction implement core rules; typography and layout
also live in feature CSS modules. Check deployed source and rendered desktop /
mobile states before claiming full alignment. Preserve intentional surface-specific
differences when consolidating tokens and components. -->

## Current shared content contract (2026-10-09)

- A section reads in this order: heading with secondary navigation, description, filters, content. `FanSectionHeader` owns its `{ label, href }` action: the heading and action align in one wrapping row, and supporting copy sits below both. The title has a flexible 10rem basis; long translated actions wrap naturally. Never shrink the title to fit a translation.
- Section headings use 20px on mobile and 24px from 768px; item names use 16px/700, body copy 16px, metadata 13px. Related copy has 4–8px gaps, subgroups 16px, and major sections 32px/48px. Existing hero artwork/display type remains independent.
- Creator summaries read image → name → audience metadata → actions. The name may wrap; stateful fan links stay actionable. Social marks remain 20px inside non-shrinking 44px targets and action groups wrap when necessary.
- Filters have 12px corners and quiet labels. Creator-role filters use equal-width columns sized by the longest localized label, with a five-character Korean minimum (`5em + 26px`) and 44px minimum height. A narrow viewport scrolls the whole strip horizontally without truncating labels; focus outlines remain visible. Status pills remain distinct from filters. Community translation belongs to the body, reactions share one row, and secondary/destructive actions live in the accessible More menu.
- All 11 `APP_LOCALES` use the same composition. Use native language wrapping, flexible heights, and complete accessible labels; do not encode Korean/English-only layout branches. CMS content fallback and proper names retain their existing semantics.
- For shared composition changes, verify affected home/community screens at 390px and 1440px for every supported language, plus 360px and 768px for Korean, Japanese, Vietnamese and Thai. Read the locale list from current `APP_LOCALES` and cover new scripts/directions when supported. Include applicable guest/owner/loading/empty/error states, long names, keyboard menus, locale switching and fixed-navigation clearance. Scope local changes to their actual impact and reuse unchanged valid evidence.

### Content and navigation refinements (2026-10-04)

- Home previews only Passports whose creators are in the current published directory; the explicit Passport count and carousel use that same set. A directory failure shows a recoverable error and a collection link, never a misleading empty collection. The owned collection and historical records remain intact and accessible from MY/Passports. A managed announcement CTA describes and opens its actual destination; creator welcome banners may link directly to the creator home.
- Creator home is a summary. Full conversation, news and media belong to their named tabs; a personal fan activity card appears on home only. Nicknames wrap without competing with attendance, tier or growth controls. The creator's Fan board remains inside that creator's page, and detail, sign-in and back navigation preserve the originating board and language.
- Media uses a clear heading, official-channel links, type filters and a consistent content grid. Video previews retain 16:9 framing and text/metadata hierarchy; source failures remain recoverable without hiding successful content.
- Fan-post replies open within the selected comment, with the target author, a short quote, and keyboard focus in the reply field. Keep the composer and its controls above fixed navigation when focusing. Use compact right-aligned Neutral submit and Text cancel actions (minimum 44×44px), separate top-level and per-comment drafts, and retain drafts on cancel or failure. Cancel returns focus to the originating reply action. A reply retained across comment pagination keeps its target context below the list.
- Community creator selection is the primary element in its switcher; Fan page and LIVE are secondary destinations. Auxiliary participation cards stack as concise rows on small screens. Composer visibility defaults to public for new posts, preserves the saved choice when editing, and uses a compact trigger with a responsive dialog/bottom sheet. Focus return, image limits, upload/error states and member-only permissions remain part of the interaction contract. Uploaded images have a quiet visible boundary.
- A selected post-like heart is filled red and paired with `aria-pressed`; failed requests restore the previous state. Certification cards distinguish open, preparing and ended work, and attempt numbers have an explicit localized label rather than a bare `#1`.
- The fan list becomes a leaderboard from 100 active fans. Count the deduplicated union of completed creator likes and issued Passport holders, while retaining the separate Passport count. Below 100, show recent fans; at 100 or more, show the top 100 and the signed-in fan's rank. Like-only fans participate with zero points until they earn points.
- The available leaderboard replaces the animated fan gathering. Overall, Quiz, LIVE (reservation/attendance), Missions and Verification filters rank the entire eligible fan population on the server. Only Overall includes score adjustments and zero-point fans; category lists show fans with positive points. Existing lifetime score, tie order and threshold stay unchanged. Use the shared circular `Avatar`; ranks 1–3 retain numbered gold, silver and bronze badges on mobile. Show activity earning rules without claiming fixed mission or verification rewards.
- MY separates primary activity destinations from secondary history/request links. Settings is an index of aligned rows leading to query-addressable detail sections with Back navigation, retained locale and visible focus. Entering a detail focuses its heading; returning focuses the originating row. Logout and destructive account actions belong to account details. Authentication and resource restoration use loading states before showing account actions or a guest screen.
- Notifications use the shared Primary action for enabling browser notifications and a Neutral action for marking all read. Unread counts, dots and permission icons use the existing Spectrum Ink and subtle focus surface; status is also conveyed through labels and weight.
- These refinements reuse the existing ByUs brand. Public Weverse artist tabs and b.stage community/MY references informed separation of summaries, feeds, media and settings; they do not establish ByUs membership rules or authentication behavior. Source examples: [Weverse artist home](https://weverse.io/enhypen/highlight), [Weverse media](https://weverse.io/enhypen/media), [b.stage community](https://bigbang.bstage.in/community), [b.stage My Posts & Activity](https://bstage.in/article/bstage-tips-7-en/).

### Creator board and unified feed (2026-10-09)

- Creator pages have five primary destinations: Home, Board, Fan verification, Events and Fan leaderboard. Board contains Feed, Official media and LIVE. Keep the creator, language and originating board filter when entering details or signing in; legacy news, media, LIVE, lounge and cheer links resolve to their corresponding destination.
- Feed is one chronological conversation combining official posts, fan posts and existing cheers, with All, Official and Fan posts source filters. Pinned standard notices precede pinned welcome notices; an unpinned welcome notice follows its publication time. Use one existing composer in All and Fan posts. Each content type keeps only its supported reactions, comments and owner actions.
- The board navigation, filters and feed share the full `FanContentContainer` edges: 1440px maximum width and 16/32/40px responsive gutters. There is no secondary official-news column. Individual text and media retain readable widths inside the full-width feed. Creator home may retain its calendar beside the summary.
- Official media uses three columns on desktop, two on tablet and one on mobile. Keep a purposeful empty state with a filter reset or Feed destination; a failed source has a retry action while successful content remains visible. Official channels stay available above the grid.
- A new fan post shares the existing one-time first-comment reward eligibility with cheers and notice comments. Do not suggest a new score reward or retroactively reward existing fan posts. Existing content and reward history remain intact.

### Completion requires a visual finish review

- Apply the current user-approved design, then this current role contract. Historical observations and example prompts cannot override it. Reuse shared owners and keep approved hero/profile/display variants; do not normalize every surface into the same card. This document is a design contract, not a claim that an old checkout or production already implements it.
- Verify both behavior/accessibility and the actual composition. View the affected mobile and desktop screens at native display size with realistic normal content and varied representative images. Confirm a clear first focus and next action, readable title/body/metadata hierarchy, coherent information groups, optical icon alignment, face-legible crops, balanced density and deliberate section rhythm. Compare with the approved product direction and resolve visible disharmony before claiming visual completion.
- Check translated and long content without shrinking type/targets or hiding meaningful information. Inspect active keyboard focus in Portal menus as well as the surrounding page, and inspect open dialogs for padding, clipping, safe-area and fixed-navigation conflicts. Focus ownership or automated accessibility passes alone do not prove visible focus or aesthetic quality.
- Keep evidence tied to the changed screen, width, locale and state. Loading-only captures, repeated identical portraits or isolated component fixtures cannot certify a whole page. Report functional checks and visual judgment separately; disclose incomplete states and unresolved material issues. No score or token check guarantees beauty.

## Intent

The system is an image-first fan utility: editorial artist imagery creates emotion, while quiet product surfaces make reservation, login, discovery, and Passport tasks immediately understandable. Current approved role contracts below guide new UI. Historical extraction notes describe their original evidence, not current deployment status.

## Color

Use a White and Near Black shell with a `single-gradient-highlight` strategy. Reserve the filled pink-to-violet Spectrum Relay for the current surface's single most important next action. Google, Passport, and repeated LIVE-row context actions may reuse the relay as a 1px outline with a high-contrast solid Spectrum Ink label; neutral utility surfaces must not compete with artist photography.

## Typography

Use Pretendard Variable throughout product UI. Apply the exact hierarchy, weight, line-height, and tracking rules documented below; countdown numerals use a monospace stack with tabular figures.

## Image

Use face-legible, editorial, full-color artist photography. Preserve the approved hero crop and Home's inset square favorite artwork within a Gallery Gray field. The `/celebrities` directory uses full-bleed portraits: 5:4 on mobile and square from 768px, retaining the registered image source and focal position. Role filters use 12px rounded rectangles with at least 44px touch targets; search and sort render at the same 14px label size. Use only the fully opened identity-and-stamp Passport asset.

## Surfaces

Use 12px controls, 16px collections, and a 20px hero with 1px neutral hairlines and short two-layer micro-shadows. Avoid dark utility cards, glassmorphism, nested cards, and decorative color surfaces.

## Interaction

Maintain 44px minimum targets, a 3px Near Black `focus-visible` outline, 160ms control feedback, and 240ms object or layout transitions. Adjacent icon-only actions, including Home celebrity social links, use optically centered 20×20px visible marks inside separate 44×44px targets with no inter-target gap. Never overlap or shrink the targets to achieve visual density. Collapse transitions for reduced-motion users.

## Locked Contract

Preserve the Korean copy, artist identities, live data, Google login treatment, opened Passport lifecycle copy, and responsive panel behavior. The global fan information architecture is `HOME · 커뮤니티 · 최애 · MY` on desktop and mobile: HOME routes to `/`, 커뮤니티 to `/community`, 최애 to `/celebrities`, and MY to `/my`. Passport, benefits, notifications, and settings are MY sub-surfaces and keep MY active. Focused login, onboarding, verification, attendance, and survey flows may use the compact Focus Header. The hero remains the sole dominant visual surface, while the active surface's one most important next action may use the gradient-filled Primary treatment.

The Home hero is an independently managed carousel of published home banners, ordered by the administrator's saved order with stable ID ties. Publishing LIVE occurrences does not add hero slides; the LIVE calendar and upcoming list retain their independent schedules. A creator may have at most one published regular-broadcast banner. Banner artwork, copy and destination are localized for Korean and English. Mobile uses the registered mobile artwork, falling back only to the same language's desktop artwork with contain. The existing Elina participation guide remains the final slide. With more than one item the carousel advances horizontally every 6 seconds; hover, keyboard focus and pointer interaction pause it. Reduced-motion users receive no autoplay or large translation. Hidden slides are inert. Keep existing geometry, controls and typography.

All Home hero status badges (UPCOMING, LIVE, and SPECIAL EXHIBITION) share one component and use the user-selected Magic UI Shimmer Button perimeter light: pale pink-white glint on a dark solid surface, original 3s alternating travel and 6s rotation, with existing 28px height and 12px type. Only the visible active badge animates; offscreen/hidden slides pause and reduced-motion keeps the static outline.

Scheduled LIVE countdowns share a vivid pink accent (`#be185d`), with a pale pink fill (`#fff1f7`) and fine pink border on MY and badge variants. Calendar text variants keep their compact unboxed layout. On Home photography, use pale pink text (`#ffd0e6`) on a dark translucent pill. A 7px dot and expanding halo pulse every 1.8s while a future LIVE is visible and active; the time text stays steady. Hidden/inactive countdowns and elapsed scheduled starts do not pulse, and reduced-motion disables both dot and halo animation. Keep existing KST date/countdown semantics and server-confirmed LIVE status.


## 1. Visual Theme & Atmosphere

Fan Pulse Spectrum is a bright, image-first fan utility interface. A full-color KARA hero supplies nearly all of the page's visual intensity; the surrounding product UI stays white, neutral, and deliberately quiet. The composition pairs editorial entertainment imagery with disciplined product surfaces: generous whitespace, black display type, hairline borders, short micro-shadows, and one pink-to-violet conversion accent. The result should feel like a polished global fan platform rather than a promotional microsite or a dense dashboard.

The page uses asymmetry only at desktop scale. The main content owns the visual narrative while a narrower sticky context panel handles logged-out actions. Below 1024px, that panel disappears and the experience becomes a single-column feed with a fixed four-item bottom navigation. Color is concentrated in photography, the primary reservation action, and restrained Spectrum outlines on repeated LIVE-row actions; utility cards do not compete with the hero.

### Key Characteristics

- Image-first editorial hierarchy with one dominant 2:1 desktop hero.
- White canvas, near-black text, soft neutral surfaces, and almost invisible borders.
- One controlled pink-to-violet filled gradient reserved for the primary conversion CTA; repeated LIVE-row actions may reuse the same relay only as a 1px outline.
- Rounded but not bubbly: 12px controls, 16px collections, 20px hero, full pills only for status and primary action.
- Large negative space between sections; dense information is organized inside compact rows rather than scattered labels.
- Product utility and fandom emotion remain separate: photography carries emotion, cards carry tasks.

## 2. Color Palette & Roles

| Role | Semantic Name | Value | Usage |
| --- | --- | --- | --- |
| Page background | Canvas White | `#FFFFFF` / `oklch(100% 0 0)` | Page, header, primary cards, context panel cards |
| Primary text | Near Black | `oklch(18% 0 0)` | Headings, active navigation, key labels, focus rings |
| Secondary text | Muted Ink | `oklch(48% 0 0)` | Subtitles, metadata, supporting instructions |
| Subtle surface | Soft Gray | `oklch(97.5% 0 0)` | Quiet hover states and low-emphasis controls |
| Media field | Gallery Gray | `#F6F6F5` | Framed artist-photo fields inside the favorite collection |
| Structural line | Hairline | `oklch(90% 0 0)` | Navigation capsule and bottom navigation dividers |
| Card line | Micro Hairline | `oklch(93% 0 0)` | Cards, artist media fields, social buttons, live rows |
| Strong line | Warm Gray | `oklch(76% 0 0)` | Reserved for stronger internal guides; use sparingly |
| Primary action | Spectrum Relay | `linear-gradient(125deg, oklch(68% 0.22 18), oklch(62% 0.25 340), oklch(56% 0.22 285))` | The current visible surface's single most important next action |
| Action text | On Action White | `#FFFFFF` | Text and icons on the gradient CTA |
| Status accent | Live Pink Line | `rgb(255 95 191 / 78%)` | UPCOMING status outline only |
| Highlight outline | Spectrum Relay | Same gradient as Primary action | 1px border on Google, Passport, and repeated LIVE-row context actions |
| Highlight action text | Spectrum Ink | `oklch(45% 0.22 315)` | Solid accessible label, icon, and arrow on outlined highlight actions |

### Primary

- The interface is monochrome-first. White and Near Black define the product shell.
- The Spectrum Relay is a conversion signal, not a decorative background. It appears at most once as a filled action in each active main or inert-isolated overlay. Google, Passport, and repeated LIVE-row actions may reuse it as a restrained 1px outline, but every action within the same repeated collection uses the same outline treatment.
- Photography may be colorful, but no colored surface should be introduced merely to balance an image.

### Interactive

- Default interactive text inherits Near Black or Muted Ink according to hierarchy.
- `:focus-visible` uses a 3px Near Black outline with a 3px offset.
- Fine-pointer hover feedback runs for 160ms with `cubic-bezier(0.2, 0, 0, 1)`.
- The gradient CTA darkens all three stops on hover; outlined Spectrum actions receive a faint Spectrum-tinted White surface while preserving their outline; neutral controls shift toward `oklch(97.5% 0 0)`.

### Neutral Scale

- Canvas and card: `#FFFFFF`.
- Gallery field: `#F6F6F5`.
- Soft interaction surface: `oklch(97.5% 0 0)`.
- Hover surface: `oklch(94% 0 0)`.
- Muted text: `oklch(48% 0 0)`.
- Primary text: `oklch(18% 0 0)`.

### Surface & Overlay

- Main canvas: solid White; no page gradient or ambient color wash.
- Hero readability: two restrained black scrims, vertical and horizontal, fading to transparent before the image midpoint.
- Text on hero photography uses a short `0 1px 3px` dark text shadow.
- Passport asset uses a soft object drop-shadow rather than a surrounding colored panel.

### Theme Modes

#### Light Mode

- Background: Canvas White.
- Surface: Canvas White with a Micro Hairline and short micro-shadow where separation is necessary.
- Text: Near Black plus Muted Ink.
- Accent: Spectrum Relay on the primary hero CTA.
- Notes: this is the only observed and supported appearance mode.

#### Dark Mode

- Not observed and not implemented. Do not infer or auto-generate a dark palette from this document.

### Shadows & Depth

- Card micro-shadow: `0 1px 2px oklch(18% 0 0 / 0.05), 0 4px 12px oklch(18% 0 0 / 0.03)`.
- Hero CTA shadow: `0 5px 8px rgb(58 18 55 / 22%)`.
- Passport image: `drop-shadow(0 8px 14px rgb(23 25 28 / 7%))`.
- Borders provide the primary separation; shadows confirm depth but never create floating islands.

## 3. Typography Rules

### Font Family

- Primary: `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif`.
- Google login control: `"Google Sans", Roboto, Arial, sans-serif`.
- Numeric countdown: `ui-monospace, SFMono-Regular, Menlo, monospace` with tabular figures.
- OpenType features: use `font-variant-numeric: tabular-nums` for changing timer values.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Hero event title | Pretendard Variable | `48px` desktop / `32px` mobile | `850` | `1.02` | `-0.04em` | White overlay title, maximum `15ch` |
| Shared section heading | Pretendard Variable | `24px` from 768px / `20px` mobile | Standard `850`, editorial `800`, personal `700` | Shared role leading | Shared role tracking | Description is optional; preserve the MY page-specific breakpoint and leading |
| Context-card heading | Pretendard Variable | `20px` | `850` | `1.2` | `-0.03em` | “곧 만날 최애”, “최애의 Fan Passport” |
| Item / creator name | Pretendard Variable | `16px` | `700` | Shared item leading | Shared role tracking | Image → name → audience metadata → actions; names may wrap |
| Body copy | Pretendard Variable | `16px` | `400` | Shared body leading | `0` | Preserve readable translated content |
| Metadata | Pretendard Variable | `13px` | Role-specific `400–550` | Shared metadata leading | `0` | Quieter than the item name |
| Live-row title | Pretendard Variable | `16px` | `700` | Shared item leading | Shared role tracking | Allow wrapping without clipping the title |
| Section subtitle | Pretendard Variable | `14px` | `550` | `1.5` | `0` | Muted Ink, sentence-style Korean |
| Primary CTA | Pretendard Variable | `15px` | `800` | Normal | `0` | Compact, direct verb phrase |
| Status label | Pretendard Variable | `12px` | `800` | Normal | `0.04em` | Uppercase only for UPCOMING |
| Passport value line | Pretendard Variable | `14px` | `750` | `1.45` | `0` | Centered and concise |
| Passport supporting line | Pretendard Variable | `13px` | `550` | `1.5` | `0` | Muted Ink |
| Countdown | UI monospace | `14px` | `750` | Normal | `-0.02em` | Stable width; never use proportional numerals |

### Principles

- Use weight contrast before introducing additional size tiers.
- Korean headings are short, assertive noun phrases; subtitles explain value in one sentence.
- Home Hero event titles use `{celebrity name} LIVE` and do not repeat the associated brand name. CMS titles and brand context remain unchanged for LIVE lists and detail screens.
- Do not use the Bricolage wordmark font for UI copy. The custom wordmark remains an image asset.
- Keep hero text high-contrast and left aligned; keep Passport empty-state copy centered.

## 4. Component Stylings

### Buttons and Links

- Primary CTA: at most one visible per active main or inert-isolated overlay; some surfaces need none. Use a 320px maximum width, 48px minimum height, full pill radius, Spectrum Relay fill, White text, Pretendard Variable 15px/800, optically centered label, and optional 18px leading/trailing icons. Labels are short verbs describing the immediate next action. Put necessary preconditions or destination details in helper copy 8px below at 13px/550 and connect it with `aria-describedby`.
- Google login: 90% of card width, 52px minimum height, full pill radius, White fill, 1px Spectrum Relay outline, solid Spectrum Ink label, authentic multicolor G mark, centered label.
- Passport CTA: label `Fan Passport 발급받기`; 90% of card width, 52px minimum height, full pill radius, White fill, 1px Spectrum Relay outline, solid Spectrum Ink label, centered label and right arrow.
- Creator summaries: inset 12px below the media field, then show a wrapping 16px/700 name, quieter 13px audience metadata, and a separate action group. Use a 4–8px gap within related copy and allow actions to wrap without shrinking their 44px targets.
- LIVE state: show a blinking red dot plus `LIVE 진행중` / `LIVE NOW` only for an active LIVE, a static muted dot plus `LIVE 예정` / `UPCOMING LIVE` for a scheduled LIVE, on LIVE surfaces. Home creator cards instead show an outlined heart with `입덕하기` / `Become a fan` in the action group, linking to the existing creator fan-verification detail page (`/c/{slug}`) with the current locale; this is navigation, not a saved-favorite toggle. Disable dot animation for reduced-motion users.
- Celebrity social controls: keep the icon group together in the action area after identity and audience metadata; allow the group to wrap. Use optically centered 20×20px brand marks inside separate 44×44px targets and `0px` gap between adjacent targets. Do not render visible YouTube, TikTok, or Instagram labels. Preserve accessible names in the links.
- Mobile/tablet context actions: below 1024px, keep the existing state-appropriate activity summary and authentication or Passport action in the normal content flow. Reuse the service/passport action roles; do not force duplicate CTAs or invent a destination for unavailable content.
- Section secondary links: minimum 44px interaction height, 13px/550, Muted Ink, unboxed chevron treatment. Other text-action roles retain their shared typography.
- Icon-only controls: use 20×20px visible icons inside 44×44px targets with Lucide-style 1.75–2px strokes. The Header language switch is the deliberate exception: use a 24×24px visible glyph inside the same 44×44px target. Adjacent icon-only controls use `0px` group gap while each target remains distinct and non-overlapping. Do not apply this compact rule to controls with visible text.
- Repeated LIVE-row actions: use the highlighted Secondary treatment rather than Primary or Neutral. Apply the same White fill, 1px Spectrum Relay outline, and Spectrum Ink label/icons to every action in the collection regardless of reservation or replay state. At desktop use a 184×48px outlined pill with a 14px/750 centered label and balanced 18px leading/trailing icons; below 768px reduce the same action to a separate 44×44px icon target.
- LIVE detail action rail: treat its title as a Page heading, not a Hero overlay title. Use 24px/800 on desktop and 20px/800 on mobile, 14px/550 schedule labels, 14px/750 schedule values, 24px between information groups, and 8px between the Primary and its 13px/550 helper.
- Avoid parallel primary actions. The hero ends at “라이브 예약하기”; detailed information belongs downstream.

### Cards and Containers

- Collection card: White, 16px radius, 24px desktop padding / 20px mobile padding, Micro Hairline, card micro-shadow.
- Utility card and live row: White, 12px radius, Micro Hairline, card micro-shadow.
- Hero: 20px radius, no border or card shadow; depth comes from the photograph and internal scrim.
- Desktop context cards stack with a 16px gap and remain visually quieter than the hero.
- Nested colored cards are prohibited. Inner separation should use a media field, spacing, or a hairline.

### Inputs and Interactive Controls

- No form input was observed on this page.
- Controls use an explicit 3px Near Black focus outline with 3px outer offset. The shared ContentActions/PostCard More menu items use a 3px inset outline (`-3px` offset) to stay inside the compact popup; report-dialog fields and actions keep the default outer offset. Portal content owns its product font and focus styling independently of the page frame.
- Touch targets remain at least 44px even when the visible icon or label is smaller.

### Navigation

- Header: sticky White shell using the current shared header geometry, with 88px desktop height from 1024px. Preserve the compact mobile header and avoid duplicating historical extraction heights in new CSS.
- Wordmark: 80px rendered image inside an 88×44px link target.
- Desktop navigation from 1024px: White pill, 44px height, subtle border, active item in Near Black/800 and inactive items in Muted Ink/600.
- Desktop optical correction: navigation is translated upward by 1px to align Pretendard with the wordmark.
- Below 1024px, hide the desktop pill and retain brand plus header actions.
- Below 1024px, show a fixed 64px four-column bottom navigation with a thin top line and a 2px active indicator.
- Desktop and mobile use the same four product destinations: `HOME`, `커뮤니티`, `최애`, `MY`. Do not replace them with section anchors or separate mobile-only labels.
- `/passports`, `/stamps`, `/benefits`, `/notifications`, and `/settings` are MY sub-routes and render MY as the current top-level destination.

### Image Treatment

- Hero uses full-bleed high-resolution KARA photography with `object-fit: cover` and a slightly right-shifted focal position.
- Home favorite cards use a nested gallery composition: a square `#F6F6F5` field contains the shared `min(84%, 240px)` square portrait. The `/celebrities` directory fills its entire media area, 5:4 below 768px and square from 768px. Both use the shared per-creator cover crop; do not use contain letterboxing.
- Favorite portraits are direct, colorful, face-legible editorial crops: blue KARA group styling, warm gold Elina close-up, cool dark Changha close-up.
- Upcoming LIVE avatars reuse the corresponding artist imagery in circular 64px desktop / 56px mobile crops.
- Passport uses a transparent, fully opened identity-and-stamp-book asset with `object-fit: contain`; it is never shown as a closed burgundy cover.

### Distinctive Components

- Status Rail: UPCOMING outline pill plus date on one horizontal rail; the countdown sits below in monospace. Scheduled LIVE events use `D-{days} HH:MM:SS`, omitting the day prefix when less than 24 hours remain, and update once per second. Active events and countdowns that reach zero show `LIVE NOW`.
- Favorite Gallery Collection: one rounded outer collection with image-led items; each item reads portrait → emphasized name → fan count → fan-detail and social actions. Keep real YouTube, TikTok, and Instagram marks in full-size targets.
- Logged-out Live Card: heading and subtitle at the top, centered calendar-heart line icon, centered explanatory copy, Google login CTA at the bottom.
- Fan Passport Card: title/subtitle, opened Passport asset, lifecycle value copy, and login CTA in one quiet vertical composition.
- Upcoming LIVE Row: circular avatar, identity/title/date block, right-aligned reservation metadata on tablet/desktop, and a 44px chevron action.

## 5. Layout Principles

### Spacing System

- Base unit: `4px`.
- Repeated spacing values: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64px`.
- Adjacent icon-only action groups are the deliberate exception to the positive spacing scale: use `0px` between separate 44×44px targets and center a 20×20px icon in each target.
- Major content sections use the shared 32px mobile / 48px wider-screen gap.
- Shared section headers use a 16px bottom gap. The optional secondary link wraps below when a 20rem title column and the action do not fit.
- Dense components use 12–24px internal gaps; avoid arbitrary intermediate spacing.

### Grid & Container

- Maximum product width: `1440px`.
- HOME, LIVE list, LIVE calendar, creator directory and MY share that outer width, including horizontal gutters of `16px` below 768px, `32px` from 768px, and `40px` from 1280px. Page headings and first content edges align with the header and footer; do not add narrower nested page containers. Control density with rows and columns inside this shared shell.
- Reading and focused task widths remain separate: settings fields 720px; certification and quiz 760px (quiz result 690px); login 440px or gateway 960px; onboarding 1120px; legal reading 760px; LIVE mission 880px and survey 800px; Passport issuance presentation 1320px. Dialog widths are independent of page width.
- At 1440px with the always-visible side panel: 40px page insets, `944px` main column, 32px gutter, `384px` context panel.
- At 1024–1279px: main column plus 360px context panel with a 24px gap.
- At 768px: 32px page insets and a single 704px content column.
- At 390px: 16px page insets and a 358px content column.
- Desktop hero ratio: `16:8`; mobile hero ratio: `4:5`.

### Whitespace Philosophy

- Whitespace is the primary neutralizing force against colorful artist imagery.
- Major sections use the 32px/48px rhythm; judge the whole-page density with real content and do not fill gaps with decorative copy or badges.
- Left alignment governs discovery and live information. Center alignment is reserved for empty states and authentication prompts.
- The right context panel stays sticky and task-focused rather than becoming a second scrolling content feed.

### Border Radius Scale

- Micro: `10px` for compact social buttons.
- Standard control: `12px`.
- Collection card: `16px`.
- Hero: `20px`.
- Authentication CTA: `14px`.
- Pill: `999rem` for navigation capsule, status, and primary CTA.

## 6. Depth & Elevation

| Level | Treatment | Use |
| --- | --- | --- |
| Flat | White or Gallery Gray, no shadow | Header, page canvas, artist media field |
| Ring | 1px Hairline or Micro Hairline | Navigation, social controls, CTA outlines |
| Card | Micro Hairline plus two-layer micro-shadow | Favorite collection, context cards, live rows |
| Hero | Full-bleed image plus internal black scrim | Primary live feature only |
| Focus | 3px Near Black outline with 3px offset | Keyboard focus on every link and button |

### Depth Principles

- Use borders before shadows and micro-shadows before floating elevation.
- The hero is visually dominant without an external shadow.
- Image objects may use a soft drop-shadow, but their containing surface remains White.
- Footer: keep navigation links at 13px/550 inside full 44px targets. Use 48px top and 16px bottom padding on desktop, 40px top and 16px bottom padding on mobile, and create hierarchy with grouped whitespace rather than taller link rows.
- Keep the three service groups separate from a full-width horizontal social row. On mobile, the service navigation uses two group columns and the longer guide group spans both columns with its links in two columns; from 768px, use three compact service columns.
- Social marks render at 20×20px, centered inside separate 44×44px targets. Business and policy metadata stays at 13px and wraps naturally instead of shrinking.
- The footer remains normal-flow content and owns no viewport height, bottom-navigation clearance, or safe-area padding. `FanAppFrame`, `FocusFlowFrame`, standalone login, and standalone page layouts own the clearance required by their navigation and viewport context.
- No glassmorphism, backdrop blur, ambient colored glow, or broad decorative shadow was observed.

## 7. Do's and Don'ts

### Do

- Let one strong artist image lead each viewport.
- Keep utility surfaces white and separate them with hairlines and micro-shadows.
- Use the filled Spectrum Relay only for the active surface's single primary next action. A page may have no filled Primary. Repeated LIVE-row actions use the approved Spectrum-outline Secondary treatment consistently; other repeated card actions and secondary exploration stay Neutral or Text.
- Keep title and explanatory subtitle together as a reusable section-heading pair.
- Preserve 44px minimum interaction targets and visible keyboard focus.
- Use real social brand marks and face-legible, high-quality artist photography.
- Present Passport as an opened record system with empty stamp capacity.

### Don't

- Do not add colored card backgrounds to “balance” the hero.
- Do not place multiple gradients, dark feature cards, or competing primary CTAs on the same screen.
- Do not use a closed leather Passport, pocket graphic, or heavy burgundy surface in this system.
- Preserve the inset portrait composition on Home. Only the creator directory uses the approved full-bleed portrait variant; banner, Passport and circular-avatar treatments are separate.
- Do not introduce nested cards, oversized shadows, glass panels, or ornamental divider lines.
- Do not hide secondary information behind tiny hit areas or use icons below 44px without a larger target.
- Do not fabricate dark mode rules from the light-only implementation.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
| --- | --- | --- |
| Mobile | `< 768px` | 16px page inset, 20px headings, 4:5 hero, horizontal 288px favorite cards, 56px live avatars, desktop nav hidden |
| Tablet | `768–1023px` | 32px page inset, 24px headings, 2:1 hero, three visible favorite cards in the horizontal snap rail, 64px live avatars, compact header and bottom navigation |
| Desktop | `1024–1279px` | Desktop header navigation appears; side context panel is visible and sticky; bottom navigation disappears; no panel toggle |
| Wide desktop | `≥ 1280px` | 40px page inset, 384px context panel, 32px column gap; social controls remain icon-only |

### Touch Targets

- Standalone links and buttons maintain at least 44×44px interaction areas; inline prose links keep readable native line flow. Never shrink icon targets to fit a translation.
- Adjacent icon-only actions maintain independent 44×44px hit areas with `0px` visual gap; hit areas must meet edge-to-edge but never overlap.
- The visible icon remains 20×20px. Text-bearing actions, navigation labels, and isolated icon controls keep their component-specific spacing.
- Bottom navigation divides the viewport into four equal-width targets with 64px minimum height.
- Horizontal favorite cards use scroll snap and hide the scrollbar without disabling native touch scrolling.

### Responsive Layout Strategy

- Desktop behavior: two-column shell with a 944px content column and sticky 384px context panel at 1440px.
- Tablet behavior: single content column, compact header and bottom navigation; the side context and desktop header navigation are hidden below 1024px.
- Mobile behavior: compact header, no desktop nav or side panel, horizontal favorite rail, fixed bottom navigation.
- Desktop context: keep the right activity panel visible without a header toggle or collapse state. The main column retains its two-column width; mobile activity summaries remain in the content flow.
- Live metadata: reservation count is hidden on mobile, leaving avatar, content, and action columns.
- Reduced motion: all transitions are reduced to `0.01ms`, and smooth scrolling is disabled.

## 9. Agent Prompt Guide

### Quick Color Reference

- Primary CTA: Spectrum Relay gradient.
- Background: `#FFFFFF`.
- Heading text: `oklch(18% 0 0)`.
- Body text: `oklch(48% 0 0)`.
- Border or ring: `oklch(90–93% 0 0)`.
- Media field: `#F6F6F5`.
- Status accent: `rgb(255 95 191 / 78%)`.

### Quick Summary

Build a white, image-first K-pop fan product with Pretendard typography, a dominant full-color editorial hero, and at most one pink-to-violet filled gradient CTA per active surface. Repeated LIVE-row actions may reuse that relay as a consistent 1px outline; keep all other utility surfaces neutral with 1px hairlines, 12/16/20px radii, and short two-layer micro-shadows. Use the shared 32px/48px section spacing and compact heading/optional-description groups with quiet secondary navigation. On wide screens, split the page into a large content column and a narrow sticky logged-out context panel. Below 1024px remove that panel and use fixed bottom navigation; below 768px use the existing horizontal snap collection where appropriate.

### Example Component Prompts

- Hero: “Create a 2:1 desktop live hero with full-bleed high-resolution artist photography, a restrained left-and-bottom black scrim, a clearly defined outlined UPCOMING rail, 48px white event title, monospace countdown, and one 320×48px spectrum-gradient reservation pill.”
- Card: “Create a White favorite collection with a 16px outer radius, 24px padding, micro hairline and short two-layer shadow. Place three square Gallery Gray media fields inside; use the shared min(84%, 240px) inset portrait, then a wrapping 16px/700 name, 13px fan count and a separate action group with three 44px social controls and 20px brand marks.”
- Navigation: “Reuse the shared sticky White header with an 80px ByUs wordmark, a 44px hairline pill navigation optically shifted upward by 1px, and 44px language/menu controls. Use a 24px visible language glyph inside its 44px target. Hide the pill below 1024px.”
- Passport: “Create a quiet White Passport utility card with a 20px/850 title, 14px subtitle, fully opened identity-and-stamp asset, centered two-line lifecycle copy, and a 90%-width 52px outlined login CTA.”
- Live row: “Create a 112px White live row with a 64px circular artist avatar, wrapping 16px/700 title and 13px metadata stack, plus a right-aligned 184×48px Spectrum-outline Secondary booking pill. Apply the same outline treatment to every action in the collection. Below 768px use a 44px icon-only action without turning repeated rows into filled Primary buttons.”

### Ready-to-Use Prompt

Using the ByUs Fan Pulse Spectrum design system, turn the supplied product scenario into a responsive fan-platform screen. Preserve the White/Near Black shell, Pretendard hierarchy, 4px spacing scale, 12/16/20px radius ladder, hairline-plus-micro-shadow surfaces, face-legible editorial imagery, and at most one filled Spectrum Relay primary CTA per active surface. Repeated LIVE-row actions may use the same relay as a consistent 1px outline. Use a wide content column plus sticky context panel at desktop, a single column with fixed bottom navigation below 1024px, and the existing horizontal snap collection below 768px where appropriate. Do not introduce dark cards, extra filled or decorative gradients, glassmorphism, nested cards, or decorative color surfaces.

### Iteration Guide

1. Establish the screen’s main task and visual focus before adding secondary modules; a utility screen does not need a hero or filled CTA.
2. Translate scenario information into title/subtitle pairs, compact rows, or one neutral utility card.
3. Check that colored surfaces do not compete with artist photography.
4. Verify 44px targets, 3px focus outlines, and mobile in-flow activity access.
5. Confirm that new components reuse shared roles and tokens, then apply the separate visual finish criteria below. Token compliance alone is insufficient.

## Optional Appendix: Interaction Patterns

- Scroll behavior: header remains sticky; context panel is sticky from 1024px; mobile/tablet use a fixed bottom navigation.
- Hover behavior: neutral controls receive a subtle gray fill; artist media fields rise by 2px and strengthen their border; Passport artwork rises by 6px; the primary gradient darkens.
- Click behavior: login and reservation actions route downstream. The desktop activity panel is always visible and has no fold/unfold control.
- Animation tone: restrained and product-like, 160ms for control feedback and 240ms for layout/object transitions.
- Reduced motion: transitions collapse to effectively instant and smooth scrolling is removed.

## Optional Appendix: Content & Messaging Patterns

- Headline pattern: short identity or value phrase, often mixing Korean with a familiar English product noun, e.g. “최애의 Fan Passport”.
- Subtitle pattern: one direct benefit sentence ending in `-보세요` or `-하세요`.
- CTA language: explicit task plus outcome, e.g. “라이브 예약하기”, “Google로 계속하기”, “Fan Passport 발급받기”.
- Lifecycle copy: enumerate meaningful fan actions before promising the stored value, e.g. “팬 인증부터 라이브 예약, 출석, 후기까지”.
- Voice and tone: warm and encouraging, but never cute, overly promotional, or verbose.

## Optional Appendix: Historical Observed Pages (2026-07-20)

- `http://127.0.0.1:5173/candidates/03-fan-pulse-spectrum`: desktop 1440×1100, tablet 768×1024, and mobile 390×844 rendered states; logged-out context panel open and collapsed; hover-capable controls.

## Optional Appendix: Historical Evidence Notes (2026-07-20; not current rules)

- Observed: the live rendered page exposes no root variables on `:root`; reusable tokens are scoped to `[data-fan-pulse-home]` and were read from the loaded stylesheet.
- Observed: at 1440px the hero is 944×472px, the favorite collection is 944px wide, and the open context panel is 384px wide.
- Observed: the favorite media field is about 287px square with about 48px padding, yielding an artwork ratio near 66.5%.
- Observed: the browser reported no runtime page errors during extraction; console output contained only Vite and React development messages.
- Inferred rule: color is intentionally budgeted—photography plus one primary gradient—because neutral utility surfaces preserve visual rest beside the hero.
- Inferred rule: the side panel is contextual rather than foundational because it is removed entirely below 1024px without replacing the main content flow.

## Shared fan UI implementation (updated 2026-10-04)

The current consolidation covers Home section headers, LIVE catalog headers,
LIVE calendar page title, MY page/section headings, and shared FanAction controls.
The migrated roles follow the current shared content contract; this does not
claim that all screens or all local CSS have been migrated.

- `apps/web/app/globals.css` owns semantic `--fan-*` typography and action tokens,
  alongside existing color, spacing, radius, focus, and motion tokens.
- `FanHeading` separates semantic `as` (`h1` / `h2` / `h3`) from visual `variant`.
  Standard headings are 20px / 24px at 48rem, weight 850. Editorial headings retain
  weight 800. MY page headings retain their 40rem breakpoint and inherited leading;
  personal section headings use 20px / 24px at 48rem, weight 700.
- `FanSectionHeader` owns title, optional description, optional `{ label, href }`
  action and their spacing. Its heading row wraps the flexible 10rem title and
  14px secondary action together, with supporting copy below and a 16px bottom gap. Standard/editorial retain their shared
  minimum header height; personal headers have no minimum height.
- Do not add local heading selectors or arbitrary style/className overrides to
  these migrated roles. Add an intentional, reusable variant in the shared module
  only when the existing roles cannot express the product requirement.
- `FanAction` continues to own primary, neutral, text, service and passport
  behavior. Its central dimensions remain 44px base, 48px primary, 52px service /
  passport, and 18px icons. Existing service-specific typography is preserved.
- Home hero typography, Passport artwork, profile identity, calendar controls and
  non-migrated screens remain intentional separate owners, not silently normalized.
- `fan-design-system.contract.test.ts` guards token resolution and migrated CSS
  ownership; component tests guard heading semantics, optional content and links.
  Run these checks plus the affected screen tests when changing shared properties.
  Desktop/mobile rendering verification remains necessary; source checks alone do
  not certify visual parity with production.

- `LiveStatusIndicator` owns `density="comfortable" | "compact"`. Catalog rows
  select compact density rather than overriding the shared badge's min-height in
  a screen stylesheet; this keeps dev and production CSS ordering equivalent.
- The `Fan design system` GitHub workflow runs the shared-role and migrated-screen
  tests on relevant pull requests and main pushes without production credentials.
  Repository branch-protection settings are separate; this workflow does not itself
  make the check mandatory for merges.


### Calendar phase one ownership

- `components/fan-calendar/calendar-parts.tsx` owns month controls, KST labels,
  and the numeral-only today ring for full and embedded calendars. Callers keep
  their existing links or local month state; these primitives do not own fetching.
- `globals.css` owns `--fan-calendar-*` type roles. Metadata stays at 12px and
  event titles at 14px; desktop density must not introduce 9px overrides.
- The full calendar retains its mobile agenda, tablet two-column layout and
  desktop seven-column month grid, multi-celebrity filters and inline +N expansion.
  Titles use two lines; the full accessible detail-link title remains intact.
- Celebrity calendar placement: outside the hero, after the upcoming LIVE section
  in DOM/mobile order. At 1024px+, the same single instance occupies the 360px
  right content rail above Passport. No duplicate hidden calendar or hero overlay.
  The September 6 feedback extends this single-calendar placement to notice,
  LIVE, and benefit tabs, including empty notice states. Tab navigation targets
  the content below the hero and retains keyboard focus with a sticky-header offset.
  Full-calendar event chips use soft pastel surfaces inspired by TimeTree/Amie;
  the compact month and nearby schedule list follow the approved Fantastical reference.
- The mini calendar preserves direct first-LIVE links and month/locale/celebrity
  context in “open calendar.” Today is a numeral ring, not a reservation border.
  Single-event reserved/unreserved/unknown states have distinct non-color markers
  and a complete legend. Multiple-event dates show a neutral count rather than
  borrowing the first LIVE's reservation state. Full multi-event selection is
  deferred, not claimed complete by this visual pass.
- No date-selection panel, month/list toggle, new reservation flow or API change
  is part of phase one. Validate 360/390/768/1024/1440px before promoting changes.

## Utility surfaces and truthful copy (2026-09-05)

The UI/copy guide is implemented as an opt-in extension, not a replacement of
Fan Pulse Spectrum. `fan-ui/fan-surface` owns neutral utility canvases and static
section cards; `--color-utility-canvas` and `--color-surface-focus` are shared
roles. HOME, artist heroes and Passport artwork retain their existing treatment.
Do not introduce a parallel hard-coded blue palette from the guide's example hexes.

- Creator directory: maximum three equal-width columns, left-aligned partial row,
  two columns at 768px and one below. The later shared portrait contract applies:
  full-bleed cover, 5:4 below 768px and square from 768px, preserving registered
  framing and every face rather than reverting to the historical 4:3 contain layout.
  Use published summaries only, no invented biographies or popular/recommended claims.
  Default order remains the published order. Search, ordering and ownership filters stay.
- MY (updated 2026-09-10, slide 58): profile then a shared favorite selector,
  with attained fan tier/progress and that creator’s raffle ticket balance as the
  two primary panels. Reserved LIVE and recent activity follow; totals appear
  once as a quiet summary. Within LIVE, active precedes scheduled, then start time,
  with other reservations in a disclosure. First-reaction-only
  relationships remain distinct from owned Passports. Tier targets use FAN_TIERS;
  remaining points come from the existing summary, not a new score calculation.
- Passport collection cards stay at most 380px even for one record. Technical
  issuance details remain on detail; successful issuance is not a list warning.
- Korean labels use 패스포트, 팬 점수, 스탬프, 티켓 and 디지털 기념품 without merging
  their underlying concepts. Authentication, failed reads and empty states differ.
- Mission pages preserve a locale-aware LIVE return link, use the public LIVE title
  when available, and distinguish loading/errors from an empty eligible list.
  An empty eligible list does not prove the LIVE has no configured missions.

Deferred pending evidence: creator biography editing, Fans metric provenance,
contractual official/appearance claims, benefit claimability aggregation, detailed
activity-type enrichment, and cross-site notification/benefit copy changes.
These must not be inferred from the visual guide or added as fabricated data.

Verification boundary: responsive public directory checks live in
`e2e/public/ui-guide.spec.ts`; owned MY/Passport visual checks require a test
account or isolated auth/API fixtures. Passing fixtures is not proof of a live
production account or of benefit eligibility logic.


## Fan hub density refinement (2026-09-05)

- Utility pages reuse the white `--color-canvas` via `--color-utility-canvas`;
  gray remains a media or hover field, not an alternate whole-page theme.
- Directory cards have one semantic link covering image, introduction, status,
  and action. Korean actions use the creator name plus `만나보기`. Introductions
  use the first complete published sentence; no line-clamp or invented biography.
- MY uses two restrained bordered panels for selected-creator fan tier and raffle
  tickets (updated 2026-09-10, slide 58). Supporting LIVE and recent activity use
  open sections below these panels. The same creator selection controls tier,
  tickets, current mission and existing benefit progress; it does not save a
  representative badge. Recent activity shares the desktop supporting row.
  Without supporting content, primary sections share available width instead of
  leaving a left-aligned 800px island. Mobile remains a linear task sequence.
- MY LIVE uses truthful KST date tiles, not an inferred creator/event photo; its
  DTO has no image association. Creator images belong only to owned creator rows.
- Creator home leads with next LIVE plus creator-context portrait. News and
  benefits retain their dedicated tabs, loading/error states, and compact home
  empty states. Independent desktop columns prevent the calendar height from
  stretching content rows. The calendar remains below the hero in the home tab.
- These refinements do not modify published content, personal history, or access
  rules. Verification of local rendering is not production deployment proof.

MY notification preferences live beside unread notifications in the profile header,
with visible labels and 44px targets. Mobile wraps the same utility group below
the identity; no separate full-width settings row appears below activity records.

### Growing creator roster
The editorial first three are centrally configured in `apps/web/server/content/creator-discovery.ts` (Changha, Elina, Yuna). Priority is conveyed only by order: all creators share the same card size, image treatment and information rules on each discovery surface. No secondary group heading, divider, compact tier on home cards. Display the existing CMS fan count below each name using the shared compact Fans format. Additional creators use individual-platform audience stored in CMS as an approximate order signal; do not sum platforms. Explicit directory sorts/search remain neutral. For group photos, crop around the complete member group with every face visible; do not fit the entire venue into the card. Personal MY records are unchanged.

Home favorites preserve the existing portrait-card size and image/social treatment in a single horizontal snap rail at every breakpoint. Desktop shows three equal cards (Changha/Elina/Yuna first); mobile keeps the existing card width. Use banner-style circular arrows at the left/right media edges for viewport-sized movement, disabled at boundaries, synchronized with native touch/trackpad scrolling and resize, with reduced-motion support. Do not show the bottom page count or pagination capsule. Portraits use a 240 × 240 CSS-pixel square (shrinking only when needed inside narrower cards), object-fit cover with creator focal points; Xin uses a 1.6× bottom-centered crop within the same square, retaining all five members while reducing venue and crowd space. Directory remains a normal grid. Generated list/gallery concepts were not selected.

Creator portrait selection and crop requirements: [프로필 사진 규약](docs/design/creator-profile-photo-guidelines.md). Visible tattoos are excluded from final profile crops; use another source if a complete face-preserving crop cannot remove them.

### September 6 remaining feedback

Passport collection photos use a more compact desktop crop. Fan Score and Stamp
numbers link to the existing Passport activity ledger and Stamp Book with stable
fragment targets. The Passport artwork carries its real STAR, issue date and
short Fan ID; the creator portrait links to the creator fan page. MY totals link
to their existing collections or in-page sections, and an unavailable collection
must not receive a fabricated destination. Completion rewards use aligned plain
text for earned score, total and level, without a duplicate floating score badge.

Fan-facing unspent creator balances use 응모권 / Raffle tickets. Applied amounts
use 응모 수 / Entries. Admission tickets and internal accounting identifiers retain
their existing meaning. Balances remain creator-specific.

Utility calendar, ticket, gift and radio icons use direct AnimateIcons Lucide
imports. Hover and keyboard focus trigger one bounded cycle. Active radio may
repeat a short cycle every seven seconds only while visible on a fine-pointer
device. Reduced motion, hidden documents and offscreen icons remain static;
all timers and observers are removed on unmount. Home hero shimmer is unchanged.

LIVE mission entry uses a public visibility boolean, independent of owner
completion or attendance. The read mirrors published, non-legacy, localized
missions in the half-open visibility window. False disables entry with the inline
reason 현재 참여 가능한 미션이 없어요. / No missions are available right now.
Unknown read results retain a link to check the authenticated list and never
claim there are no missions. No question or owner payload is exposed publicly.

### Creator directory portrait contract

`/celebrities` and Home favorites share `CreatorPortrait` and registered crops.
Directory keeps its responsive grid and existing full-card links, using the
`full-bleed` variant to fill a 5:4 media area below 768px and a square from 768px,
without a gray frame. Home keeps the default `min(84%, 240px)` square inset portrait. Shared per-creator
cover crops preserve faces, all group
members and tattoo exclusion. Do not use contain letterboxing, route-local crop
copies or hover zoom on these portraits. Passport badges remain outside the crop.
Banner and circular-avatar treatments remain separate. See the directory section
of [프로필 사진 규약](docs/design/creator-profile-photo-guidelines.md) for replacement
and desktop/mobile verification requirements.

### 원형 크리에이터 프로필
- 팬 화면의 원형 사진은 `CreatorAvatar` 공용 컴포넌트 사용. 시각 옵션은 `size`만 허용하며 원형 마스크·개인/그룹 크롭·실패 시 실루엣은 공용으로 관리한다.
- 등록·교체·24px/64px 검수는 `docs/design/creator-profile-photo-guidelines.md`의 원형 프로필 공용 구현 규약을 따른다. 호출부에서 내부 이미지 CSS를 덮어쓰지 않는다.

### 모바일 LIVE 캘린더 — 2026-09-06 후속 피드백

앞선 calendar phase-one의 목록 전용 모바일 범위를 확장한다. 1024px 미만에서는
기존 월 이동 헤더 아래 7열 날짜 선택 달력을 제공하고, 선택된 셀럽의 일정이 있는
날짜에 점을 표시한다. 점은 예약 여부가 아니라 LIVE 존재를 뜻하며 실제 예약 상태는
아래 상세 일정에 유지한다. 날짜 선택은 아래 목록을 좁히고 전체 보기로 되돌릴 수 있다.
셀럽 필터 변경 시 날짜 선택을 해제하며 월 이동 링크는 셀럽/언어를 보존한다.
PC의 기존 월간 상세 달력에는 모바일 날짜 선택이 적용되지 않는다.

2026-09-10 후속 승인: 홈 상단의 팬 활동 버튼과 패널 접기·펼치기를 제거한다.
PC 오른쪽 활동 요약은 항상 표시하고 모바일 본문 활동 요약과 MY 경로는 유지한다.
모바일 달력은
사용자가 날짜를 선택하면 선택 날짜·LIVE 건수를 알리고 해당 결과 제목이 보이도록
이동한다. 화면 크기 변경만으로 포커스를 옮기지 않으며 reduced motion을 존중한다.
PC 날짜 셀의 다건 전환과 전체 보기 dialog는 유지한다.

사용자 승인으로 Weverse 공식 공지 27504와 Blip App Store 캘린더 이미지를
모바일 시각 레퍼런스로 채택했다. 필터는 박스 대신 가로 한 줄의 아바타 칩으로,
달력은 32px 선택 날짜 원과 단색 LIVE 점으로 정리한다. 오늘은 테두리 원,
선택 날짜는 서비스 색 채움으로 구분한다. 아래 일정은 부드러운 회색 영역 위
흰 카드로 배치하고 시간 13px / 제목 16px / 셀럽 13px의 위계를 유지한다.
여러 색 점의 의미를 새로 만들지 않으며 기존 예약·방송 상태는 카드에 유지한다.
공식 출처와 원본 이미지는 artifacts/feedback-2026-09-06/calendar/benchmark에 보관한다.

### Shared creator photography — 2026-09-10

All creator identity-photo consumers use `CreatorImage` with source and framing registered in `creator-image-config.ts`. `CreatorPortrait` and `CreatorAvatar` keep their existing square/circle masks and sizing APIs. MY, LIVE detail/calendar, Passport photos and calendar collage use the same renderer; fanpage banners use `CreatorHeroPicture` and the same registry with separate responsive composition. Source replacement and crop stay coupled. A later CMS upload must be honored without inheriting a previous photo's zoom. Keep event artwork, benefits and user avatars separate. Park Myungho uses the approved user-provided suit portrait, about50% crown-to-chin height in square/circular photos; preserve shape-specific framing in wide/vertical surfaces.
