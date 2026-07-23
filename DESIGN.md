---
id: '03'
slug: '03-fan-pulse-spectrum'
name: 'Fan Pulse Spectrum'
family: 'core'
palette: 'single-gradient-highlight'
font: 'pretendard'
source: "live rendered page"
observed-at: "2026-07-20"
theme: "light-only"
ui-font: "Pretendard Variable"
base-spacing: "4px"
radius-scale: "12px / 16px / 20px / pill"
---

# Design System: ByUs Fan Pulse Spectrum

## Intent

The system is an image-first fan utility: editorial artist imagery creates emotion, while quiet product surfaces make reservation, login, discovery, and Passport tasks immediately understandable. The live rendered page is the source of truth for the detailed rules below.

## Color

Use a White and Near Black shell with a `single-gradient-highlight` strategy. Reserve the filled pink-to-violet Spectrum Relay for the primary live-reservation CTA. The Google and Passport context actions may reuse the relay only as a 1px outline with a high-contrast solid service-color label; neutral utility surfaces must not compete with artist photography.

## Typography

Use Pretendard Variable throughout product UI. Apply the exact hierarchy, weight, line-height, and tracking rules documented below; countdown numerals use a monospace stack with tabular figures.

## Image

Use face-legible, editorial, full-color artist photography. Preserve the approved hero crop, center square favorite artwork at roughly 66.5% within a Gallery Gray field, and use only the fully opened identity-and-stamp Passport asset.

## Surfaces

Use 12px controls, 16px collections, and a 20px hero with 1px neutral hairlines and short two-layer micro-shadows. Avoid dark utility cards, glassmorphism, nested cards, and decorative color surfaces.

## Interaction

Maintain 44px minimum targets, a 3px Near Black `focus-visible` outline, 160ms control feedback, and 240ms object or layout transitions. Adjacent icon-only actions use 20×20px visible icons inside separate 44×44px targets with no inter-target gap; never overlap or shrink the targets to achieve visual density. Collapse transitions for reduced-motion users.

## Locked Contract

Preserve the current rendered information architecture, Korean copy, artist identities, live data, Google login treatment, opened Passport lifecycle copy, and responsive panel/navigation behavior. The hero remains the sole dominant visual surface and the reservation CTA remains the only gradient-filled action.

## 1. Visual Theme & Atmosphere

Fan Pulse Spectrum is a bright, image-first fan utility interface. A full-color KARA hero supplies nearly all of the page's visual intensity; the surrounding product UI stays white, neutral, and deliberately quiet. The composition pairs editorial entertainment imagery with disciplined product surfaces: generous whitespace, black display type, hairline borders, short micro-shadows, and one pink-to-violet conversion accent. The result should feel like a polished global fan platform rather than a promotional microsite or a dense dashboard.

The page uses asymmetry only at desktop scale. The main content owns the visual narrative while a narrower sticky context panel handles logged-out actions. Below 1024px, that panel disappears and the experience becomes a single-column feed with a fixed four-item bottom navigation. Color is concentrated in photography and the primary reservation action; utility cards do not compete with the hero.

### Key Characteristics

- Image-first editorial hierarchy with one dominant 2:1 desktop hero.
- White canvas, near-black text, soft neutral surfaces, and almost invisible borders.
- One controlled pink-to-violet gradient reserved for the primary conversion CTA.
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
| Primary action | Spectrum Relay | `linear-gradient(125deg, oklch(68% 0.22 18), oklch(62% 0.25 340), oklch(56% 0.22 285))` | Only the hero's “라이브 예약하기” CTA |
| Action text | On Action White | `#FFFFFF` | Text and icons on the gradient CTA |
| Status accent | Live Pink Line | `rgb(255 95 191 / 78%)` | UPCOMING status outline only |
| Service outline | Spectrum Relay | Same gradient as Primary action | 1px border on Google and Passport context actions only |
| Service action text | Spectrum Ink | `oklch(45% 0.22 315)` | Solid accessible label and arrow on outlined service actions |

### Primary

- The interface is monochrome-first. White and Near Black define the product shell.
- The Spectrum Relay is a conversion signal, not a decorative background. It appears once as a filled action; the two approved context actions may reuse it as a restrained 1px outline.
- Photography may be colorful, but no colored surface should be introduced merely to balance an image.

### Interactive

- Default interactive text inherits Near Black or Muted Ink according to hierarchy.
- `:focus-visible` uses a 3px Near Black outline with a 3px offset.
- Fine-pointer hover feedback runs for 160ms with `cubic-bezier(0.2, 0, 0, 1)`.
- The gradient CTA darkens all three stops on hover; neutral controls shift toward `oklch(97.5% 0 0)`.

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
| Page and section heading | Pretendard Variable | `24px` from 768px / `20px` mobile | `800` | `1.2` | `-0.03em` | Always paired with a restrained subtitle |
| Context-card heading | Pretendard Variable | `20px` | `850` | `1.2` | `-0.03em` | “곧 만날 최애”, “최애의 Fan Passport” |
| Artist name | Pretendard Variable | `18px` | `850` | `1.3` | `-0.025em` | Immediately below the image field |
| Live-row title | Pretendard Variable | `15px` | `750` | Normal | `-0.02em` | Single-line truncation |
| Section subtitle | Pretendard Variable | `14px` | `550` | `1.5` | `0` | Muted Ink, sentence-style Korean |
| Primary CTA | Pretendard Variable | `15px` | `800` | Normal | `0` | Compact, direct verb phrase |
| Status label | Pretendard Variable | `12px` | `800` | Normal | `0.04em` | Uppercase only for UPCOMING |
| Passport value line | Pretendard Variable | `14px` | `750` | `1.45` | `0` | Centered and concise |
| Passport supporting line | Pretendard Variable | `13px` | `550` | `1.5` | `0` | Muted Ink |
| Countdown | UI monospace | `14px` | `750` | Normal | `-0.02em` | Stable width; never use proportional numerals |

### Principles

- Use weight contrast before introducing additional size tiers.
- Korean headings are short, assertive noun phrases; subtitles explain value in one sentence.
- Do not use the Bricolage wordmark font for UI copy. The custom wordmark remains an image asset.
- Keep hero text high-contrast and left aligned; keep Passport empty-state copy centered.

## 4. Component Stylings

### Buttons and Links

- Primary CTA: 320px maximum width, 52px minimum height, full pill radius, Spectrum Relay fill, white text, play icon left and arrow right.
- Google login: 90% of card width, 52px minimum height, full pill radius, White fill, 1px Spectrum Relay outline, solid Spectrum Ink label, authentic multicolor G mark, centered label.
- Passport CTA: label `Fan Passport 발급받기`; 90% of card width, 52px minimum height, full pill radius, White fill, 1px Spectrum Relay outline, solid Spectrum Ink label, centered label and right arrow.
- Celebrity social controls: place the artist name and three icon-only 44×44px links on one row; align the icon group to the far right. Use 20×20px brand marks and `0px` gap between the adjacent 44×44px targets. Do not render visible YouTube, TikTok, or Instagram labels. Preserve accessible names in the links.
- Mobile/tablet context actions: below 1024px, replace the hidden desktop side panel with a regular in-flow action section immediately after the Hero. Keep both `Google로 계속하기` and `Fan Passport 발급받기` visible, 52px high, full-pill, Spectrum-outline controls; use one column on mobile and two columns from 768px.
- Text links: minimum 44px interaction height, 14px/650, Muted Ink, unboxed chevron treatment.
- Icon-only controls: use 20×20px visible icons inside 44×44px targets with Lucide-style 1.75–2px strokes. Adjacent icon-only controls use `0px` group gap while each target remains distinct and non-overlapping. Do not apply this compact rule to controls with visible text.
- Avoid parallel primary actions. The hero ends at “라이브 예약하기”; detailed information belongs downstream.

### Cards and Containers

- Collection card: White, 16px radius, 24px desktop padding / 20px mobile padding, Micro Hairline, card micro-shadow.
- Utility card and live row: White, 12px radius, Micro Hairline, card micro-shadow.
- Hero: 20px radius, no border or card shadow; depth comes from the photograph and internal scrim.
- Desktop context cards stack with a 16px gap and remain visually quieter than the hero.
- Nested colored cards are prohibited. Inner separation should use a media field, spacing, or a hairline.

### Inputs and Interactive Controls

- No form input was observed on this page.
- Focus styling is global and explicit: 3px Near Black outline, 3px offset.
- Touch targets remain at least 44px even when the visible icon or label is smaller.

### Navigation

- Header: sticky, 64px design token and 68px rendered outer height including padding behavior; White with no bottom divider.
- Wordmark: 80px rendered image inside an 88×44px link target.
- Desktop navigation from 768px: White pill, 44px height, subtle border, active item in Near Black/800 and inactive items in Muted Ink/600.
- Desktop optical correction: navigation is translated upward by 1px to align Pretendard with the wordmark.
- Below 768px, hide the desktop pill and retain brand plus header actions.
- Below 1024px, show a fixed 64px four-column bottom navigation with a thin top line and a 2px active indicator.

### Image Treatment

- Hero uses full-bleed high-resolution KARA photography with `object-fit: cover` and a slightly right-shifted focal position.
- Favorite cards use a nested gallery composition: a square `#F6F6F5` field contains a square editorial portrait occupying about 66.5% of the field. Padding is `16.75%` on all sides.
- Favorite portraits are direct, colorful, face-legible editorial crops: blue KARA group styling, warm gold Elina close-up, cool dark Changha close-up.
- Upcoming LIVE avatars reuse the corresponding artist imagery in circular 64px desktop / 56px mobile crops.
- Passport uses a transparent, fully opened identity-and-stamp-book asset with `object-fit: contain`; it is never shown as a closed burgundy cover.

### Distinctive Components

- Status Rail: UPCOMING outline pill plus date on one horizontal rail; the countdown sits below in monospace.
- Favorite Gallery Collection: one rounded outer collection, three light media fields, names and real YouTube/TikTok/Instagram marks below each portrait.
- Logged-out Live Card: heading and subtitle at the top, centered calendar-heart line icon, centered explanatory copy, Google login CTA at the bottom.
- Fan Passport Card: title/subtitle, opened Passport asset, lifecycle value copy, and login CTA in one quiet vertical composition.
- Upcoming LIVE Row: circular avatar, identity/title/date block, right-aligned reservation metadata on tablet/desktop, and a 44px chevron action.

## 5. Layout Principles

### Spacing System

- Base unit: `4px`.
- Repeated spacing values: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64px`.
- Adjacent icon-only action groups are the deliberate exception to the positive spacing scale: use `0px` between separate 44×44px targets and center a 20×20px icon in each target.
- Content sections are separated by 64px in the current implementation.
- Section heading rows use a 20px bottom gap and align the title block against an optional text link.
- Dense components use 12–24px internal gaps; avoid arbitrary intermediate spacing.

### Grid & Container

- Maximum product width: `1440px`.
- At 1440px with the side panel open: 40px page insets, `944px` main column, 32px gutter, `384px` context panel.
- At 1024–1279px: main column plus 360px context panel with a 24px gap.
- At 768px: 32px page insets and a single 704px content column.
- At 390px: 16px page insets and a 358px content column.
- Desktop hero ratio: `16:8`; mobile hero ratio: `4:5`.

### Whitespace Philosophy

- Whitespace is the primary neutralizing force against colorful artist imagery.
- Major sections breathe with 64px separation; do not fill gaps with decorative copy or badges.
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
- No glassmorphism, backdrop blur, ambient colored glow, or broad decorative shadow was observed.

## 7. Do's and Don'ts

### Do

- Let one strong artist image lead each viewport.
- Keep utility surfaces white and separate them with hairlines and micro-shadows.
- Use the Spectrum Relay only for the screen's single primary conversion action.
- Keep title and explanatory subtitle together as a reusable section-heading pair.
- Preserve 44px minimum interaction targets and visible keyboard focus.
- Use real social brand marks and face-legible, high-quality artist photography.
- Present Passport as an opened record system with empty stamp capacity.

### Don't

- Do not add colored card backgrounds to “balance” the hero.
- Do not place multiple gradients, dark feature cards, or competing primary CTAs on the same screen.
- Do not use a closed leather Passport, pocket graphic, or heavy burgundy surface in this system.
- Do not enlarge portraits until they fill the Gallery Gray field; preserve the approximately 66.5% artwork ratio.
- Do not introduce nested cards, oversized shadows, glass panels, or ornamental divider lines.
- Do not hide secondary information behind tiny hit areas or use icons below 44px without a larger target.
- Do not fabricate dark mode rules from the light-only implementation.

## 8. Responsive Behavior

### Breakpoints

| Name | Width | Key Changes |
| --- | --- | --- |
| Mobile | `< 768px` | 16px page inset, 20px headings, 4:5 hero, horizontal 288px favorite cards, 56px live avatars, desktop nav hidden |
| Tablet | `768–1023px` | 32px page inset, 24px headings, 2:1 hero, three fixed favorite columns, 64px live avatars, desktop nav visible |
| Desktop | `1024–1279px` | Side context panel appears and becomes sticky; bottom navigation disappears; panel toggle appears |
| Wide desktop | `≥ 1280px` | 40px page inset, 384px context panel, 32px column gap; social controls remain icon-only |

### Touch Targets

- All links and buttons maintain at least 44px in one dimension.
- Adjacent icon-only actions maintain independent 44×44px hit areas with `0px` visual gap; hit areas must meet edge-to-edge but never overlap.
- The visible icon remains 20×20px. Text-bearing actions, navigation labels, and isolated icon controls keep their component-specific spacing.
- Bottom navigation divides the viewport into four equal-width targets with 64px minimum height.
- Horizontal favorite cards use scroll snap and hide the scrollbar without disabling native touch scrolling.

### Collapsing Strategy

- Desktop behavior: two-column shell with a 944px content column and sticky 384px context panel at 1440px.
- Tablet behavior: single content column; side context is removed, but the desktop header navigation remains.
- Mobile behavior: compact header, no desktop nav or side panel, horizontal favorite rail, fixed bottom navigation.
- Panel toggle: at desktop, collapsing the context panel expands the main column to the full available 1360px; content is not replaced with a placeholder.
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

Build a white, image-first K-pop fan product with Pretendard typography, a dominant full-color editorial hero, and only one pink-to-violet gradient CTA. Keep all utility surfaces neutral with 1px hairlines, 12–16px radii, and short two-layer micro-shadows. Use 64px section spacing and strong but compact heading/subtitle pairs. On wide screens, split the page into a large content column and a narrow sticky logged-out context panel. Below 1024px remove that panel; below 768px switch to horizontal snap cards and fixed bottom navigation.

### Example Component Prompts

- Hero: “Create a 2:1 desktop live hero with full-bleed high-resolution artist photography, a restrained left-and-bottom black scrim, an outlined UPCOMING rail, 48px white event title, monospace countdown, and one 320×52px spectrum-gradient reservation pill.”
- Card: “Create a White favorite collection with a 16px outer radius, 24px padding, micro hairline and short two-layer shadow. Place three square Gallery Gray media fields inside; center square portraits at 66.5% of each field, then add artist names and three 44px social controls.”
- Navigation: “Create a 64px sticky White header with an 80px ByUs wordmark, a 44px hairline pill navigation optically shifted upward by 1px, and 44px language/menu controls. Hide the pill below 768px.”
- Passport: “Create a quiet White Passport utility card with a 20px/850 title, 14px subtitle, fully opened identity-and-stamp asset, centered two-line lifecycle copy, and a 90%-width 52px outlined login CTA.”
- Live row: “Create a 112px White live row with a 64px circular artist avatar, compact title/date stack, right-aligned booking meta, and a 44px chevron target; reduce to 104px and hide booking meta on mobile.”

### Ready-to-Use Prompt

Using the ByUs Fan Pulse Spectrum design system, turn the supplied product scenario into a responsive fan-platform screen. Preserve the White/Near Black shell, Pretendard hierarchy, 4px spacing scale, 12/16/20px radius ladder, hairline-plus-micro-shadow surfaces, face-legible editorial imagery, and exactly one Spectrum Relay primary CTA. Use a wide content column plus sticky context panel at desktop, a single column below 1024px, and horizontal snap or fixed bottom navigation patterns below 768px. Do not introduce dark cards, extra gradients, glassmorphism, nested cards, or decorative color surfaces.

### Iteration Guide

1. Establish the hero image and the single primary action before adding secondary modules.
2. Translate scenario information into title/subtitle pairs, compact rows, or one neutral utility card.
3. Check that colored surfaces do not compete with artist photography.
4. Verify 44px targets, 3px focus outlines, and mobile collapse behavior.
5. Confirm that new components reuse the 4px spacing scale and existing radius/shadow tokens.

## Optional Appendix: Interaction Patterns

- Scroll behavior: header remains sticky; context panel is sticky from 1024px; mobile/tablet use a fixed bottom navigation.
- Hover behavior: neutral controls receive a subtle gray fill; artist media fields rise by 2px and strengthen their border; Passport artwork rises by 6px; the primary gradient darkens.
- Click behavior: the desktop menu button collapses the entire context panel and lets the main content expand; login and reservation actions route downstream.
- Animation tone: restrained and product-like, 160ms for control feedback and 240ms for layout/object transitions.
- Reduced motion: transitions collapse to effectively instant and smooth scrolling is removed.

## Optional Appendix: Content & Messaging Patterns

- Headline pattern: short identity or value phrase, often mixing Korean with a familiar English product noun, e.g. “최애의 Fan Passport”.
- Subtitle pattern: one direct benefit sentence ending in `-보세요` or `-하세요`.
- CTA language: explicit task plus outcome, e.g. “라이브 예약하기”, “Google로 계속하기”, “Fan Passport 발급받기”.
- Lifecycle copy: enumerate meaningful fan actions before promising the stored value, e.g. “팬 인증부터 라이브 예약, 출석, 후기까지”.
- Voice and tone: warm and encouraging, but never cute, overly promotional, or verbose.

## Optional Appendix: Observed Pages

- `http://127.0.0.1:5173/candidates/03-fan-pulse-spectrum`: desktop 1440×1100, tablet 768×1024, and mobile 390×844 rendered states; logged-out context panel open and collapsed; hover-capable controls.

## Optional Appendix: Evidence Notes

- Observed: the live rendered page exposes no root variables on `:root`; reusable tokens are scoped to `[data-fan-pulse-home]` and were read from the loaded stylesheet.
- Observed: at 1440px the hero is 944×472px, the favorite collection is 944px wide, and the open context panel is 384px wide.
- Observed: the favorite media field is about 287px square with about 48px padding, yielding an artwork ratio near 66.5%.
- Observed: the browser reported no runtime page errors during extraction; console output contained only Vite and React development messages.
- Inferred rule: color is intentionally budgeted—photography plus one primary gradient—because neutral utility surfaces preserve visual rest beside the hero.
- Inferred rule: the side panel is contextual rather than foundational because it is removed entirely below 1024px without replacing the main content flow.
