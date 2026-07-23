아래 지시안은 **현재 로컬 작업 트리에 남아 있는 G0~G7 변경 사항을 다시 검토하고, 안전하게 커밋·푸시·배포한 뒤 실제 배포 환경에서 최종 확인하는 단계**를 위한 것입니다.

현재 UI/UX 후속 범위는 P0 0건, P1 0건으로 판정됐지만, 이는 아직 커밋·푸시·운영 배포까지 완료됐다는 뜻은 아닙니다. 또한 실제 `FAILED` 블록체인 작업과 headless WebKit 관리자 인증은 검증 경계로 남아 있습니다. 

```markdown
# [지시안] ByUs UI/UX G0~G7 변경사항 최종 검토·커밋·배포 및 운영 스모크 테스트

## 0. 역할과 목표

당신은 ByUs 프로젝트의 수석 풀스택 엔지니어이자 릴리즈 매니저, QA 책임자이다.

기존 UI/UX 감사 후속 작업으로 G0~G7 구현과 검증이 완료되었으며, 현재 보고된 상태는 다음과 같다.

- P0: 0건
- P1: 0건
- 단위·컴포넌트·통합 테스트: 958개 통과
- Public E2E: 50개 통과, 4개 의도적 제외
- ESLint: 통과
- TypeScript: 통과
- Production build: 통과
- Next.js 정적 페이지: 24/24
- Chromium 실제 관리자 계정으로 ADM-002~012 검증 완료
- 변경 사항은 아직 커밋·푸시되지 않고 로컬 작업 트리에 보존된 상태

이번 작업의 목적은 새로운 기능 개발이 아니다.

다음을 순서대로 수행하는 것이 목적이다.

1. G0~G7 변경사항이 의도한 범위만 포함하는지 최종 검토
2. 보안·DB·인증·핵심 팬 여정의 회귀 위험 검토
3. 생성물과 소스 변경을 구분
4. 논리적 단위로 커밋 구성
5. 원격 저장소에 안전하게 푸시
6. 배포 환경에 반영
7. 실제 배포 URL에서 최종 스모크 및 핵심 여정 검증
8. 릴리즈 결과와 남은 검증 경계를 문서화

임의로 기능 범위를 확장하거나 디자인을 추가 수정하지 않는다.

---

# 1. 작업 기준 문서

다음 자료를 Source of Truth로 사용한다.

- `todo.md`
- `docs/status/2026-07-22-ui-ux-followup-g0.md`
- `docs/status/2026-07-22-ui-ux-followup-g1.md`
- `docs/status/2026-07-22-ui-ux-followup-g2.md`
- `docs/status/2026-07-22-ui-ux-followup-g3.md`
- `docs/status/2026-07-22-ui-ux-followup-g4.md`
- `docs/status/2026-07-22-ui-ux-followup-g5.md`
- `docs/status/2026-07-23-ui-ux-followup-g6.md`
- `docs/status/2026-07-23-ui-ux-followup-g7.md`
- `docs/decisions/ui-context-contract-2026-07.md`
- `docs/decisions/public-discovery-data-contract-2026-07.md`
- 루트 `DESIGN.md`
- `outputs/ByUs_화면기획서_v1.pptx`
- `output/pdf/byus-ui-ux-followup-final-verification-2026-07-23.pdf`

기존 구현과 문서가 충돌하면 임의로 수정하지 말고 충돌 내용을 먼저 보고한다.

---

# 2. Phase R0 — 현재 작업 트리 및 변경 범위 검토

코드 수정이나 커밋 전에 다음을 조사한다.

## 2.1 Git 상태

다음을 출력하고 기록한다.

- 현재 branch
- HEAD commit
- origin/main과의 차이
- staged 파일
- unstaged 파일
- untracked 파일
- 삭제된 파일
- rename 감지
- 전체 diff 통계
- 파일별 변경량

필수 명령 예시:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git diff --stat
git diff --name-status
git diff --check
```

## 2.2 변경 파일 분류

모든 변경 파일을 아래 범주로 분류한다.

| 범주 | 예시 |
|---|---|
| 제품 소스 | `apps/web`, `worker`, 공통 package |
| 테스트 | unit, component, Playwright |
| DB migration | `supabase/migrations` |
| 계약·결정 문서 | `docs/decisions` |
| 상태 보고서 | `docs/status` |
| 증거 파일 | `output/g*-evidence`, PDF |
| 빌드·테스트 생성물 | `.next`, Playwright profile, tmp, report |
| 로컬 환경 파일 | `.env*`, credential, token, cookie |
| 불명확한 변경 | 별도 검토 필요 |

다음은 커밋 대상에서 반드시 제외한다.

- `.env`
- `.env.local`
- access token
- OTP
- cookie
- session storage dump
- raw wallet address가 포함된 디버그 파일
- Privy 인증 정보
- Supabase service role key
- 브라우저 profile
- `.next`
- 임시 캐시
- 불필요한 trace/video
- macOS 임시 파일
- 개인 로컬 경로가 포함된 설정 파일

민감 정보가 발견되면 커밋을 중단하고 파일 경로와 노출 유형만 보고한다.
실제 값은 출력하지 않는다.

---

# 3. Phase R1 — 변경사항 코드 리뷰

G0~G7 보고서의 “완료” 표현을 그대로 신뢰하지 말고 실제 diff를 기준으로 검토한다.

## 3.1 Auth Intent

다음을 확인한다.

- intent는 UUID만 URL 또는 navigation에 전달되는가
- 민감한 Fan Code, 이메일, wallet, token, 설문 답변, 혜택 코드가 intent에 저장되지 않는가
- intent 만료 시간이 적용되는가
- 잘못된 path, anchor, action, target이 거부되는가
- 서버가 action과 target을 다시 검증하는가
- 로그인·닉네임 설정 후 정확한 action만 한 번 재개되는가
- action 완료 전 intent가 너무 일찍 삭제되지 않는가
- action 완료 후에는 intent와 draft가 제거되는가
- duplicate submit과 refresh 시 idempotency가 유지되는가

## 3.2 Passport 및 Stamp

다음을 확인한다.

- FAN-009가 Passport 생성 API를 다시 호출하지 않는가
- 기존 발급 aggregate만 읽는가
- 재진입·새로고침·double click으로 중복 발급되지 않는가
- FAN-012 직접 URL은 유지되는가
- 내부 진입 시 drawer/sheet가 열리는가
- 닫기·Back·Escape 후 FAN-011 상태가 복원되는가
- 타 사용자 Stamp 존재 여부가 노출되지 않는가

## 3.3 Benefit

다음을 확인한다.

- FAN-018 직접 URL과 내부 overlay 진입이 모두 동작하는가
- 혜택 claim/application에 idempotency key가 적용되는가
- 재고, 자격, 기간, 소유권은 서버가 최종 검증하는가
- 수령 성공 후 FAN-017 배경 카드 상태가 갱신되는가
- 비공개 코드와 delivery 정보가 소유자에게만 반환되는가

## 3.4 Public Discovery

다음을 확인한다.

- FAN-001~003에서 fixture runtime import가 완전히 제거됐는가
- 공개 API는 published 데이터만 반환하는가
- `display_order`가 관리자 순서를 보존하는가
- KO/EN 콘텐츠가 조용히 혼합되지 않는가
- unknown, draft, archived 콘텐츠는 non-enumerating 404인가
- Passport 소유 여부가 공개 DTO에 포함되지 않는가
- 실제 LIVE가 없을 때 fixture로 대체하지 않는가
- loading, empty, error가 서로 구분되는가

## 3.5 Supabase 보안

다음을 확인한다.

- 신규 migration이 멱등성 또는 적용 순서를 고려했는가
- local과 linked migration history가 일치하는가
- public discovery View가 `security_invoker=true`인가
- View 직접 조회 권한이 browser role에 불필요하게 열려 있지 않은가
- service role 전용 동작이 클라이언트에 노출되지 않는가
- 기존 RLS를 우회하지 않는가
- migration rollback 또는 복구 방향이 문서화 가능한가

## 3.6 Overlay 접근성

다음을 확인한다.

- initial focus
- Tab/Shift+Tab containment
- Escape
- trigger focus restoration
- body scroll lock
- background inert
- nested AlertDialog
- topmost overlay만 Escape 처리
- busy mutation 중 닫기 방지
- reduced-motion
- mobile safe-area

ADM-010, ADM-011, ADM-012뿐 아니라 FAN-004, FAN-012, FAN-018에도 동일 contract가 적용되는지 확인한다.

## 3.7 공통 Shell

다음을 확인한다.

- FanShell, FocusFlowShell, AdminShell이 무리하게 하나로 합쳐지지 않았는가
- 각 화면의 route, anchor, locale, active item 의미가 유지되는가
- `aria-current="page"`가 올바른 화면에만 적용되는가
- desktop target은 최소 44px인가
- mobile bottom navigation은 최소 64px인가
- 화면별 business state를 공통 Shell이 침범하지 않는가

---

# 4. Phase R2 — 생성물 및 저장소 정리

## 4.1 커밋 대상 권장

다음은 저장소 정책에 따라 커밋 가능하다.

- 제품 코드
- 테스트 코드
- Supabase migration
- Decision Record
- G0~G7 상태 보고서
- `todo.md`
- 최종 검증 PDF
- 재현에 필요한 소규모 증거 이미지

## 4.2 커밋 제외 권장

다음은 기본적으로 제외한다.

- Playwright HTML report 전체
- 대량 브라우저 프로필
- trace/video
- `.next`
- tmp
- 중복 캡처
- contact sheet 생성 중간물
- 로컬 절대 경로만 의미 있는 파일
- 18GB를 유발했던 stale browser profile 또는 cache

단, 기존 저장소가 증거 이미지와 PDF를 버전 관리하는 규칙을 갖고 있다면 그 규칙을 따른다.

## 4.3 `.gitignore` 검토

필요한 경우에만 `.gitignore`를 보강한다.

예시:

```gitignore
.next/
playwright-report/
test-results/
blob-report/
artifacts/**/trace.zip
artifacts/**/video/
tmp/
.DS_Store
```

이미 저장소가 의도적으로 추적하는 경로는 무조건 ignore하지 않는다.

---

# 5. Phase R3 — 최종 검증 재실행

커밋 전에 깨끗한 환경에서 검증한다.

## 5.1 사전 정리

소스와 사용자 증거는 삭제하지 않는다.

삭제 가능한 생성물만 정리한다.

- `.next`
- stale Playwright browser profile
- test-results
- 임시 cache
- 이전 build artifacts

## 5.2 필수 검증

저장소에서 정의한 정확한 명령을 먼저 확인하고 실행한다.

최소 검증:

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Playwright는 기존 최종 검증과 동일한 환경 구성을 사용한다.

검증 기준:

- 단위·컴포넌트·통합 테스트 전체 통과
- Public E2E 50개 통과
- 의도적 skip 4개만 존재
- Chromium, Firefox, WebKit 공개 화면 통과
- 360/390 모바일 및 1440 데스크톱
- production build 통과
- 정적 페이지 생성 수 확인
- axe 접근성 위반 없음
- first-party console error 없음
- 외부 Privy/Cloudflare/CSP 진단은 별도 분류

테스트 수가 기존 보고서와 달라졌다면 단순 통과로 끝내지 말고,
증가·감소 이유를 기록한다.

---

# 6. Phase R4 — 커밋 계획 수립

모든 변경을 하나의 거대한 커밋으로 만들지 않는다.

아래는 권장 커밋 구성이며, 실제 diff 의존성에 따라 조정할 수 있다.

## Commit 1 — Overlay accessibility foundation

포함:

- Dialog
- Drawer
- BottomSheet
- AlertDialog
- ADM-010~012 적용
- 관련 접근성 테스트

예시 메시지:

```text
feat(ui): add accessible overlay primitives
```

## Commit 2 — Contextual authentication and Auth Intent

포함:

- FAN-004 intercepted login
- durable Auth Intent
- Fan Code draft
- onboarding resume
- reservation/survey/benefit resume
- 관련 테스트

예시 메시지:

```text
feat(auth): preserve protected action intent across login
```

## Commit 3 — Shared Fan and Admin navigation

포함:

- FanHeader
- FanPrimaryNavigation
- FanBottomNavigation
- FocusFlow primitives
- Admin active navigation
- 44px/64px target
- 관련 테스트

예시 메시지:

```text
refactor(ui): unify fan and admin navigation shells
```

## Commit 4 — Core screen and context contracts

포함:

- FAN-002
- FAN-003
- FAN-009
- FAN-012
- FAN-017
- FAN-018
- FAN-019
- FAN-020
- semantic tokens
- screen-level tests

예시 메시지:

```text
feat(fan): complete hub and contextual detail flows
```

## Commit 5 — Public data and database security

포함:

- published content repository
- public APIs
- fixture 제거
- display_order migration
- security_invoker migration
- KO/EN
- empty/error behavior
- repository/API/migration tests

예시 메시지:

```text
feat(data): connect public discovery to published content
```

## Commit 6 — QA evidence and release documentation

포함:

- G0~G7 보고서
- Decision Record
- 최종 PDF
- 필요한 증거 파일
- todo 상태

예시 메시지:

```text
docs(qa): record ui ux follow-up verification
```

주의:

- 커밋 단위 사이에 build가 깨지지 않게 구성한다.
- DB migration과 이를 사용하는 코드는 배포 순서를 고려한다.
- migration을 별도 커밋으로 분리하는 것이 더 안전하면 분리한다.
- 자동 생성 파일만 변경된 커밋은 만들지 않는다.
- 커밋 전에 각 commit의 staged diff를 검토한다.

---

# 7. Phase R5 — 커밋 전 사용자 승인 Gate

다음 내용을 먼저 보고하고,
사용자 승인 전에는 commit 또는 push하지 않는다.

## 보고 형식

### 변경 요약

- 총 변경 파일 수
- 제품 코드
- 테스트
- migration
- 문서
- 증거 파일
- 제외한 생성물

### 위험 요소

- Auth Intent
- Supabase migration
- 공개 API
- Admin 인증
- Passport/Benefit idempotency
- 배포 순서

### 제안 커밋

| 순서 | Commit message | 주요 파일 | 위험도 |
|---|---|---|---|

### 검증 결과

- unit/integration
- E2E
- lint
- typecheck
- build
- diff check

### 사용자 결정 요청

- 커밋 진행 여부
- push 진행 여부
- 배포 대상 환경
- PDF 및 대량 evidence의 Git 추적 여부

사용자의 명시적인 승인 없이 commit, push, production deploy를 수행하지 않는다.

---

# 8. Phase R6 — 커밋 및 푸시

사용자가 승인한 경우에만 수행한다.

## 8.1 커밋

각 커밋 전에:

```bash
git diff --cached --stat
git diff --cached
git diff --cached --check
```

커밋 후:

```bash
git show --stat --oneline HEAD
```

를 통해 의도한 파일만 포함됐는지 확인한다.

## 8.2 최종 로컬 검증

마지막 커밋 후 전체 검증을 다시 실행한다.

- lint
- typecheck
- unit/integration
- production build
- 핵심 Playwright
- git status

## 8.3 푸시

다음을 확인한다.

- 원격 branch 최신 상태
- force push 금지
- `main` 직접 push 정책
- PR 필요 여부
- CI 예상 동작

원격 main이 변경된 경우:

- 무조건 merge하지 않는다.
- fetch 후 차이를 분석한다.
- 안전한 rebase 또는 merge 계획을 보고한다.
- conflict를 임의로 해결하지 않는다.

권장:

```bash
git fetch origin
git log --oneline --left-right HEAD...origin/main
```

force push는 사용자가 명시적으로 승인하지 않는 한 금지한다.

---

# 9. Phase R7 — 배포

저장소의 기존 배포 방식을 먼저 확인한다.

가능한 방식:

- Vercel Git integration
- 수동 Vercel deployment
- GitHub Actions
- 별도 production pipeline

## 9.1 DB migration 적용 순서

공개 화면 코드가 신규 View 또는 `display_order` 컬럼을 요구한다면,
다음 순서를 검토한다.

1. backward-compatible migration 적용
2. migration 검증
3. web application 배포
4. public API smoke
5. security advisor 및 권한 확인

migration 적용 전:

- linked project 확인
- migration history 확인
- 대상 환경 확인
- production인지 staging인지 확인
- 기존 데이터 영향 확인
- rollback 또는 forward-fix 방안 기록

운영 DB에 임의의 FAILED blockchain job이나 가짜 콘텐츠를 생성하지 않는다.

## 9.2 배포 성공 조건

- deployment status success
- build success
- environment variables 정상
- Supabase 연결 정상
- Privy 설정 정상
- 공개 route HTTP 200
- Admin route 인증 보호
- 신규 migration 반영

---

# 10. Phase R8 — 실제 배포 환경 스모크 테스트

로컬 테스트 통과만으로 종료하지 않는다.

실제 배포 URL에서 다음을 검증한다.

## 10.1 공개 화면

- `/`
- `/celebrities`
- `/c/kara`
- KO/EN API
- 실제 published KARA
- 관리자 `display_order`
- LIVE가 없을 때 빈 상태
- unknown/unpublished 404
- 모바일 390px
- 데스크톱 1440px

## 10.2 로그인과 Auth Intent

최소 다음 여정을 실제 브라우저에서 검증한다.

### 팬 인증

```text
FAN-003
→ 팬 인증 CTA
→ contextual FAN-004
→ 로그인
→ 필요 시 FAN-005
→ FAN-006 또는 기존 Passport
```

### 예약

```text
FAN-013
→ 예약 CTA
→ 로그인
→ 동일 라이브 예약 action 복귀
```

### Fan Code

```text
FAN-015
→ 코드 입력
→ 로그인
→ 입력값 복원
→ 중복 없이 1회 제출
```

실제 Fan Code가 없거나 운영상 실행하면 안 되는 경우,
production mutation은 수행하지 말고 안전한 staging 또는 읽기 전용 검증으로 제한한다.

### Benefit

```text
FAN-017
→ FAN-018
→ 로그인 문맥 확인
```

운영 혜택을 실제 수령하지 않아야 하는 경우,
claim mutation은 실행하지 않고 staging에서 검증한다.

## 10.3 관리자

실제 허용된 관리자 계정으로 확인한다.

- ADM-002~012 진입
- active navigation
- mobile menu
- ADM-010 drawer
- ADM-011 drawer
- ADM-012 drawer
- Escape
- focus restore
- body scroll lock
- background inert
- completed job retry disabled
- FAILED filter empty state

운영 데이터에 mutation을 발생시키는 동작은 최소화한다.

## 10.4 브라우저

최소:

- Chrome
- Safari 실제 브라우저 또는 가능한 Safari 환경
- 모바일 viewport

headless WebKit 관리자 OTP가 실패했던 사실을 숨기지 않는다.
실제 Safari에서 관리자 인증이 가능하다면 별도 증거로 보강한다.

---

# 11. Phase R9 — 남은 P2 검증 항목 관리

현재 남은 검증 경계는 결함으로 단정하지 않는다.

## P2-01 실제 FAILED 블록체인 작업

현재 상황:

- linked DB에 실제 FAILED job 없음
- completed job retry는 HTTP 409로 차단
- FAILED empty state 확인
- nested retry AlertDialog는 deterministic test로 확인

후속 조건:

- staging에서 안전한 FAILED fixture를 만들 수 있을 때
- 또는 실제 FAILED job이 발생했을 때

다음을 추가 확인한다.

- FAILED 상세
- retry 버튼 활성화
- nested AlertDialog
- retry API
- 상태 전이
- audit log
- 중복 retry 방지

운영 환경에 검증 목적으로 실패 데이터를 만들지 않는다.

## P2-02 WebKit 관리자 인증

현재 상황:

- Chromium 실계정 Admin 검증 완료
- WebKit 공개 화면·공통 component 검증 완료
- headless WebKit Test Account OTP session 실패

후속 조건:

- Safari 실제 브라우저
- WebKit 인증 자동화 환경
- Privy가 지원하는 안정적인 테스트 계정 방식

확인 전까지 authentication을 약화하거나 테스트 우회 코드를 제품에 넣지 않는다.

---

# 12. 최종 완료 보고서

다음 형식으로 보고한다.

# ByUs UI/UX Follow-up Release Report

## 1. Git

- branch
- base commit
- 최종 commit 목록
- push 대상
- PR 또는 main 반영 상태
- working tree clean 여부

## 2. 변경 범위

- 제품 코드
- 테스트
- DB migration
- 문서
- 증거 파일

## 3. 검증

| 항목 | 결과 |
|---|---|
| Unit / Integration | |
| Public E2E | |
| Accessibility | |
| ESLint | |
| TypeScript | |
| Production Build | |
| Static Pages | |
| Migration | |
| Deployed Smoke | |

## 4. 실제 배포 검증

- 공개 화면
- 로그인 문맥
- Admin
- 반응형
- 브라우저
- 실제 데이터

## 5. 잔여 항목

- P0
- P1
- P2
- P3

## 6. 최종 판정

다음 중 하나만 사용한다.

- READY TO DEPLOY
- DEPLOYED / SMOKE PASS
- DEPLOYED / LIMITED PASS
- BLOCKED

“complete”라는 표현은 커밋, 푸시, 배포, 운영 스모크까지 실제로 완료된 경우에만 사용한다.

---

# 13. 즉시 수행할 첫 단계

우선 R0~R4까지만 수행하라.

아직 commit, push, deploy는 하지 않는다.

다음을 제출하라.

1. 현재 Git 상태
2. 변경 파일 전체 분류
3. 민감 정보·로컬 생성물 검사 결과
4. 실제 diff 기반 코드 리뷰 결과
5. DB migration 위험 검토
6. 최종 테스트 재실행 결과
7. 제안 커밋 목록
8. 커밋에서 제외할 파일
9. push 및 배포 전 사용자 결정이 필요한 사항

사용자 승인을 받은 뒤에만 R6 이후로 진행하라.
```
