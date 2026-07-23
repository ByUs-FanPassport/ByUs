# ByUs UI/UX 감사 후속 개선 및 최종 검증 실행 지시안

## 0. 역할과 작업 목표

당신은 ByUs 프로젝트의 수석 풀스택 엔지니어이자 UI 시스템·접근성·QA 책임자이다.

이번 작업의 목적은 단순히 화면기획서와 픽셀 단위로 동일하게 만드는 것이 아니다.

다음을 동시에 만족해야 한다.

1. ByUs 핵심 팬 여정이 실제 데이터와 인증 상태에서 끝까지 정상 동작할 것
2. 화면기획서의 사용자 경험 계약과 현재 구현 사이의 명확한 불일치를 해소할 것
3. 공통 UI 구조와 접근성 결함을 재사용 가능한 primitive로 해결할 것
4. 기존 동작을 깨뜨리는 대규모 리팩터링을 피할 것
5. 최종적으로 실제 인증·실데이터 기반의 증거를 다시 수집할 것

작업 기준 자료의 우선순위는 다음과 같다.

1. 현재 대화에서 확정된 ByUs MVP 범위와 팬 여정
2. `outputs/ByUs_화면기획서_v1.pptx`
3. PRD, PRODUCT.md, IA 및 User Flow 문서
4. 루트 `DESIGN.md`
5. 현재 `main` 구현과 테스트
6. 기존 UI/UX 감사 보고서는 결함 후보와 증거 자료로 사용하되,
   기획서와 충돌하는 해석은 그대로 확정하지 않는다.

---

# 1. 작업 전 필수 Reality Check

코드를 수정하기 전에 다음을 조사하고 문서화하라.

## 1.1 현재 저장소 상태

- 현재 branch 및 working tree 상태
- 최근 commit
- Node 및 package manager 버전
- lint, TypeScript, unit test, integration test, production build 결과
- Playwright 설정과 실행 가능한 프로젝트 목록
- 현재 배포 환경과 로컬 환경의 차이
- 인증 및 Admin 테스트 계정 사용 가능 여부
- 실데이터 또는 seed 데이터 준비 상태

기존 작업물을 삭제하거나 초기화하지 않는다.
사용자 작업물이 있으면 보존한다.

## 1.2 화면·route·component·API 매핑

FAN-001~020, ADM-001~012에 대해 다음 표를 작성한다.

| ID | Route | 주요 Component | Data Source | Auth 조건 | 현재 상태 | 감사 이슈 |
|---|---|---|---|---|---|---|

특히 아래를 별도로 확인한다.

- FAN-004 로그인 호출 방식과 로그인 후 intent 복원 방식
- FAN-009 발급 연출 진입 및 종료 방식
- FAN-012 Stamp 상세의 route 및 부모 Passport 문맥
- FAN-018 혜택 상세의 route 및 목록 필터·scroll 복원 방식
- ADM-010에 이미 구현된 focus 관리 코드
- ADM-011·012의 drawer/dialog 구현 차이
- Fan 화면별 중복 header/nav/locale 코드
- FAN-001~003의 fixture/static data 사용 위치
- FAN-019·020의 Notification/PWA/permission 구현 위치

---

# 2. 기획 계약 결정 — 구현 전에 반드시 확정

아래 항목은 감사 보고서의 결론을 그대로 적용하지 말고,
현재 구현과 화면기획서를 함께 검토하여 Decision Record를 작성한다.

문서 위치 예시:

`docs/decisions/ui-context-contract-2026-07.md`

## 2.1 FAN-004 로그인

결정:

- FAN-004는 화면기획서의 `modal://login` 계약을 따른다.
- 공개 화면에서 CTA를 눌렀을 때 호출 화면의 문맥을 유지한다.
- `/login` 직접 접근과 인증 callback을 위한 fallback route는 유지할 수 있다.
- 일반 사용자 CTA에서는 context-preserving modal 또는 sheet를 사용한다.

보존해야 할 intent:

- 원래 pathname 및 query
- 대상 celebrity/live/benefit ID
- 선택한 action
- Fan Code 입력값
- 필요 시 scroll 위치 및 form draft
- 로그인 후 nickname onboarding 필요 여부
- onboarding 완료 후 원래 action 자동 재개

권장 구현:

- Next.js App Router intercepting route 또는 parallel route
- 구현 복잡도가 과도하면 공통 LoginDialog + signed return intent 방식
- 새로고침·OAuth callback·직접 URL 진입 fallback 제공

## 2.2 FAN-009 Passport 발급

다음 중 하나로 계약을 명확히 선택한다.

A. FAN-008 위에서 이어지는 overlay ceremony
B. 독립된 full-screen ceremony route

현재 구현이 B에 가깝다면 반드시 overlay로 강제 변경하지 않는다.

단, 어느 방식을 선택하든 다음은 충족한다.

- Passport DB 생성 완료 후 진입
- 발급 animation 실패가 Passport 접근을 막지 않음
- skip 제공
- reduced-motion 사용자는 즉시 완료 상태 제공
- 완료 후 FAN-011로 이동
- 중복 진입 및 재발급 방지
- 화면 의미가 dialog라면 focus/inert/Escape 규칙 적용
- 독립 route라면 dialog role을 억지로 사용하지 않음

## 2.3 FAN-012 Stamp 상세

화면기획서에는 상세 panel 동작과 실제 `/stamps/...` route가 함께 존재한다.

권장 계약:

- 직접 URL 접근: 독립 상세 페이지
- FAN-011에서 Stamp 선택: desktop drawer 또는 modal
- mobile: full-height sheet 또는 상세 페이지
- browser back 시 Passport의 scroll 및 선택 문맥 복구
- deep link와 refresh 지원

Next.js intercepting route 적용이 과도하면,
현재 독립 route를 유지하고 기획 문서를 갱신할 수 있다.

중요:
이 항목은 결정 전까지 P1 구현 결함으로 취급하지 않는다.

## 2.4 FAN-018 혜택 상세

FAN-012와 같은 원칙으로 결정한다.

권장 계약:

- 직접 URL 접근: 독립 상세 페이지
- FAN-017 목록에서 선택: desktop drawer
- mobile: sheet 또는 full route
- 목록의 celebrity filter, scroll 위치, 선택 상태 보존
- 수령 완료 후 목록 상태 즉시 동기화
- refresh, back, duplicate claim 지원

이 항목도 결정 전까지 단순 “기획 위반”으로 확정하지 않는다.

## 2.5 FAN-003 팬 허브 범위

현재 MVP에서 반드시 복원할 최소 범위를 먼저 확정한다.

필수:

- Hero 및 셀럽 기본 정체성
- 현재·예정 LIVE
- 팬 인증 또는 Passport CTA
- Notice 최소 목록
- Profile 요약
- SNS 링크
- Passport holder / non-holder CTA 변형
- empty state
- mobile과 desktop의 정보 순서

MVP 외 콘텐츠 피드, 커뮤니티 기능, 복잡한 탭 시스템은 새로 추가하지 않는다.

---

# 3. 우선순위 재정의

감사 보고서의 상·중·하를 아래 기준으로 P0~P3으로 다시 분류한다.

## P0

- 핵심 팬 여정 진행 불가
- 데이터 손상
- 중복 Passport/Stamp/혜택 발급
- 인증 우회
- production build 실패

## P1 — 출시 전 필수

- 로그인 후 원래 action이 복구되지 않음
- Dialog/Drawer의 키보드 접근성 결함
- 핵심 CTA 또는 navigation target이 44px 미만
- fixture 때문에 실제 공개 콘텐츠가 노출되지 않음
- Passport/Stamp/혜택 상태가 실제 데이터와 불일치
- 관리자 핵심 운영 작업을 실제 계정으로 수행할 수 없음

## P2 — 시스템 품질

- Fan header/nav 중복
- semantic token 분열
- hover/active/disabled/loading 불균일
- 화면별 typography drift
- empty/zero/unsupported 상태 표현 미흡

## P3 — 시각 polish

- 기획 후보안과의 미세한 표현 차이
- shelf/bookcase 등 비핵심 시각 metaphor 차이
- 콘텐츠 간격과 세부 motion polish

---

# 4. Phase 1 — 공통 Accessible Overlay Primitive

가장 먼저 공통 Dialog/Drawer/Sheet 기반을 구현한다.

## 4.1 구현 범위

재사용 가능한 primitive 또는 검증된 접근성 라이브러리를 사용해 다음을 제공한다.

- Dialog
- AlertDialog
- Drawer
- Bottom Sheet
- Backdrop
- Portal
- nested modal 정책

필수 동작:

- open 직후 initial focus
- Tab 및 Shift+Tab focus trap
- Escape 닫기
- 닫은 후 trigger focus 복귀
- background inert 또는 동등한 비활성화
- body scroll lock
- backdrop click 정책
- aria-labelledby / aria-describedby
- role="dialog" 또는 role="alertdialog"
- 중첩 confirm에서 부모 focus 상태 보존
- reduced-motion 대응
- mobile viewport 및 virtual keyboard 대응

## 4.2 우선 적용 순서

1. ADM-011 blockchain job drawer
2. ADM-011 retry confirmation
3. ADM-012 audit drawer
4. ADM-010 기존 drawer를 같은 primitive로 이관
5. FAN-009가 overlay 계약일 경우 적용
6. FAN-004 LoginDialog
7. FAN-012/FAN-018은 결정된 계약에 따라 적용

## 4.3 테스트

각 primitive에 대해 다음 자동 테스트를 추가한다.

- trigger click 후 dialog heading 또는 첫 필드에 focus
- Tab 순환
- Shift+Tab 역순환
- Escape close
- trigger focus restore
- body scroll 불가
- background element focus 불가
- nested alertdialog 닫은 후 부모 dialog focus 복귀
- reduced-motion
- mobile 390px

가능하면 axe 또는 동등한 자동 접근성 검사를 추가한다.

---

# 5. Phase 2 — 로그인 Intent 복원

FAN-004를 전체 route 제거 방식으로 단순 변경하지 말고,
직접 접근 fallback과 modal 호출을 함께 지원한다.

## 5.1 Intent 모델

다음과 같은 명시적 타입을 정의한다.

- sourcePath
- sourceQuery
- actionType
- targetType
- targetId
- draftPayload
- returnAnchor
- createdAt
- expiresAt

지원 action 예시:

- START_FAN_VERIFICATION
- RESERVE_LIVE
- SUBMIT_FAN_CODE
- OPEN_SURVEY
- CLAIM_BENEFIT
- OPEN_PASSPORT

민감 정보는 intent에 저장하지 않는다.
클라이언트 값만 신뢰하지 말고 서버에서 target과 action을 재검증한다.

## 5.2 필수 시나리오

1. FAN-003에서 팬 인증 CTA
2. FAN-013에서 예약 CTA
3. FAN-015에서 Fan Code를 입력한 뒤 제출
4. FAN-016 접근 전 인증
5. FAN-017/018 혜택 수령
6. 로그인 후 닉네임이 없을 때 FAN-005 경유
7. FAN-005 완료 후 저장된 action 자동 재개
8. 사용자가 modal을 닫으면 원래 페이지와 입력 상태 유지
9. OAuth 실패·취소 후 복구
10. 만료되거나 잘못된 intent는 안전한 기본 화면으로 이동

## 5.3 완료 기준

- 로그인 전 입력한 Fan Code가 로그인 후 유지된다.
- 로그인 전 누른 라이브 예약이 로그인 후 같은 라이브에 대해 재개된다.
- 다른 탭이나 조작으로 target이 바뀌어도 잘못된 대상에 action이 실행되지 않는다.
- 새로고침과 OAuth callback 이후에도 복구된다.
- action 중복 실행이 발생하지 않는다.

---

# 6. Phase 3 — 공통 Shell의 점진적 통합

전체 Fan 화면을 한 번에 재작성하지 않는다.

## 6.1 Shell 계층

### FanShell

적용 후보:

- FAN-001
- FAN-002
- FAN-003
- FAN-010
- FAN-011
- FAN-013
- FAN-017
- FAN-018
- FAN-019
- FAN-020

포함 항목:

- wordmark
- desktop navigation
- mobile bottom navigation
- locale action
- active route
- page container
- header sticky behavior
- content bottom padding
- 44px interaction target

### FocusFlowShell

적용 후보:

- FAN-005
- FAN-006
- FAN-007
- FAN-008
- FAN-009
- FAN-016

포함 항목:

- 최소화된 wordmark/header
- back/close 정책
- locale
- 단일 집중 content container
- progress 표시 영역
- mobile safe area

### AdminShell

기존 `AdminOperationsShell`을 유지·보강한다.

포함 항목:

- active navigation
- aria-current
- desktop/mobile navigation
- sign-out/account action
- responsive layout
- page heading convention

## 6.2 이관 순서

1. 공통 Header/Nav primitive 추출
2. FAN-001과 FAN-013에 먼저 적용
3. visual regression 및 route regression 확인
4. FAN-002, 003, 010, 011, 017~020 순차 이관
5. FocusFlowShell 이관
6. 중복 CSS 제거

기존 화면을 한 번에 대규모로 이동하지 않는다.
각 화면 이관마다 테스트를 통과시킨다.

## 6.3 Navigation 노출표

다음 문서를 작성한다.

| 화면 | Desktop Header | Desktop Nav | Mobile Header | Bottom Nav | Back | Locale |
|---|---|---|---|---|---|---|

guest/auth/holder 상태에 따른 차이도 기록한다.

---

# 7. Phase 4 — Semantic Token 통합

루트 `DESIGN.md`를 기준으로 전역 semantic token을 정의한다.

## 7.1 필수 token

### Color

- canvas
- surface
- soft
- ink
- muted
- line
- line-subtle
- error
- success
- warning
- backdrop
- focus
- primary-action

### Spacing

4px 기반:

- 1: 4px
- 2: 8px
- 3: 12px
- 4: 16px
- 5: 20px
- 6: 24px
- 8: 32px
- 10: 40px
- 12: 48px
- 16: 64px

### Radius

- control: 12px
- collection: 16px
- hero: 20px
- pill

### Motion

- control: 160ms
- layout: 240ms
- easing
- reduced-motion fallback

### Z-index

의미 기반으로 정의한다.

- sticky-header
- bottom-nav
- dropdown
- backdrop
- drawer
- dialog
- alertdialog
- tooltip

임의의 숫자를 각 CSS module에 직접 선언하지 않는다.

### Accessibility

- min-target: 44px
- focus-width: 3px
- focus-offset: 3px

## 7.2 적용 원칙

- 모든 hard-coded 값을 기계적으로 한 번에 치환하지 않는다.
- 동일한 의미로 반복되는 값부터 token으로 이동한다.
- visual regression이 있는 단위로 나눠 적용한다.
- 특정 화면만의 이미지 crop이나 editorial 값은 semantic token으로 억지 통합하지 않는다.
- dark mode는 추가하지 않는다.
- 새로운 gradient를 만들지 않는다.

---

# 8. Phase 5 — 핵심 화면 기능 보강

## 8.1 FAN-003 팬 허브

최소 구현:

- hero
- sticky 또는 명확한 section navigation
- Notice
- Live 및 활동
- Profile
- SNS
- Passport CTA
- holder/non-holder 상태
- 각 섹션 empty state
- KO/EN
- mobile 순서: Hero → tabs → Notice → Live/활동 → Profile
- desktop: main content + Profile/SNS 요약

실제 데이터가 없는 섹션은 fixture로 채우지 말고
명시적인 empty state를 표시한다.

## 8.2 FAN-002 셀럽 전체 보기

기획 범위:

- 검색
- 정렬
- Passport 보유 필터
- 게시된 셀럽만 노출
- 로그인 사용자의 보유 Passport 상태
- loading / empty / error

기능이 아직 API에 없다면 먼저 API 계약과 query parameter를 정의한다.

## 8.3 FAN-017

- 모든 nav/control interaction target 44px 이상
- locked / eligible / claimed 상태
- 진행 현황에서 올바른 FAN-011로 이동
- keyboard 및 screen reader label 확인

## 8.4 FAN-019

- `-0.05em` tracking 제거
- DESIGN.md 하한을 넘지 않도록 통일
- 불필요한 uppercase eyebrow 반복 제거
- 공통 section heading 사용
- empty/read/unread/push 상태 검증

## 8.5 FAN-020

실제 브라우저 상태를 구분한다.

- permission default
- granted
- denied
- unsupported
- insecure context
- PWA install available
- already installed
- install unsupported

권한이 거부된 상태에서 브라우저 prompt를 반복 호출하지 않는다.

---

# 9. Phase 6 — Fixture 제거와 실제 데이터 연결

FAN-001~003에 사용된 fixture/static data를 모두 식별한다.

## 9.1 원칙

- UI 컴포넌트에 fixture import를 직접 남기지 않는다.
- public API 또는 server-side data layer를 사용한다.
- seed 데이터와 production data를 구분한다.
- published 상태만 공개 API에 노출한다.
- KO/EN fallback 규칙을 명시한다.
- 이미지 URL 오류 시 허용된 fallback을 제공한다.
- loading / empty / error를 구분한다.

## 9.2 완료 기준

- Admin에서 게시한 셀럽·라이브·Notice·SNS 변경이 Fan 화면에 반영된다.
- draft/archived 데이터는 공개 화면에 노출되지 않는다.
- 실제 데이터 0건일 때 fixture가 나타나지 않는다.
- API 실패 시 빈 화면처럼 보이지 않고 error recovery를 제공한다.

---

# 10. Phase 7 — Admin 실데이터 검증

기존 감사 캡처의 “관리자 로그인이 필요합니다” 화면은
UI 구현 승인 증거로 사용하지 않는다.

## 10.1 검증 준비

- 허용된 Admin 테스트 계정
- seed 또는 staging 데이터
- 셀럽 1개 이상
- 라이브 1개 이상
- 퀴즈 3문항 이상
- 설문
- 혜택
- 팬 참여 기록
- 성공·실패 blockchain job
- audit log

## 10.2 ADM-002~012 검증 항목

각 화면에서 다음을 확보한다.

- 정상 데이터
- empty
- loading
- error
- filter 적용
- mobile 또는 최소 responsive 상태
- drawer/dialog open
- keyboard interaction
- 권한 실패 상태
- mutation 성공·실패
- audit log 생성

특히:

- ADM-008: zero와 empty를 분리하고 분모 0은 N/A
- ADM-009: 자동 집계와 수동 KPI를 시각적으로 구분
- ADM-011: PROCESSING/COMPLETED 중복 재처리 방지
- ADM-012: append-only UI와 읽기 전용 동작 확인

---

# 11. 테스트 계획

## 11.1 정적 검증

- TypeScript
- ESLint
- production build
- dependency audit는 별도 기록
- CSS token 사용 검사
- 44px target 검사
- invalid z-index 검사
- reduced-motion 검사

자동 검사는 false positive와 실제 결함을 구분해 보고한다.
1px divider를 click target 결함으로 집계하지 않는다.

## 11.2 Unit / Component

- intent serialize/restore/expire
- Button state matrix
- Dialog/Drawer focus behavior
- notification permission mapping
- PWA state mapping
- published data filter
- duplicate action 방지

## 11.3 E2E 핵심 팬 여정

### Guest → Passport

FAN-001
→ FAN-003
→ 팬 인증 CTA
→ FAN-004 modal
→ Google login
→ FAN-005
→ FAN-006
→ FAN-007
→ FAN-008
→ FAN-009
→ FAN-011

### Passport holder → Live 참여

FAN-013
→ 예약
→ FAN-014
→ Fan Code
→ FAN-015
→ 후기
→ FAN-016
→ FAN-011 Stamp 반영
→ FAN-017 혜택 상태 반영

### Benefit

FAN-017
→ FAN-018
→ claim
→ 중복 claim 방지
→ 목록 claimed 상태 동기화
→ refresh 후 유지

### Authentication intent

- Fan Code 입력 후 로그인
- 혜택 상세에서 로그인
- modal 닫기
- OAuth 취소
- nickname onboarding 경유
- callback 후 원래 action 복원

## 11.4 접근성 E2E

- keyboard-only
- focus order
- visible focus
- Escape
- focus restore
- background inert
- dialog accessible name
- screen-reader landmark
- touch target

---

# 12. 캡처 및 감사 PDF 재생성

수정 완료 후 기존 감사 PDF와 동일한 방식으로 새 버전을 생성한다.

## 12.1 캡처 규칙

- Desktop 1440px
- Mobile 390px
- 100% zoom
- browser chrome 제외
- full-page
- modal/drawer는 배경과 함께 캡처
- guest/auth/holder 분리
- loading/empty/error/success/permission 분리
- 캡처 파일명에 화면 ID와 상태 포함

예:

- `FAN-004-guest-login-modal-desktop.png`
- `FAN-015-fancode-preserved-after-login-mobile.png`
- `ADM-011-retry-alertdialog-keyboard.png`

## 12.2 보고서 판정 규칙

화면별로 다음 상태를 구분한다.

- Code Exists
- Functional
- Visually Verified
- Real-data Verified
- Accessibility Verified
- Approved

“코드가 존재한다”는 이유만으로 “구현 완료” 판정을 하지 않는다.

## 12.3 최종 승인 기준

- P0 0
- P1 0
- 핵심 팬 여정 E2E 전부 통과
- TypeScript, lint, build 통과
- 접근성 핵심 테스트 통과
- FAN-001~003 실제 API 데이터 사용
- FAN-019/020 실제 브라우저 상태 증거 확보
- ADM-002~012 실제 Admin 계정·실데이터 캡처 확보
- 390px 및 1440px에서 주요 레이아웃 파손 없음
- audit PDF 재생성 후 전 페이지 렌더링 검수 완료

---

# 13. 작업 수행 순서

다음 순서로 진행한다.

## G0 — Reality Check 및 Decision Record

- 코드 수정 전 현황 조사
- 화면/route/API 매핑
- FAN-009·012·018 화면 계약 확정
- shell 노출 매트릭스 작성
- 우선순위 재분류

## G1 — Accessible Overlay Primitive

- Dialog/Drawer/AlertDialog/Sheet 구현
- ADM-010~012 적용
- unit 및 keyboard E2E

## G2 — FAN-004 Auth Intent

- context-preserving login
- nickname onboarding 복귀
- Fan Code 및 예약 intent 복원
- 직접 `/login` fallback 유지

## G3 — Shared Navigation Foundation

- Header/Nav/Locale/BottomNav primitive
- FAN-001·013 우선 적용
- 회귀검증 후 점진 이관

## G4 — Core Screen Completion

- FAN-003 팬 허브 최소 정보구조
- FAN-002 검색·정렬·Passport 필터
- FAN-017 44px target
- FAN-019 typography
- FAN-020 permission/PWA states
- FAN-009·012·018 결정 계약 반영

## G5 — Live Data

- FAN-001~003 fixture 제거
- public API
- published filter
- KO/EN
- loading/empty/error

## G6 — Admin Real-data Verification

- Admin 계정
- seed/staging data
- ADM-002~012 실제 동작 검증
- 접근성 및 mutation 검증

## G7 — Final QA and Evidence

- 전체 자동 테스트
- 핵심 journey E2E
- 390/1440 캡처
- PDF 재생성
- P1 0 확인
- 최종 보고

---

# 14. 각 Gate 완료 보고 형식

각 Gate 완료 시 다음 형식으로 보고한다.

## Gate 결과

- 수행 범위
- 변경 파일
- 주요 구현 내용
- 의도적으로 변경하지 않은 범위
- 테스트 결과
- 캡처 및 증거 경로
- 남은 P0/P1/P2/P3
- 발견된 기획 충돌
- 다음 Gate 진입 가능 여부

표현 예:

- 완료
- 부분 완료
- 차단됨
- 기획 결정 필요

근거 없이 “완료”라고 표현하지 않는다.

---

# 15. 금지 사항

- 감사 보고서의 모든 차이를 자동으로 결함으로 간주하지 않는다.
- FAN-012·018을 결정 없이 무조건 drawer로 변경하지 않는다.
- 기존 route deep link를 제거하지 않는다.
- Fan 전체를 한 커밋에서 대규모 재작성하지 않는다.
- 정상 동작하는 G2~G5 비즈니스 로직을 UI 리팩터링 과정에서 변경하지 않는다.
- 테스트를 삭제하거나 assertion을 약화해 통과시키지 않는다.
- 실제 Admin 화면 대신 로그인 필요 화면을 최종 증거로 사용하지 않는다.
- fixture를 실제 데이터처럼 표시하지 않는다.
- 디자인 후보안의 시각 요소를 임의로 섞지 않는다.
- dark mode, 추가 gradient, glassmorphism, 과도한 radius를 도입하지 않는다.
- 기존 사용자 작업물이나 증거 파일을 삭제하지 않는다.

---

# 16. 즉시 수행할 첫 작업

우선 G0만 수행하라.

아직 구현을 시작하지 말고 다음을 제출하라.

1. 현재 repository Reality Check
2. FAN/ADM route-component-data-source 매핑
3. 감사 항목의 P0/P1/P2/P3 재분류표
4. FAN-009·012·018 계약 결정안과 장단점
5. FanShell / FocusFlowShell / AdminShell 노출 매트릭스
6. 각 Gate 예상 변경 범위와 의존 관계
7. 테스트 및 증거 수집 계획
8. 구현 전 사용자 결정이 반드시 필요한 항목

G0 결과를 제출한 뒤에만 G1 구현으로 진행하라.
