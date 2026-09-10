# 이퓨 100일 LIVE 참여 가이드

## 범위와 상태

- 요청: 엘리나 참여 가이드와 같은 구조로 이퓨의 토요일 LIVE 상세페이지 제작.
- 완료: 한국어·영어 페이지, 비로그인 홈 진입 카드, 공유 메타데이터, 로컬 검증.
- 경로: `/pages/ifew-fan-guide?locale=ko` 및 `?locale=en`.
- 운영 배포는 아직 수행하지 않았다.

## 확인한 행사 정보

- 2026년 9월 12일(토) 08:00–13:00, 한국 시간(KST, UTC+9).
- TikTok 활동 100일 기념 축하 LIVE, 계정 `@ifewknow`.
- 뱅크시 전시 티켓: 10명 추첨, 1인 1장. 이퓨 응모권으로 별도 응모한다.
- 응모 마감: 2026년 9월 20일(일) 00:00 KST. 9월 19일이 끝나는 시각이다.
- 예약·시청은 자동 응모가 아니다. ByUs 예약과 TikTok 이벤트 등록도 별개다.
- 현재 LIVE는 `missionsAvailable: false`이며, 미션 API는 `MISSION_UNAVAILABLE`을 반환한다. 가이드에서 출석·퀴즈·미션 보상을 약속하지 않는다.

근거: 메인 체크아웃 `docs/ifew-100-days-live.md`의 사용자 제공 행사 자료, 공개 LIVE `/api/live-events/ifew-100-days-tiktok-20260912`, 혜택 `/api/benefits/41ae7883-098e-49f2-9229-4f6962160141`. 조회 응답은 `artifacts/ifew-fan-guide/*-source.json`에 보존했다.

## 구현

- `FanParticipationGuide`에서 엘리나·이퓨 화면 구조와 스타일을 공유하고, 카피와 실제 이동 목적지를 구분한다.
- 팬 인증 → LIVE 예약 → TikTok LIVE 참여 → 뱅크시 티켓 응모 순서로 안내한다.
- 대표 이미지·홈 카드·Open Graph는 기존 `ifew 100 Days!` 행사 배너를 재사용한다. 원본의 2:1 비율로 전체 구도를 보존하며, 모바일 상세에서는 안내문보다 먼저 배치한다.
- LIVE 안내 카드의 작은 프로필은 기존 `CreatorImage`의 `collection` 표현을 사용한다.
- 홈에 이퓨 카드와 기존 엘리나·미국 팬미팅 카드를 함께 제공한다.
- 공통 가이드의 링크 색상 초기화가 키보드 접근용 본문 바로가기의 흰 글자를 덮던 문제를 가이드 범위 안에서 수정했다.

## 검증

- 관련 테스트 5개 파일, 61개 통과. TypeScript, 대상 ESLint, production build, diff 검사 통과.
- 이퓨 KO/EN × 360/390/768/1440, 엘리나 KO/EN × 390/1440: 12개 화면에서 이미지·줄바꿈·넘침·키보드 본문 바로가기·언어 전환·섹션 이동 확인. axe 위반 0건.
- 비로그인 홈 KO/EN × 390/1440: 카드 3개 노출, 이퓨 가이드 → LIVE 및 혜택 상세 이동 확인. 예약·응모·외부 등록 제출은 하지 않았다.
- 근거: `artifacts/ifew-fan-guide/qa.json`, `build.log`, 화면 PNG.

## 행사 배너 후속 반영

- 사용자 요청: 기존 100 LIVE 이벤트 이미지를 활용한다.
- 원본: 메인 체크아웃 `docs/assets/ifew-100-days/ifew-100-days-horizontal-banner.png`.
- 게시된 동일 행사 자산: `cms-assets/lives/ifew-100-days/banner-9dddada89193dd87.png`. 재생성·이미지 편집 없이 사용했다.
- 후속 검증: 관련 테스트 10개, 대상 ESLint, production build 통과. 상세 KO/EN × 360/390/768/1440 및 홈 KO/EN × 390/1440의 12개 로컬 브라우저 사례에서 전체 2:1 이미지, 가독성, 메타 이미지, 링크 이동을 확인했다. axe 위반 0건. 실제 모바일 기기 검증은 수행하지 않았다.
- 최신 화면 근거: `artifacts/ifew-event-artwork/qa.json`, `guide-*.png`, `home-card-*.png`, `build.log`.
