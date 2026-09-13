# 독립 홈 배너 구현

## 목표와 범위
회차별 LIVE 공개와 홈 대형 배너를 분리한다. 관리자에서 정기 방송/일반 안내 배너를 등록·공개·정렬하고 KO/EN desktop/mobile 이미지를 관리한다. 같은 셀럽의 LIVE 4개가 캘린더에 남아도 공개 정기 배너는 1개다. 기존 Elina 안내, 하단 LIVE 목록, 예약·알림·참여 데이터는 보존한다. 로컬 구현·검증까지만 수행하며 운영 변경·push·배포·최종 이미지 제작·실제 일정 입력은 제외한다.

## 설계
- home_banners(id, kind, celebrity_id, publication_status, sort_order, revision) 및 home_banner_localizations(locale, title, description, cta_label, href, alt, desktop_asset_id, mobile_asset_id). 이미지 업로드는 기존 public-image-assets API 재사용.
- regular_live는 celebrity 필수, 같은 셀럽의 published regular_live 최대 1개(partial unique index). draft 여러 개 허용.
- 초안 미완성 저장 가능. 공개/공개 상태 저장에는 KO/EN 제목·CTA·링크·alt·desktop 이미지 필수. 모바일 누락은 동일 언어 desktop contain으로 대체, 언어 교차 대체 금지. 이미지 로드 오류 시 문구/CTA 유지.
- 내부 경로 또는 HTTPS 링크만 허용. 프로토콜 상대 URL·역슬래시·제어문자 금지. 내부 링크는 현재 locale을 적용하고 기존 query/hash 유지.
- 기존 관리자 auth + assert_active_admin, service_role 전용 RPC, RLS, 감사 로그, expectedRevision/row lock. 정렬은 전체 ID/revision 목록을 원자적으로 검증·갱신.
- HomePage의 기존 featuredLives 조회는 하단 LIVE/예약 표시용으로 보존하고 homeBanners 조회를 추가. 대형 캐러셀만 새 데이터를 사용하며 마지막 ElinaGuideCard와 기존 접근성·모션 유지.
- 배너 조회 오류는 라이브 조회 오류와 분리하며 기존 안내는 보존. 기존 테이블/자산 삭제 없음. 롤백은 앱 복귀 및 신규 데이터 보존.

## 검증
- 실제 로컬 PostgreSQL migration replay와 권한/공개 조건/중복/충돌/정렬/감사 및 캘린더 4개 유지 검사.
- 도메인·API·저장소·관리자·홈 테스트. 관리자 navigation, home 기존 검사 갱신.
- typecheck, build 및 admin-ui/fan-design-system/backend-security 해당 필수 검사.
- 실제 UI 컴포넌트와 production CSS를 쓰는 loopback harness로 KO/EN × 360/1440 4개 렌더, 이미지·fallback·CTA·정렬/비공개 확인. 합성 데이터/인증임을 근거에 표시.

## 진행 및 검증 근거
- 읽기 전용 architecture 계획 및 독립 risk 계획 검토 완료. 공개 RPC 최소 projection, 기존 asset ACL 유지, home 부분 오류 분리 보완 수용.
- SQL/domain/API/admin/home 분리 구현 완료. 독립 결과 검토에서 발견한 정상 @handle 링크 차단을 수정하고 양쪽 검증기에 회귀 검사를 추가했다. 최종 검토에서 추가 확정 차단 사항 없음.
- npm ci --ignore-scripts --no-audit --no-fund 통과, Node 24.13.1. 실제 자격증명 없는 synthetic env를 work/home-banners/build.env에만 저장.
- npm run build와 npm run typecheck 통과. 초기 root 직접 next 실행/--env-file worker 옵션 실패 후 npm 자식 프로세스 환경 전달 방식으로 해결. 증거 work/home-banners/build.log 및 typecheck.log.
- admin-ui+fan-design-system+신규 기능 검사 91 files/674 tests 통과. API 보안42 files/393 tests, worker529 tests+typecheck/build, forge9 tests 통과. work/home-banners/*tests.log 및 worker-checks.log, contracts.log.
- 최종 npm run security:backend-db 통과(exit 0): 전체166 migration replay와 신규 배너 권한·공개·중복·revision·정렬·감사·캘린더4회 SQL assertion 및 기존 보안 검사 포함. 독립 PostgreSQL 연결 두 개의 create/full-reorder 경합 검사 PASS. 테스트 fixture의 service_role 권한 문제는 RPC/pg_catalog 사용으로 해결했고 append-only 감사 기록은 disposable DB 종료까지 보존했다. 근거 work/home-banners/backend-db-pass.log.
- 실제 GuestHome/캐러셀/calendar 컴포넌트+CSS loopback harness로 KO/EN×360/1440 이미지·same-locale fallback·이미지실패 CTA·inert·안내보존·캘린더4회 확인. apps/web/test-results/banner-local/evidence.json 및 PNG. 최종 관리자 동일4조합 저장/공개/비공개 브라우저 검증도 통과(apps/web/test-results/banner-local/admin-evidence.json). 최종 아트가 아닌 기존 공개 자산을 합성 fixture 입력으로 사용. 브라우저 API/인증은 합성이며 권한·트랜잭션은 별도 실제 로컬 PostgreSQL 검사로 검증했다.
- 최종 build/typecheck/lint 모두 exit 0. 최신 변경 관련8 files/64 tests 통과. 근거 work/home-banners/build-pass.log, typecheck-final.log, lint-final.log, final-targeted-tests.log, admin-browser-final.log. git diff --check 통과. 필수 검사와 연동된 로컬 검증을 실행했으며 원격 CI·운영 QA 실행 주장은 하지 않는다.
- 운영 DB·배포·push는 수행하지 않음. 기존 production 기록과 사용자가 열어둔 포트3000 프로세스 보존.
- 검증용으로 생성한 loopback4193 서버 종료 및 포트 해제 확인. Playwright 브라우저는 각 실행 종료 시 닫힘. 로컬 구현·검증 목표 완료.

## 후속 운영 반영 승인 및 진행
- 사용자가 코드 push 후 운영 DB 필요 사항을 확인하고 `진행.`으로 DB 적용과 웹 배포를 승인했다. 실제 배너 이미지·방송 일정 입력은 별도다.
- 운영 Supabase gmrykvmtmuaeswpajteq preflight에서 신규 배너 테이블 부재 및 이번 마이그레이션만 미적용임을 확인했다.
- 20260913120000_independent_home_banners를 운영 DB에 적용했다. DDL·migration ledger를 한 트랜잭션으로 처리하고 빈 초기 데이터, KO/EN 공개 조회, 강제 RLS 및 직접 쓰기 금지 조건을 검사했다. 운영 LIVE/예약/참여 데이터 변경이나 배너 seed 없음.
- 최신 main dbf8e21(셀럽 root handle)을 통합했다. guest-home 테스트 한 곳의 충돌은 새 /kara 주소와 분리된 LIVE 목록 동작을 함께 유지하도록 해결했다. 통합 후 관련122tests, 전체 DB 보안·동시성 검사, build/typecheck/lint 통과. 근거 work/home-banners/integration-*.log 및 production-*.json.
- 웹 배포 진행 및 최종 결과는 이 변경의 Git 배포 상태와 후속 작업 기록에서 확인한다.
- 첫 운영 웹 빌드 f583bb7은 새 API의 모듈 로딩 시 환경검사 때문에 실패했다. Vercel 빌드 전용 VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG를 운영 환경 오설정으로 판단했으며, 기존 관리자 API처럼 요청 시 의존성을 초기화하도록 수정했다. 환경 보안 검사는 완화하지 않았다. 해당 빌드 변수를 넣은 로컬 build와 import 회귀 검사 포함53tests 통과.
- 첫 backend CI는 runner에 rg가 없어 동시성 검사 로그 확인에서 실패했다. 표준 grep -Fq로 바꾸고 전체 로컬 DB 파이프라인 재통과. DB 운영 마이그레이션은 최초 적용 상태를 유지하며 반복 적용하지 않는다. Vercel 실패·CI 실패 로그와 수정 검증은 work/home-banners/vercel-failed.log, production-ci-failed.log, rollout-fix-*.log에 보존했다.
- 동일 모듈 초기화 원인으로 CS CI의 환경변수 없는 build도 실패했음을 확인했다. 수정 후 환경변수 없는 npm run build 및 build 전용 VITE 변수를 넣은 build 모두 통과했다. 최종 typecheck/lint도 통과.
