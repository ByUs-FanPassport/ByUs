# SEO 유입 전환 측정 기준

작성일: 2026-09-11
범위: 검색·공유 유입 → 팬 인증 → LIVE 예약 → 출석 → 래플 응모

이 문서는 전환율 개선 성과를 약속하지 않는다. 현재 코드에서 측정할 수 있는 범위, 집계 기준, 개인정보 보호 한계를 고정한다.

## 확인된 기존 측정

`fan_product_events`는 측정 전용 append-only 테이블이다. 보상·자격·당첨 여부는 이 테이블이 아니라 각 운영 테이블을 기준으로 판단한다.

다음 완료 이벤트는 운영 데이터가 커밋된 뒤 DB 트리거가 `source=server.commit_projection`으로 기록한다.

| 단계 | 이벤트 | 운영 원본 |
| --- | --- | --- |
| 팬 인증 | `passport_issued` | `fan_passports` |
| LIVE 예약 | `reservation_completed` | `live_reservations` |
| LIVE 출석 | `attendance_completed` | `live_attendances` |
| 래플 응모 | `benefit_entered` | `benefit_claims` 또는 `benefit_ticket_entries` |
| 당첨 | `benefit_won` | `benefit_draw_winners` |

LIVE 관리자 분석에는 방문 → 예약 → 출석 집계와 예약·출석 운영 원본이 이미 연결돼 있다. LIVE 귀속 팬 인증은 `quiz_pass_attributions`와 `fan_passports`를 함께 사용한다.

## 추가한 유입 측정

새 DB 이벤트 종류를 만들지 않고 기존 `creator_page_view`를 사용한다. 유입 이벤트는 `source`로 일반 크리에이터 페이지뷰와 구분한다.

- 첫 유입: `acquisition.session_landing`
- 익명으로 유입한 뒤 같은 탭에서 로그인한 경우: `acquisition.identified_handoff`
- 속성: `channel`, `landing`, `attribution=session_first_touch`

채널은 `direct`, `search`, `social`, `email`, `paid`, `referral`, `internal` 중 하나만 기록한다. 랜딩도 홈, 크리에이터 목록·상세, LIVE 목록·상세, 혜택 상세, 팬 가이드처럼 정해진 유형만 기록한다.

전체 URL, 경로의 slug·ID, 리퍼러 도메인, 검색어, `utm_source`, `utm_campaign`, UTM 원문, `gclid`·`fbclid` 같은 클릭 ID, OAuth 코드, 이메일은 이벤트 속성이나 세션 귀속 데이터에 저장하지 않는다. 익명 세션 ID는 서버에서 SHA-256 해시로 바꾼 뒤 저장하며, 페이지뷰 멱등 키에도 원문 세션 ID를 넣지 않는다.

클라이언트가 보낼 수 있는 이벤트는 페이지뷰와 LIVE CTA 클릭으로 제한한다. 팬 인증·예약·출석·응모를 비롯한 완료 이벤트는 클라이언트 요청으로 기록할 수 없다.

## 퍼널 집계

`buildAcquisitionFunnelReport`는 식별된 유입 사용자를 코호트로 삼아 다음 순서를 모두 만족하는 고유 사용자 수를 계산한다.

1. 식별된 유입 이벤트
2. `passport_issued`
3. `reservation_completed`
4. `attendance_completed`
5. `benefit_entered`

완료 단계는 앞 단계 이후에 발생한 `server.commit_projection` 이벤트만 인정한다. 각 전환율의 분모는 바로 앞 단계를 통과한 사용자 수다. 앞 단계가 0명이면 전환율은 `null`로 두며 0%로 단정하지 않는다.

익명 유입은 해시된 세션 수로 별도 집계한다. 로그인하지 않은 익명 세션과 로그인 뒤 식별된 사용자를 같은 사람으로 연결하지 않으므로, 익명 유입을 식별 사용자 퍼널의 분모로 사용하지 않는다. 같은 탭에서 로그인 상태가 확인되면 원문 식별자를 복사하지 않고 안전한 채널·랜딩 유형만 식별 이벤트로 다시 기록한다.

## 운영 집계 방법과 앱 화면 연결 조건

`scripts/report-seo-conversion-funnel.sql`을 운영 DB에 읽기 가능한 계정으로 실행하면 기간별 집계 JSON을 확인할 수 있다. `from`, `to`를 ISO 8601 시각으로 반드시 전달하며 기간은 최대 366일이다. 스크립트는 `BEGIN TRANSACTION READ ONLY`에서 실행하고 마지막에 롤백한다. 결과에는 단계별 고유 사용자 수와 전환율, 식별 유입의 채널별 수, 익명 랜딩 세션 수, 기존 서버 완료 이벤트별 행 수만 포함된다. 원시 사용자 ID와 익명 세션 해시는 출력하지 않는다.

예시 실행 형식은 다음과 같다. 접속 정보와 비밀번호는 명령 인자나 로그에 남기지 않는다.

```sh
psql "$DATABASE_URL" \
  -v from='2026-09-11T00:00:00+09:00' \
  -v to='2026-09-12T00:00:00+09:00' \
  -f scripts/report-seo-conversion-funnel.sql
```

앱 관리자 화면이나 API에 이 퍼널을 표시하려면 별도의 관리자 전용 읽기 RPC가 필요하다. 현재 작업에는 새 DB 함수, 권한 변경, 관리자 UI를 포함하지 않는다.

새 유입 수집 이벤트는 배포 이후부터 쌓이므로 배포 직후 유입 단계가 0명이어도 오류로 단정하지 않는다. 같은 결과의 `serverCommittedEventAvailability`에서 기존 완료 이벤트 행 수를 함께 확인해 수집 시작 시점과 기존 운영 이벤트 가용성을 구분한다.

## 해석할 때 지킬 기준

- 유입 수는 방문자 수이며 검색 순위나 매출 증가를 뜻하지 않는다.
- 식별 퍼널은 로그인 상태가 확인된 유입 코호트만 설명한다.
- 여러 셀럽·LIVE·래플을 가로지르는 플랫폼 퍼널이다. 한 캠페인의 성과를 보려면 `celebrity_id`, `live_event_id`, `benefit_id` 범위를 추가로 고정해야 한다.
- 완료 여부와 보상·당첨 상태는 운영 테이블을 우선한다. 이벤트 누락이 운영 성공을 취소하거나 변경하지 않는다.

## 실제 집계 검증

- DEV와 운영 DB에서 2026-08-12부터 2026-09-11까지 읽기 전용 SQL 실행 성공. 새 유입 이벤트 배포 전이라 유입 코호트는 0명이고 전환율은 null이다.
- 운영 완료 이벤트 가용성: 팬 인증 9, 예약 6, 출석 0, 응모 4, 당첨 0. 이는 전체 완료 이벤트 수이며 신규 유입 퍼널 성과가 아니다.
- 결과: `artifacts/seo-20260911/conversion-dev.json`, `conversion-prod.json`. 사용자 ID나 세션 해시 원문은 출력하지 않았다.
