# KO/EN 누락 수정 TODO · 관리자 제외

- 요청: 2026-09-10, 확인된 누락을 TODO에 기록하고 추가 조사.
- 상태: **27개 항목 처리 및 로컬 검증·배포 완료**. 2026-09-10 사용자가 전체 define-goal 및 배포를 승인했다. 체크 완료는 조사 또는 구현 검증이 실제 끝난 항목에만 표시한다.
- 소스·로컬 실행 기준: `b381524a1f519e262319c1f1fe5af8c484de402b`. 추가 변경 대조: `origin/main` `72e8b35`까지.
- 범위: 공개·팬 화면, 로그인, 크리에이터 외부 연결 화면, 알림·이메일·푸시. 관리자 화면 제외.
- 작업 위치: `/Users/jewel/.codex/worktrees/byus-footer-calendar-20260910`.
- 상세 근거: `artifacts/locale-audit-20260910/README.md`, `main.md`, `features.md`, `server.md`.

## 우선 수정 — 처리 완료

- [x] **L10 / 높음 / 알림 화면**: `notification-center.tsx`의 KO 전용 문구·상태·접근성 이름·시간 형식을 한영 사전으로 분리. 완료 기준: EN 비로그인·로딩·빈 목록·실패·읽음·알림 권한 상태 모두 영문.
- [x] **L11 / 높음 / 알림 내용 5종**: `notification-repository.ts`의 당첨·수령 정보·수령 상태·Collectible 수령/마감 payload를 locale별로 투영. 완료 기준: 과거 한국어 payload 행도 EN 요청에서 시스템 문구가 영어.
- [x] **L12 / 높음 / 알림 이동**: 알림 행 및 `open=` 이동 직전 locale 추가. 저장 경로의 pathname-only 제약을 보존하며 클라이언트용 목적지를 합성. 완료 기준: EN 알림에서 이동한 상세도 EN, 기존 쿼리·해시 보존.
- [x] **L13 / 높음 / Web Push**: delivery claim→모델→sender→SW에 locale 전달, 6종 제목·본문 및 fallback 현지화. 완료 기준: KO/EN payload와 수신 표시가 일치.
- [x] **L14 / 높음 / Push 클릭**: SW의 `/notifications?open=...`에 수신 locale 유지. 완료 기준: 새 창·기존 창 모두 EN 알림과 상세로 이동.
- [x] **L20 / 높음 / 로그인 문구**: `login-page.tsx` 제목·OAuth 실패·홈/닫기 이름·이미지 alt 현지화. 완료 기준: 페이지 및 overlay의 KO/EN 문구와 접근성 이름 확인.
- [x] **L21 / 높음 / 로그인 이동**: 브랜드 홈 링크와 returnTo 없는 로그인 완료 목적지에 locale 유지. 완료 기준: EN 직접 로그인·홈 진입·기존 intent 복귀 모두 EN 유지.
- [x] **L22 / 보통 / SDK 로그인 모달**: `privy-provider.tsx` 커스텀 제목·설명 locale 반영. 실제 SDK 모달 사용 진입과 headless 경로를 구분해 확인.
- [x] **L30 / 보통 / Instagram 연결**: 초대·OAuth state·확인·취소·성공·오류·삭제 상태에 locale 유지, 독립 HTML·버튼·privacy 링크 현지화.
- [x] **L31 / 보통 / 설치형 앱**: manifest 설명·lang·start_url을 언어 정책에 맞춰 정리. 완료 기준: EN 설치 진입과 재실행의 시작 언어 확인.
- [x] **L32 / 보통 / 404**: 한국어에서도 영문 기본 404만 나오는 상태를 localized not-found 화면으로 처리.
- [x] **L40 / 낮음 / Passport 접근성**: KO skeleton `Loading` 및 EN Stamp dialog `Stamp 상세` 수정. 두 언어의 접근성 이름 검증.
- [x] **L41 / 낮음 / Stamp fallback**: intercepted Stamp Suspense fallback에 locale 전달.
- [x] **L42 / 낮음 / 공통 상태 초기 언어**: PublicContentState의 KO 초기값→effect EN 전환을 개선. EN 첫 렌더에서도 해당 언어 표시.

## 2차 조사에서 추가된 수정 — 처리 완료

- [x] **L23 / 높음 / LIVE 상세 복귀**: `Live`/`라이브` 링크가 `/`로 이동하여 EN 유실. 의도한 목록/홈 목적지와 locale을 함께 정리. 근거 N-01.
- [x] **L24 / 보통 / Onboarding 언어 전환**: KO→EN 전환 후 nested returnTo는 KO로 남아 완료·뒤로가기 때 KO 복귀. 허용된 내부 returnTo·LIVE context를 현재 언어와 일치. 근거 N-03.
- [x] **L33 / 보통 / Kakao callback 언어**: cookie로 선택한 본문과 URL 기반 html·metadata 언어를 일치. KO title `Kakao connection`도 현지화. 근거 N-02.

- [x] **L34 / 보통 / 인증 카테고리**: EN 공개 인증 목록 9개 모두 category=`팬 인증`. quiz category를 locale별로 투영하고 manual category도 언어별 값 또는 code로 분리. 목록 필터·상세 header까지 확인. 근거 S-07.
- [x] **L15 / 높음 / Kakao 발송 언어**: primary outbox가 locale을 `ko`로 강제하는 부분을 정리. 사용자 언어를 job·payload·provider template까지 전달. 실제 provider 수신은 별도 확인. 근거 S-02B 보강.

## 조건부 수정·정책 확인 — 처리 완료

- [x] **C10 / Kakao provider 계약**: 저장소 내 KO 강제는 L15로 확정. 외부 승인 템플릿의 KO/EN 지원과 최종 수신 언어는 아직 미확인. provider 계약·실제 수신 검증 범위를 확인.
- [x] **C11 / 레거시 등급**: stageProgress 없는 Home fallback의 Platinum/Diamond KO 매핑 추가 필요 여부와 실제 노출 범위 확인.
- [x] **C12 / 익명 팬 이름**: profile join이 없는 경우 RPC의 `팬` fallback을 locale별 처리. 사용자 닉네임 자체는 번역하지 않음.
- [x] **C13 / CHZZK**: EN 홈 `CHZZK`와 팬페이지 `치지직` 표기 일치.
- [x] **C14 / 공지 locale 오류**: 잘못된 locale에서 503 대신 검증 오류 400 반환. 정상 KO/EN 번역 누락과 분리.
- [x] **C15 / 시간대**: LIVE 일정·수령 마감·개인 활동 시각별로 KST 또는 사용자 현지 시간 정책 확인. 언어와 지역을 동일시하지 않음.

## 번역과 별개로 발견한 제품 공백

- [x] **G01 / 수령인 정보 입력 UI**: owner recipient API와 도메인 모델은 있지만 팬 입력 폼·호출 경로가 없다. MY의 정보 필요 보상도 일반 혜택 상세로만 연결된다. 입력 폼/경로 구현 범위를 정한 뒤 KO/EN 필드·검증·오류를 검증해야 한다. 최신 전체 승인에 따라 기존 owner API 계약을 보존하여 구현한다.
- [x] **C16 / On-chain metadata**: 토큰 name/description/trait는 고정 영문. 지갑·탐색기 대상 한국어 metadata 지원 정책을 정한 경우에만 추가 작업.

## 추가 조사 체크리스트

- [x] **R00 / 1차 감사**: AST 후보 199개, 직접 KO/EN 객체 32개 상위 키 비교, feature 93개 파일, 공개/비로그인 19개 경로×2언어. 로그인·알림 혼용 및 KO 404 로컬 재현.
- [x] **R01 / CMS 데이터**: 연결 Supabase를 읽기 전용으로 집계. 공개 셀럽9·브랜드1·LIVE2·Benefit4·공지3·퀴즈9(질문27/선택108) 한영 필수필드 nonblank. 인증 title/description은 양언어지만 category 누락 S-07 확인. 공개 테마·설문/미션0은 표본 없음. 비공개 초안 전체와 번역 품질은 완료 판정 범위 밖.
- [x] **R02 / 인증 후 화면**: 구현된 MY·설정·아바타·Passport·혜택·퀴즈·인증 상태의 소스와 기존 테스트 확인 완료(12개 파일 154개 테스트 통과). 실제 계정 인증은 하지 않았다. 수령인 폼은 미구현/미연결이므로 G01에 남겼다.
- [x] **R03 / 탐색·복귀 경로**: redirect·router·window.location·공유·callback 경로를 추가 추적. N-01 LIVE 복귀 및 N-03 onboarding 전환 후 복귀에서 언어 유실 확인.
- [x] **R04 / 메타데이터·에셋**: N-02 callback 본문·문서 언어 불일치 재현. 공통 안내 이미지와 공유 문구 확인. 고정 on-chain 영문 metadata는 C16 정책 항목으로 분리.
- [x] **R05 / 중첩·동적 사전**: feature 상태·오류의 중첩/동적 맵을 추가 확인했고 새 매핑 누락은 발견하지 못했다. 서버 projection은 R01/R06의 데이터·외부 전달 조사와 함께 판정.
- [x] **R06 / 외부 경계 조사**: Kakao outbox locale KO 강제와 payload 전달 계약 확인. Privy 모달 커스텀 문구와 Apple 재인증 redirect의 locale 보존 확인. 외부 제공자 최종 수신/로그인 조작은 미수행이며 C10에 남김.

## 구현할 때 보존할 기준

- 기존 사용자/다른 작업 변경을 보존하며 이 worktree에서 수행.
- 최신 요청은 TODO 전체 구현·커밋·푸시·필요한 DB/웹/알림 워커 배포까지 승인한 요청이다. 실제 사용자 데이터·계정·외부 메시지 발송은 임의로 수행하지 않는다.
- 브랜드명·공통 용어·사용자 작성 내용은 자동 번역 대상으로 세지 않는다.
- LIVE 외부 링크의 숨김 `새 창`은 상위 localized aria-label이 실제 이름을 덮어쓰므로 현재 접근성 이름 결함으로 세지 않는다.
- 정상 여부는 소스·fixture·실제 로그인 화면·운영 데이터·실제 알림 수신을 구분하여 기록.

## 조사 진행 기록

- 2026-09-10: 1차 확인분을 위 TODO로 기록. 2차 조사 시작. 구현 항목은 모두 미착수.

- 2026-09-10 2차: LIVE 복귀, Kakao callback 문서/본문 언어, onboarding returnTo 총 3개 원인을 추가하고 L23/L24/L33으로 등록. 상세 `artifacts/locale-audit-20260910/main-round2.md`.

- 2차 기능 검증: 구현된 MY/설정/아바타/혜택/퀴즈/인증의 추가 상태 맵은 양언어 선택 확인. 수령인 입력 UI는 존재하지 않아 G01로 분리. `features-round2.md` 참조.
- 최신 변경 확인: `72e8b35`까지 추가된 Settings·LIVE mission·fan activity 문구는 양언어. Notification Center의 진행/실패 문구는 여전히 KO 전용으로 L10 영향 범위에 포함.

- 2차 서버 검증: S-07 인증 category 누락 추가(L34), Kakao locale KO 강제 확인(L15). 공개 콘텐츠 집계와 표본 없는 범위는 `server-round2.md` 참조.
- 추가 조사 완료: 새로운 원인 4개(N-01/N-02/N-03/S-07), 기존 Kakao 항목 1개 근거 강화, 수령인 UI 제품 공백 1개를 기록. 모든 제품 수정 TODO는 미착수다.

- 구현 계획 검토 중 발견: owner reward 목록의 benefit title도 KO 우선 projection이다. G01 및 MY 한영 완료 기준에 동일 JSON shape의 locale-aware owner read를 포함한다.

## 구현 및 최종 검증 · 2026-09-10

- 27개 항목을 구현 또는 아래 명시한 정책·검증 범위로 처리했다. 최신 main `d222885`의 홈 안내 카드/참여 가이드, 역할 분류, Apple 진단을 통합했다.
- 관련 웹 32개 파일 **361개 테스트**, 워커 전체 **213개 테스트**, 웹·워커 typecheck, 전체 lint, 웹 production build 및 Lambda bundle build 통과.
- PostgreSQL17에서 최신 역할 migration110000 및 localization120000을 포함한 **132개 migration replay** 통과. 함수 존재/정의·구버전/신버전 빈 claim shape 검사와 Kakao EN snapshot→KO 프로필 변경→EN 작업 복원 실행형 fixture를 구분해 검증했다. 전체 실제 계정 상태 전이 검증을 의미하지 않는다.
- 독립 위험 검토에서 recipient 언어 전환, digital 안내, Instagram 구버전 form, 실제 fulfillment enum, Kakao snapshot 보정 지적을 수정했고 최종 차단 사항 없음.
- 실제 로컬 production build에서 KO↔EN client navigation, reload, browser back/forward, html lang/OG locale/manifest href Playwright 1개 통과. 실제 SSR manifest URL과 JSON lang/start_url KO/EN200 확인.
- Aside desktop1440/mobile390:4044개 실제 페이지 및 로그인/수령인/알림/Stamp/LIVE14개 기본 component fixture 화면 확인. KO배송/EN픽업 stub 제출 및 GET확인, 가로 넘침/필드 label/포커스/locale 링크/KST 표시 확인. 증거: `artifacts/locale-audit-20260910/local-root-render/`, `local-component-render/`.
- L22: Privy 지원 custom header/message와 locale 전환 시 provider mount1회 유지 테스트 통과. 초기3024 실제 SDK는 Origin not allowed로 본문 진입이 제한되어 실제 Google/Apple 로그인은 수행하지 않았다. 제품 컴포넌트 auth stub 검증과 실제 로그인은 구분한다.
- L31: EN manifest/start_url과 locale-bearing 링크 계약 완료. OS 설치 및 기기 재실행 자체는 미검증.
- C10/L15: 현재 AWS dev/prod 외부알림 mode 및 Kakao/email provider URL/token 미설정 상태 확인. 언어 snapshot·KO/EN payload 전달을 구현하고 이 비활성 설정은 보존한다. 승인 템플릿·실제 수신은 미검증이며 이번에 활성화/발송하지 않는다.
- C15: LIVE/Collectible 운영 시각은 KST 명시, 개인 과거 기록은 viewer-local 유지. C16: 기존 immutable on-chain 영문 canonical metadata 유지, locale 변경으로 tokenURI/기존 토큰 변경 없음.
- 웹 확대 검사에서 참조 파일2종 테스트 실패는 원본의 무시된 브랜드/ledger 파일을 정확히 복사해5개 테스트 재통과. Home CSS 고정값 검사3개는 분리한 기존 main `d222885` 및 `b538c7b`에서도 동일하게 실패함을 확인했다. 현재4개 입력파일 해시도 기존 main과 같으며 이번 변경의 회귀가 아니다. 상세 `artifacts/locale-audit-20260910/baseline-failures.md`.
- 로그: `web-focused-final.log`, `worker-all-tests-final.log`, `web-production-build.log`, `lint-final.log`, `backend-clean-replay-final.log`, `root-document-e2e-production.log`.

- Production DB: Supabase linked push 최종 성공 및 `supabase_migrations.schema_migrations`의120000 localization_contracts 반영 확인. 로컬Docker 비실행으로 부가 catalog cache 경고만 발생했으며 migration적용은 성공했다.

- Notification worker Production code-only 교체 성공: `Active / Successful`, 배포ZIP SHA256 일치. EventBridge/schedule/target/concurrency 및 환경변수·handler 등 운영 설정 보존. AWS Auto runtime ARN만 변경됐으며, 과거 INIT_START ARN을 대입하면 배포 전 전체 설정 digest가 정확히 재현되는 것으로 차이를 확인했다. 증거 `deployment/notification-after.json`, `notification-runtime-change-proof.json`.

## 배포 완료 기록

- 코드 배포 commit `1d07748fbaab2675b9ac7858c793e02afc977e44`, Vercel Production `dpl_J48d7W5erXMgUEy5gyHhckExgxHu` **Ready**. Vercel 조회로 `byus.kr` 및 `www.byus.kr`이 동일 deployment에 할당됨을 확인했다. 운영 화면/로그인/API를 반복 검사하지 않았다.
- Supabase migration120000, Notification worker code-only 배포도 최종 성공. 외부 발송 설정은 비활성 상태 유지.
- 추가 로컬 Instagram 오류 shell: KO desktop1440/EN mobile390의 실제 HTML lang·제목·본문·privacy locale 링크·가로 넘침 확인. 유효 OAuth 연결 자체는 unit fixture 검증이며 실제 계정 연결은 하지 않았다.
- 이번 작업이 연 임시 브라우저 탭과 검증 서버를 정리했다. 다른 작업의 서버/사용자 탭은 보존했다.
- 결론: **로컬 검증 및 배포 완료**. 실제 Kakao 수신, 실제 Google/Apple 로그인, OS 설치/재실행은 완료 주장에 포함하지 않는다. 전체 웹 확대 검사 중 기존 CSS 기준선3개 실패는 관련361개 테스트 통과와 구분한다.
