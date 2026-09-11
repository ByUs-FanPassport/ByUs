# 가입 전환 측정 계약

이 문서는 가입 안내 화면부터 로그인 시도, 계정·프로필 생성까지의 측정 기준과 보고서 실행 방법을 정리한다. 익명 행동과 실제 계정 생성은 서로 다른 모집단이며, 두 집단의 수치를 이어 붙여 하나의 전환율로 계산하지 않는다.

## 수집 이벤트

브라우저에서 기록하는 이벤트는 `signup_guide_view`, `signup_guide_cta`, `login_started`, `login_result` 네 가지다. 네 이벤트는 항상 익명 세션 해시로 소유자를 표시하며 계정 ID와 셀럽·LIVE·미션·혜택 ID를 담지 않는다.

- 안내 이벤트의 출처는 `signup.guide`다. `signup_guide_view`는 화면을 본 시점의 `guest`, `member`, `unknown` 상태를 기록한다. 나중에 로그인 상태가 확인돼도 과거 이벤트를 바꾸지 않는다.
- 로그인 이벤트의 출처는 `signup.login`이다. 한 로그인 시도는 UUID v4 nonce 하나를 쓰고, 시작·실패·성공 관찰을 같은 nonce로 묶는다. 실패 뒤 같은 시도가 성공하면 두 관찰을 모두 보존한다. 사용자가 다시 시도하면 새 nonce를 발급한다.
- 공통 속성은 `channel`, `landing`, `guide`, `browser`, `os`, `locale`이며 값은 고정된 분류만 허용한다. 이벤트별 속성도 고정돼 있어 누락·추가 속성, 잘못된 자료형과 임의 문자열을 RPC에서 거부한다.

서버에서 기록하는 `account_created`, `profile_completed`는 각각 `app_users`와 `user_profiles` INSERT가 성공한 트랜잭션에서 생성한다. 출처는 `server.commit_projection`, 속성은 빈 객체, 소유자는 원본 행의 계정 ID다. 이벤트 시각과 결정적 멱등성 키도 원본 행에서 정한다. 원본 행이 없거나 시각·키가 맞지 않으면 직접 만든 서버 이벤트를 거부한다.

프로젝션은 측정 실패 때문에 가입 처리를 취소하지 않도록 오류를 경고로 남기고 원본 INSERT를 계속한다. 같은 트랜잭션이 롤백되면 생성된 이벤트도 함께 사라진다. 마이그레이션 이전 데이터는 소급 생성하지 않는다. 따라서 운영 수치는 원본 테이블을 기준으로 보고, 이벤트 커버리지는 별도로 확인한다.

## 보고서 실행

보고서는 `psql`에서 시작 시각과 종료 시각을 반드시 전달해 실행한다.

```bash
psql "$DATABASE_URL" \
  -v from='2026-09-01T00:00:00+09:00' \
  -v to='2026-09-08T00:00:00+09:00' \
  -f scripts/report-signup-conversion-funnel.sql
```

시간 구간은 `[from,to)`다. `from`은 `to`보다 앞서야 하고, `to`는 실행 시점 이후일 수 없으며, 조회 기간은 최대 366일이다. 보고서는 읽기 전용 트랜잭션에서 집계 JSON 한 건만 반환한다. 계정 ID, 익명 세션 해시, 로그인 시도 nonce는 출력하지 않는다.

## 지표 해석

`anonymousGuideEngagement`는 조회 구간 안에서 익명 세션·가이드별 첫 `signup_guide_view`를 코호트 기준으로 삼는다. 이후 같은 익명 세션과 같은 가이드에서 발생한 CTA만 인정한다. 모든 가이드 조회를 분모로 `anyCta`, `verifyCta`를 계산하며, 첫 조회의 채널·랜딩·가이드·브라우저·OS·언어·audience를 차원으로 사용한다. `unknown` audience는 전체 참여율에 포함하고 별도 건수로 표시하지만 guest 가입 전환 분모에는 넣지 않는다.

`guestVerifyToLogin`은 각 익명 세션·가이드의 첫 인증 CTA를 기준으로, 그 시점의 audience가 `guest`인 세션을 대상으로 한다. 첫 CTA가 `unknown`이면 이후 CTA를 기준으로 다시 분류하지 않는다. 첫 조회가 `unknown`이어도 CTA 시점에 `guest`이면 포함하고, 첫 조회가 `guest`여도 CTA 시점에 `member`이면 제외한다. 조회 이벤트가 없더라도 유효한 guest 인증 CTA는 이 코호트에 포함한다. `unknown` 인증 CTA는 `unknownAudienceVerifyCtaSessions`로 따로 표시한다. 인증 CTA 뒤 처음 발생한 `trigger=provider` 로그인 시도를 선택하고, 같은 nonce·익명 세션·가이드·provider·trigger의 성공만 인정한다. 첫 시도가 실패하고 두 번째 시도가 성공한 경우 첫 시도의 성공으로 합치지 않는다.

`loginAttempts`는 조회 구간 안에서 시작한 시도를 집계한다. 결과는 같은 nonce·익명 세션·가이드와 일치하는 provider·trigger만 연결한다.

- `succeeded`: 성공 관찰이 있는 시도
- `failedWithoutSuccess`: 실패는 있으나 성공은 없는 시도
- `pending`: 실패와 성공이 모두 없는 시도
- `recovered`: 같은 시도에서 실패와 성공이 모두 관찰된 경우

`byTrigger`는 `provider`, `session_restore`, `retry`, `reauth`를 분리한다. 실패 내역은 브라우저·provider·stage·reason 조합별 건수만 반환한다. 연결할 시작 이벤트가 없거나 provider·trigger 등이 맞지 않는 결과는 `unmatchedOrInconsistentResultObservations`로 표시한다.

`canonicalSignupProgress`는 조회 구간에 생성된 `app_users`를 기준으로 같은 계정의 프로필과 팬 패스포트가 종료 시각 전에 생성됐는지 계산한다. 테스트 계정은 자동으로 제외하지 않는다. 활성 관리자 허용 목록과 이메일이 일치하는 계정 수는 `adminAllowlistedAccounts`로 따로 제공한다.

`projectionCoverage`는 원본 `app_users`, `user_profiles` 수와 정확히 대응하는 서버 이벤트 수를 비교한다. 이 값은 누락된 측정 이벤트를 찾기 위한 지표이며 가입 완료의 원본 수치를 대체하지 않는다. 모든 전환율은 분모가 0이면 `null`이다.

## 로컬 검증

다음 명령은 임시 PostgreSQL 클러스터에 전체 마이그레이션을 적용한 뒤 기존 백엔드 보안 검사와 가입 측정·보고서 fixture를 실행한다.

```bash
bash scripts/verify-backend-security.sh
```

fixture는 고정 속성 검증, 멱등 재실행과 충돌, 서버 원본 검증, private ACL, INSERT 전용 프로젝션, 측정 실패 시 원본 보존, 트랜잭션 롤백, 빈 분모, 순서가 맞는 전환, 누락·재시도·대기·복구 상태, 서로 다른 로그인 시도 혼동 방지를 검사한다. 임시 데이터베이스는 검증 후 전체 삭제한다.

## 2026-09-11 검증 결과와 적용 범위

- `codex/signup-funnel-20260911`에서 로컬 구현을 완료했다. 운영 DB 적용·푸시·배포는 수행하지 않았다.
- 전체 145개 마이그레이션 재생성, 기존 백엔드 보안 검사, 가입 측정·보고서 fixture가 통과했다. 마지막 SQL 수정은 guest CTA 코호트 회귀를 포함한다.
- 이벤트 계약·익명 전송·가이드 연결·로그인·기존 계측 계약의 대상 테스트가 통과했다. 마지막 로그인 변경 후 43개 로그인 테스트를 재실행해 통과했고, 관련 입력이 같았던 나머지 성공 결과는 재사용했다. 타입 검사와 변경 TypeScript 파일 린트도 통과했다.
- 독립 보안 검토에서 CTA 시점 audience 분류, 로그인 시도와 메모리 내 계정 전환 분리, 늦은 provider 오류 차단, OAuth 복귀 시 원래 시도 복구를 확인했다.
- 실제 컴포넌트와 CSS를 사용하는 로컬 Vite fixture에서 한국어 390×960 안내→인증 CTA→로그인 성공을 확인했다. `signup_guide_view → signup_guide_cta → login_started → login_result(succeeded)`가 기록됐고 시작·결과 시도가 일치했다.
- 영어 1440×960 fixture에서 세션 API 503 실패→재시도 성공을 확인했다. 각 시작·결과 쌍은 같은 시도로 묶이고 재시도에는 새 시도를 사용했다. 계측 요청에 Authorization 헤더가 없고 외부 서비스 요청·page error·가로 넘침이 없었다.
- 브라우저 검증의 Privy와 API는 합성 응답이다. 실제 Instagram 인앱 OAuth, 운영 이벤트 수집, 전환율 개선 효과를 검증한 결과는 아니다.

로그와 캡처는 `/tmp/byus-signup-*.log`, `/tmp/byus-signup-render/`에 보존했다. 운영에 적용하려면 마이그레이션과 애플리케이션을 함께 반영해야 하며, 적용 이전 방문의 단계별 이탈을 소급 복원할 수는 없다.

## 운영 반영 기록

사용자가 배포를 승인한 뒤 2026-09-11 23:28 KST에 `20260911140102_signup_funnel_measurement.sql`을 운영 DB에 적용했다. 마이그레이션과 이력 기록은 한 트랜잭션에서 커밋했다. 저장된 SQL의 MD5는 `798d27e24e54318845e7a9cac2ec6337`로 파일 내용과 일치한다.

기존 계정·프로필·이벤트 수가 바뀌지 않았고, 두 INSERT 트리거 활성화, 새 함수 본문, RPC·내부 함수 권한, 이벤트 제약 검증을 확인했다. 합성 가입 데이터는 운영에 생성하지 않았다.

애플리케이션 변경 `db5e733`을 최신 main `33ee596`과 충돌 없이 통합했다. 계측·로그인·DB·의존성 파일이 검증된 내용과 동일해 기존 검증을 재사용했다. 애플리케이션은 main 푸시에 연결된 Vercel 자동 배포 경로로 반영한다.
