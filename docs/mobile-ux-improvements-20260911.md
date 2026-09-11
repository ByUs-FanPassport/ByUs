# 모바일 UI/UX 개선 · 2026-09-11

사용자가 승인한 모바일 감사 6개 항목을 구현했다. 최신 main의 세로형 LIVE 배너 변경을 통합했으며 예약·응모·CMS 데이터는 수정하지 않았다.

| 항목 | 적용 내용 |
| --- | --- |
| 팬페이지 대비 | 주요 CTA·달력 날짜는 `#ce0066`, 보조 본문은 `#6b6570`을 역할별 토큰으로 사용한다. 흰색 버튼 글자 대비는 3.77446:1에서 5.50282:1로 개선했다. |
| 참여 가이드 재생 | 정지 버튼을 항상 노출하고 44×44px 터치 영역을 확보했다. 모바일 터치가 마우스 호버를 남겨 재시작을 막던 문제도 해결했다. |
| 최애 목록 탐색 | 검색·정렬을 한 줄로 묶고 모바일 카드의 이름·직군·LIVE 일정·만나보기 문구를 사진 위에 배치했다. 이미지 비율, 소유·팬 단계 배지, 필터 동작은 유지했다. |
| 홈 정보 순서 | 모바일에서 최애 목록을 가이드보다 먼저 배치하고 로그인은 Google 버튼 하나로 정리했다. 데스크톱 패스포트 진입은 유지한다. |
| MY 최애 선택 | 선택 상태를 계정별 셸에 유지해 언어 전환 중 로딩·목록 재정렬로 초기화되지 않도록 했다. 삭제된 최애는 첫 항목으로, 계정 변경은 새 계정 기준으로 초기화한다. |
| LIVE 목록 행동 | 모바일에서도 실제 도착 화면에 맞는 `상세 보기` / `View details`를 표시한다. 이벤트 제목·새 창 안내는 접근 가능한 이름에 유지한다. |

검증 기록은 `artifacts/mobile-ux-fixes-20260911/`에 보관한다. 실제 운영 계정의 인증·예약·응모는 이번 검증에서 수행하지 않는다. 로컬 데이터와 mock MY 결과를 운영 API 검증으로 해석하지 않는다.

- [x] 변경 관련 테스트 7개 파일, 114개 통과.
- [x] 타입 검사 및 변경 TSX·테스트 ESLint 통과.
- [x] 공개 화면 4종 × KO/EN × 360·390·430px 초기 로컬 렌더: 가로 넘침 없음. 화면·언어별 axe 검사 8건 모두 위반 없음.
- [x] 정지 후 3.3초 동안 슬라이드 유지, 재시작 후 이동, reduced-motion 비활성화: KO/EN 터치 검증 통과.
- [x] 390px 최애 첫 이름 y444, 행동 문구 y519: 하단 메뉴 위 첫 화면에 노출.
- [x] 주요 CTA·LIVE 보조 문구·빈 상태·달력 날짜 직접 계산 대비 5.025~5.503:1.
- [x] 최신 main 통합 후 production build 통과. 홈 KO/EN × 3개 폭과 데스크톱 렌더 확인, 가로 넘침·axe 위반 없음.
- [x] 실제 MY 컴포넌트와 CSS에 mock 인증·응답을 사용한 브라우저 검증: KO→EN loading→재정렬 선택 유지, 삭제 fallback, owner 변경 초기화 통과. KO/EN × 3개 폭에서 넘침·런타임 오류 없음.

배포는 main 푸시 후 해당 SHA의 Vercel 최종 상태를 별도 확인한다. 운영 UI 반복 검사는 요청 범위에 포함하지 않는다.


## 2026-09-12 전체 모바일 검토

팬·일반 방문자용 45개 페이지 파일과 연결된 탭·모달 검토를 마쳤다. 시작 커밋은 `6d423f8`, 모바일 개선은 `5511e7f`에 기록했고, 최신 main의 영어 문구·LIVE 개편을 `a044a1e`로 통합했다. 이 작업의 변경은 UI·CSS와 관련 테스트이며, 운영 API·DB·인증 및 보상 정책은 변경하지 않았다.

- [x] 45개 경로와 내부 탭·모달 목록화 및 코드 매핑
- [x] baseline-ui + fixing-accessibility 기준과 DESIGN.md 확인
- [x] 390px 대표 렌더 및 360/430px Chromium/WebKit 확인
- [x] 미션 Focus Header 개선안 독립 검토, 계정·안내·팬 화면 이미지 독립 검토
- [x] 입력·포커스·닫기·실패 복구와 1440px 회귀 확인
- [x] 최신 main 통합 및 변경 관련 검사 통과

배포 실행 결과는 아래 증거 폴더의 `deployment.json`에 main SHA와 Vercel 자동 운영 배포 시작 상태로 기록한다. 최종 배포 성공·운영 동작 검증과 구분한다.

### 확인한 문제와 조치

| 영역 | 확인한 문제 | 조치·근거 |
|---|---|---|
| 미션 | 공통 집중형 화면 헤더·언어 전환 부재, 기본 링크·폰트, 이미지와 긴 선택지의 폭 보호 부족 | 기존 FocusFlowHeader와 skip target 적용. 880px 폭 유지, 선택지 grid/줄바꿈·미디어 max-width, 44px 이상 조작 영역. GET/POST·idempotency·보상 문구 유지 |
| 배송지·문의 입력 | 420px 높이에서 주소 입력이 하단 메뉴 뒤에 가려짐 | FanAppFrame 입력 스크롤 여백으로 상단 84px·하단 80px+safe-area 확보. Chromium/WebKit 재검증 |
| 국가 선택 | 팝업의 아래쪽 항목에 하단 메뉴가 클릭을 가로챔 | 공통 dropdown 층(35) 사용. 두 엔진에서 같은 좌표의 hit-test가 nav → listbox로 변경 |
| 국가 검색 | 높이 42px, 글자 15px | 44px·16px로 확대 |
| 아바타 확대 | range 입력 높이 16~17px | 조작 영역 44px. 사진 선택·확대·모달 스크롤/포커스 확인 |
| 협업 문의 | WebKit select가 min-height 48px에도 24px로 렌더됨 | 명시적 height 48px 적용, 양 엔진 재검증 |
| 안내 문의 | 이메일 버튼 높이 35px | 공통 스타일 최소 44px |
| 혜택 필터 | select 글자 15px | 16px |
| 팬페이지 댓글 | 등록 버튼 36px, textarea 글자 14px | 버튼 44px·입력 16px |
| 팬페이지 달력 | 360px에서 날짜 폭 40.86px | 389px 이하 카드 좌우 여백 축소로 날짜 44px 이상 확보 |
| 래플 | 모두 사용 36px, 수량 입력 31px | 두 조작 영역 44px |
| 재시도 | 미션 25px·팬 활동 26.8px | 미션은 FanAction 재사용, 팬 활동은 44px 최소 영역 |

스탬프 상세의 초기 컨테이너 포커스는 오류로 처리하지 않았다. 실제 Tab/Shift+Tab 트랩과 Escape 닫기·스크롤 복구가 통과했으며 포커스 표시를 제거하지 않았다.

### 검증 범위와 근거

증거 폴더: `/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit`. `index.html`에서 경로별 최신 화면을 열 수 있다. 실패한 초기 캡처와 수정 후 자료를 함께 보존했다.

- 390px: 계정·안내 27건 및 팬 20경로 × KO/EN × guest/member 80건. 공지 상세는 같은 작업에서 검증한 기존 390/1440px 18건도 재사용했다. 실제 wrapper가 다른 인증/래플 경로는 올바른 wrapper로 고친 뒤 별도 확인했다.
- 360/430px 양 엔진: 98건. Vite fixture 수정 중 발생한 context reload 2건은 `retry.json`으로 대체했다. 계정 auth/guest 추가 22건, 로딩·빈값·실패 96건을 확인했다. 실패 상태에서 발견한 작은 재시도 버튼은 `final-fixes.json`의 통과 결과로 대체했다.
- 수정 화면: 390/360/1440px 24건. 최신 main의 영어 문구와 LIVE 배치를 통합한 후 영향을 받는 렌더 53건에서 런타임 오류·가로 넘침·44px 미만 주요 폼/버튼 탐지 0건.
- 실제 로컬 조작: 팬 16건(예약·출석·미션·설문 자동 저장/완료·퀴즈·래플, 실패/재시도), 계정 16건(오류 입력 보존·축소 viewport 입력 가림·모달 양방향 포커스/닫기), 아바타·국가·협업 문의 14건, 팬 내부 모달/툴팁 5건. 국가 선택 레이어는 양 엔진 전후 hit-test 4건.
- 내부 탭: 팬 홈·인증·래플·리더보드 및 legacy notice/live, 인증 missions/history. 내부 UI: 캘린더 전체보기, 예약 dialog, 첫 좋아요 완료, 다음 단계 안내, 팬 등급 tooltip, 아바타 선택·crop, 국가 검색·선택, 문의 입력·완료·실패, 래플 확인, 혜택/스탬프/로그인 overlay.
- 캘린더 전체보기 trigger는 1024px 이상에서만 노출된다. 열린 실제 Dialog를 390px로 줄여 반응형 동작을 확인했다. 모바일에 없는 버튼을 있다고 주장하지 않는다.
- 홈 지연 이미지 2건은 decode 후 두 엔진에서 정상 확인했다(`images.json`). 인증 증빙의 깨진 이미지는 텍스트를 image Blob으로 만든 fixture 오류였으며 실제 로컬 이미지 응답으로 수정했다. 제품 결함으로 집계하지 않는다.

검증은 실제 소스 컴포넌트/CSS와 모의 Next navigation·Privy·API로 수행했다. 회원 데이터와 모든 POST/PUT/PATCH는 로컬 fixture에 한정한다. 실제 Next 라우터의 intercepted navigation, 실기기 키보드, 운영 인증/배포 후 UI 검증으로 해석하지 않는다. 키보드 가림 확인은 420px 높이로 줄인 브라우저 viewport의 입력·스크롤 검사다.

### 자동 검사

- `npm run typecheck`: 통과.
- 변경 TSX·테스트 ESLint 및 `git diff --check`: 통과.
- 필수 shared UI CI와 관련 화면 검사 36개 파일·305개 테스트: 최신 main 통합 후 304개 통과, 기존 LIVE 테스트 1개 실패. 개편 전 collectible 외부 간격·inset 비교를 요구하던 오래된 기대를 현재 Fan Code padding/notice 계약으로 정리했고 해당 파일 5개 테스트가 통과했다. 나머지 35개 파일의 성공 근거는 재사용했다.
- 이전 notice 9개 테스트, 이전 모바일 114개 테스트와 실제 계정 선택 유지 검증은 관련 입력이 유지된 범위에서 재사용했다. 운영 전송·보상 수령을 반복하지 않았다.

### 45개 경로별 결과

| 경로 | 상태 | 대표 근거 |
|---|---|---|
| `/@modal/(.)benefits/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-011.png) |
| `/@modal/(.)login` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-018.png) |
| `/@modal/(.)stamps/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-012.png) |
| `/@modal/[...catchAll]` | 검토 완료 | null 반환 코드 확인 |
| `/benefits/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-010.png) |
| `/benefits` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-009.png) |
| `/c/[slug]/certifications/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-044.png) |
| `/c/[slug]/certifications` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-043.png) |
| `/c/[slug]/leaderboard` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-047.png) · 실제 redirect와 도착 탭 확인 |
| `/c/[slug]/notices/[noticeSlug]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-048.png) |
| `/c/[slug]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-034.png) |
| `/c/[slug]/raffles/[benefitId]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-046.png) |
| `/c/[slug]/raffles` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-045.png) |
| `/c/[slug]/verify` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-040.png) |
| `/c/[slug]/verify/questions` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-041.png) |
| `/c/[slug]/verify/result` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-042.png) |
| `/celebrities` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-028.png) |
| `/guide` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-019.png) |
| `/live/[slug]/missions` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-052.png) |
| `/live/[slug]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-051.png) |
| `/live/[slug]/survey` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-033.png) |
| `/live/calendar` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-030.png) |
| `/live` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-029.png) |
| `/login` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-017.png) |
| `/my/inquiries/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-003.png) |
| `/my/inquiries` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-002.png) |
| `/my` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-000.png) |
| `/my/raffles` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-001.png) |
| `/my/rewards/[winnerId]/recipient` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-004.png) |
| `/notifications` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-015.png) |
| `/onboarding/profile` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-014.png) |
| `/` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-027.png) |
| `/pages/creator-onboarding` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-022.png) |
| `/pages/elina-fan-guide` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-025.png) |
| `/pages/ifew-fan-guide` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-026.png) |
| `/pages/partners` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-023.png) |
| `/pages/us-fanmeetings` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-024.png) |
| `/passports/[id]/issuance` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-007.png) |
| `/passports/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-006.png) |
| `/passports` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-005.png) |
| `/privacy` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-020.png) |
| `/settings/kakao/callback` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-016.png) |
| `/settings` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-013.png) |
| `/stamps/[id]` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-008.png) |
| `/terms` | 검토 완료 | [렌더](/Users/jewel/.codex/visualizations/2026/09/11/01a090ee-8db3-7803-8d6c-a79f55a66dd8/mobile-ux-audit/integration-021.png) |
