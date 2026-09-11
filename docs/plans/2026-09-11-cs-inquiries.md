# ByUs 자체 CS 문의

## 목표와 범위
사용자는 MY의 문의 내역에서 새 문의, 대화 확인, 추가 메시지를 이용한다. 운영자는 기존 관리자에서 문의 목록·대화를 읽고 답변·처리 완료를 관리한다. KO/EN, 기존 인증·관리자 권한을 유지한다. AI, 첨부 파일, 외부 알림, 외부 CS 연동, 운영 배포는 이번 범위 밖이다. 문의와 대화 이력은 자동 삭제하지 않으며 기존 계정 비활성화 정책을 유지한다. 외부 알림 없이 화면을 열면 최신 답변을 확인하며 새로고침과 주기적 갱신을 지원한다.

## 구현 계약
- `/my/inquiries`, `/my/inquiries/[id]`: 기존 FanAppFrame·FanAction 활용. 로그인 전에는 문의 작성 대신 로그인 후 돌아오기. 로딩·빈 목록·오류·재시도 상태를 구분한다.
- `/admin/inquiries`, `/admin/inquiries/[id]`: AdminOperationsShell과 useAdminSession 활용. viewer는 조회만, operator/admin은 답변·처리 완료 가능.
- `cs_inquiries`: 소유 app_user_id, 제목(1–120자), locale, 상태(open/answered/resolved), 생성·갱신 일시, 단조 증가 version. `cs_messages`: inquiry_id, 실제 작성 사용자·관리자 ID, 본문(1–4000자), 멱등성 키, 생성 일시.
- 최초 접수 시 문의와 첫 메시지를 한 트랜잭션에 저장. 관리자 답변은 answered, 사용자 추가 메시지는 open, 관리자 처리 완료는 resolved. 완료 후 사용자 메시지는 문의 재개. row lock으로 메시지·상태 변경 직렬화. 상태 변경은 마지막으로 읽은 정수 version을 제출하여 새 메시지를 읽지 않은 채 완료하는 경쟁을 방지한다.
- 서버는 기존 authorizeFanRequest/authorizeAdminSession을 사용한다. 클라이언트가 actor ID를 지정할 수 없다. 모든 RPC는 active 사용자 또는 assert_active_admin을 재확인하며 서비스 역할만 실행 가능. 테이블은 RLS를 켜고 직접 접근을 모두 회수한다. 다른 사용자 문의는 존재 여부와 무관하게 404.
- 문의 생성과 메시지 전송은 UUID 멱등성 키를 보존하여 재시도 중복을 방지한다. 동일 키의 다른 내용은 409. 사용자 단위 생성·메시지 rate limit, 스트리밍 요청 크기 제한, 입력·출력 스키마 검사. 관리자 답변/완료 감사 로그에는 본문을 넣지 않는다.
- 목록은 최신 갱신순으로 20건씩 커서 조회, 관리자 상태 필터 제공. 대화는 오래된 메시지도 조회 가능하게 50건씩 과거 페이지 조회. 개인정보 응답은 private/no-store, 페이지 noindex.

## 검증 및 종료 기준
- [x] DB migration replay 및 SQL 시나리오: 전체 문의 흐름, 재시도·충돌, 사용자 격리, inactive·viewer·non-admin 차단, 서비스 역할 외 RPC/테이블 접근 금지, 상태 경쟁.
- [x] route 테스트: 인증 필수, actor 주입·입력 변조 차단, 오류 매핑, 실제 계약 응답.
- [x] UI 테스트: 전송 실패 시 초안 유지, 소유자 전환 시 내용 제거, KO/EN, 처리 상태, 권한별 행동.
- [x] 필수 CI 대상 테스트, typecheck, lint, build.
- [x] 로컬 렌더링 및 사용자→관리자→사용자 흐름, 모바일/데스크톱·키보드·접근성 확인. 실제 DB 근거와 UI 테스트 인증 대체 범위를 명시한다.

## 진행
- 기준 checkout: 1792b94, 시작 시 변경 없음.
- 기존 fanpage RPC 권한 패턴, admin session, owned resource 훅, clean migration harness 확인.
- 설계·구현 독립 검토 완료. 기존 승인된 목표 안에서 진행하며 유료 계약·운영 데이터 변경·인증 정책 중대 변경이 필요하면 확인한다.

- 설계 독립 검토 반영: timestamp 대신 version으로 상태 경쟁 차단. 별도 Vite E2E harness에서만 테스트 인증·로컬 identity/RPC adapter 사용, 제품 빌드에는 테스트 인증 경로를 넣지 않는다.


## 완료 근거 (2026-09-11, 현재 worktree 변경분)
- 사용자 진입: MY의 문의 내역, 공통 푸터 문의하기, 이용 가이드, 혜택 문의 버튼. 사용자 `/my/inquiries`, 관리자 `/admin/inquiries`; 한국어·영어 모두 구현.
- `bash scripts/verify-cs-local.sh`: 147 migration clean replay + CS SQL fixture + 브라우저/실제 DB 통합 10개 시나리오 PASS. `apps/web/test-results/cs-local/evidence.json`, `/tmp/byus-cs-local-final.log`.
- 브라우저 근거: 생성→답변→사용자 추가 메시지→완료→재접속 이력 유지, 답변 유실 후 재시도 중복 방지, cross-owner/non-admin/viewer 접근 차단, 동시 동일 키 생성·전송과 완료 경쟁, 320px 키보드 전송, 360px/1440px 렌더링. 팬·관리자 axe 위반 0건. 스크린샷은 `apps/web/test-results/cs-local/*png`.
- 로컬 통합은 Privy 검증만 합성 계정으로 대체한다. 제품의 fan/admin authorization guard, PostgreSQL identity/allowlist/audit 조회와 서비스 역할 RPC는 실제 실행한다. Next Link/Image/router는 테스트 shell adapter를 사용하며 실제 Privy 로그인·Supabase PostgREST 전송·운영 동작의 증거는 아니다. 제품 코드에는 테스트 인증 경로를 추가하지 않았다.
- `node apps/web/e2e/cs-local/production-auth.mjs`: 일반 Next 빌드에서 인증 없음·합성 fan/admin 토큰 거부 6건 PASS (`/tmp/byus-cs-production-auth-2.log`). fake 설정과 `.invalid` 주소만 사용했으며 실제 계정/운영 DB에 연결하지 않는다.
- CS route 15 + UI 10 테스트 PASS. 관련 화면·공유 shell 회귀 128건은 `/tmp/byus-cs-regression.log`의 127 PASS와 푸터 신규 진입 계약 변경 후 `/tmp/byus-cs-footer-final.log` 6 PASS로 확인. 마지막 변경은 새 CS 링크를 예상하도록 기존 푸터 assertion을 갱신한 것이다.
- 전체 웹 테스트: 421파일/3,128건 PASS, 5파일/5건 FAIL (`/tmp/byus-cs-web-tests.log`). 변경 전 HEAD 1792b94를 별도 디렉터리에 추출해 동일 5건 실패를 재현 (`/tmp/byus-cs-baseline-tests.log`). 실패 원인은 ① creator raffle 재시도 버튼의 기존 이름 불일치 ② legal navigation의 기존 테스트 범위 불일치 ③ 추적되지 않은 기존 invariant ledger 없음 ④⑤ 추적되지 않은 브랜드 원본 두 파일 없음. CS 변경과 무관하여 수정하지 않았다.
- 기존 CI가 지정한 관련 로컬 검증: web typecheck, 최종 Next build(TypeScript 포함), lint:web PASS; worker typecheck/build 및 39파일/479테스트 PASS; `npm run security:backend-db` 147 migration 및 역할·동시성 검사 PASS; `forge test --root contracts` 9테스트 PASS. 각각 `/tmp/byus-cs-{typecheck,build-final,lint-final,worker-types,worker-build,worker-tests,security,contracts}.log`.
- 새 `.github/workflows/cs-inquiries.yml`은 CS route/UI, SQL/로컬 브라우저 흐름, 일반 빌드의 합성 인증 거부를 자동 확인한다. 원격 CI는 푸시하지 않아 실행하지 않았다.
- 독립 보안 검토에서 발견한 생성/추가 메시지 작업 종류별 멱등성 충돌과 50건 이상 새 메시지로 인한 이력 단절은 수정·회귀 검증했으며 잔여 지적 없음.
- 커밋·푸시·운영 migration 적용·배포는 수행하지 않았다. 실패 로그는 보존했고 로컬 통합용 DB/서버/브라우저는 종료 시 정리된다.


## 배포 진행 (2026-09-11, 사용자 승인: 배포)
- 후속 사용자 요청으로 운영 DB 적용 및 main 자동 배포를 승인받았다. 위 운영 배포 제외·미수행 기록은 최초 로컬 구현 단계의 범위와 결과다.
- 구현 커밋 `6268989`, 최신 `origin/main` `4ceb755`와 충돌 없이 통합. CS 소스·인증 경로·의존성 변경 없음. 기존 검증을 재사용했다.
- 통합 추가 확인: `bash scripts/verify-cs-local.sh` DB/브라우저 10개 시나리오 PASS, `npm run typecheck` PASS. `/tmp/byus-cs-deploy-integration.log`, `/tmp/byus-cs-deploy-typecheck.log`.
- 운영 프로젝트 `gmrykvmtmuaeswpajteq`에 `20260911140430_cs_inquiries.sql`과 migration ledger를 하나의 transaction으로 적용했다. schema reload 통지 완료.
- 적용 후 두 테이블의 forced RLS, 세 역할의 직접 테이블 접근 금지, 다섯 RPC의 service_role 전용 실행 권한을 확인했다. `/tmp/byus-cs-production-migration.log`.
- 애플리케이션 rollback 시 이전 배포로 되돌려도 신규 CS 테이블은 이력 보존을 위해 유지한다. 이번 migration은 기존 테이블·데이터를 변경하지 않는다.
