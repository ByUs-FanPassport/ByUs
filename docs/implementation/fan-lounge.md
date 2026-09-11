# 팬 커뮤니티 전체 공개 전환 · 2026-09-12

사용자가 체크박스 제거와 전체 공개, 구현 후 배포를 승인했다. 아래 이전 기록의 공개 동의 정책은 이번 변경으로 대체한다.

- active 사용자의 완료된 좋아요 또는 issued 패스포트 참여자를 중복 제거해 팬 수에 포함한다. 기존 공개 설정의 false·미설정 여부와 무관하게 닉네임과 번들 캐릭터를 표시한다. 상단 최대 5개, 리더보드 탭 최대 24개이며 전체 팬 수는 별도로 집계한다.
- 팬 활동 체크박스와 공개 인원·동의 안내 문구를 제거했다. 기존 visibility 기록은 보존하되 GET/PATCH API는 비캐시 410을 반환하고 두 legacy RPC의 모든 외부 실행권한을 회수했다. `publicFanCount`는 이전 클라이언트 호환을 위해 전체 `fanCount`와 같은 값으로 유지한다.
- 이메일, 사용자 ID, 업로드한 개인 사진은 공개 응답에 포함하지 않는다. creator 공개/보관/언어 조건과 실제 순위표의 501 패스포트 기준은 유지한다.
- 팬 모임의 포인터·터치·키보드·동작 줄이기 및 응원댓글은 앞선 승인 구현을 함께 배포한다. 별도 배포된 가이드 사진과 최신 main의 엘리나 미션 변경을 보존한다.

검증: UI·경로 관련 40개 통과. 새 migration 30000→30001의 빈 로컬 PostgreSQL 재생 및 `fan_community_cheers_behavior.sql` 통과(기존 이메일 충돌 검사의 별도 실행기 제한은 아래 기록과 동일). 기존 `fanpage_community_behavior.sql`도 변경된 공개 정책·언어 조건에 맞춰 갱신한 뒤 통과했다. 독립 결과 검토에서 P1/P2 없음. 전체 공개 정책은 새로 검증했으며 변경하지 않은 물리·터치·댓글 동작의 기존 성공 근거는 재사용한다.

최신 main `584f145`에 구현을 통합했으며, 엘리나 미션 진입 컴포넌트와 응원댓글을 함께 유지했다. 통합 테스트 81개, 변경 파일 ESLint, Next production build(전체 TypeScript 포함)가 통과했다. KO/EN × 390/1440px 전체 공개 화면을 확인했고, 초기 캡처는 페인트 완료를 기다린 최종 이미지로 교체했다. 작업용 node_modules 외부 심볼릭 링크 때문에 발생한 Turbopack 오류는 해당 링크만 APFS 복사본으로 바꿔 해결했다.

운영 DB에 `20260912030000`과 `20260912030001`, migration ledger를 한 트랜잭션으로 적용하고 COMMIT을 확인했다. 새 조회/작성 RPC는 service_role 전용이며 기존 visibility RPC는 service_role도 실행할 수 없다. 기존 설정 기록·댓글·개인 데이터는 삭제하지 않았다. 운영 테스트 데이터를 만들지 않았다. 현재 기록은 웹 푸시 직전이며 정확한 푸시 커밋과 자동 배포 시작 상태는 완료 응답에 기록한다.

- migration SHA256: 30000 `ad31a1a79064807ca63576934de0bc00c3c784f4497a4ccd644c5bcc5b14e25e`, 30001 `a66672fd2308b892b85036686354f0b125877a13c8f41487377724e40a44459f`.
- 로그: `/tmp/byus-fan-community-public-profiles.log`, `/tmp/byus-public-integration-tests.log`, `/tmp/byus-public-integration-build-final.log`, `/tmp/byus-public-profiles-production-apply.log`.
- 화면 증거: `apps/web/test-results/fan-public-profiles/`. 실제 OAuth 및 운영 UI 동작은 별도 검증하지 않았다.

## 이전 팬 커뮤니티 로컬 구현

2026-09-12 · `codex/fan-lounge` · 기준 커밋 `1080e30`

사용자가 초기 커뮤니티를 **팬 수 + 프로필 썸네일 + 응원댓글**로 선택했다. 이번 변경은 로컬 구현·검증 범위이며, 아래 기존 라운지 배포 기록과 구분한다.

- 팬페이지 상단은 active 사용자의 완료된 좋아요 또는 발급된 패스포트 참여 고유 인원을 집계한다. 공개 동의한 팬 캐릭터 최대 5개와 더보기 표시를 하트 옆에 두고, 누르면 리더보드 탭의 팬 모임 화면으로 이동한다. 업로드한 프로필 사진·이메일·사용자 ID는 반환하지 않는다. 공개를 해제하면 같은 페이지의 썸네일을 갱신하며 팬 수는 유지한다.
- 페이지 내 응원댓글은 1~1,000자 작성, 최신 5개와 이전 페이지, 내 삭제를 지원한다. 닉네임·캐릭터 공개 안내를 제공한다. 답장·반응·대화 자동 갱신 기능은 제공하지 않는다.
- 기존 top-level 라운지 메시지를 응원댓글로 읽고, 과거 답글은 기록만 보존한다. 관리자 숨김과 감사 로그는 기존 관리 화면을 사용한다. 공지 댓글은 별도 저장소를 유지한다.
- `/c/[slug]/lounge`는 같은 언어의 팬페이지 `#cheers`로 이동한다. 기존 공개 lounge GET/POST와 reaction PUT은 의존성 생성 전에 비캐시 404를 반환한다. 기존 owner DELETE는 유지한다.
- 새 API: `/api/celebrities/[slug]/fans`, `/api/celebrities/[slug]/cheers`, `/api/cheers/[id]`. 새 migration: `20260912030000_fan_community_cheers.sql`. 새 RPC는 service_role만 실행한다. 댓글 작성은 기존 SQL 멱등성·분당 10회 제한을 재사용한다.
- 계정 전환 시 본문·소유권·이전 요청을 폐기한다. 성공 응답 유실 시 같은 본문은 같은 멱등 키로 재시도한다.

검증 완료: 새 서버 테스트 13개, 종료 경로·팬페이지·공개 설정 회귀 34개, 신규 UI 행동 5개 통과. 빈 로컬 PostgreSQL에 실제 migration 파일 169개를 적용했고 팬 커뮤니티 SQL 행동 검증 및 브라우저 통합 검증이 통과했다. 독립 결과 검토에서 P1/P2 없음. 변경 파일 ESLint·전체 TypeScript·Next production build 통과.

- 실제 fan/admin gate·API·PostgreSQL을 사용한 브라우저 검증: 팬 수·공개 썸네일·답글 제외·구 API 종료, KO/EN 1440px·390px 렌더링, 성공 응답 유실 후 단일 저장, 두 계정의 작성과 소유자 삭제, 다른 계정 삭제 거부, 관리자 숨김, 공개 해제 후 썸네일 제거와 인원 유지. 브라우저 runtime 오류와 모바일 가로 넘침 없음.
- 공개 설정 저장 직후 새로고침 없이 썸네일을 제거하는 동작과 계정 전환 중 토큰 대기 취소는 React 통합 테스트에서 별도로 검증했다. 공지 댓글 저장소 분리는 SQL 행동 테스트로 검증했다.
- 신원은 테스트용이며 기타 기존 홈 패널 일부는 fixture다. 실제 OAuth·운영 데이터·운영 화면 검증은 포함하지 않았다. 화면의 인원·댓글은 검증 데이터다.
- 실행: `bash scripts/verify-community-local.sh`. 증거: `apps/web/test-results/fan-community-local/evidence.json`과 같은 폴더의 `community-{ko,en}-{390,1440}.png`. 로그: `/tmp/byus-community-local.log`, `/tmp/byus-community-build.log`.
- 새 migration의 운영 적용, 커밋·푸시·배포는 이번 변경에서 하지 않았다. 기존 Elina 가이드 사진 변경을 보존했다.

## 리더보드 탭과 포인터 반응 · 이전 로컬 구현 기록

벤치마킹 후 사용자의 `define-goal 진행` 승인에 따라 리더보드 탭 본문에 팬 모임을 연결했다. 탭과 하트 옆 프로필 묶음은 같은 URL로 이동한다. 모임 진입은 인원에 관계없이 허용하고 실제 팬점수 순위표는 기존 501 패스포트 조건을 유지한다. 순위 공개 시에도 모임은 위에 표시한다.

- 캐릭터는 같은 44px 크기이며 영역 안에서 천천히 방향을 바꾼다. 움직이는 마우스 주변만 약하게 영향을 받고, 호버·키보드 포커스·터치 선택 대상 한 개만 고정한다. 닉네임은 해당 캐릭터 곁에 표시한다.
- 캐릭터를 끌고 놓으면 이동 속도가 서서히 줄어든다. 움직임은 최대 속도와 충돌 경계로 제한한다. 이전 포인터 속도는 80ms가 지나면 적용하지 않는다.
- 터치에서는 탭으로 닉네임을 유지하고 빈 곳을 누르면 해제한다. `touch-action:none`은 캐릭터 버튼에만 적용해 빈 공간에서 시작하는 페이지 스크롤을 유지한다. 취소된 드래그는 포인터 캡처와 선택 상태를 정리한다.
- 일시정지·재생, 숨겨진 탭의 프레임 정지·복구, 시스템 동작 줄이기를 지원한다. 동작을 멈춘 상태에서도 닉네임을 읽을 수 있다. 모달은 사용하지 않는다.
- 새 DB·API 정책 변경은 없다. 이전의 실제 참여자 합집합·공개 동의·최대 24개·계정 경계 검증을 재사용했다. 응원댓글과 별도 배포된 가이드 사진은 보존했다.

검증: 물리 계산 10개, 팬페이지·커뮤니티 28개, 드래그 취소·정지/재생/숨김 컴포넌트 2개, 총 40개 통과. 전체 TypeScript, 변경 파일 ESLint, Next production build 통과. 독립 결과 검토에서 추가 P1/P2 없음.

실제 컴포넌트·fan API/순위 API·로컬 PostgreSQL을 사용하는 브라우저에서 KO/EN × 1440/390/320px의 탭 진입, 24개 표시, 호버 대상 고정과 이웃 이동, 드래그·해제, 키보드 포커스, 정지, 화면 경계를 확인했다. Chromium 모바일 터치 에뮬레이션에서 탭·드래그·빈 공간 세로 스크롤을 확인했다. reduced-motion, 공개 프로필 0개, 브라우저 오류 없음도 통과했다. 실제 휴대전화와 실제 OAuth는 미검증이다.

증거: `apps/web/test-results/fan-motion-local/evidence.json` 및 같은 폴더의 이미지. 로컬 검증 데이터이며 운영 인원을 나타내지 않는다. 브라우저 로그는 `/tmp/byus-fan-motion-browser-touch-scroll-test-failure.log`(데스크톱 6개 조합 성공 포함)와 `/tmp/byus-fan-motion-touch.log`(터치·동작 줄이기·빈 상태 최종 성공), 빌드는 `/tmp/byus-fan-motion-build.log`에 있다. 초기 테스트가 움직이는 버튼의 안정화를 기다리거나 빈 공간 대신 원 가장자리를 스와이프하던 문제를 테스트 좌표·입력 방식에서 수정했다. 통과한 데스크톱 결과는 제품 코드가 동일해 재사용했다. 기존과 같은 로컬 DB 파생 실행기 조건은 아래 기록을 따른다.

이번 승인 범위는 로컬 구현·검증이며 커밋·푸시·운영 DB 적용·배포는 수행하지 않았다.

## 순위 없는 팬 모임 오버레이 · 이전 구현 기록


사용자가 작은 프로필 묶음에서 구슬 접시처럼 움직이는 화면으로 펼치는 방향을 명시적으로 승인했다. 기존 응원댓글은 보존하며 리더보드 활성화·채팅·게임·푸시·배포는 이번 범위에 포함하지 않았다.

- `fanCount`: active 사용자의 완료된 좋아요 또는 issued 패스포트 합집합에서 중복 제거. `likeCount`는 기존 좋아요 집계를 별도로 유지한다. `publicFanCount`는 이 중 프로필 공개 동의 인원이며, 서버는 닉네임·선택 캐릭터 최대 24명을 반환한다.
- 펼친 화면의 캐릭터는 같은 크기로 배치하고 점수·등급·순위·접속 상태를 표시하지 않는다. 누르거나 키보드 포커스를 주면 닉네임을 표시하고 움직임을 멈춘다. 사용자가 일시정지할 수 있고 시스템 reduced-motion 및 숨겨진 탭에서는 움직이지 않는다. 팬 0명 또는 비공개 상태를 가짜 캐릭터로 채우지 않는다.
- 기존 `Dialog`의 포커스 격리·Escape·닫기·트리거 복귀를 재사용한다. 작은 묶음의 사진은 22px지만 클릭 영역은 44px 이상이다.
- 320px 화면의 24번째 자리 누락을 독립 검토에서 발견해 좁은 화면의 접시 높이를 400px로 늘렸다. 폭 244/246/266px에서 24개 보존 및 60초 움직임의 경계·겹침 검증을 추가했다. 포털 바깥에서 글꼴 상속이 끊기는 문제는 Pretendard 명시로 수정했다.

검증: 새 집계 API 13개, 팬페이지·커뮤니티 UI·물리 시뮬레이션 31개 및 좁은 폭을 포함한 최종 시뮬레이션 6개 통과. 169개 migration을 적용한 로컬 PostgreSQL에서 패스포트 단독·좋아요와 중복·비활성 제외·공개 해제·24개 제한 SQL 검증 통과. KO/EN 각각 1440/390/320px에서 실제 API와 합성 인증으로 열기·움직임·멈춤·닉네임·포커스·Escape·모든 원의 화면 내 배치를 확인했다. reduced-motion 및 공개 프로필 0개 상태도 통과했다. 새 컴포넌트 Next build 통과 후 글꼴·빈 상태·좁은 폭 보완에 대해 렌더링·타입·ESLint 검증을 완료했다.

증거는 `apps/web/test-results/fan-marbles-local/evidence.json`과 같은 폴더의 화면 이미지다. 이미지의 인원·닉네임은 로컬 검증 데이터다. 운영 데이터 또는 실제 OAuth 검증이 아니다. SQL 로그 `/tmp/byus-fan-community-focused.log`, 최종 화면 로그 `/tmp/byus-fan-marbles-finish.log`, 빌드 로그 `/tmp/byus-fan-marbles-build.log`를 보존했다. 이번 임시 DB 실행은 기존 알림 이메일 충돌 검사 스크립트의 확인된 heredoc 정체 때문에 해당 무관한 검사를 생략한 파생 실행기를 사용했다. 해당 알림 검사를 새로 통과했다고 주장하지 않으며 저장소의 기본 검증 스크립트는 변경하지 않았다.

## 기존 라운지 구현·배포 기록

2026-09-12 · `codex/fan-lounge` · 기준 커밋 `1dfc247`

## 구현 범위

- `/c/[slug]`: 실제 누적 좋아요 참여 인원, 라운지 대화 2개 미리보기, 참여 링크. 모바일에서는 팬 활동 요약 다음에 라운지를 배치한다.
- `/c/[slug]/lounge`: 저장되는 메시지, 답장, 6종 이모지 반응, 내 메시지 삭제, 이전 대화, 새 메시지 안내. KO/EN을 지원한다.
- `/admin/lounge-messages`: 관리자 메시지 조회, 사유를 남기는 숨김과 감사 기록. viewer는 숨길 수 없다.
- 기존 공지 및 공지 댓글은 별도 테이블·API·화면을 유지한다.

좋아요 인원은 해당 creator의 `fan_reactions.business_status='completed'`인 고유 `app_user_id` 수다. CMS `fan_count`, 패스포트 보유자 수, 접속 중 인원과 구분하며 mint 상태로 제한하지 않는다.

## 동작·권한

- 대화는 3초 간격으로 자동 갱신한다. 화면이 숨겨지거나 오프라인이면 중지하고 focus/online/visibility 복구 시 즉시 재조회한다. 오류는 최대 30초까지 간격을 늘린다. WebSocket과 접속자 수는 사용하지 않는다.
- 한 페이지는 최대 50개다. 이전 페이지도 고정된 상단 커서를 기준으로 다시 읽어 삭제·숨김·비활성 작성자와 인용문의 변경을 반영한다. 재접속 중 쌓인 대화는 최신 페이지부터 이전 페이지로 모두 조회할 수 있다.
- 새 메시지는 `(createdAt,id)` 기준으로 구분한다. 정확한 개수를 알 수 없는 경우 숫자 없는 안내를 표시한다. 계정 전환 시 작성 중 본문·답장·소유권 상태를 초기화하고 이전 요청 결과를 폐기한다.
- 클라이언트가 Supabase 테이블을 직접 읽지 않는다. 기존 Privy 검증과 active 사용자 gate를 거쳐 서버 전용 RPC를 호출한다. 모든 응답은 `private, no-store`, `Vary: Authorization`을 사용한다.
- 메시지는 1~1,000자, 요청 본문은 8KiB, 사용자당 분당 10회로 제한한다. 동일 멱등 키의 creator·본문·답장 대상이 같으면 같은 결과를 돌려주며, 다르면 충돌로 거절한다.
- 반응은 원하는 최종 상태를 보내며 동일 상태 재요청은 부작용이 없다. 상태 변경 기록을 남겨 취소·재추가도 분당 30회 제한에 포함한다.
- 다른 creator의 메시지에 답장할 수 없다. 삭제·숨김된 원문의 본문과 닉네임은 인용에서도 제거한다.

## 검증 근거

- 서버 라운지 단위 테스트 16개 통과.
- 기존 팬페이지·공지 댓글 라우트 회귀 테스트 33개 통과.
- PostgreSQL 17 빈 로컬 DB에 전체 migration 적용(당시 출력값 `migrationsApplied: 150`은 실제로 public 테이블 수였음) 및 `supabase/tests/fan_lounge_behavior.sql` 통과. ACL, 작성자/관리자 권한, 멱등성, 횟수 제한, 인용 범위, 삭제·숨김·보관 조건, 실제 좋아요 집계 검증.
- 독립된 두 테스트 계정 브라우저에서 새로고침 없는 수신, 답장·반응 동기화, 동시 중복 전송, 성공 응답 유실 후 재시도, 오프라인 복구 검증.
- 65개 신규 메시지 재접속·이전 페이지 조회, 과거 페이지 숨김 반영, 최신 글 삭제 시 새 메시지 오집계 방지, 계정 전환, 영어 비로그인 화면 검증.
- 기존 공지 댓글 작성 후 라운지와 별도로 저장되는지 확인.
- PC 1440px / 모바일 390px 실제 컴포넌트 렌더링 확인. 모바일 가로 넘침이 없고 입력창이 화면 안에 있다.
- 일반 Next production build 실행에서 미인증 및 로컬 테스트 토큰을 fan/admin API 모두 거절하는 6개 검사 통과.
- 변경 파일 ESLint, TypeScript 및 Next build 통과.

### 검증 환경의 경계

브라우저 통합 검증은 별도 loopback 전용 Vite 실행기에서 수행했다. Privy 신원 검증만 테스트 신원으로 대체했고, 실제 fan/admin 인증 gate·라우트·PostgreSQL 저장/RPC를 사용했다. 홈의 기존 기타 패널은 fixture다. 실제 Google/Apple OAuth 로그인, 운영 DB, 운영 배포 및 운영 동작은 이번 검증에 포함하지 않았다. 테스트 인증 코드는 Next 애플리케이션에서 import하지 않는다.

`apps/web/test-results/lounge-local/evidence.json`에 상세 검증 항목과 이미지 경로가 있다. `home-desktop.png`, `home-mobile.png`, `lounge-desktop.png`, `lounge-mobile.png`, `lounge-english-guest.png`, `lounge-admin.png`를 저장했다. 성공한 대화 검증은 재사용하고 마지막 홈 검증과 화면 확인만 별도로 이어갔다.

## 재현

Node/npm과 PostgreSQL의 `initdb`, `pg_ctl`, `psql`, Playwright Chromium이 필요하다. 아래 명령은 임시 로컬 DB만 사용하며 종료 시 정리한다.

```sh
BYUS_CLEAN_DB_PORT=55479 \
BYUS_CLEAN_DB_ASSERTION_FILE=supabase/tests/fan_lounge_behavior.sql \
BYUS_CLEAN_DB_SHELL_ASSERTION_FILE=scripts/verify-lounge-local.sh \
bash scripts/verify-clean-migration-chain.sh

npm exec --workspace @byus/web -- vitest run server/lounge/routes.test.ts components/celebrity-fan-page.test.tsx server/fanpage/routes.test.ts
npm run typecheck
npm run build
node apps/web/e2e/lounge-local/production-auth.mjs
```

## 적용 상태

2026-09-12 사용자의 배포 요청에 따라 운영 DB에 `20260912010000_fan_lounge.sql`과 migration ledger를 한 트랜잭션으로 적용했다. 세 테이블의 강제 RLS·직접 접근 차단과 여섯 RPC의 서버 전용 실행 권한을 확인했다. 운영 테스트 데이터는 만들지 않았다.

- 구현 커밋: `af3d0dc`. 원격 main `45ca609`를 충돌 없이 통합한 커밋: `7f28e31`.
- 통합 영향 검증: 팬페이지·클라이언트 이벤트 테스트 29개 및 프로덕션 빌드 통과. 앞서 통과한 SQL·브라우저·인증 검증은 재사용했다.
- 운영 migration SHA256: `b02e149847ea278e5c958740bb1a41f76f56008262a2c856d5701d4e36513f1a`.
- 배포 경로: 현재 커밋을 main에 푸시하면 Vercel이 자동 배포한다. 이 기록 작성 시점에는 DB 적용을 완료했고 웹 푸시를 준비 중이다. 정확한 푸시 커밋과 배포 시작 상태는 배포 결과에서 확인한다.
- 일반 배포 범위는 로컬 검증·푸시·해당 커밋의 자동 배포 시작까지다. 운영 UI 동작은 직접 검증하지 않았다.

기존 `npm run dev`는 운영 DB를 참조할 수 있으므로 쓰기 검증에 사용하지 않는다.
