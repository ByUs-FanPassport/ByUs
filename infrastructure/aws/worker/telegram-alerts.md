# Telegram 운영 알림

회원가입, 최애 Fan Passport 최초 발급, LIVE 예약·출석, 추첨 결과 공개를 기존 notification Lambda에서 운영 방으로 알린다. 로그인 반복이나 온체인 민팅 완료는 가입으로 세지 않는다. 추첨 실행만으로는 발송하지 않으며 결과 공개 시 당첨자 수를 알린다.

## 수집과 발송

- DB migration: `20260911121807_telegram_major_event_alerts.sql`.
- `configure_telegram_alerts(chat_id, true)` 실행 이후 새로 발생한 이벤트만 수집한다. 기존 데이터를 소급 전송하지 않는다.
- 한 메시지에 최대 5건을 묶고 방 전체에서 최소 60초 간격을 둔다. 매분 새 이벤트를 확인하며, 이벤트가 없으면 아무 메시지도 보내지 않는다.
- 가입·팬 가입·예약·출석은 한 건씩 닉네임과 가입 이메일, 공개된 셀럽·LIVE 이름을 표시한다. 닉네임 미설정 상태도 그대로 표시한다. 사용자가 지정한 운영 방에 이 정보를 보내도록 명시적으로 요청했다.
- `20260911124147_telegram_alert_actor_identity.sql`의 서버 전용 `claim_telegram_alert_batch_with_identity`가 원천 이벤트의 회원과 `user_profiles`를 조회한다. 이메일을 outbox에 중복 저장하지 않는다. 기존 대기 이벤트도 처리하며 이미 종료된 이벤트를 다시 보내지 않는다.
- 계정·지갑 ID, 설문 답변, 비공개 추첨 정보는 포함하지 않는다. 추첨 공개 알림은 공개 당첨자 수를 유지한다.
- 수집 트리거 오류는 SQLSTATE만 기록하고 본래 가입·예약·출석 트랜잭션을 막지 않는다. 트랜잭션이 롤백되면 알림도 남지 않는다.
- 대기 24시간이 지난 알림은 건너뛰고 종료 기록은 30일 보관한다.

## 설정

기존 AWS Secrets Manager `byus/notification/prod` JSON에 아래 필드를 병합한다. 기존 필드는 유지한다. 토큰을 Git, 로그, 쉘 인자, 문서에 기록하지 않는다.

| 필드 | 값 |
| --- | --- |
| `TELEGRAM_ALERT_MODE` | `enabled` 또는 `disabled` (기본값) |
| `TELEGRAM_BOT_TOKEN` | 기존 봇 토큰 |
| `TELEGRAM_CHAT_ID` | 검증한 그룹의 음수 숫자 ID |

실운영 발송에는 기존 `NOTIFICATION_EXTERNAL_ENVIRONMENT=prod`와 운영 Supabase 주소도 일치해야 한다. Telegram 설정이 잘못돼도 기존 팬 알림·문의 메일 분기는 계속 실행한다.

1. 봇 `getMe`와 지정 그룹을 확인한다. 초대 URL은 Bot API 목적지가 아니므로 그룹에서 봇 명령을 보내 받은 업데이트로 숫자 ID를 확인한다. 기존 webhook과 업데이트 소비 정책은 변경하지 않는다.
2. 테스트를 통과한 migration을 트랜잭션과 migration ledger로 적용한다. 초기 수집 상태는 꺼짐이다.
3. 기존 notification Lambda 코드와 비밀 설정을 갱신한다. 기존 IAM, 예약 동시 실행 수, EventBridge 스케줄, 다른 Lambda는 유지한다.
4. `configure_telegram_alerts(chat_id, true)`로 수집을 켜고 `telegram_alert_health()`로 상태를 확인한다.
5. 연결 완료 안내 1건을 전송한다. 안내 메시지와 실제 회원 이벤트 수신 검증을 구분해 보고한다.

## 실패와 재설정

`claim → begin → send → finish` 순서다. `begin` 전에 멈춘 작업은 60초 lease 만료 후 다시 가져갈 수 있다. `sending` 상태에서 120초 안에 확정되지 않으면 `delivery_unknown`으로 종료한다. 네트워크 오류·5xx·응답 파싱 오류·전송 후 DB 확인 실패는 자동 재전송하지 않는다. Telegram의 중복 방지 키 부재 때문에 중복 발송 방지를 우선한다.

명시적인 429만 `retry_after`와 최소 60초를 지켜 최대 3회 시도한다. 확정적인 4xx 거절은 실패로 끝낸다. `telegram_alert_health()`의 `failed`, `delivery_unknown` 증가 시 설정과 제공자 상태를 확인하되 기존 알림을 임의로 재전송하지 않는다.

즉시 수집 중지는 `configure_telegram_alerts(chat_id, false)`, 발송 중지는 비밀 설정 `TELEGRAM_ALERT_MODE=disabled`로 처리한다. 중지·방 변경 시 기존 대기/claim 알림은 건너뛴다. 이미 외부 요청이 시작된 메시지는 도착할 수 있다. 재활성화로 건너뛴 알림을 복구하지 않는다. 롤백은 먼저 비활성화하고 이전 Lambda 코드와 Secrets Manager 버전을 복구한다. 사업 이벤트 테이블은 삭제하거나 수정하지 않는다.

## 검증

로컬 전체 migration replay에 `supabase/tests/telegram_alert_capture.sql`와 `supabase/tests/telegram_alert_lifecycle.sql`를 적용한다. 워커 테스트는 메시지 크기·요청한 신원 필드·그 외 정보 제외·빈 큐 무발송·응답 분류·중복 실행·다른 알림 분기 격리를 검증한다. 운영에서는 설정과 함수 배포 상태를 확인한다. 최초 연결 안내 발송과 실제 회원 이벤트 수신 검증을 구분하며, 가짜 회원·당첨자를 운영 DB에 생성하지 않는다.

## 운영 방 명령어

| 명령어 | 응답 |
| --- | --- |
| `/users` | 전체 회원, 이용 가능한 회원, 이용 중지 회원, 팬 가입 회원 수와 누적 팬 가입 건수 |
| `/today` | 한국시간 오늘 가입·팬 가입·LIVE 예약·출석 건수 |
| `/lives` | 최근 7일 내 종료했거나 이후 종료하는 공개 LIVE의 일정·예약·출석, 시작 시간순 최대 5개 |
| `/help` | 명령어와 이용 안내 (`/start`도 같은 안내) |

그룹에서는 `/users@SallyLabSurveyAlertBot`처럼 봇 이름을 붙일 수 있다. 등록 메뉴는 지정 운영 방 범위에만 설정한다. 일반 대화, 다른 봇을 향한 명령, 다른 방과 개인 메시지에는 응답하지 않는다. 집계 응답에는 개별 회원 개인정보를 포함하지 않는다. 사용자 수는 이용 중지·팬 미가입 회원을 포함한 전체 계정 수이며, `active`는 접속 빈도가 아닌 계정 이용 상태다.

기존 매분 notification Lambda가 `getUpdates`로 확인하므로 보통 다음 확인 주기에 답한다. 한 번에 최대 3개 답장을 처리하고 실행 시간을 제한한다. 명령이 몰리면 다음 주기로 이어서 처리하며, 활성화 전이나 10분이 지난 명령에는 뒤늦게 답하지 않는다. 이벤트 알림과 명령 처리는 각각 독립 분기로 실행한다.

`20260911125938_telegram_operator_commands.sql`을 적용한 뒤 기존 notification 비밀 JSON에 `TELEGRAM_COMMAND_MODE=enabled`를 추가하고 `configure_telegram_commands(true)`로 수신을 켠다. 기본값은 비활성이다. 활성화 전 기존 webhook과 다른 수신 처리기의 사용 여부를 확인한다. 봇 업데이트 수신은 이 워커가 담당하므로 다른 polling/webhook 수신기를 동시에 연결하지 않는다. 기존 webhook·허용 업데이트 종류를 자동으로 변경하지 않는다.

명령 update ID는 응답 전 서버 전용 receipt에 기록한다. 동일 update와 발송 결과 불명 요청은 자동 재전송하지 않는다. 실패 시 사용자가 명령을 다시 입력할 수 있다. 처리한 구간까지만 cursor를 저장하며 정상 완료한 구간을 다음 요청에서 확인 처리한다. 일반 메시지 본문·사용자 정보는 저장하지 않고 receipt는 30일 후 제거한다. `/today` KST 경계와 권한·TTL·중복·cursor 검증은 `supabase/tests/telegram_operator_commands.sql`에 있다.

## CS 문의 알림

- 새 문의 접수와 사용자가 남긴 추가 메시지를 같은 운영 방으로 알린다. 운영자의 답변과 처리 완료에는 별도 알림을 보내지 않는다.
- 알림에는 이벤트 종류, 문의 메시지 본문 미리보기(최대 600 UTF-16 단위), `https://byus.kr/admin/inquiries/{문의 ID}`를 넣는다. 긴 본문에는 생략 부호를 붙이며 전체 대화는 관리자에서 확인한다. 문의 제목·별도 사용자 이름·이메일 필드는 추가하지 않는다. 사용자가 본문에 직접 작성한 정보는 미리보기에 포함될 수 있다. 링크 열람에는 기존 관리자 인증이 필요하다.
- `20260911144306_cs_telegram_alerts.sql`이 신규 사용자 메시지를 기존 outbox에 저장한다. 이전 문의는 소급 발송하지 않으며, 동일 전송의 재시도는 알림을 중복 생성하지 않는다. 기존 매분 확인·최대 5건 묶음·방 단위 60초 간격·결과 불명 자동 재전송 금지 정책을 유지한다.
- DB migration을 먼저 적용한 뒤 notification Lambda 코드만 갱신한다. `claim_telegram_alert_batch_with_cs`가 새 DTO를 반환하며 이전 claim RPC는 CS를 제외하므로 이전 워커도 기존 이벤트를 계속 처리한다. 롤백 시 이전 코드로 복구하면 CS 알림은 대기하며 기존 이벤트는 유지된다.
- `bash scripts/verify-cs-telegram-local.sh`: CS 접수/추가 메시지/재개, 중복·원자성, 개인정보 제외, 운영자 제외, 이전 워커 호환, 오류 격리와 기존 Telegram lifecycle·명령·경쟁 검증을 실행한다. 기존 backend-security CI에도 포함된다.

### CS 운영 반영 및 전송 검증 — 2026-09-11

- 구현 `b69b917`, 운영 migration `20260911144306` 적용 완료. 기존 notification Lambda를 코드만 갱신하고 `Active`/`Successful` 및 ZIP SHA-256 일치를 확인했다. 기존 설정·IAM·다른 Lambda·매분 스케줄은 유지했다.
- 워커 39파일/485테스트, typecheck, lint, Lambda bundle 검사 PASS. 로컬 전체 migration replay와 기존 Telegram/CS SQL·동시 실행 검사 PASS. 독립 검토 잔여 지적 없음.
- 회사 운영 계정으로 테스트임을 명시한 문의 `9a54c1bd-b5b1-4c2a-84bf-3e9f2972af62`를 생성하고 사용자 추가 메시지를 남겼다. 실제 CS RPC → 트리거 → outbox → 예약 Lambda → Telegram 경로를 검증했다.
- 두 이벤트는 기존 운영 방의 Telegram 메시지 `334`로 묶여 전송됐다. 두 건 모두 `sent`, `attempt_count=1`, 오류 없음. 문의 제목·본문·개인정보를 포함하지 않았다. Telegram 전송 결과를 확인한 것이며 사람의 열람 여부는 확인하지 않았다.
- 테스트 문의는 검증 후 기존 관리자 RPC로 `resolved` 처리했고 대화·감사·발송 이력은 보존했다.
- 근거: `/tmp/byus-cs-telegram-sql-2.log`, `/tmp/byus-cs-telegram-worker.log`, `/tmp/byus-cs-tg-production-migration.log`, `/tmp/byus-cs-tg-deploy.log`, `/tmp/byus-cs-tg-live-test.log`, `/tmp/byus-cs-tg-receipts.log`, `/tmp/byus-cs-tg-resolve.log`. 이전 Lambda ZIP은 `/tmp/byus-cs-tg-rollout/previous.zip`에 보존했다.

### 본문 미리보기 추가 — 2026-09-11

사용자가 Telegram에서 메시지 내용도 확인하도록 요청했다. `20260911145206_cs_telegram_message_content.sql`과 `claim_telegram_alert_batch_with_cs_content`가 발송 시 원본 메시지를 읽는다. 기존 RPC는 본문 없는 응답을 유지하므로 배포·롤백 중 DTO 충돌이 없다. outbox에 본문을 복제하지 않는다. 줄바꿈·제어문자는 공백으로 정리하며, 5건 묶음의 최대 길이가 Telegram 한도를 넘지 않도록 각 본문을 제한한다. 이전 본문 미포함 운영 검증은 당시 전송 결과의 기록이다.

본문 포함 버전 운영 검증: migration `20260911145206`과 notification Lambda 코드 반영 후 `Active`/`Successful` 및 ZIP 해시 일치를 확인했다. CS 워커 27테스트·typecheck·lint·bundle과 로컬 SQL·기존 Telegram 회귀/경쟁 검사가 통과했다. 기존 테스트 문의에 추가한 본문 표시 테스트가 예약 Lambda를 통해 Telegram 메시지 `337`로 한 번 전송됐다(`sent`, 시도 1회, 오류 없음). 검증 후 문의는 다시 처리 완료로 정리했다. 근거는 `/tmp/byus-cs-tg-content-{tests,sql-2,deploy,receipt,resolve}.log`이며 이전 코드 ZIP은 `/tmp/byus-cs-tg-content-rollout/previous.zip`에 보존했다.
