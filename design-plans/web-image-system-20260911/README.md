# ByUs 웹 이미지 사용처·규격·공통화 제안

작성일: 2026-09-11 · 상태: **현황 조사 및 제안 / 제품 코드·데이터 변경 없음**

## 1. 결론

**공통화는 가능하다. “모든 사진을 같은 비율로”가 아니라, 대표 프로필·세로형·가로형 사진을 별도로 등록하고, 같은 용도의 화면끼리 공유하도록 코드로 제한하는 방식이 맞다.** 각 구분은 서로 다른 사진을 사용할 수 있다. 같은 촬영 원본에서 구도가 충분할 때만 파생본을 공유한다. 행사 포스터·경품은 셀럽 기본 사진과 분리한다.

현재 `CreatorImage`라는 공통 기반이 이미 있다. 그러나 전용 배너·캘린더 사진, 축약 DTO, 직접 `Image`를 사용하는 행사/가이드 이미지까지 한 계약으로 관리되지는 않는다. 화면마다 `cover`, `contain`, 배율, 소스 우선순위를 따로 결정하는 것이 불일치의 주원인이다.

이번 결과는 34개 사용처 매핑, 로컬 래스터 자산 109개와 화면에서 참조한 공개 원격 원본 8개의 크기 목록, PC/모바일 비교 화면, 코드 강제 적용안으로 구성한다. 로컬 자산 목록에는 미사용·장식·과거 파일도 포함하며 **117개가 전부 현재 노출 사진이라는 뜻은 아니다.**

- 읽기 쉬운 화면 비교: [report.html](report.html)
- 사용처 매핑: [image-slot-map.csv](image-slot-map.csv)
- 원본 크기 목록: [asset-dimensions.csv](asset-dimensions.csv)
- 렌더링 측정값: [render-measurements.json](render-measurements.json)

### 방향 보강 · 세로형/가로형 별도 등록

사용자가 확인한 방향은 **대표 프로필 사진 / 세로형 사진 / 가로형 사진 / 행사·홍보 이미지의 별도 관리**다. 처음 제안의 “원본을 한 번 관리”는 동일 사진 한 장을 모든 화면에 사용한다는 의미로 적용하지 않는다.

- 프로필: 홈·디렉터리·원형 아바타·작은 인물 표시.
- 세로형: 모바일 인물 배너·캘린더 세로 사진. 같은 역할 내 slot별 crop은 별도 확인.
- 가로형: PC 인물 배너·가로형 Passport 카드. 모바일 화면이어도 가로 카드면 가로형 사진을 사용.
- 행사: 가로형·세로형 홍보 이미지를 별도 등록. 이미 글자가 들어간 포스터는 전체 표시가 기본.
- 서로 다른 사진을 사용해도 같은 셀럽의 분위기·시기를 맞추는 것을 권장한다. 동일 촬영본 사용을 강제하지 않는다.

[레퍼런스 보강 문서](reference-review.md)에 Spotify·Steam·YouTube 공식 근거와 이미지, ByUs에 적용할 규칙 및 가져오지 않을 규칙을 정리했다. 아래 현황 매핑은 기존 관찰을 유지하고, 제안은 위 방향으로 보강했다.

## 2. 조사 기준과 확인 범위

- 코드 기준: `d8d3676341c59adf24ab01f2e5baec39e3cecfc5`.
- 분석 checkout: `/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911`.
- 산출물: `/Users/jewel/Desktop/Developement/byus/design-plans/web-image-system-20260911/`.
- 원래 checkout은 기준 코드보다 뒤에 있어 그대로 분석하지 않았다. 이 문서의 소스 링크는 위 고정 checkout을 가리킨다.
- 로컬 `next start`의 기존 production build로 `/`, `/c/ifewknow`, `/c/jenny-jeong`, `/live/ifew-100-days-tiktok-20260912`, `/pages/ifew-fan-guide`를 1440px·390px, DPR 1에서 확인했다. 공개 콘텐츠 조회는 기존 운영 데이터 설정을 사용했다. 운영 사이트를 다시 검사하거나 데이터를 수정한 작업은 아니다.
- 인증이 필요한 MY·소장 Passport·개인 아바타·증빙 및 관리자 화면은 코드·스키마 매핑이다. 사용자 로그인·비공개 사진 열람은 하지 않았다. 동적 SNS 실제 게시물과 각 셀럽의 모든 조합은 렌더 검증 범위 밖이다.
- 이미지 `width`/`height` JSX 값, 브라우저가 받은 최적화 이미지 크기, 원본 파일 크기, CSS 표시 영역 크기는 각각 구분했다. 원본 크기는 Sharp metadata로 확인했다.
- CSS를 읽을 때 실제 import와 마지막 breakpoint override를 우선했다. 예를 들어 팬페이지의 실제 CSS는 `features/fanpage/ui/fanpage.module.css`이고, 기존 `components/celebrity-fan-page.module.css`를 검사하는 일부 계약 테스트는 실제 화면 규칙을 보장하지 않는다.

## 3. 확인한 문제 — 우선순위 3개

### 3.1 원본의 용도와 표시 영역이 맞지 않는다

| 직접 확인한 사례 | 원본 | 실제 사진 영역 | 현재 처리 | 관찰·의미 |
|---|---:|---:|---|---|
| 정제니 PC 팬페이지 | 853×1280, 약2:3 | 937×358, 약2.62:1 | cover, 50% 30% | 세로 원본의 약25.5% 면적만 사진 영역에 남는다. 얼굴 중심의 확대된 구도가 되고 머리 위·아래가 잘린다. |
| 이퓨 PC 팬페이지 | 로컬 hero-studio, 2:3 | 937×358 | cover, 50% 45% | 원본의 약25.5% 면적만 남는다. 얼굴을 맞춰도 전신/상반신 의도를 그대로 보존할 수는 없다. |
| 이퓨 모바일 홈 메인 | 1774×887, 2:1 | 358×447.5, 4:5 | cover | 가로 원본의 약40% 면적만 남는다. 배너 왼쪽 글자와 오른쪽 인물 일부가 프레임 밖으로 잘린다. |
| 같은 이퓨 모바일 안내 페이지 | 같은 1774×887 | 350×175, 2:1 | contain | 원본 전체 구성을 유지한다. 같은 파일도 용도별 규칙에 따라 결과가 크게 달라진다. |

위 수치는 배율 변형이 없는 `cover`에서 `min(원본비율/영역비율, 영역비율/원본비율)`로 계산한 **기하학적 잔존 면적**이다. 흰색/그라데이션 오버레이에 가려지는 부분은 포함하지 않으며, 얼굴 인식·품질 점수나 허용 기준이 아니다. Xin·이퓨 프로필처럼 CSS zoom이 별도로 있으면 이 단순 수식을 그대로 쓰면 안 된다.

`cover`는 원본 비율을 보존한 채 잘라 채운다. 이번 확인 사례를 “가로로 늘려 찌그러뜨린다”로 단정하지 않는다. 현재 제니 원본은 사용자가 선택한 사진이므로 유지하고, 가로 전용 이미지가 없을 때의 배치 방식부터 정하는 것이 맞다.

**제안:** 인물 가로 배너는 승인된 가로 구도나 별도 배치가 있을 때만 `cover`. 세로 원본만 있으면 기존 텍스트 영역 + 단색 배경 + 비율 보존 인물 사진을 fallback으로 사용한다. 글자가 포함된 행사 포스터는 기본적으로 전체 표시하고, 모바일 홈용 4:5 파생본이 있으면 그 파일을 사용한다. 배경 확장·합성 이미지를 자동 생성하는 것은 이 제안에 포함하지 않는다.

### 3.2 공통 컴포넌트가 있어도 원본·초점 정보가 끝까지 이어지지 않는다

- `CreatorImage`는 `portrait/avatar/passport/collection/vertical/calendar`를 지원하지만, 배너는 `CreatorHeroPicture`와 별도 registry, 캘린더는 정적 사진 배열이 소스를 선택한다.
- Park/Jenny는 알려진 옛 사진일 때만 정적 예외를 적용하고 새 CMS 사진을 우선한다. 다른 셀럽 전체에 같은 정책이 적용되는 것은 아니다. “프로필 교체가 어느 화면까지 바뀌어야 하는지”가 자산 계약에 명시되어야 한다.
- CMS 프로필은 URL·alt·`imagePosition`을 갖지만, MY·일부 LIVE·캘린더 DTO는 URL만 전달한다. 위치를 CMS에서 조절해도 모든 표면에서 같은 구도가 된다고 보장할 수 없다.
- 그룹 사진은 멤버 전체를 보존해야 하므로 개인 얼굴 crop과 구분해야 한다. KATSEYE/Xin의 현재 별도 소스·contain 처리도 이행 시 검토 대상으로 남긴다.

**제안:** `creator → asset profile → slot별 binding`을 한곳에서 관리한다. 프로필·세로형·가로형 asset 역할을 분리하고, 해당 역할의 사진을 교체하면 그 역할을 참조하는 화면의 crop 승인만 재검토한다. 프로필 교체가 세로형·가로형 사진을 덮어쓰지 않는다.

### 3.3 비율뿐 아니라 전달 해상도와 검증 기준도 분산되어 있다

이퓨 모바일 홈 배너는 DPR 1 검사에서 브라우저가 358×179 이미지를 받았지만 358×447.5 프레임을 `cover`로 채운다. 이때 비율을 유지한 실제 확대 크기는 약895×447.5가 필요하다. 결과적으로 전달된 작은 이미지가 약2.5배 확대되며, 캡처에서도 글자·인물 경계가 거칠게 보인다. CSS 칸 너비만 `sizes`로 제공하면 세로 프레임의 cover 확대량을 놓칠 수 있다.

반대로 LIVE 상세는 HTTPS URL이면 직접 `unoptimized` 처리해 원본을 요청한다. 공통 public-image-policy는 허용된 CMS bucket만 optimizer를 사용하도록 하지만 모든 소비자가 같은 경로를 따르지는 않는다. 단순히 모든 이미지에 `unoptimized`를 켜는 해결은 피한다.

**제안:** 용도에 맞는 파생본을 먼저 고르고 실제 slot 크기·DPR·cover 확대량에 맞춰 `sizes/srcset`을 계산한다. 픽셀 치수·선택된 source·최종 CSS·로드 성공은 자동 검사하고, 얼굴/글자 잘림은 실제 렌더를 보고 승인한다. 단순 소스 문자열 grep 테스트만으로 완료하지 않는다.

## 4. 사용처 전체 매핑

아래는 현행 동작이다. 비율이 다른 사용처를 임의로 같은 비율로 바꾸라는 결정이 아니다. 코드만 확인한 경로와 실제 렌더한 경로는 마지막 열로 구분한다. 세부 source/CSS 링크는 CSV 및 10절에 있다.

| ID | 화면 / 역할 | PC | 모바일 | 현재 원본·처리 | 제안 slot | 검증 |
|---|---|---|---|---|---|---|
| I01 | 홈 셀럽 목록 / 셀럽 프로필 | 정사각형; 내부 min(84%,240px) | 정사각형; 내부 인셋 | cover + 셀럽별 위치/배율; CMS 프로필; 일부 예외; preview 있으면 영상으로 대체 | `identity.square` | 코드 |
| I02 | /celebrities 디렉터리 / 셀럽 프로필 | 1:1; 최대 약438 CSS px | 1:1; 1열 | cover; CMS + 공통 resolver | `identity.square` | 코드 |
| I03 | 홈 LIVE 행 / 셀럽 아바타 | 64×64 원형 | 56×56 원형 | cover + avatar crop; 축약 LIVE projection + resolver | `identity.avatar` | 코드 |
| I04 | LIVE 목록 / 상세 / 프로필 온보딩 / 셀럽 아바타 | 64 / 64 / 56px 원형 | 52 / 56 / 48px 원형 | cover + avatar crop; 각 projection; 위치 전달 여부 다름 | `identity.avatar` | 코드 |
| I05 | /c/[slug] 팬페이지 / 셀럽 배너 | 전체 높이360; 오른쪽69%가 사진; 실측937×358 | 전체 높이470; 실측356×468 | cover; Aryeom PC contain 예외; 전용 hero registry; Park/Jenny 새 CMS 우선; KATSEYE 전용 | `identity.hero.desktop/mobile` | 코드 + 이퓨/제니 실측 |
| I06 | MY 셀럽 선택 / 셀럽 프로필 | 48px 프레임 | 작은 화면40px 힌트 | cover; MY projection; imagePosition 없음 | `identity.square.small` | 코드; 인증 화면 미렌더 |
| I07 | /passports 소장 목록 / 셀럽 카드 | ≥1024:16:9 | <1024:16:11 | cover; 소장 Passport projection | `identity.collection.desktop/mobile` | 코드; 인증 화면 미렌더 |
| I08 | 홈 Passport 아트 / 셀럽 합성 사진 | Passport 내 사진 창440:354; sizes96px | 같은 아트 축소 | cover; CreatorImage(passport) + Passport 장식 | `identity.passport` | 코드; 인증 화면 미렌더 |
| I09 | LIVE 캘린더 이벤트 / 셀럽 세로 사진 | ≥1024:폭 clamp(48px,5vw,72px), 높이96 | 세로 사진 숨김;24px 아바타 | cover; 캘린더 projection; 위치 전달 없음 | `identity.vertical + identity.avatar` | 코드 |
| I10 | 캘린더 모달 / 셀럽 세로 사진 | 72×96 | 72×96 계약 | cover; 이벤트 셀럽 사진 | `identity.vertical` | 코드 |
| I11 | 캘린더 주변 장식 / 셀럽 포토카드 | 카드1024:1536; 내부 사진창 별도 | <1024 숨김 | cover; Xin/그룹 등 contain; calendarPortraits 정적 배열; Jenny 새 CMS 분기 | `identity.calendar` | 코드 |
| E01 | 홈 메인 캐러셀 / LIVE 홍보 배너 | 2:1; 실측944×472 | 4:5; 실측358×447.5 | cover; LIVE heroImage; Elina 전용 PC/mobile 예외 | `event.home.desktop/mobile` | 코드 + 실측 |
| E02 | 홈 뱅크시 슬라이드 / 캠페인 홍보 배너 | 2:1 | 4:5 | cover; BANKSY_CAMPAIGN_IMAGE 정적 16:9 계열 | `campaign.home.desktop/mobile` | 코드; 초기 활성 슬라이드 외 별도 렌더 미검증 |
| E03 | /live/[slug] 상세 / LIVE 대표 이미지 | 2:1 | 2:1 | PC cover center36%; ≤767 contain; live.heroImage.url | `event.detail` | 코드 + 별도 로딩 대기 실측 |
| E04 | 홈 셀럽 카드 / 팬페이지 최근 LIVE / LIVE preview | 1:1 파생본720×720; 팬페이지 CSS 확인 필요 | 팬페이지 liveCard는3:2로 override | 표면별 cover; 영상은 별도 player; 승인 preview square manifest | `preview.square` | 코드; 이퓨 현재 preview 없음 |
| E05 | LIVE 상세 영상 poster / LIVE preview | 2:1 파생본1280×640 | 2:1 | preview player 소유; 승인 preview landscape manifest | `preview.landscape` | 코드; 현재 영상 미검증 |
| E06 | 팬페이지 LIVE 탭 패널 / LIVE 카드 이미지 | 1:1 | 3:2 | cover; live.heroImage.url; E01/E03와 같은 원본 | `event.thumbnail.square/landscape` | 코드; legacy live tab 분기 연결, 이번 렌더 미검증 |
| E07 | 팬페이지 래플 카드 / 대표 래플 / 래플 경품 | 일반1.35:1; 대표35%열·min-height230 | 1.6:1 | cover; raffle.imageUrl ← teaser_image_url | `benefit.product / benefit.poster` | 코드 |
| E08 | MY 래플 미리보기 / 래플 경품 | 96×104 CSS px | 96×104 CSS px | cover; JSX112×112는 표시 규격 아님; raffle.imageUrl | `benefit.thumbnail` | 코드; 인증 화면 미렌더 |
| G01 | 이퓨 가이드 / 홈 진입 카드 / 행사 정보 배너 | 가이드580×290; 홈384폭 힌트 | 가이드350×175; 홈356×178 | contain 2:1; ifewEventBanner 1774×887; E01과 같은 원본 | `event.poster` | 코드 + 가이드 실측 |
| G02 | 엘리나 팬 참여 가이드 / 가이드 인물 사진 | 580×560 | 1:1 | cover center; /images/home-entry/elina.jpg 하드코딩 | `identity.editorial` | 코드 |
| G03 | 팬 참여 가이드 LIVE 예시 카드 / 가이드 인물 작은 사진 | 48×48 | 48×48 | 각 구현의 crop; 가이드 자체 원본; 일부 shared renderer | `identity.avatar 또는 square.small` | 코드 |
| G04 | 팬 참여 가이드 / 가이드 경품 이미지 | JSX560×340; visual 컨테이너 | visual 약1:0.66 | cover; banksy-exhibition-campaign.webp | `benefit.poster` | 코드 |
| S01 | 팬페이지 InstagramRecentActivity / SNS 최근 활동 | 9:16 | 9:16 | cover; PHOTO/VIDEO 동일; Instagram imageUrl; 원본 비율 모델 없음 | `social.media` | 코드; 이번 화면에 실제 SNS 카드 없음 |
| U01 | MY / 팬페이지 헤더 / 댓글 / 랭킹 / Passport 상세 / 사용자 프로필 | 표면별 크기; 원형 | 표면별 크기; 원형 | cover; 출력512×512 WebP; private avatar BFF / 사용자 선택 캐릭터 | `user.avatar (공개 CMS와 분리)` | 코드; 인증 화면 미렌더 |
| U02 | AvatarEditor / 사용자 사진 편집 | 업로드 편집용 | 업로드 편집용 | 사용자 선택 crop; private upload pipeline | `user.avatar.editor` | 코드; 인증 화면 미렌더 |
| P01 | 인증 상세 / 팬 인증 증빙 | 4:3 미리보기 | 4:3 미리보기 | cover; 저장 원본 비율은 보존; private certification-proofs | `proof.private` | 코드; 개인 증빙 미열람 |
| M01 | LIVE mission / 퀴즈·미션 내용 이미지 | 일부 옵션폭160; height:auto | 같은 컨텐츠 규칙 | 일부 레이아웃 자연 비율; JSX640×360; 미션 body/option media URL | `content.media` | 코드; 실제 미션 미렌더 |
| D01 | 홈 / 가이드 / 로그인 / US fanmeetings / Passport / 스탬프 장식 | 아트별 고유 비율 | 같은 비율 축소 | contain 또는 자연 크기; 일부 합성 창 별도; 로컬 정적 자산 | `artwork` | 코드 + 가이드 상단 일부 |
| D02 | MY / 팬페이지 / Passport / 팬 등급 휘장 | tier/stage별 정적 자산 | 같은 선택 계약 | contain; badge tier/stageKey; 사진 선택과 무관 | `badge (identity와 분리)` | 코드 |
| D03 | 로그인 전체화면 / 로그인 배경 | 뷰포트 채움 | 별도 mobile source | cover; 로컬 desktop/mobile 배경 | `decorative.background` | 코드 |
| D04 | 공통 header/footer/focus flow / 로고·아이콘 | 브랜드 고유 비율 | 브랜드 고유 비율 | contain 또는 자연 크기; 워드마크/SVG | `brand (사진 규격 제외)` | 코드 |
| A01 | 셀럽 / LIVE 관리자 / CMS 관리자 미리보기 | 관리자 미리보기 크기 | 관리자 레이아웃 | URL 기반; 게시 전 규격 승인 도구 아님; 입력중 imageUrl / heroUrl | `asset.review` | 코드; 관리자 미접속 |
| X01 | 이퓨 가이드 OpenGraph metadata / 외부 공유 썸네일 | 앱 화면 밖; 플랫폼별 처리 | 앱 화면 밖; 플랫폼별 처리 | 소비 플랫폼에 따라 달라짐; ifewEventBanner; 전용 OG 파생본 없음 | `social.share (별도 전달 규격)` | 코드; 공유 플랫폼 미검증 |

Passport 상세는 셀럽 사진을 직접 렌더하지 않는다. 사용자 아바타와 등급 휘장이 나오므로 “Passport에는 모두 셀럽 사진”으로 묶지 않는다. 일반 혜택 상세/목록에 사진이 없더라도 CMS의 teaser URL은 팬페이지·MY 래플에서 사용되므로 필드와 소비 화면을 따로 매핑해야 한다.

## 5. 권장 규격 — 적용 전 제안

기존 화면을 보존하려면 **역할(family)**과 **실제 표시 위치(slot)**를 두 단계로 관리해야 한다. family 내부에 프로필·세로형·가로형 source role을 두고, 같은 role의 원본·처리 규칙을 공유한다. slot은 비율, 반응형 크기, crop, 전달 해상도를 고정한다. 아래 해상도는 제작 시작점이며 확정 운영 정책이 아니다. 실제 최소값은 crop 후 필요한 표시 픽셀로 계산한다.

| 공통 family | 묶을 사용처 | 제안 규칙 | 제작/전달 해상도 시작점 |
|---|---|---|---|
| 셀럽 identity | I01–I11, G02–G03 | 대표 프로필·세로형·가로형 원본을 각각 등록 + 역할 내 승인 crop; 그룹은 전원 safe box | 정사각형 파생본 1200×1200 권장, 작은 avatar 256/512. directory 최대438px×DPR2를 충족하려면 crop 후876px 이상 필요 |
| 인물 배너 identity.hero | I05 | PC는 가로형, 모바일은 세로형 원본 선택 및 독립 승인. 실제 PC 사진 aperture 약2.62:1, 모바일 약0.76:1; 전체 hero와 혼동 금지 | PC 실측937×358의 DPR2는1874×716 유효 픽셀. 현재 max-width 기준 및 중간 breakpoint도 검사. 모바일 기본 제작1080×1350은 시작점이며 실제 aperture에 맞춘 crop 미리보기 필요 |
| LIVE/캠페인 event | E01–E03, E06, G01 | 홈PC2:1 / 홈모바일4:5 / 상세2:1 / 카드별 별도 slot | 가로형 1920×960급, 세로형1080×1350을 제작 시작점으로 사용. 상세는 실제 최대폭×DPR. 원본 텍스트 포스터는 contain 또는 자연 비율 |
| 영상 preview | E04–E05 | 현재 승인 파이프라인 유지; 사진 계약과 연결하되 무리한 재작성 금지 | 이미 square720×720, landscape1280×640. 파생본 검증 유지 |
| 경품 benefit | E07–E08, G04 | 상품 사진과 글자 포스터를 분리. 상품도 중요 부분 crop 승인, 포스터 기본 전체 표시 | 정사각 1200급 원본에서 각 슬롯 crop; 글자 포스터는 원본 비율 유지. 현재96×104·1.35·1.6 등 슬롯은 우선 명시적으로 등록 |
| SNS/콘텐츠 social/content | S01, M01, X01 | media 종류·원본 비율을 보존. 세로 동영상 썸네일만9:16 고정 검토. 공유 이미지는 별도 slot | SNS는 외부 메타데이터가 허용하는 범위만 사용. OG 플랫폼별 실제 테스트 후 전용 제작값 확정 |
| 사용자 avatar | U01–U02 | 기존 비공개 업로드·crop·원형 표시 유지 | **현재 강제값512×512 WebP**. 공개 셀럽 사진과 저장소 분리 |
| 비공개 proof | P01 | 원본 내용 보존; 미리보기 crop과 원본 검토를 구분 | 원본 비율 유지. 현재3MiB/24MP 입력 제한, WebP 정규화. 공개 파생본으로 전환 금지 |
| 장식/브랜드/휘장 | D01–D04 | 고유 비율 보존; 제작물별 예외. 셀럽 사진 규격 강제에서 제외 | SVG 우선 가능한 브랜드 자산, 래스터는 해당 표시 크기 기준 |

기존 사진 가이드의 square1200/최소720, hero2:1·4:5 제작 규칙은 참고할 수 있다. 다만 square720은 현재 directory의 DPR2 최대 표시를 충족하지 못할 수 있고, 팬페이지 PC의 실제 사진 영역은2:1이 아니다. 따라서 기존 숫자를 현행 강제값이라고 그대로 복사하지 않는다.

### 공통 fallback 순서

1. 해당 slot에 승인된 최신 rendition 사용.
2. 같은 source role의 원본에 승인된 crop이 있고 최소 유효 해상도를 충족하면 파생본 생성/선택.
3. 필요한 role이 없으면 다른 role 사진을 자동 cover하지 않는다. 명시적으로 승인된 대체 사진을 비율 보존으로 표시하고 배경 여백을 허용한다. 글자 포스터는 전체 표시한다.
4. 원본 로드 실패 시 기존 제품 fallback 또는 텍스트 정보 유지. 다른 인물 사진으로 대체하지 않음.

사진 구분별 교체 시 slot binding이 해당 role의 원본 revision을 따르는지 확인한다. 과거 source에서 승인된 focal/zoom을 새 사진에 자동 적용하지 않는다. 사용자 선택 원본, 과거 아트, 공개 상태·이력은 보존한다.

## 6. 코드로 강제하는 방법

### 6.1 데이터 계약: URL 대신 검증된 asset와 binding

공개 CMS 사진에 우선 적용한다. 셀럽·LIVE·경품은 현행 URL을 바로 삭제하지 않고 asset reference를 추가한다. 개인 아바타·증빙의 비공개 저장소/접근 권한은 별도로 유지한다.

| 데이터 | 저장할 내용 | 강제 목적 |
|---|---|---|
| PublicImageAsset | id, revision, 소유 콘텐츠, 안전한 저장 경로, MIME/bytes/hash, orientation 보정 후 width/height | 같은 원본의 정체·치수·변경 추적 |
| 원본 출처 | 기존 local/CMS/external 구분, source URL 또는 보관 key, 처리 상태 | 외부 링크 만료·과거 로컬 파일을 신규 업로드와 구분 |
| ImageBinding | owner + sourceRole + slot + asset revision, sourceMode, focal/safeBoxes, crop approval | 프로필·세로·가로별 참조와 교체 범위 명시 |
| Rendition | crop rectangle, width/height, format, 공개 경로, 원본 revision | 승인된 자르기와 유효 픽셀로 정확히 렌더 |
| 콘텐츠별 alt | locale별 문맥적 alt 또는 decorative 선언 | 같은 파일을 다른 문맥에서 사용할 때 대체 텍스트 분리 |

`sourceRole`은 `creator.profile`, `creator.portrait`, `creator.landscape`로 나누고 `sourceMode`는 `follow-role`과 승인된 `slot-override`로 구분한다. 서로 다른 role이 같은 assetId를 공유할 때도 구도 승인은 각각 필요하다. `imagePosition`은 이행 기간 유지하되 normalized focal point와 동치라고 가정하지 않는다. CSS object-position은 원본의 얼굴 좌표 자체가 아니므로, 정확한 이행에는 기존 slot 크기로 재구도를 확인해야 한다.

아래는 **구현 형태 예시이며 아직 앱에 추가하지 않은 코드**다.

```ts
type CreatorSourceRole = "creator.profile" | "creator.portrait" | "creator.landscape";

type IdentitySlot =
  | "identity.square" | "identity.avatar"
  | "identity.hero.desktop" | "identity.hero.mobile"
  | "identity.collection.desktop" | "identity.collection.mobile"
  | "identity.vertical" | "identity.passport" | "identity.calendar";

type ImageBinding = Readonly<{
  slot: IdentitySlot;
  sourceRole: CreatorSourceRole; // 실제 구현은 slot별 허용 role까지 좁힌다.
  assetId: string;
  assetRevision: string;
  sourceMode: "follow-role" | "slot-override";
  cropId?: string; // source revision + slot에 승인된 crop
}>;

type IdentityImageProps = Readonly<{
  creator: CreatorAssetProfile;
  slot: IdentitySlot;
  alt: string;
  priority?: boolean;
}>;

// 호출자는 src, objectFit, objectPosition, scale, style을 받지 않는다.
<IdentityImage creator={creator} slot="identity.avatar" alt={creator.name} />;
// ratio/breakpoint/fit/fallback/sizes는 slot registry + resolver 소유.
```

slot registry는 `identity.hero.desktop → creator.landscape`, `identity.hero.mobile → creator.portrait`, `identity.avatar → creator.profile`을 고정한다. 화면 너비만으로 사진 방향을 선택하지 않는다. 모바일의 가로 Passport 카드도 가로형 사진을 참조한다.

`event.poster`처럼 다른 family는 별도 타입과 컴포넌트를 둔다. 한 컴포넌트에 임의 `kind`, `ratio`, `fit`, `src`를 다시 모두 열어두면 규칙을 우회하게 된다. 기존 `CreatorImage`를 확장해 이 경계로 옮기고, 컴포넌트를 이름만 바꿔 전면 교체할 필요는 없다.

### 6.2 입력·게시·렌더·CI의 역할 분담

| 계층 | 추가할 검사 | 실패 시 처리 |
|---|---|---|
| CMS 업로드/BFF | 실제 decode, 허용 MIME·bytes·pixel count, orientation, 원본/파생본 해시·치수, 서버가 소유하는 key | 업로드 거부 또는 원본 재선택. 클라이언트가 보낸 width/height만 신뢰하지 않음 |
| CMS 편집 미리보기 | 실제 slot/breakpoint에서 인물·글자·그룹 safe area 미리보기; crop revision 승인 | 게시 전에 해당 slot만 재검토. 포스터/세로 원본은 contain fallback 선택 가능 |
| 서버 게시 gate | 필요한 binding, asset revision, rendition 객체·규격·유효 해상도, alt 완결성 검사 | 신규/수정 자산의 부적합 게시 차단. 기존 공개 데이터는 이행 정책에 따라 유지 |
| 공통 렌더러 | slot별 소스·fit·position·sizes·fallback 결정 | 소비 화면에서 직접 crop 제어 불가 |
| Lint/AST | 공개 사진 소비 영역의 직접 next/image·img·background-image 및 style 우회 차단 | 좁은 allowlist만 허용: 공통 renderer·로고·private/editor·승인 장식 |
| Unit/contract | 사진 구분별 교체의 영향 범위, role 간 자동 대체 금지, revision invalidation, group fallback, legacy URL, DTO focal 전달, crop-pixel 계산 | 의미 있는 계약 회귀 차단 |
| Browser/visual | 최종 breakpoint box 비율, 이미지 decode/선택, 실제 화면 clipping·overlay·해상도 | 로컬 렌더 증거로 수정/승인. 얼굴 safe area는 수동 판단 남김 |

타입 검사만으로 URL 의미나 임의 CSS를 완전히 강제할 수는 없다. 서버의 게시 검사와 파일 경계 lint가 함께 있어야 한다. AST 역시 모든 동적 CSS·URL 전파를 증명하는 것은 아니므로 직접 이미지 import 허용 파일을 제한하고 실제 렌더 검사로 보완한다.

**해상도 계산:** crop 없이 `cover`하는 경우 필요한 source 폭은 `ceil(max(slotWidth, slotHeight × sourceAspect) × DPR)`로 계산할 수 있다. crop rendition이 있으면 그 rendition 비율로 계산하고, 기존 추가 zoom/translate는 별도로 반영한다. 자동 upscaling으로 원본 부족을 감추지 않는다.

### 6.3 기존 구현을 재사용할 지점

- `CreatorImage` / `creator-image-config`: identity slot API, source 정책, crop registry의 출발점.
- `LIVE preview` domain/SQL: focal과 square/landscape derivative manifest, 게시 전 저장 객체 검증의 선례.
- `avatar-image.ts`: 서버 decode·회전·crop·512×512 WebP 변환의 선례.
- `certification-image.ts`: 원본 내용 비율 보존과 출력 metadata/hash 기록의 선례. **공개 asset로 합치는 선례는 아님.**
- `public-image-policy.ts` + `next.config.ts`: 공개 CMS remote origin 경계 유지. LIVE/가이드/MY 직접 renderer도 이 정책과 일관되도록 이행.

외부 HTTPS URL을 계속 허용할지는 이후 정책 결정 사항이다. 우선 새 CMS 업로드를 권장 경로로 만들고 legacy URL은 읽을 수 있게 유지한다. URL 수집 기능을 만든다면 서버의 외부 요청 경계·타임아웃·크기 제한을 별도 설계해야 하며, 현재 단순 URL 입력을 무검증 fetch 기능으로 확장하지 않는다.

## 7. 권장 적용 순서와 완료 기준

| 순서 | 범위 | 완료 기준 |
|---|---|---|
| 0. 현황 고정 | 이 문서·CSV, 사용자 선택 원본 및 현재 crop 보존 | 사용처·담당 renderer·실제 비율·source 우선순위가 추적 가능 — **이번 조사 범위** |
| 1. 클라이언트 계약 | 현행 비율을 그대로 slot registry로 명시, source/위치 DTO 누락 정리, direct image 경계 제한 | 새 사진이 의도된 표면에만 반영되고 동일 slot의 override가 없음 |
| 2. CMS metadata와 publish gate | 원본/파생본/slot binding 추가, 기존 URL compatibility | 신규/변경 자산은 서버 검사, 기존 게시물은 갑자기 비공개 되지 않음 |
| 3. 실제 crop 정리 | 홈 모바일 이벤트 포스터, 세로 인물 PC 배너 우선 | PC/모바일에서 얼굴·텍스트 보존, 전달 해상도 적합 |
| 4. 점진 이행 | Passport/캘린더/가이드/경품/SNS, 사용하지 않는 source 예외 정리 | 승인된 구도 유지, legacy 사용량 감소, 관련 계약/렌더 검사 통과 |

현행 layout까지 한 번에 바꾸면 원본 정리와 디자인 변경의 영향을 분리하기 어렵다. 따라서 규격 계약을 먼저 명시하고, 문제가 확인된 slot의 배치·파생본부터 수정하는 순서를 권장한다.

구현 시 기본 검증은 영향 범위의 unit/contract + typecheck/lint + 로컬 PC/모바일 렌더다. 배포 요청이 있으면 배포 도구의 최종 성공까지 확인한다. 운영 로그인·API·동일 화면 재검사는 별도 요청 또는 실제 운영 문제 없이 자동 확대하지 않는다.

## 8. 적용 전에 확정할 선택 — 아직 결정 아님

1. **역할별 교체 범위:** 프로필·세로·가로 분리 방향은 확인됐다. 각 role을 어떤 슬롯이 참조하는지, slot override를 어디에 허용할지는 구현 시 고정한다.
2. **가로 배너가 없는 셀럽:** 현재 hero 구성에서 contain/배경 fallback을 허용할지, 전용 가로 이미지를 필수로 받을지 결정한다. 모든 셀럽에게 새 사진 제출을 요구하기 전에 fallback부터 권장한다.
3. **포스터와 경품 사진:** 글자 포스터 전체 표시를 기본으로 하고 사진형 썸네일은 별도 crop 승인을 권장한다.
4. **기존 URL 이행:** 현재 공개 데이터는 유지하고 새 업로드·사진 수정부터 검증을 강제하는 방식을 권장한다.

이는 구현 과정의 선택지이며, 이번 요청을 마치기 위한 추가 승인 질문은 아니다. 제품 변경은 이 문서의 후속 작업이다.

## 9. 실제 화면 근거

| 화면 | PC 1440 | 모바일 390 | 확인 목적 |
|---|---|---|---|
| 홈 | [캡처](evidence/home-1440.png) | [캡처](evidence/home-390.png) | 동일 LIVE 포스터의2:1→4:5 crop 및 화질 |
| 이퓨 팬페이지 | [캡처](evidence/ifew-1440.png) | [캡처](evidence/ifew-390.png) | 전용 세로 hero를 넓은 영역에 사용하는 결과 |
| 제니 팬페이지 | [캡처](evidence/jenny-1440.png) | [캡처](evidence/jenny-390.png) | 새 CMS 세로 원본의 PC/mobile 구도 |
| LIVE 상세 | [캡처](evidence/live-1440.png) | [캡처](evidence/live-390.png) | 로딩 완료 후2:1 및 mobile contain |
| 이퓨 안내 | [캡처](evidence/guide-1440.png) | [캡처](evidence/guide-390.png) | 같은 포스터 전체 표시 사례 |

화면 캡처는 각 페이지 상단 viewport다. 모든 이미지·스크롤 위치·슬라이드를 시각 검수했다는 의미가 아니다. 측정 JSON의 naturalWidth/Height는 브라우저가 받은 리소스 기준이고 원본 크기는 `asset-dimensions.csv` 기준이다. 초기 LIVE 로딩 화면은 별도 재측정 스크립트로 보완했다. 단순 DOM 박스의 화면 교차 여부는 clipping/캐러셀 활성 상태를 완전히 나타내지 않으므로 실제 노출 판단은 캡처를 기준으로 한다.

## 10. 구현 근거 링크

- **I01 홈 셀럽 목록:** [apps/web/components/guest-home.tsx:318](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/guest-home.tsx:318); [apps/web/components/fan-ui/creator-portrait.module.css:2](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/creator-portrait.module.css:2)
- **I02 /celebrities 디렉터리:** [apps/web/components/celebrity-directory.tsx:133](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/celebrity-directory.tsx:133); [apps/web/components/celebrity-directory.module.css:18](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/celebrity-directory.module.css:18)
- **I03 홈 LIVE 행:** [apps/web/components/guest-home.tsx:367](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/guest-home.tsx:367); [apps/web/components/fan-ui/creator-avatar.module.css:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/creator-avatar.module.css:1)
- **I04 LIVE 목록 / 상세 / 프로필 온보딩:** [apps/web/features/live/ui/live-catalog-screen.tsx:144](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-catalog-screen.tsx:144); [apps/web/components/fan-ui/creator-avatar.tsx:10](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/creator-avatar.tsx:10)
- **I05 /c/[slug] 팬페이지:** [apps/web/components/celebrity-fan-page.tsx:68](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/celebrity-fan-page.tsx:68); [apps/web/features/fanpage/ui/fanpage.module.css:9](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/fanpage.module.css:9)
- **I06 MY 셀럽 선택:** [apps/web/features/my/ui/my-screen.tsx:189](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/my/ui/my-screen.tsx:189); [apps/web/features/my/domain/my-summary.ts:19](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/my/domain/my-summary.ts:19)
- **I07 /passports 소장 목록:** [apps/web/features/passport/ui/passport-screens.tsx:152](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/passport/ui/passport-screens.tsx:152); [apps/web/features/passport/ui/passport-screens.module.css:1092](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/passport/ui/passport-screens.module.css:1092)
- **I08 홈 Passport 아트:** [apps/web/features/passport/ui/passport-identity-artwork.tsx:14](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/passport/ui/passport-identity-artwork.tsx:14); [apps/web/features/passport/ui/passport-identity-artwork.module.css:17](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/passport/ui/passport-identity-artwork.module.css:17)
- **I09 LIVE 캘린더 이벤트:** [apps/web/features/live/ui/live-calendar-screen.tsx:326](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-calendar-screen.tsx:326); [apps/web/features/live/ui/live-calendar-screen.module.css:264](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-calendar-screen.module.css:264)
- **I10 캘린더 모달:** [apps/web/features/live/ui/live-calendar-screen.tsx:326](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-calendar-screen.tsx:326); [apps/web/features/live/ui/live-calendar-screen.module.css:301](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-calendar-screen.module.css:301)
- **I11 캘린더 주변 장식:** [apps/web/components/fan-calendar/calendar-art.tsx:11](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-calendar/calendar-art.tsx:11); [apps/web/components/fan-calendar/calendar-art.module.css:13](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-calendar/calendar-art.module.css:13)
- **E01 홈 메인 캐러셀:** [apps/web/components/live-hero-carousel.tsx:268](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/live-hero-carousel.tsx:268); [apps/web/components/guest-home.module.css:44](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/guest-home.module.css:44)
- **E02 홈 뱅크시 슬라이드:** [apps/web/components/live-hero-carousel.tsx:355](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/live-hero-carousel.tsx:355); [apps/web/components/guest-home.module.css:320](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/guest-home.module.css:320)
- **E03 /live/[slug] 상세:** [apps/web/features/live/ui/live-event-screen.tsx:1054](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-event-screen.tsx:1054); [apps/web/features/live/ui/live-event-screen.module.css:79](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-event-screen.module.css:79)
- **E04 홈 셀럽 카드 / 팬페이지 최근 LIVE:** [apps/web/features/fanpage/ui/home-panels.tsx:25](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/home-panels.tsx:25); [apps/web/features/fanpage/ui/fanpage.module.css:54](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/fanpage.module.css:54)
- **E05 LIVE 상세 영상 poster:** [apps/web/features/live/ui/live-event-screen.tsx:1069](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-event-screen.tsx:1069); [apps/web/features/live/domain/live-preview.ts:43](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/domain/live-preview.ts:43)
- **E06 팬페이지 LIVE 탭 패널:** [apps/web/features/fanpage/ui/home-panels.tsx:57](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/home-panels.tsx:57); [apps/web/features/fanpage/ui/fanpage.module.css:54](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/fanpage.module.css:54)
- **E07 팬페이지 래플 카드 / 대표 래플:** [apps/web/features/fanpage/ui/home-panels.tsx:36](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/home-panels.tsx:36); [apps/web/features/fanpage/ui/fanpage.module.css:61](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/fanpage.module.css:61)
- **E08 MY 래플 미리보기:** [apps/web/features/my/ui/my-screen.tsx:283](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/my/ui/my-screen.tsx:283); [apps/web/features/my/ui/my-screen.module.css:253](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/my/ui/my-screen.module.css:253)
- **G01 이퓨 가이드 / 홈 진입 카드:** [apps/web/components/fan-participation-guide/fan-participation-guide.tsx:85](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.tsx:85); [apps/web/components/home-entry-cards/home-entry-cards.module.css:20](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/home-entry-cards/home-entry-cards.module.css:20)
- **G02 엘리나 팬 참여 가이드:** [apps/web/components/fan-participation-guide/fan-participation-guide.tsx:83](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.tsx:83); [apps/web/components/fan-participation-guide/fan-participation-guide.module.css:63](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.module.css:63)
- **G03 팬 참여 가이드 LIVE 예시 카드:** [apps/web/components/fan-participation-guide/fan-participation-guide.tsx:102](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.tsx:102); [apps/web/components/fan-participation-guide/fan-participation-guide.module.css:102](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.module.css:102)
- **G04 팬 참여 가이드:** [apps/web/components/fan-participation-guide/fan-participation-guide.tsx:116](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.tsx:116); [apps/web/components/fan-participation-guide/fan-participation-guide.module.css:100](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.module.css:100)
- **S01 팬페이지 InstagramRecentActivity:** [apps/web/components/instagram-recent-activity.tsx:44](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/instagram-recent-activity.tsx:44); [apps/web/components/instagram-recent-activity.module.css:6](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/instagram-recent-activity.module.css:6)
- **U01 MY / 팬페이지 헤더 / 댓글 / 랭킹 / Passport 상세:** [apps/web/features/profile/ui/avatar.tsx:7](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/profile/ui/avatar.tsx:7); [apps/web/server/avatar/avatar-image.ts:94](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/avatar/avatar-image.ts:94)
- **U02 AvatarEditor:** [apps/web/features/profile/ui/avatar-editor.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/profile/ui/avatar-editor.tsx:1); [apps/web/server/avatar/avatar-route.ts:201](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/avatar/avatar-route.ts:201)
- **P01 인증 상세:** [apps/web/features/certification/ui/certification-detail-screen.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/certification/ui/certification-detail-screen.tsx:1); [apps/web/features/certification/ui/certification.module.css:309](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/certification/ui/certification.module.css:309)
- **M01 LIVE mission:** [apps/web/features/live/ui/live-mission-screen.tsx:132](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-mission-screen.tsx:132); [apps/web/features/live/ui/live-mission-screen.module.css:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/ui/live-mission-screen.module.css:1)
- **D01 홈 / 가이드 / 로그인 / US fanmeetings:** [apps/web/components/fan-participation-guide/fan-participation-guide.tsx:98](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-participation-guide/fan-participation-guide.tsx:98); [apps/web/features/passport/ui/passport-stamp-artwork.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/passport/ui/passport-stamp-artwork.tsx:1)
- **D02 MY / 팬페이지 / Passport:** [apps/web/features/rewards/ui/fan-tier-badge.tsx:13](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/rewards/ui/fan-tier-badge.tsx:13); [apps/web/features/fanpage/ui/fanpage.module.css:35](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/fanpage/ui/fanpage.module.css:35)
- **D03 로그인 전체화면:** [apps/web/components/login-page.tsx:483](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/login-page.tsx:483); [apps/web/components/login-page.module.css:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/login-page.module.css:1)
- **D04 공통 header/footer/focus flow:** [apps/web/components/fan-shell/fan-wordmark-link.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-shell/fan-wordmark-link.tsx:1); [apps/web/components/fan-shell/fan-site-footer.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-shell/fan-site-footer.tsx:1)
- **A01 셀럽 / LIVE 관리자:** [apps/web/components/admin/celebrity-manager.tsx:449](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/admin/celebrity-manager.tsx:449); [apps/web/components/admin/live-manager.tsx:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/admin/live-manager.tsx:1)
- **X01 이퓨 가이드 OpenGraph metadata:** [apps/web/app/pages/ifew-fan-guide/page.tsx:21](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/app/pages/ifew-fan-guide/page.tsx:21); —

추가 데이터/검증 근거:

- [apps/web/components/fan-ui/creator-image-config.ts:28](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/creator-image-config.ts:28)
- [apps/web/components/fan-ui/creator-image.tsx:19](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/creator-image.tsx:19)
- [apps/web/server/g5/content-cms.ts:17](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/g5/content-cms.ts:17)
- [apps/web/server/content/content-domain.ts:115](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/content/content-domain.ts:115)
- [apps/web/server/content/published-content-repository.ts:14](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/content/published-content-repository.ts:14)
- [apps/web/server/g5/live-manager-route.ts:33](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/g5/live-manager-route.ts:33)
- [apps/web/server/g5/benefit-admin-route.ts:75](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/g5/benefit-admin-route.ts:75)
- [apps/web/server/my/my-summary-repository.ts:14](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/my/my-summary-repository.ts:14)
- [apps/web/app/live/calendar/page.tsx:42](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/app/live/calendar/page.tsx:42)
- [apps/web/server/avatar/avatar-image.ts:6](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/avatar/avatar-image.ts:6)
- [apps/web/server/certification/certification-image.ts:4](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/server/certification/certification-image.ts:4)
- [apps/web/features/live/domain/live-preview.ts:27](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/features/live/domain/live-preview.ts:27)
- [supabase/migrations/20260726030000_live_event_previews.sql:1](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/supabase/migrations/20260726030000_live_event_previews.sql:1)
- [supabase/migrations/20260906130000_app_user_avatars.sql:243](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/supabase/migrations/20260906130000_app_user_avatars.sql:243)
- [supabase/migrations/20260908030000_fan_certification_manual.sql:50](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/supabase/migrations/20260908030000_fan_certification_manual.sql:50)
- [apps/web/components/fan-ui/public-image-policy.ts:3](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/fan-ui/public-image-policy.ts:3)
- [apps/web/next.config.ts:5](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/next.config.ts:5)
- [apps/web/components/celebrity-fan-page-layout.contract.test.ts:5](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/apps/web/components/celebrity-fan-page-layout.contract.test.ts:5)
- [.github/workflows/fan-design-system.yml:36](/Users/jewel/.codex/worktrees/byus-jenny-profile-20260911/.github/workflows/fan-design-system.yml:36)

기존 문서: `docs/design/creator-profile-photo-guidelines.md`, `docs/design/creator-hero-photo-sources-20260906.md`, `docs/design/creator-hero-image-sources.json`. 기존 문서의 의도·제작값과 현재 구현을 대조했으며, 이 문서로 제품 정책이 자동 변경되는 것은 아니다.

## 11. 산출물 검증 기록

- [x] 현재 기준 commit의 직접 사진 소비 경로·공통 컴포넌트·CMS/private 업로드 경계 매핑.
- [x] 34개 사용처를 편집 가능한 CSV로 저장.
- [x] 로컬 래스터109개와 공개 원격 원본8개 metadata 저장; 현재 노출 여부와 구분.
- [x] 공개 5개 경로 × 2개 viewport 캡처 및 주요 사진 영역 실측.
- [x] 문서/CSV 행 수·로컬 링크·소스 파일 존재 검사.
- [ ] 제안한 slot/schema/lint/publish gate 실제 구현 — **이번 작업 범위 밖**.
- [ ] 인증 화면·실제 SNS 미디어·관리자·운영 재검증 — **미실시**.

## 12. 승인 후 구현·배포 진행 기록

2026-09-11 후속 요청으로 위 제안을 구현·배포하는 범위가 승인됐다. 앞 절의 ‘이번 작업 범위 밖’은 최초 문서 조사 시점의 경계다.

- [x] 최신 main `d8d3676`에서 별도 worktree 생성, 기존 사용자 변경 보존.
- [x] 구조 계획과 독립 권한·데이터 검토. 대표·세로·가로 및 행사 사진을 기존 콘텐츠 이력과 분리.
- [x] 기본 회귀 5개 파일·24개 테스트 통과.
- [x] 검증된 이미지 등록, 역할별 원자적 적용, 충돌·삭제 버전 및 공개 projection 구현.
- [x] CMS 역할 편집기와 공개 화면 slot 연결.
- [x] 권한·DB 회귀, 타입·lint·관련 테스트, 로컬 PC/모바일 렌더 확인.
- [x] 운영 additive migration 성공 및 웹 배포 최종 성공.

구도는 편집기 안에서 수정하고 ‘적용’ 시에만 공개 연결을 바꾼다. 최초 적용도 revision=0부터 보호하며 제거는 tombstone을 남긴다. 사진 등록 시 검증한 bytes를 불변 hash 경로에 저장한다. 신규 콘텐츠는 초안 생성 후 역할을 적용하고 공개한다. 기존 LIVE 일정·상태·참여 이력과 개인 아바타·증빙은 보존한다. 운영 검증을 자동 확대하지 않는다.


### 구현 검증 결과

- 관련 통합 회귀: 62개 파일 / 441개 테스트 통과. 마지막 모바일 포스터 위치 보정 후 사진·캐러셀 2개 파일 / 9개 테스트 재통과.
- TypeScript, 전체 웹 ESLint, Next.js 프로덕션 빌드 통과.
- 로컬 공개 화면: 홈, 제니·박명호·이퓨 팬페이지, LIVE 상세, 캘린더를 1440/390px에서 실제 렌더. 12개 화면 HTTP 200, 대상 사진 디코딩 및 가로 넘침 없음 확인. 모바일 가로 포스터 fallback은 위쪽에 전체 표시해 하단 UI 문구와 분리.
- CMS: 실제 편집기 컴포넌트를 로컬에서 렌더하고 관리자 HTTP만 테스트 응답으로 대체해 업로드→구도 승인→역할 적용을 1440/390px에서 확인. 다른 역할 revision 보존과 실제 슬롯 비율 확인. 운영 계정으로 CMS 사진을 변경한 검증은 아니다.
- 개발 DB: migration과 SQL 권한·CAS·tombstone·null 입력·감사 원자성·종료 LIVE 조회 계약을 BEGIN/ROLLBACK으로 실행해 통과. 이후 신규 migration만 적용.
- 운영 DB: 신규 migration `20260911034700_public_image_assets_and_roles` 적용 성공. 기존 제니·박명호의 사진 URL·위치·게시 상태가 전후 동일함을 확인. 개인 아바타·증빙 테이블과 기존 LIVE 행 수정 없음.
- Supabase 보안 Advisor 커넥터는 권한 부족으로 조회 불가. 새 테이블/RPC의 접근 권한과 RLS는 SQL 계약으로 별도 확인.
- 기존 원본 URL 필드는 호환 데이터로 남기며 저장된 콘텐츠의 CMS 화면에서는 변경을 잠근다. 새 이미지 역할 API가 검증·적용을 담당한다. SNS·래플·개인 이미지 저장 체계의 전면 이행은 포함하지 않았다.

증거: `implementation-evidence/{public-proof.json,cms-proof.json,database-proof.json}` 및 같은 폴더의 PC/모바일 캡처. 초기 조사와 구현 후 증거는 폴더를 구분했다.


## 2026-09-11 하위 화면 역할 전달 보강

사용자 기준: **상위 역할군에 속한 하위 컴포넌트가 역할별 사진 전달에서 빠지면 안 된다.** 서로 다른 역할에 같은 원본을 강제하지 않는다.

- [x] `CreatorImage`, `CreatorAvatar`, `EventPhoto`의 `photos` 입력을 필수로 변경. 아직 역할을 등록하지 않은 레거시 데이터만 `undefined`를 명시적으로 전달한다.
- [x] 용도 → 슬롯 → 역할을 `creatorPresentationSlots`와 `imageSlots`에서 결정. 사진 소스와 대체 텍스트가 같은 역할 매핑을 사용한다.
- [x] 온보딩 셀럽 선택에 상위 `celebrity.image.photos`와 위치 전달.
- [x] 엘리나·이퓨 가이드의 작은 사진은 `CreatorAvatar` / `profile` 사용. 가이드의 큰 인물 사진과 홈 인물 카드는 `portrait` 사용.
- [x] 홈·이퓨 가이드 행사 배너 및 공유 이미지에 LIVE `poster` 역할 전달. 가이드 서버 읽기는 요청 내에서만 공유하여 수정 후 영구 캐시에 남지 않게 한다.
- [x] 셀럽 소개의 최근 LIVE 카드에 등록된 행사 포스터 사용. 활성 영상 미리보기는 영상 파생 자산으로 별도 유지한다.
- [x] 캘린더 API가 공개 LIVE → 공개 셀럽 연결을 배치 조회하여 셀럽 역할 사진과 위치를 자체 제공. 별도 화면에서 목록을 다시 합쳐야만 이미지가 보강되는 의존성 제거.
- [x] 상위 역할 사진 교체 → 하위 실제 이미지 변경 회귀 검사: 모든 CreatorImage 용도, 홈 가이드, 두 참여 가이드, 온보딩.
- [x] 공개 데이터 조회, 명시적 역할 제거(null), 역할 읽기 실패, 최근 LIVE 영상 프리뷰 우선순위 검사.
- [x] 로컬 실제 화면 확인: 홈·두 가이드 PC1440 / 모바일390, 캘린더 PC. 상위 사진 교체 검증·공개 조회 검증·타입 검사·ESLint 통과.
- [x] 최종 production 빌드 통과. 배포 완료 기준은 main 푸시 후 해당 커밋의 Vercel `READY` 확인이다.

공유 프로필은 `profile`, 세로 인물 사진은 `portrait`, 가로 인물 사진은 `landscape`, 행사 포스터는 LIVE의 `poster`에 속한다. 경품 이미지·장식·개인 아바타·영상 파생 프리뷰는 셀럽 역할 사진으로 바꾸지 않는다. 새 하위 화면은 공통 렌더러에 상위의 전체 `photos`를 전달하고, 등록된 역할 소스를 화면 내부의 고정 주소로 덮어쓰지 않는다.


### 배포 완료

- 커밋: `999bc2644661b62bb19ee2c6881e5cfca9556567` (`main` push 완료)
- Vercel: `dpl_3nE6joHxiYmq3CPKvwtMPrti287t` — **READY**
- 운영 별칭: https://byus.kr
- 배포 기록: https://vercel.com/sallylab/byus/3nE6joHxiYmq3CPKvwtMPrti287t
- 기본 완료 범위인 로컬 검증과 배포 최종 상태까지 확인했다. 배포 후 운영 화면·로그인·동일 API 재검사를 추가로 수행하지 않았다.

### 모바일 홈 포스터 여백 보정 (2026-09-11)

모바일 `event.home.mobile`에 승인된 `portrait` cover 구도가 없는 LIVE는 전체 포스터를 표시하되, 고정 4:5 캔버스의 빈 공간을 남기지 않는다. 원본 비율의 사진 아래에 LIVE 정보를 흰 배경의 일반 흐름으로 배치하고 캐러셀 높이를 현재 슬라이드에 맞춘다. 사진 자체에 모서리 라운드를 적용하며, 사진과 정보 뒤에 검은 패널을 남기지 않는다. 제목·일정은 밝은 배경에 맞는 글자색을 사용한다. 이전·다음 컨트롤은 사진 영역 안에 배치한다. 등록된 세로형 사진의 승인된 cover 구도와 데스크톱 2:1 표시는 유지한다. 역할 등록이 없다는 이유로 다른 사진을 자동 crop하거나 포스터의 글자를 잘라내지 않는다.
