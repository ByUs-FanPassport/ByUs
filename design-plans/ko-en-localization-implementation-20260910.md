# KO/EN 전체 누락 구현·배포 계획

상태: 27개 항목 처리, 로컬 검증 및 DB/worker/web 배포 완료. 사용자 2026-09-10 `전체 define-goal 하고, 배포까지 진행`으로 TODO 전체 구현·배포 승인. 작업 공간은 기존 `/Users/jewel/.codex/worktrees/byus-footer-calendar-20260910`, 시작 HEAD `72e8b35`. 다른 작업의 미커밋 변경과 실행 중 서버는 보존한다.

## 완료 기준

기존 TODO L10~L42, C10~C16, G01 총 27개 미완료 항목을 코드 수정 또는 근거가 있는 정책 결정으로 처리한다. 체크는 관련 구현·검증이 끝난 경우에만 한다. 관리자 기능, 사용자 작성 내용, 기존 발급 토큰, 실제 사용자 데이터는 변경하지 않는다.

- 관련 KO/EN 회귀 테스트, 웹·워커 타입 검사와 lint, 프로덕션 빌드 통과.
- 새 SQL은 전체 기존 migration의 깨끗한 DB replay와 해당 assertion 통과.
- 수정 화면은 실제 로컬 desktop/mobile KO/EN 렌더링과 해당 동작을 확인. 개인 데이터가 필요한 상태는 명시적 fixture로 검증하며 실제 계정 검증으로 부르지 않는다.
- 승인된 변경만 커밋·main push. 필요한 DB migration, Notification worker, Vercel의 정확한 대상/커밋/최종 성공을 확인. 배포 이후 운영 UI 반복 검증은 하지 않는다.

## 1. 공통 언어 계약·로그인·문서 (주 에이전트)

- 작은 내부 locale helper를 만들어 `ko|en` 검증, 안전한 내부 path의 locale 교체, 중첩된 허용 returnTo의 locale 동기화에 사용한다. 기존 auth path allowlist, double-slash/backslash/외부 URL 방어를 우회하지 않는다. recursion depth 제한 및 URLSearchParams 사용. authIntent 식별자/행동은 유지한다.
- LoginPage의 모든 제품 문구·alt·aria를 locale별로 선택. 기본 returnTo `/`와 브랜드 홈을 locale-bearing 링크로 만들고, 기존 Apple 재인증 분기와 세션 유지·계정 전환 로직을 보존한다.
- Onboarding 언어 전환은 화면 언어뿐 아니라 허용 returnTo·중첩 LIVE 복귀 언어도 동기화. 로그인 intent 재개도 같은 계약을 사용한다.
- root에서 서버가 선택한 locale을 안정적인 React context로 내려준다. DocumentLocale의 client navigation updater가 context와 html lang을 같은 입력으로 갱신하도록 하되 PrivyProvider를 key 변경이나 remount하지 않는다. SDK custom header/message는 context locale을 사용한다. SDK 자체 지원하지 않는 옵션은 추가하지 않는다.
- PublicContentState는 context의 서버 초기 locale을 사용하여 KO 초기값→effect EN 전환을 없앤다. Stamp fallback에도 명시적으로 locale 전달.
- Kakao callback만 query가 없을 때 byus_locale cookie를 해석하는 예외를 공통 request/document 계약에 둔다. query가 있으면 우선. root metadata·html·callback screen·title이 같은 locale을 선택한다. 일반 페이지의 query-only/default-KO 정책은 유지한다.
- manifest는 locale별 description/lang/start_url, 동일 app id를 사용한다. metadata의 manifest URL에 locale 명시. Next metadata route의 요청 context와 SW 캐시 키를 함께 정리한다. localized not-found 추가.

## 2. 알림·DB·워커·독립 연결 페이지 (백엔드 작업자)

세부 설계: `artifacts/locale-audit-20260910/backend-implementation-plan.md`가 준비되면 본 계획에 통합한다.

- 기존 notification payload title/detail을 최종 UI 문자열로 신뢰하지 않고 종류·상태·context로 한영 projection. 과거 행도 동작하며 notification source key/id/read state는 유지한다.
- DB push claim이 locale을 전달하도록 additive migration. worker는 locale이 없는 기존 job에 KO fallback하여 혼합 버전 배포 허용. Web Push payload는 locale 포함; SW click은 해당 locale을 목적지에 추가. stored deepLink의 pathname-only 제약은 유지하고 이동 직전에 합성.
- Kakao delivery plan은 사용자 언어 snapshot을 보존하고 payload도 한영 생성. 기존 실제 외부 mode·활성화·동의 정책·EventBridge 상태를 바꾸지 않는다. provider 미설정이면 테스트 가능한 계약을 문서화하되 활성화나 실제 메시지 발송을 수행하지 않는다.
- 인증 category는 quiz locale projection과 manual의 backward-compatible EN 필드 또는 code mapping. 기존 관리자 writer가 새 필드를 몰라도 무효 데이터를 만들지 않도록 호환 경로를 정한다. 사용자/관리자 원문을 자동 추측 번역하지 않는다.
- 익명 팬 fallback은 null과 실제 nickname을 구분하여 locale별 표시. 닉네임 `팬`이라는 실제 사용자를 일괄 치환하지 않는다.
- 공지 invalid locale은 repository 오류와 구별해400. 정상 localized query 유지.
- Instagram 초대 시작에서 locale을 안전하게 받아 OAuth state/cookie/확인/삭제 상태 HTML과 privacy 링크에 보존. CSRF/state/owner/expiry 검사 유지.

## 3. 화면·접근성·작은 매핑 (화면 작업자)

- Notification Center ko-only 객체를 KO/EN으로 분리. 새 pending/read-all 실패·구독 권한 상태까지 포함. 행/자동 이동 링크는 locale helper로 합성. mutation lock/GET-only retry/owner guard는 보존.
- Passport loading/Stamp overlay name 현지화, LIVE 상세 `Live` 복귀 목적지는 locale-bearing LIVE 목록으로 정리.
- stage 정보 없는 Home 등급 fallback은 공통 fan tier helper를 재사용하여 Platinum/Diamond 포함. CHZZK EN 이름 통일.
- 운영 마감 시간은 기존 LIVE 계약과 동일 KST, 사용자 개인 제출/발급 기록은 기존 viewer-local time 유지. Collectible 마감에는 명시적 KST 표시. 날짜를 언어에 따라 임의 시간대로 바꾸지 않는다.

## 4. 수령인 입력 동선 G01 (계약 확인 후 별도 작업자 또는 주 에이전트)

세부 설계: `artifacts/locale-audit-20260910/recipient-implementation-plan.md`.

- 기존 owner `save_owned_benefit_recipient` 및 `recipientInputSchema`가 요구하는 이름·연락처·배송 주소·동의만 수집.
- locale-bearing owner route에서 인증/소유권/방법/현재 상태를 확인한 뒤 해당 필드만 표시. digital은 입력 불필요, pickup은 배송 주소를 요구하지 않는다.
- MY의 recipientRequired 상태에 입력 CTA를 연결하고 알림 경로도 동일한 목적지로 연결할 방법을 정한다.
- POST pending 잠금, 사용자 변경/언마운트 후 응답 무시, 실패/불확실 성공 후 GET 확인, 성공 상태/재시도 제공. PII를 URL·localStorage·로그에 저장하지 않는다. 소유권 오류는 다른 사용자의 당첨 정보를 드러내지 않는다.
- 동의문은 실제 저장·보관·파기 계약을 근거로 필수 수집 항목·목적·보유 기간·거부 시 제한을 KO/EN으로 표시. 새로운 법적 보관 기간을 임의로 만들지 않는다.

## 5. 정책 항목 처리

- C15: LIVE 및 운영 마감은 KST(명시), 개인 과거 활동 시각은 viewer-local로 유지. 단일 helper/문서로 용도 구분.
- C16: 기존 on-chain metadata는 고정 식별 정보이므로 name/description/trait의 영문 canonical 값을 유지. 기존 토큰 재발급·URI 변경 없음. 제품 UI에서 token type/status를 locale별로 표시하는 현 계약을 검증하고 정책 결정으로 종결.
- C10: 현재 provider 승인/설정 상태를 확인하고 payload의 KO/EN 계약까지 테스트한다. 실제 발송은 본 goal에서 요구하지 않는다. 외부 템플릿이 언어 지원을 제공하지 않아 사용자 기능 완료가 불가능한 경우에만 정확한 외부 의존성을 질문한다.

## 변경 소유권·통합 원칙

계획 승인 후 담당자에게 구체적 파일 목록과 migration timestamp를 할당한다. 같은 파일을 두 작업자가 수정하지 않는다. 서버/워커 작업자는 SQL 전담, 화면 작업자는 Notification Center 및 Passport/LIVE 작은 UI 전담, 주 에이전트는 공통 locale·auth·PWA 및 수령인 통합 전담을 기본으로 한다. 위험 검토자는 읽기 전용으로 원 요구사항과 계획/diff를 평가한다.

## 배포 순서·호환성

1. 전체 로컬 검증 및 독립 결과 검토를 마친다.
2. additive DB migration을 먼저 적용해 구버전 web/worker도 계속 동작하도록 한다. 기존 API/RPC 시그니처를 파괴하는 변경은 피하고 필요한 경우 versioned wrapper를 둔다.
3. worker 코드와 web 코드의 릴리즈 순서는 변경별 호환성 확인 후 확정한다. 자동 main 배포 전에 필요한 DB가 준비되어 있어야 한다.
4. worker는 정확한 Production AWS account/function/alias/config를 read-only로 확인하고 활성/비활성 운영 상태를 보존하는 code-only update-function-code를 사용한다. 기존 deploy 스크립트는 환경변수·EventBridge·maintenance Lambda까지 변경하므로 이번 release에 그대로 실행하지 않는다. function-updated-v2와 CodeSha256/LastUpdateStatus를 확인하며 mint/maintenance worker는 변경하지 않는다.
5. Vercel 정확한 project/repository/main commit 배포 READY 확인. 실패 시 해당 변경 범위만 복구/재배포하며 사용자 변경을 reset/stash하지 않는다.

## 진행 체크

- [x] 사용자 전체 구현·배포 승인 및 goal 생성.
- [x] 기존 격리 worktree를 최신 main72e8b35로 fast-forward; 조사 문서 보존.
- [x] 세부 계약 계획과 독립 위험 검토.
- [x] 구현 및 관련 로컬 검증.
- [x] 결과 위험 검토와 필요한 보완.
- [x] DB/worker/web 배포 최종 성공 확인.

- 환경 준비: npm ci --ignore-scripts로 최신 lockfile 동기화(제품 dependency 변경 없음). 검증 실행은 설치된 Node24.13.1(`/Users/jewel/.nvm/versions/node/v24.13.1/bin`)을 명시한다. 기존 own dev3017 서버는 소스 갱신 전 종료했고 root3000/다른3018은 보존했다.

## 독립 검토 반영 및 초기 검증

- 새 수령인 경로는 `/api/notifications?recipientLinks=1` 요청에서만 투영한다. 저장된 deep_link 및 opt-in 없는 구버전 요청은 기존 경로를 유지해 이미 열린 구버전 탭도 보호한다.
- 관리자 제외 범위를 지킨다. 인증 category는 공개/owner 읽기의 공통 매핑으로 처리한다. 알려진 category는 정확히 매핑하고 미매핑 manual category의 EN은 일반 분류 `Fan activity`로 표시한다. 이는 원문 세부 분류의 번역이 아니며 KO 원문은 유지한다. 관리자 schema/writer/publication validator는 변경하지 않는다.
- 최신 main `140571e`의 역할 migration이110000을 사용하므로 localization migration은 `20260910120000_localization_contracts.sql`로 예약했다.
- 백엔드 세부 문서의 광범위 deploy script 및 dev rollout 제안은 본 문서의 승인된 Production code-only 배포 경로가 우선한다.
- 공통 locale/auth/PWA 9개 파일84개 테스트 통과. 추가 locale provider SSR EN 및 KO↔EN에서 Privy mount1회 유지, onboarding/Proxy 테스트3개 파일23개 통과. 전체 통합 검증과 실제 로컬 렌더링은 구현 완료 후 진행한다.

## 배포 대상 현재 확인

- AWS profile `coredot-dev`, account `200151116034`, region `ap-northeast-2`, function `byus-notification-worker-prod`, runtime Node24, handler `index.handler`. 별도 alias 없음. 현재 `Active / Successful`, 알림 enabled=true, maintenance=false. EventBridge `byus-notification-worker-prod-every-minute` enabled, rate(1 minute). 코드 교체 전후 이 설정과 전체 configuration digest를 비교한다.
- Supabase CLI를 이 격리 worktree에서 `ByUs Production` (`gmrykvmtmuaeswpajteq`)에 연결했다. 읽기 전용 migration history에서 `20260910110000 celebrity_roles`까지 적용 확인. 관리 API 기반 `supabase db query --linked` 사용 가능. 적용 단계에는 새120000 하나만 추가되도록 확인한다.
- C16 근거: `apps/worker/src/metadata.ts`는 고정 version1 영문 credential name/description/trait와 immutable ipfs 자산을 생성한다. 기존 metadata 테스트에서 deterministic 출력·PII 차단·token 종류별 immutable path를 검증한다. UI locale 변경은 이 식별 메타데이터를 바꾸지 않는 것으로 처리한다.

- 실제 문서 검사에서 Next의 file-based `app/manifest.ts`가 metadata의 locale query URL을 덮어씀을 발견했다. `components/pwa-manifest.ts` 생성기와 명시적 `/manifest.webmanifest` route로 변경했고 KO/EN 실제 SSR `rel=manifest` href가 각각 `?locale=ko/en`임을 확인했다. manifest JSON만 검사하면 발견되지 않는 문제였다.
- Aside local 3024 desktop1440/mobile390:404 KO/EN 문구·홈링크·html lang·overflow 통과. 실제로그인SDK는 `Origin not allowed`로 초기상태에 머물러 본문은 real component+stubauth harness로 검증한다. SDK실제로그인 검증으로 표현하지 않는다. 증거 `artifacts/locale-audit-20260910/local-root-render/`.

## 최종 로컬 검증 및 배포 준비

- 관련 웹361/361, 워커213/213, 전체 lint 및 web/worker typecheck, production/Lambda build 통과.132개 migration 전체 replay 및 Kakao snapshot runtime fixture 통과.
- 실제 production build 문서 언어·manifest·history Playwright1개 통과. 수정화면 desktop/mobile 렌더링 통과. 실제 계정·실제 외부 수신 및 OS install을 검증했다고 주장하지 않는다.
- 독립 reviewer 최종 지적 모두 해소. Instagram 기존 form호환,실제수령상태 enum8종 KOEN16조합,Kakao생성당시 snapshot보정,recipient최신locale/중복방지 보완.
- Supabase linked dry-run 성공: 새 `20260910120000_localization_contracts.sql` 한 개만 적용 대상.
- 통합 main: `b538c7b` 이후 새 `d222885`도 반영. 원래 작업공간·다른 배포 변경 유지.

- 확대 검사 잔여3개 CSS 고정값 실패는 분리한 기존main d222885/b538c7b에서도 동일함을 확인했다. 이번 변경의 회귀가 아니며 기존 제품CSS를 테스트를 맞추기 위해 바꾸지 않았다. 누락된 ignored reference3개는 원본동일hash로 복사해 관련5개 테스트 통과.
- SupabaseProduction120000 적용 및 migrationhistory 확인 완료.

- Notification worker Production code-only 교체 성공: `Active / Successful`, 배포ZIP SHA256 일치. EventBridge/schedule/target/concurrency 및 환경변수·handler 등 운영 설정 보존. AWS Auto runtime ARN만 변경됐으며, 과거 INIT_START ARN을 대입하면 배포 전 전체 설정 digest가 정확히 재현되는 것으로 차이를 확인했다. 증거 `deployment/notification-after.json`, `notification-runtime-change-proof.json`.

## 완료 체크포인트

- 코드 release `1d07748fbaab2675b9ac7858c793e02afc977e44`: Vercel `dpl_J48d7W5erXMgUEy5gyHhckExgxHu` Ready. byus.kr/www.byus.kr alias도 Vercel 도구로 같은 배포 확인.
- DB120000 및 notification Lambda의 정확한 코드 hash/Active/Successful 확인. AWS Auto runtime 변경 외 운영 설정 동일.
- 남은 승인 범위 작업 없음. 실제 외부 수신/Google·Apple 로그인/OS 설치는 범위 밖 검증으로 명시. 기존 main CSS source-contract 실패3개는 별도 기준선 기록.
- 로컬 Instagram 오류 shell KOdesktop/ENmobile 추가 rendered검증 통과. 임시 브라우저탭/검증서버 정리.
