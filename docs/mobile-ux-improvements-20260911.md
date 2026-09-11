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

사용자 요청: 팬·일반 방문자용 모바일 UI/UX 전체 검토, 확인된 문제 개선, 배포. 관리자·운영 데이터 쓰기·인증 및 보상 정책 변경은 제외한다. 작업 브랜치 `codex/mobile-ux-audit-20260912`, 시작 커밋 `6d423f8`.

진행 순서: 경로·탭·모달 목록화 → 실제 컴포넌트와 로컬 모의 응답으로 390px 기준 렌더 검토 → 확인된 문제만 수정 → 360/430px 및 Chromium/WebKit 핵심 동선·KO/EN·상태 검증 → 1440px 회귀와 관련 검사 → main 푸시·정확한 SHA의 자동 운영 배포 시작 확인. 브라우저 엔진 검증과 실제 모바일 기기 검증을 구분한다.

- [x] 현재 변경 없음과 최신 origin/main 일치 확인.
- [x] 팬·계정 영역 읽기 전용 코드 매핑 완료.
- [x] baseline-ui + fixing-accessibility 선택; 기존 DESIGN.md/한국어 문구 보존.
- [ ] 모든 팬 경로·탭·모달 렌더 근거 확보.
- [ ] 확인된 문제 우선순위와 수정 계획 독립 검토.
- [ ] 개선·동작 검증·관련 테스트·타입 검사.
- [ ] 푸시·자동 운영 배포 시작 확인.

### 경로 목록

| 경로 | 화면/라우팅 근거 | 검토 상태 |
|---|---|---|
| `/@modal/(.)benefits/[id]` | `apps/web/app/@modal/(.)benefits/[id]/page.tsx` | 대기 |
| `/@modal/(.)login` | `apps/web/app/@modal/(.)login/page.tsx` | 대기 |
| `/@modal/(.)stamps/[id]` | `apps/web/app/@modal/(.)stamps/[id]/page.tsx` | 대기 |
| `/@modal/[...catchAll]` | `apps/web/app/@modal/[...catchAll]/page.tsx` | 대기 |
| `/benefits/[id]` | `apps/web/app/benefits/[id]/page.tsx` | 대기 |
| `/benefits` | `apps/web/app/benefits/page.tsx` | 대기 |
| `/c/[slug]/certifications/[id]` | `apps/web/app/c/[slug]/certifications/[id]/page.tsx` | 대기 |
| `/c/[slug]/certifications` | `apps/web/app/c/[slug]/certifications/page.tsx` | 대기 |
| `/c/[slug]/leaderboard` | `apps/web/app/c/[slug]/leaderboard/page.tsx` | 대기 |
| `/c/[slug]/notices/[noticeSlug]` | `apps/web/app/c/[slug]/notices/[noticeSlug]/page.tsx` | 대기 |
| `/c/[slug]` | `apps/web/app/c/[slug]/page.tsx` | 대기 |
| `/c/[slug]/raffles/[benefitId]` | `apps/web/app/c/[slug]/raffles/[benefitId]/page.tsx` | 대기 |
| `/c/[slug]/raffles` | `apps/web/app/c/[slug]/raffles/page.tsx` | 대기 |
| `/c/[slug]/verify` | `apps/web/app/c/[slug]/verify/page.tsx` | 대기 |
| `/c/[slug]/verify/questions` | `apps/web/app/c/[slug]/verify/questions/page.tsx` | 대기 |
| `/c/[slug]/verify/result` | `apps/web/app/c/[slug]/verify/result/page.tsx` | 대기 |
| `/celebrities` | `apps/web/app/celebrities/page.tsx` | 대기 |
| `/guide` | `apps/web/app/guide/page.tsx` | 대기 |
| `/live/[slug]/missions` | `apps/web/app/live/[slug]/missions/page.tsx` | 대기 |
| `/live/[slug]` | `apps/web/app/live/[slug]/page.tsx` | 대기 |
| `/live/[slug]/survey` | `apps/web/app/live/[slug]/survey/page.tsx` | 대기 |
| `/live/calendar` | `apps/web/app/live/calendar/page.tsx` | 대기 |
| `/live` | `apps/web/app/live/page.tsx` | 대기 |
| `/login` | `apps/web/app/login/page.tsx` | 대기 |
| `/my/inquiries/[id]` | `apps/web/app/my/inquiries/[id]/page.tsx` | 대기 |
| `/my/inquiries` | `apps/web/app/my/inquiries/page.tsx` | 대기 |
| `/my` | `apps/web/app/my/page.tsx` | 대기 |
| `/my/raffles` | `apps/web/app/my/raffles/page.tsx` | 대기 |
| `/my/rewards/[winnerId]/recipient` | `apps/web/app/my/rewards/[winnerId]/recipient/page.tsx` | 대기 |
| `/notifications` | `apps/web/app/notifications/page.tsx` | 대기 |
| `/onboarding/profile` | `apps/web/app/onboarding/profile/page.tsx` | 대기 |
| `/` | `apps/web/app/page.tsx` | 대기 |
| `/pages/creator-onboarding` | `apps/web/app/pages/creator-onboarding/page.tsx` | 대기 |
| `/pages/elina-fan-guide` | `apps/web/app/pages/elina-fan-guide/page.tsx` | 대기 |
| `/pages/ifew-fan-guide` | `apps/web/app/pages/ifew-fan-guide/page.tsx` | 대기 |
| `/pages/partners` | `apps/web/app/pages/partners/page.tsx` | 대기 |
| `/pages/us-fanmeetings` | `apps/web/app/pages/us-fanmeetings/page.tsx` | 대기 |
| `/passports/[id]/issuance` | `apps/web/app/passports/[id]/issuance/page.tsx` | 대기 |
| `/passports/[id]` | `apps/web/app/passports/[id]/page.tsx` | 대기 |
| `/passports` | `apps/web/app/passports/page.tsx` | 대기 |
| `/privacy` | `apps/web/app/privacy/page.tsx` | 대기 |
| `/settings/kakao/callback` | `apps/web/app/settings/kakao/callback/page.tsx` | 대기 |
| `/settings` | `apps/web/app/settings/page.tsx` | 대기 |
| `/stamps/[id]` | `apps/web/app/stamps/[id]/page.tsx` | 대기 |
| `/terms` | `apps/web/app/terms/page.tsx` | 대기 |
