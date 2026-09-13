# 활동별 로그인 진입 계측

사용자 승인 범위: AWS 운영 실행 확인, 비식별 활동별 로그인 분류, 검증 및 기존 통합·배포 경로와 루틴 반영.

## 측정 계약

기존 익명 `login_started`와 `login_result`에 선택 속성 `entryAction`만 추가한다. 이벤트명·익명 식별 방식·30분 시도 보존기간·계정 이벤트 분리는 유지한다. 기존 API/RPC 및 기록은 계속 유효하다.

| 값 | 실제 로그인 진입 근거 |
| --- | --- |
| `daily_checkin` | 기존 로컬 returnTo가 `/c/{slug}#daily-checkin` |
| `cheer` | 기존 로컬 returnTo가 `/c/{slug}#cheers` |
| `passport_share` | 기존 로컬 returnTo가 유효한 `/s/{32hex}` |
| `other` | 새 계측이 실행됐지만 위 세 경로가 아님 |
| `unknown` | 보고서에서만 사용하는 기존 선택 필드 누락. 새 client 전송 값이 아님 |

locale query는 유지된 이동 경로에서만 읽는다. URL·returnTo 원문·creator slug·공유 token·초대코드·전화·계정 ID는 이 필드나 추가 저장소에 보존하지 않는다. 외부 URL·프로토콜 상대 URL·역슬래시·잘못된 slug/token은 `other`다. 일반 `/login` 진입에서 이전 행동을 상속하지 않는다.

분류는 실제 provider/retry/restore 시도의 시작 때 한 번 캡처한다. 결과가 늦게 도착하거나 문서가 새로 로드돼도 해당 시도의 값을 유지한다. 예전 시도에는 값을 소급 추정하지 않는다. 기존 로그인 링크·인증·복귀 동작과 화면은 변경하지 않는다.

초대코드는 인증 후 MY에서 입력하는 기능이므로 사전 로그인 초대 귀속을 새로 만들지 않는다. 초대는 `report-fan-activation-operations.sql`의 수락·계정당 지급 원장으로 확인한다.

## 집계와 해석

`report-signup-conversion-funnel.sql`의 `loginEntryActions.groups`는 시작 이벤트 기준 행동·provider·trigger·30분 관측 여유로 나눈 시도/성공/성공 없는 실패/pending/회복이다. 시작/결과 모두 기존 `[from,to)` 범위에서 연결한다. 합계는 succeeded + failed_without_success + pending = attempts이고 recovered는 succeeded에 포함된다.

이것은 로그인 시도 경로의 진단이다. CTA 노출/클릭 전부, 순수 신규 사용자, 가입 완료, 로그인 후 출석/응원/공유 완료 또는 공유 보상 수신까지 연결한 전환율이 아니다. 결과가 범위 종료 후 발생한 시도는 해당 조회에서 pending으로 남을 수 있다. 비교 시 최근30분을 분리하고 실제 신규 계정→프로필→Passport와는 별도로 해석한다.

## 검증 및 배포 기준

- 분류·트래커·API 경계·실제 LoginPage 회귀 93 tests PASS.
- Node24에서 web typecheck·lint PASS. 새 작업 폴더의 기존 workspace-local dependency 경로를 맞췄으며 package/lock 변경은 없다.
- clean DB 164 migrations와 전체 backend security·기존 민팅/알림/SMS/공유 동시성 PASS. 신규 계약: 기존 선택 필드 누락, enum·null·타입·추가 키·guide 오용 거부, 지갑 진단 포함/부분 필드 거부, 동일 키 replay, 실제 집계 fixture의 unknown/other/회복/범위 밖 늦은 결과 PASS.
- migration `20260913061240_login_entry_action_measurement`는 `record_product_event_v1` 함수 본문만 교체한다. 개인정보/원장 행 UPDATE·DELETE·backfill·추가 권한이 없다. production 적용은 기존 함수 hash·owner·ACL을 확인한 단일 transaction과 migration ledger로 수행한다.
- 일반 자동 배포 기준: 검증된 scoped commit의 main push 및 해당 commit 배포 시작 확인. 자연 트래픽 수집은 다음 루틴에서 확인하며 이를 기다리려고 실사용자 로그인을 만들지 않는다.
- 복구 시 기존 로그인 동작은 유지된다. 새 client 필드 전송을 중지하는 가역적 코드 수정이 우선이며 기존 원장/계측 행을 삭제하지 않는다. 이전 client도 새 DB 함수에서 허용된다.
