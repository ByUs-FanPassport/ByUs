# 셀럽 팬페이지 주소 전환 — 2026-09-13

## 확정 범위

- 모든 기존·신규 셀럽의 정식 팬페이지는 `/{slug}`에서 직접 렌더링한다.
- 기존 영문 slug를 그대로 공개 핸들로 사용한다. 이퓨도 `ifewknow`를 유지한다. 동일 값을 저장하는 별도 handle 컬럼이나 인물별 매핑을 추가하지 않는다.
- 과거 이름·한글 이름의 추가 별칭은 만들지 않는다.
- 기존 `/c/{slug}` 페이지와 그 query 탭은 새 주소로 영구 이동한다. query의 중복 값도 유지한다. 서버가 받을 수 없는 fragment는 브라우저 이동 검사로 확인했다.
- `/c/{slug}/verify`, `/raffles`, `/notices`, `/certifications` 등 기존 하위 페이지는 유지한다. 그 페이지에서 팬페이지로 돌아오는 링크는 새 주소를 사용한다.
- 셀럽 ID, 이름, 공개·비공개·보관 상태, 팬 활동 기록은 변경하지 않는다.
- 푸시, 배포, 운영 DB 쓰기는 범위에 포함하지 않는다.

## 구현

- `apps/web/features/creator/domain/creator-navigation.ts`: 주소 생성·해석과 예약어 검증을 공통화했다. 앱 최상위 경로·public 디렉터리와 SQL 예약어 목록의 일치 여부를 테스트한다.
- `apps/web/app/[slug]/page.tsx`: 기존 공개 콘텐츠 조회와 메타데이터를 재사용한다. 미등록·비공개 셀럽은 공개되지 않는다.
- `apps/web/app/c/[slug]/page.tsx`: 이전 팬페이지 주소에서 새 주소로 308 이동한다. 기존 raffle/benefits query의 전용 페이지 이동은 유지한다.
- 홈·셀럽 목록·MY·팬 활동 화면·공지의 돌아가기 링크, 로그인 복귀, 첫 반응 intent, 온보딩, 메뉴, 유입·방문 집계, 검색 대표 주소와 사이트맵을 새 경로에 맞췄다.
- Vercel 계측은 공개 조회에 성공한 팬페이지가 전달하는 slug만 새 루트 주소로 허용한다. 임의 루트 경로나 비공개 화면 이동 뒤의 전송을 허용하지 않는다. 기존 셀럽별 방문 중복 방지 키는 유지한다.
- `20260913070000_celebrity_public_handle_policy.sql`: 기존 unique constraint를 유지하며 예약어 차단과 최초 공개 후 slug 변경 금지를 보강했다. 기존 `ever_published_at`을 사용하므로 공개 후 다시 비공개로 바꾸어도 이름을 바꿀 수 없다. 운영 적용 전 기존 예약어 충돌이 있으면 이름 목록을 표시하고 실패한다. rollback과 SQL 동작 검사도 포함한다.
- 관리자 입력은 동일 검증을 사용하며 최초 공개된 셀럽의 주소 필드를 잠근다.

## 확인 결과

- 운영 등록 목록을 읽기 전용으로 조회했다. 공개 8명, 비공개·보관 7명, 총 15명이며 현재 예약어 충돌은 없다. 운영 쓰기는 수행하지 않았다.
- 최종 집중 회귀 검사: 33개 파일, 592개 테스트 통과. 대상 목록은 `work/handle-focused-files.json`, 결과는 `work/handle-focused-final.json`에 보존했다.
- `npm run typecheck`, `npm run lint`, `npm run build` 통과. 각각 `work/handle-typecheck-final.log`, `work/handle-lint-final.log`, `work/creator-handles-local/build.log`를 보존했다.
- 실제 Next 빌드와 격리된 로컬 PostgREST fixture를 사용해 기존 공개 8명 및 신규 셀럽 1명의 KO/EN 18건을 확인했다. 정식 주소, canonical, 사이트맵, 308, 중복 query, fragment, 최애 메뉴 선택, 인증 진입과 팬페이지 탭 이동을 검사했다.
- 비공개·보관된 7개 이름의 루트 404와 서비스 경로 `/login`, `/my`가 팬페이지로 해석되지 않는 것을 로컬 fixture로 확인했다. 추가 이름 `/ifew`, 한글 별칭, 미등록 이름도 404였다.
- 모의 인증을 사용하는 LoginPage와 auth-intent/ReactionAction 테스트로 신·구 주소의 로그인 완료 후 복귀, intent와 fragment 유지, 첫 반응의 한 번 실행을 검증했다. 실제 외부 계정 OAuth 로그인은 수행하지 않았다.
- 로컬 브라우저 검증 보고서와 화면은 `work/creator-handles-local/report.json`, `negative-cases.json`, `ifewknow-mobile.png`, `elina-desktop.png`에 있다. 로컬 fixture는 콘텐츠·계정 운영 API 전체를 재현하지 않는다.
- Aside에서도 새 주소의 페이지와 DOM을 확인했다. 해당 브라우저 세션은 인증 초기화 대기를 벗어나지 못했으므로 인증 관련 성공 근거로 사용하지 않았다. 브라우저 동작 성공 근거는 별도 Playwright 익명 세션이다.
- 독립 검토에서 발견한 E2E의 옛 주소 기대값을 수정했다. 실제 서버 확인에서 발견한 사이트맵의 `/c/` 필터 누락도 수정하고 SEO 24개 테스트와 빌드를 다시 통과했다.

DB 담당 에이전트가 다음 두 명령의 clean migration replay·동작·rollback 통과를 확인했다. 스크립트의 임시 DB와 로그는 종료 시 정리됐으며, 재검증 없이 해당 실행 근거를 재사용한다.

```bash
PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH \
BYUS_CLEAN_DB_PORT=55439 \
BYUS_CLEAN_DB_ASSERTION_FILE="$PWD/supabase/tests/celebrity_public_handles.sql" \
bash scripts/verify-clean-migration-chain.sh

PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH \
BYUS_CLEAN_DB_PORT=55440 \
BYUS_CLEAN_DB_ASSERTION_FILE="$PWD/supabase/tests/celebrity_public_handles_rollback.sql" \
bash scripts/verify-clean-migration-chain.sh
```

로컬 HTTP·브라우저 검증 재현 명령:

```bash
node scripts/verify-creator-handles-local.mjs --build
```

## 범위 밖 실패와 다음 단계

전체 웹 테스트 실행에서는 변경 범위 밖 실패도 발견됐다. 집중 검사와 구분하며 전체 테스트 통과로 보고하지 않는다. 별도 실행 결과 `work/handle-baseline.json`의 3건은 법률 페이지의 영어 링크 이름 기대값 1건, 기존 PPT 검증 ledger 파일 누락 1건, PPT 이벤트 inventory 기대값 1건이다. 관련 법률 문구·이벤트·PPT 계약을 이번 주소 전환에서 변경하지 않았다.

로컬 구현·검증까지 완료했다. 이후 배포를 요청받으면 이 마이그레이션의 운영 충돌 사전 확인 및 적용 순서, 해당 커밋의 푸시·배포를 진행한다. 지금 운영 주소는 아직 변경되지 않았다.

## 운영 적용 승인 — 후속 요청

사용자가 DB 적용과 push를 승인했다. 기존 구현·검증 결과를 재사용하며 이번 마이그레이션만 운영에 적용하고 main에 push한다. 자동 배포 시작 확인을 종료 기준으로 하며, 이전 절의 미배포 상태는 최초 로컬 완료 시점 기록이다.
