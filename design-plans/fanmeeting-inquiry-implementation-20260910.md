# 미국 팬미팅 문의창 및 이메일 전달

사용자 요청: 문의하기를 누르면 사이트 문의창을 열고 제출 내용을 To biz@sallylab.io, Cc jongho@sallylab.io 및 jaeyeong@sallylab.io로 전달한다. 이메일 앱으로 넘기는 mailto를 사이트 접수로 바꾼다.

## 범위와 동작

- 기존 US fanmeeting 페이지의 세 문의 진입점을 동일한 문의창으로 연결한다.
- 담당자명(80), 회사명(120), 회신 이메일(254), 문의 내용(4000자), 문의 응대용 개인정보 이용 동의. 한영 지원. 불필요한 전화번호·첨부는 수집하지 않는다.
- 기존 AccessibleOverlay로 focus/ESC/배경 차단을 재사용한다. 요청 중 중복 제출을 막고, 오류·닫기 후 입력을 보존한다. 성공 후 새 문의부터 비운다.
- 성공 문구는 '문의가 접수됐어요'로 쓴다. 이메일 발송 대기는 성공 접수와 구분한다.
- 대상 이메일은 서버/worker 상수로 고정하며 요청 본문으로 수신자를 받지 않는다. From은 기존 SES 검증 발신자 notifications@byus.kr, Reply-To는 문의자 이메일. 평문 메시지를 사용한다.

## 서버·저장·발송 계획

- API /api/inquiries/fanmeeting: 동종 Origin 검사, JSON 크기16KB 제한(실제 byte 읽기), 엄격한 validation, 고정 recipient, PII 없는 오류 응답.
- Supabase service-role 전용 독립 business_inquiries outbox/RPC. 일반 anon/authenticated는 테이블/RPC 접근 불가. 기존 팬 알림·동의·사용자 FK와 분리.
- 클라이언트 UUID idempotency key + canonical payload hash로 동일 제출 replay를 처리한다. 다른 payload에 같은 key면409. 재시도는 같은 key, 입력 변경 후에는 새 key.
- 서버에서 IP를 HMAC(서비스키 기반, purpose 분리)하여 저장한다. 같은IP 3건/시간, 전체100건/일을 트랜잭션으로 제한한다. 원IP는 저장하지 않는다.
- 문의 데이터는 기존 AWS SES worker의 별도 큐에서 최대1건/run으로 전송한다. 기존 알림과 별도 lease/ack를 사용한다. 운영 모드에서만 실제SES 발송, 테스트 모드는 mock/sink.
- SES는 단일 시도(maxAttempts1). 명백한 전송 전 실패/스로틀만 제한 재시도하며, 전송 후 ack 실패나 불명확한 timeout은 자동 재발송하지 않고 delivery_unknown 상태로 남긴다. 성공 즉시 문의 PII를 비우며, pending/failed/unknown 내용도7일 후 제거한다. 최소 id/hash/status metadata는 replay/rate-limit 기간에만 보존한다.
- 기존 Lambda의 notification runtime/SES IAM 및 scheduler를 재사용할 수 있는지 read-only mapping으로 확인 후 최종 연결한다. 관련 작업자의 코드와 환경 설정을 덮어쓰지 않는다.

## 검증·완료

- DB: 권한/유효성/재시도 키 충돌/동시 중복/동시rate limit/lease 소유권/PII삭제/전송unknown 처리.
- API: validation/크기/Origin/반복/retry/오류 masking.
- Worker: To/Cc/Reply-To의 정확성, 실제SES 호출 mock, 상태별ack/unknown 처리와 기존 알림 회귀.
- UI: 필수값/한영/발송중/error 유지/retrykey/성공/ESC/focus복귀; 390/1440 실렌더와axe.
- 실제 사업 수신자에게 검증용 메일을 보내지 않는다. 이메일 최종 도착을 직접 검증하지 않은 경우 구분해서 보고한다.
- 독립 위험 검토 후 DB/worker 실행. 운영 변경은 승인 범위와 현재 인프라를 확인하여 진행한다.

## 진행

- [x] 요청 및 기존 문의 진입점 확인
- [x] 발송 경로 조사 및 독립 위험 검토
- [x] UI/API/DB/worker 구현
- [x] 로컬 검증
- [x] 배포 여부/최종 상태 기록 — 사용자 운영 배포 승인 후 DB 및 worker 반영 확인, web 릴리스 진행

## 독립 검토 반영

- 발송 전에 `sending`과 무작위 attempt token을 DB에 확정한다. 그 응답이 유실되면 SES를 호출하지 않는다. 만료된 `sending`은 `delivery_unknown`으로만 전환하고 자동 재전송하지 않는다. ack는 token을 검증한다.
- Vercel 런타임에서만 플랫폼이 덮어쓰는 `x-vercel-forwarded-for` 단일 IP를 신뢰한다. IPv4/IPv6를 정규화하고 누락·잘못된 값은 접수 거부한다. 로컬에서는 고정 loopback 키로만 제한한다. 허용 Origin은 byus.kr/www.byus.kr 및 로컬 개발 주소에 고정한다. replay 확인은 신규 할당량 검사보다 먼저 처리한다. 근거: https://vercel.com/docs/headers/request-headers
- 문의 발송은 전용 BUSINESS_INQUIRY_MODE(disabled/ses_email)로 제어한다. 기존 알림과 Promise.allSettled로 격리해 한쪽 실패가 다른 쪽 시작을 막지 않도록 한다. 문의 큐 최대 1건, DB RPC timeout 5초 및 SES timeout 8초로 제한한다.
- 개인정보 삭제는 독립 pg_cron(매시간)으로 실행한다. 전송 비활성 또는 Lambda 오류와 무관하게 7일 만료 데이터를 삭제한다. worker도 claim 전에 maintenance를 수행한다. PII 없는 상태별 개수·오래된 pending/failed/unknown 조회 RPC를 제공한다.


## 최종 검증과 배포 인계

- Web Vitest 34개: UI 8개 + API/repository 26개 통과.
- Worker Vitest 35개: inquiry/환경/runtime/Lambda 통과. typecheck 및 Lambda bundle 통과.
- Web production build/타입 검사, 변경 범위 ESLint, diff check 통과.
- 실제 로컬 PostgreSQL에서 권한, validation, 동일 key 동시 접수, IP/global 동시 제한, claim 경합, attempt 소유권, 강제 중단 후 unknown 회수, throttle 3회 한도, 성공 시 PII 제거, 만료 삭제 통과.
- pg_cron은 Homebrew fixture에 없어 등록 인자만 stub으로 검증했다. 실제 예약 실행은 미검증이다. 매시 17분 정리하므로 삭제 시점은 정상 실행 기준 접수 7일 뒤부터 최대 약 1시간 이내다.
- 한국어·영어 390/1440, 문의/오류/성공 12장 실제 렌더 확인. axe 위반 0(문의/성공), focus trap/ESC/초점 복귀, 닫기·오류 후 draft, 같은 idempotency key 재시도, 성공 후 초기화 통과. 모든 브라우저 POST는 로컬 mock으로 가로챘고 실제 문의/이메일은 전송하지 않았다.
- Aside에서도 실제 페이지와 문의창 DOM 항목을 확인했다. 자동화 상세 검증은 별도 로컬 Playwright로 수행했다.
- 독립 risk review: 구현 통과, 배포 차단 결함 없음. 운영 도착을 확인했다는 의미는 아니다.

배포 시 순서:
1. `20260910130000_business_inquiries.sql` 적용 및 cron job 등록 확인.
2. 현재 운영 worker secret/SES IAM 및 sandbox 상태를 읽기 확인한다. 기존 secret/설정 보존 후 `BUSINESS_INQUIRY_MODE=ses_email`, `NOTIFICATION_EXTERNAL_ENVIRONMENT=prod`를 설정한다. 기존 From은 notifications@byus.kr다.
3. worker Lambda 코드 배포 최종 성공을 확인한다. 기본값 disabled 상태로 두면 접수 메일을 발송하지 않는다.
4. web 배포 최종 성공을 확인한다. 사용자 운영 배포 승인 후 아래 실행 기록에 따라 반영한다.
5. PII 없는 `business_inquiry_health()`로 pending/old_pending/failed/delivery_unknown을 확인할 수 있다. unknown은 자동 재전송하지 않는다.

증거: `artifacts/inquiry/qa.json`, KO/EN form/error/success PNG, `scripts/verify-business-inquiries-local-db.mjs`.


## 2026-09-10 운영 배포 실행 기록

- 사용자 `운영 배포` 승인으로 진행.
- 문의 구현 커밋 `27006f3` 후 최신 main `565cc27`의 localization 변경을 병합했다. 병합 후 worker 43개 테스트, Lambda bundle, web production build와 타입 검사 통과.
- Supabase Production `gmrykvmtmuaeswpajteq`: dry-run에서 `20260910130000` 하나만 확인 후 적용 성공. migration history 및 `business-inquiry-retention` cron 활성 등록 확인.
- AWS `coredot-dev` / account `200151116034` / ap-northeast-2 / `byus-notification-worker-prod`: code-only 업데이트 성공, Active/Successful 및 ZIP SHA256 일치. Lambda 환경·역할·runtime·handler·timeout·메모리·아키텍처 보존.
- 기존 secret의 팬 알림 모드는 변경하지 않았다(미설정 기본 disabled). 문의 모드 `BUSINESS_INQUIRY_MODE=ses_email`과 운영 환경 `NOTIFICATION_EXTERNAL_ENVIRONMENT=prod`만 추가했다. 기존 값 보존 확인.
- SES ProductionAccessEnabled/SendingEnabled=true, byus.kr 발신 identity SUCCESS, SES From IAM 허용 확인. 기존 매분 EventBridge 예약 ENABLED 유지.
- 실제 수신자 대상 시험 문의나 이메일 전송은 수행하지 않았다. 웹 배포의 exact SHA 및 READY 최종 상태는 `artifacts/inquiry/deployment/web-confirmed.json`에 기록한다.
