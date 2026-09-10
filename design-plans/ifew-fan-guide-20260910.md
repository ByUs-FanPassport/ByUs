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
- 이퓨 사진은 기존 `CreatorImage`의 `collection` 표현을 사용해 지정 원본의 구도를 유지한다.
- 홈에 이퓨 카드와 기존 엘리나·미국 팬미팅 카드를 함께 제공한다.
- 공통 가이드의 링크 색상 초기화가 키보드 접근용 본문 바로가기의 흰 글자를 덮던 문제를 가이드 범위 안에서 수정했다.

## 검증

- 관련 테스트 5개 파일, 61개 통과. TypeScript, 대상 ESLint, production build, diff 검사 통과.
- 이퓨 KO/EN × 360/390/768/1440, 엘리나 KO/EN × 390/1440: 12개 화면에서 이미지·줄바꿈·넘침·키보드 본문 바로가기·언어 전환·섹션 이동 확인. axe 위반 0건.
- 비로그인 홈 KO/EN × 390/1440: 카드 3개 노출, 이퓨 가이드 → LIVE 및 혜택 상세 이동 확인. 예약·응모·외부 등록 제출은 하지 않았다.
- 근거: `artifacts/ifew-fan-guide/qa.json`, `build.log`, 화면 PNG.
