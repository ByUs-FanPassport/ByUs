# Creator and fandom identities

Reviewed 2026-10-14 against the 10 published person/group fan pages. RUN&MUSIC is a brand and is unchanged. No unpublished artist is added. Names below are display names, not claims about legal names, membership, agency or current lineups.

| Page | Display spelling | Primary evidence | Fandom / logo decision |
| --- | --- | --- | --- |
| elina | 엘리나 · Elina Karimova | [Official YouTube](https://www.youtube.com/@ElinaKarimova): `Elina Karimova_리나대장`, videos use 엘리나 | No separate official fandom name or logo verified; preserve photos |
| changha | 창하 · CHANGHA | [Official YouTube](https://www.youtube.com/channel/UCX4H3pl79Gs0Y-fbqwXiyzw): `창하CHANGHA` | No separate official fandom name or logo verified |
| yuna | 유나 · Yuna Karimova | [Official YouTube](https://www.youtube.com/@YunaKarimova_): `유나_Yuna Karimova` and MV credit | No separate official fandom name or logo verified |
| jenny-jeong | 정제니 · Jenny Jeong | [Official Instagram](https://www.instagram.com/jen2jen2_/): 정제니 and bio `Jenny Jeong` | No separate official fandom name or logo verified |
| aryeom | 아렴 · ARYEOM | [Official YouTube](https://www.youtube.com/@aryeomii): `아렴 ARYEOM` | No separate official fandom name or logo verified |
| park-myungho | 박명호 · Myungho Park | [Official linked Instagram](https://www.instagram.com/myunghopark/): 박명호, `myunghopark` | Existing CMS English spelling retained; no stronger English-name or separate fandom/logo evidence found |
| ifewknow | 이퓨 · ifew | [Official linked Instagram](https://www.instagram.com/ifewknow/): `ifew`, bio “If you know, you know — it’s ifew” | Existing CMS Korean name retained; no separate official fandom/logo verified |
| thisisj-official | 재희 · Jaehee | [Official linked Instagram](https://www.instagram.com/j.hya/): 재희 | Existing CMS English spelling retained; no stronger English-name or separate fandom/logo evidence found |
| nchive | NCHIVE · 엔카이브 | [Official YouTube](https://www.youtube.com/@NCHIVE), [2026 emblem announcement](https://x.com/nchiveofficial/status/2061100455133155482) | Current red channel emblem; SAVE · 세이브 and official SAVE wordmark |
| wena | We;Na · 위나 | [Official YouTube](https://www.youtube.com/@wena_official), existing verified logo provenance | mymean · 마이민; no separate official fandom logo found |
| hyunji | 현지 · Hyunji | [Instagram](https://www.instagram.com/hyunjiiee/), checked 2026-10-16: profile name `현 지`; Hyunji is the romanized display name | Photos only; no separate fandom name or logo added. See [onboarding sources](hyunji-onboarding.md). |

“Not verified” describes this review, not proof that a fan name or mark does not exist. Personal profile photos are not relabeled as logos. Existing CMS English spellings for Park Myungho and Jaehee are preserved rather than inventing a romanization.

## Group and fandom sources

- [NCHIVE official fandom announcement, 2024-01-26](https://x.com/nchiveofficial/status/1750805783091229003) explicitly names SAVE / 세이브. Its [original artwork](https://pbs.twimg.com/media/GEv-cOib0AAFNSQ.jpg?name=orig) contains a distinct blue folder-shaped SAVE wordmark and `NCHIVE OFFICIAL FAN CLUB`. The complete source is preserved; the UI crops only the existing wordmark through an SVG viewport, without redrawing or recoloring it.
- [NCV official emblem motion](https://youtu.be/DvI1K5sLg7M) and the [2026 announcement](https://x.com/nchiveofficial/status/2061100455133155482) establish the new artist emblem. The channel still uses NCHIVE; NCV in the emblem/video title does not justify replacing the canonical group name. The current channel avatar provides the clean red emblem. Asset hashes and URLs are in `public/images/celebrities/nchive/identity-provenance.json`.
- [We;Na official fandom announcement](https://www.instagram.com/p/Cgi79qPJVt-/) names `mymean` and 마이민. The post image is a group photograph, not a fandom logo. The spelling stays lowercase as in the announcement. The [official debut-name post](https://www.instagram.com/p/CgePCdbJ-6T/) confirms 위나; the verified channel supplies `We;Na`.

## Pinterest benchmark and implementation

Ego Lite inspected two actual Pinterest pins from DFY Studio's Blip portfolio: [collection presentation](https://kr.pinterest.com/pin/170222060905574425/) and [identity/navigation presentation](https://kr.pinterest.com/pin/295196950597614921/). Both link to the [designer's original case study](https://www.behance.net/gallery/99796825/The-Kpop-fandom-app-for-true-fans-blip). These are design-portfolio images, not evidence of the app's current live behavior.

Adopted photo-first composition, a stable identity area, and secondary fan information beneath the artist name. Kyaa retains its existing white/pink system, navigation, photos and participation controls. Artist logos and fandom marks have distinct roles; no membership entitlement or official partnership is implied. Fandom names link to their source announcement with the existing outbound tracking contract. A repeated name adds readable text beside a decorative logo.

All 10 headers now separate photography from copy so multilingual names never overlay faces. Existing image-role sources and revision checks remain authoritative. Elina's legacy mobile hero focal point changes from bottom to top for the shorter photo area; the original photograph is unchanged. WENA retains its natural landscape mobile ratio. The mobile NCHIVE frame preserves all six faces.

Research captures and local validation are preserved in the original checkout's `work/fandom-identities-20261014/`. Pinterest/official-account screenshots are research evidence only; release screenshots must be actual local product renders without private account details.

## Validation (2026-10-14)

- Production build at localhost:3105: 69 browser cases. All 10 identities at 390/768/1024/1440px, the shared NCHIVE structure in 11 languages at 390/1440px and KO/JA/VI/TH at 360/768px, plus the long Elina English name at 390/1440px. No document overflow, clipped identity text or photo/text overlap; all hero images decoded successfully.
- Direct visual inspection covered each changed page at 390/1440px and the 768px image-source transition. NCHIVE retains all six faces; We;Na retains all four. The original images and accepted photo treatments remain unchanged.
- 17 axe scans of the changed hero passed WCAG A/AA checks. The fandom link has a 44px target and a visible 3px keyboard outline; Enter opened the official SAVE announcement with the shared UTM decoration intact. RUN&MUSIC retains the existing heading and layout.
- The NCHIVE quiz CTA opened the sign-in UI with `intent=passport`, `entity=nchive` and return path `/c/nchive/verify`, without alerts; no account was signed in and no fan record was created.
- Impact tests: initial 80 tests across identity/page/image roles and final 42 tests across identity/design/action/image propagation contracts passed. Targeted ESLint, workspace typecheck and the root production build passed. No database or quiz implementation changed; prior quiz backend evidence remains applicable.
- Release images are inspected browser captures cropped above member avatars. Physical devices and deployment READY were not part of local validation.
