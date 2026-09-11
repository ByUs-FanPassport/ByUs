# 팬 라운지 웹 구현

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
- PostgreSQL 17 빈 로컬 DB에 전체 migration 150개 적용 및 `supabase/tests/fan_lounge_behavior.sql` 통과. ACL, 작성자/관리자 권한, 멱등성, 횟수 제한, 인용 범위, 삭제·숨김·보관 조건, 실제 좋아요 집계 검증.
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
