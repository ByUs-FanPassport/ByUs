# Kakao 알림톡 운영 연동

## 승인 범위와 근거

- 사용자: 전화번호·동의 등록, SOLAPI 운영 연결, 중복 방지·최종 결과 처리 승인. 기존 Email 대기 건은 제외.
- 시작 코드: `026642a` / `codex/kakao-alimtalk-production-20260911`.
- 2026-09-11 SOLAPI 실조회: 11개 APPROVED, `byus_fulfillment_digital_delivered_ko_v1` 1개 REJECTED. 기존 `/4fba` 준비 코드를 재사용한다.
- Developers ByUs 앱 1568460의 `phone_number` 권한은 미승인. 외부 선행 절차를 확인하고, 실제 사용 가능 전에는 등록 기능을 활성화하지 않는다.
- 독립 위험 검토: `/root/kakao_plan_review` 조건부 승인. 아래 발송 격리·단회 begin·동일 owner 잠금 조건을 반영한다.

## 확정 설계

1. 카카오가 확인한 계정 전화번호를 fresh owner-bound PKCE OAuth로 읽고, 본인이 마스킹된 번호와 알림 동의를 별도로 확인한다. 검증 방법은 `kakao_profile_owner_confirmation`이며 ByUs SMS 인증이나 현재 기기 점유 인증으로 표시하지 않는다. 별도 SMS OTP는 추가하지 않는다. 원본 번호는 서버 전용 저장소에만 보관한다.
2. 일반 카카오 계정 연결과 알림 등록을 분리한다. 등록 OAuth에는 고정 동의 버전 `kakao-alimtalk-v1`, purpose `alimtalk`, 10분 만료, 단회 state를 사용한다. callback은 동일 subject와 phone_number 동의 여부를 확인해 private pending claim을 만들고, 마지막 owner 확인이 원자적으로 claim을 소모하면서 채널·동의 이력을 저장한다.
3. 철회·연결 해제·subject 변경은 private phone과 pending claim을 지우고 새 확인 없이는 다시 eligible이 될 수 없게 한다. `verification_method`와 enrollment generation이 없는 과거 Kakao 채널은 실제 발송하지 않는다.
4. `KAKAO_ALIMTALK_MODE=disabled|solapi`를 기존 팬 Email 설정과 분리한다. generic claim은 **모든 Kakao**를 제외하고 legacy complete/fail/manual retry도 Kakao 변경을 차단한다. 배포 전 구 worker가 잡은 Kakao 작업이 없는지 확인한다.
5. 전송 ledger는 delivery ID당 하나다. `prepared → sending` CAS에서 성공한 호출만 HTTP 권한을 얻는다. begin 응답 유실, 같은 token 재호출, ACK 저장 실패, timeout은 재전송하지 않는다. expired sending은 unknown으로 남긴다. 준비 lease만 재획득 가능하다.
6. begin·철회·재등록은 owner → account/channel → delivery/attempt 순서의 잠금을 공유한다. 철회가 먼저 커밋되면 begin은 거부한다. begin이 먼저 커밋되면 이미 시작한 발송으로 간주한다. HTTP와 DB 사이의 완전한 원자성은 주장하지 않는다.
7. 발송 시 destination fingerprint, subject/consent/enrollment generation, PFID/template, deliveryKey, payload fingerprint를 보존한다. 번호 삭제 후에도 결과 대조가 가능하다. provider 접수 ID와 group ID를 저장하고 `accepted`를 `delivered`로 취급하지 않는다.
8. GET `/messages/v4/list?messageIds=<JSON array>`로 canonical 결과를 조회한다. ID, ATA, deliveryKey, 번호 fingerprint, PFID/template와 SMS 대체 미사용을 대조한다. COMPLETE+4000만 delivered; COMPLETE+명확한 오류 코드만 failed. 응답 누락·모순은 unknown이다. 확인되지 않은 결과에 retry/fallback을 적용하지 않는다.
9. 검증한 `X-Solapi-Secret` 웹훅은 receipt ID를 기록해 canonical GET 재조회를 유도한다. raw webhook을 바로 최종 성공으로 채택하지 않는다. duplicate/out-of-order는 종결 상태를 되돌리지 않는다. 수신 결과에 원본 번호/본문을 로그로 남기지 않는다.
10. 초기 범위는 한국어·한국 010 번호·승인 11종이다. 지원하지 않는 종류/언어는 provider 호출 전에 억제한다. 기존 Email 13건은 변경·발송하지 않는다.

## 구현 분담과 DB 계약

주 에이전트는 migration, SQL/동시성 검증, 배포를 담당한다. Worker 구현자는 `apps/worker`만, Web 구현자는 `apps/web`만 변경한다. 다른 사람의 변경을 되돌리지 않는다.

### 등록 RPC (service_role만 실행)

- `create_owned_kakao_alimtalk_state(p_app_user_id uuid,p_state_hash text,p_code_verifier text,p_return_path text)` → boolean. 고정 동의 버전과 현재 시각을 서버에서 저장한다.
- 기존 `consume_owned_kakao_connection_state` 결과에 `purpose: connection|alimtalk`, `consentVersion: string|null`을 추가한다. 기존 codeVerifier/returnPath 유지.
- `stage_owned_kakao_phone_enrollment(p_app_user_id uuid,p_state_hash text,p_subject_hash text,p_phone text)` → `{id, destinationLabel, expiresAt}`. 소비된 alimtalk state, 동일 활성 owner와 연결 subject를 확인하고 stage 단회 보장.
- `get_owned_kakao_phone_enrollment(p_app_user_id uuid)` → `{id,destinationLabel,expiresAt}|null` (만료/불일치 제외).
- `confirm_owned_kakao_phone_enrollment(p_app_user_id uuid,p_enrollment_id uuid,p_consent_version text)` → 기존 NotificationChannel JSON. 마지막 명시 확인은 API가 `consented:true`를 검증한 뒤 호출한다.
- `cancel_owned_kakao_phone_enrollment(p_app_user_id uuid)` → boolean. private pending claim만 삭제.
- `set_owned_notification_channel_consent`의 기존 Email 계약 유지. Kakao 철회는 번호/검증을 삭제하고 disabled 상태 반환. 재동의는 새 OAuth 등록 필요.

### 발송 RPC (service_role만 실행)

- `maintain_kakao_notification_deliveries()` → void. expired sending→unknown, private pending 만료 정리. Email 수정 금지.
- `claim_kakao_notification_deliveries(p_worker_id text,p_batch_size integer,p_lease_seconds integer)` → rows `{id,attempt_token,notification_id,template_key,locale,destination,payload,template_id,lease_expires_at}`. ledger에 불변 snapshot 저장. 준비 lease만 재획득.
- `begin_kakao_notification_send(p_delivery_id uuid,p_attempt_token uuid,p_template_id text,p_request_hash text)` → boolean. 단회 CAS, snapshot·현재 자격·동의 재검증. true를 받은 호출만 submit.
- `record_kakao_notification_submission(p_delivery_id uuid,p_attempt_token uuid,p_outcome text,p_provider_message_id text,p_group_id text,p_error_code text)` → boolean. outcome accepted/rejected/unknown/suppressed. suppressed는 provider 호출 전 validation 실패용. accepted/unknown은 outbox 처리 중, rejected/suppressed는 실패·무한 대기, delivered만 sent.
- `claim_kakao_notification_reconciliations(p_batch_size integer)` → rows `{id,provider_message_id,group_id,destination_fingerprint,template_id,status}`. 60초 조회 간격 예약, 최대 2개.
- `record_kakao_notification_result(p_delivery_id uuid,p_provider_message_id text,p_outcome text,p_status_code text)` → boolean. outcome pending/delivered/failed/unknown. 종결 상태 단조성 보장.
- `record_kakao_notification_receipt(p_delivery_id uuid,p_provider_message_id text,p_group_id text)` → boolean. 인증된 webhook에서만 호출. 기존 ledger의 sending/unknown/accepted 대상만 기록, ID 충돌 거부. canonical 조회가 최종 판정.
- `get_admin_notification_deliveries` 기존 shape 유지 + 각 item에 nullable `providerStatus`/`providerMessageId`/`providerStatusCode`. Kakao manuallyRetryable=false. admin_retry Kakao 차단.

### 설정

- Worker: `KAKAO_ALIMTALK_MODE`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`. 키는 AWS Secrets Manager의 기존 notification secret에 저장한다. 기존 `NOTIFICATION_EXTERNAL_MODE`는 그대로 둔다.
- Web: `KAKAO_ALIMTALK_ENROLLMENT_ENABLED` 기본 false, `SOLAPI_WEBHOOK_SECRET` (별도 랜덤 secret). provider 키는 웹에 둘 필요가 없다.
- Webhook: `/api/notifications/solapi/webhook`. 공개 라우트지만 secret 검증 후 제한된 receipt RPC만 호출한다.

## 검증 및 진행

- [x] 현재 DB/설정/승인 템플릿/선행 코드 확인
- [x] 독립 계획 검토 및 발송 경계 반영
- [x] 등록·발송 DB 계약 구현
- [x] Worker/client/reconciliation 구현
- [x] 설정 UI/OAuth/확인·철회/webhook/admin 상태 구현
- [x] SQL replay·권한·동시 begin·generic/dedicated 격리·철회 양방향 순서·Email 불변 검증
- [x] HTTP/DB 유실, 잘못된 결과, 중복·역순 webhook, 동의/계정 전환 테스트
- [x] typecheck/build 및 실제 로컬 화면/동작 확인
- [x] 독립 결과 검토
- [ ] 외부 권한·키·webhook 구성, DB/Worker/Web 배포와 정확한 상태 확인

공식 계약 근거: https://solapi.com/developers/api/msg-getList , https://solapi.com/developers/api/msgstatus , https://solapi.com/developers/api/webhook , https://developers.kakao.com/docs/ko/kakaologin/rest-api , https://devtalk.kakao.com/t/rest-api/143169 .

## 2026-09-11 검증 및 운영 준비

- 실제 clean PostgreSQL 검증: `npm run security:backend-db` 통과. 기존 ACL·mint budget 테스트와 신규 Kakao SQL/동시성 검증을 한 replay에서 실행한다. `kakao_alimtalk.sql`은 비어 있지 않은 Email 보존 fixture, owner/state 바인딩, 단회 확인·begin, 접수/배달 분리, 불확실 송신, 후기 ACK/webhook, 번호 삭제 후 해시 대조, 재등록 generation, 관리자 상태·수동 재시도 차단을 확인한다. 동시성 스크립트는 실제 owner-lock 대기를 관찰한다.
- Worker 집중 104건 최초 통과 후 공식 오류 코드·런타임 한도 보완 대상 45건 재통과, 타입 검사 통과. Web 집중 143건, 법적 문서 7건, 후속 카피/기존 DB 응답 호환 39건 통과. 별도 디렉터리의 production build와 격리 응답을 사용한 Chromium 8건·교정 화면 6건 통과.
- 독립 위험 검토의 3개 P2(미정의 공급자 오류 코드, DB 테스트 실행 보호, Kakao lease/worker ID 경계)를 수정했다. 관리자 DTO 무한 날짜도 기존 ISO 문자열 계약과 맞췄다. 공개 API/DB의 실제 송신이나 팬 전화번호를 사용한 검증은 하지 않았다.
- 실제 운영 OAuth 시작 응답으로 Developers 앱1568460과 키 일치를 확인했다. 비즈 앱 전환과 비즈니스 정보 심사 신청 완료, 현재 심사 중. `phone_number` 권한 신청은 선행 심사 완료 후 진행해야 한다.
- SOLAPI API 키 발급 및 읽기 전용 인증200 확인, 기존 AWS notification secret에 저장. Kakao 발송 모드는 아직 disabled이며 기존 Email disabled를 보존했다. Vercel Production에 webhook secret과 enrollment false를 설정했다.
- 배포 순서: 기존 DB 응답을 지원하는 Web 먼저 → DB migration → Worker. DB가 먼저 provider 필드를 반환하면 구 Web의 strict DTO가 거부할 수 있으므로 이 순서를 지킨다. 등록 기능은 phone_number 승인 전까지 false로 둔다.
- 운영 migration 사전조회에서 기존 Email은 새 예약으로 19건까지 증가했다. 과거 13건을 포함한 전체 Email 행을 migration 트랜잭션 안에서 전후 비교해 변경하지 않는다.
- 운영 webhook 등록, Web/DB/Worker 배포 및 상태 확인이 남아 있다. 발송·등록 활성화와 실제 수신 증명은 외부 권한 완료 여부와 구분한다.
