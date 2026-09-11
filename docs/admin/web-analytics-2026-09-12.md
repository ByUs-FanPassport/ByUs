# 관리자 방문 통계

관리자 메뉴의 **방문 통계**(`/admin/traffic`, 영문 `?lang=en`)에서 Vercel Web Analytics의 Production 데이터를 조회한다. 기존 회원·참여 분석과 공개 페이지 수집 정책은 변경하지 않는다.

## 연동 및 운영

- 서버 경로: `GET /api/admin/analytics/web?days=7|30|90`.
- 매 요청에서 기존 Google 기반 관리자 세션·활성 사용자·allowlist 검증 후 조회한다. 응답은 `private, no-store`이며, 서버 집계 캐시만 최대 5분 재사용한다.
- 서버 전용 환경변수: `VERCEL_ANALYTICS_TOKEN`, `VERCEL_ANALYTICS_PROJECT_ID`, `VERCEL_ANALYTICS_TEAM_ID`. 운영 토큰은 Vercel의 **sensitive** 변수로 등록한다. 브라우저에 전달하지 않는다.
- 2026-09-12 등록 토큰 이름: `byus-admin-web-analytics`. `sallylab > byus` 프로젝트로 제한. Vercel UI에 Analytics 읽기 전용 권한 선택은 없었다. 만료 표시일은 **2027-09-11**이다. 만료 전에 대체 토큰을 같은 변수에 등록하고 재배포한 뒤 이전 토큰을 폐기한다.
- 배포 환경에는 실제 데이터, 로컬 개발 환경에는 해당 환경에 허용된 Privy origin 설정이 필요하다. 테스트용 인증 대체 코드나 화면 검증 경로는 배포하지 않는다.

## 집계 기준

- UTC 오늘 포함 7·30·90일, Production만 조회. 응답의 `from`은 포함, `to`는 다음 날 00:00의 제외 경계이다.
- Vercel 요청 `until`에는 마지막 날 `23:59:59.999Z`를 전달한다. 날짜만 보내면 일부 분류의 종료 범위가 해당 날짜 01:00까지로 정규화된다.
- 방문자·페이지뷰 전체 값은 `by=environment`의 Production 행에서 읽는다. 페이지별 방문자는 중복될 수 있으므로 합산하지 않는다.
- 일별 조회는 API의 최대 62일 제한에 맞춰 최대 60일씩 나눈다. 90일은 60일·30일의 비중복 구간을 합친다. 분류 조회 `limit`은 최대 100이다.
- 인기 페이지·유입 경로·국가·기기·브라우저·OS를 표시한다. 빈 referrer는 직접 유입 또는 확인 불가로 표시한다. 원본 오류·인증 정보는 응답에 포함하지 않는다.
- 이탈률·현재 접속자·UTM·커스텀 이벤트는 이번 구현 범위에 포함하지 않는다.

공식 근거: [API 안내](https://vercel.com/docs/analytics/web-analytics-api), [집계 API](https://vercel.com/docs/rest-api/web-analytics/aggregates-page-views).

## 검증 근거

- 기존 관리자 회귀 범위: 50파일, 286개 테스트 통과. API 제한 대응 후 백엔드 집중 테스트 16개 통과. 동일 입력의 기존 성공 근거는 재사용했다.
- 전용 토큰으로 실제 서비스 함수의 7·30·90일 전체 요청 성공. 7·30일은 방문자 365 / 페이지뷰 1,428, 이후 90일 조회는 방문자 366 / 페이지뷰 1,438이었다. 조회 중인 UTC 당일 데이터라 시각에 따라 증가했다.
- 위 실제 7일 응답을 로컬 화면에 넣어 표시값 365 / 1,428 대조. KO/EN, 1440px/390px, 7·30·90일 전환, 방문자·페이지뷰 전환 검증. 가로 넘침 없음, 페이지 오류 없음, axe 위반 없음.
- 로컬 실제 경로의 비인증 요청은 HTTP 401 확인. 403·인증 후 캐시 접근·계정 전환·오류/재시도는 테스트로 확인했다.
- Aside의 실제 로컬 관리자 로그인은 Privy `Origin not allowed`로 초기화가 멈췄다. 화면 검증은 인증 상태와 응답 전달만 대체한 임시 로컬 경로에서 진행했으며 해당 경로와 대체 코드는 삭제했다. 실제 로그인부터 통계 조회까지의 브라우저 통합 검증과 운영 화면 직접 확인은 완료 근거에 포함하지 않는다.

- 최종 UI 집중 테스트 7개, 변경 파일 ESLint, `git diff --check` 통과. `b07187a`까지의 main 변경을 통합한 상태에서 `npm run build`(내장 TypeScript 검사 포함) 통과.
- 브라우저 정적 산출물 313개에서 전용 토큰 문자열 노출 0건 확인. Production 환경변수 등록 후 토큰 변수가 sensitive로 저장됐음을 다시 확인했다.
- 배포 경로는 `ByUs-FanPassport/ByUs`의 `main` 푸시 → Vercel `sallylab/byus` 자동 Production 배포이다. 일반 배포 종료 기준은 정확한 푸시 커밋의 자동 배포 시작 확인이며, 운영 화면 재검사는 포함하지 않는다.
