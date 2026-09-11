# ByUs 시작 문의 / 파트너 협업 제안

기존 이용 가이드와 미국 팬미팅 협업 문의 페이지처럼 두 문의 페이지를 추가한다. 구현 범위는 로컬 코드와 검증이며, 운영 변경·메일 실발송·푸시·배포는 수행하지 않았다.

## 구현

- `/pages/creator-onboarding?locale=ko|en`: ‘팬이 있는 누구나’를 위한 팬 페이지, LIVE, 팬 인증·참여 기록, 이벤트 시작 안내. 개인·팀·브랜드·IP 관계자의 문의를 받되 실제 운영 범위는 상담한다.
- `/pages/partners?locale=ko|en`: 커머스·공동구매, 라이브커머스, 굿즈·IP, 광고·브랜디드 콘텐츠, 팬 혜택·이벤트 제안 안내.
- 기존 팬미팅 페이지의 FocusFlowHeader, 한영 전환, CSS, 문의창, 공통 footer를 재사용한다. footer에 두 진입점, 사이트맵과 locale별 metadata 추가.
- 두 페이지는 공통 `BusinessInquiryPage`와 locale별 콘텐츠를 사용한다. 시작 문의는 소속사를 필수로 요구하지 않고 활동명 또는 팀·브랜드명을 받는다.
- 파트너 문의창은 5개 협업 분야와 미정/기타 선택을 제공한다. 선택값은 기존 message 앞에 붙이며, 본문은 3,900자로 제한해 전체 4,000자 API 계약을 유지한다. 다른 문의 유형의 payload는 변경하지 않는다.
- 문의는 `/api/inquiries/creator`, `/api/inquiries/partner`에서 유형을 서버에 고정한다. 기존 팬미팅 API·9인자 RPC·payload hash는 보존한다.
- 새 `inquiry_type`과 별도 `submit_categorized_business_inquiry` RPC를 사용한다. 기존과 IP당 시간당 3건 / 전체 24시간당 100건 제한을 공유한다.
- SES 제목·본문에서 세 문의 유형을 구분한다. 기존 고정 수신자, Reply-To, 보존 기간과 발송 후 PII 삭제, 중복 방지와 unknown 상태 처리 유지.
- 일정·가격·팔로워 조건·성과를 확정 정책으로 추가하지 않았다. 협의가 필요한 내용은 안내 본문에서도 협의로 표현한다.

## 검증

코드 시작 상태: `cd65ac4`의 별도 worktree. 이 작업의 관련 변경 기준.

### 벤치마킹 반영 후 확인

- [x] b.stage, Patreon, 마플샵, Grip, TAGby 공식 화면·공개 문의/시작 흐름을 확인하고 원본 캡처 12개를 보관. [비교 근거와 채택 이유](business-inquiries-benchmark-20260911.md)에 정리.
- [x] 새 문구·카테고리 선택·footer, 기존 fanmeeting 회귀: web 30개 테스트 통과. 모든 분야의 최대 본문 길이, 같은 내용 재시도 key 유지, 분야 변경 시 새 key 생성 포함.
- [x] Worker 문의 제목 변경 후 20개 테스트 통과.
- [x] Web typecheck와 변경 범위 ESLint 통과. `git diff --check` 통과.
- [x] 390/1440 × 한영 × 두 페이지 8조합 로컬 렌더·문의 동작 재확인. page/dialog axe 위반 0, 320px 가로 넘침 없음, 초점·ESC·복귀, 오류 후 보존·재시도, 분야 전송·성공 후 초기화 통과.
- [x] 실제 캡처에서 한영 hero·협업 카드·문의창의 줄바꿈·정렬·간격 확인. 모든 문의 POST는 mock이며 운영 메일은 발송하지 않음.

### 초기 구현 검증 중 재사용한 근거

아래는 본문 확대 전의 초기 구현 결과다. API·DB 동작은 이번 변경에서 수정하지 않아 기존 성공 근거를 재사용한다. Production build 결과도 초기 구현 시점이며, 이후 문구·폼 변경은 위 typecheck·테스트·로컬 dev 렌더로 검증했다.

- [x] Web UI / 기존 fanmeeting / footer / pages layout / SEO: 총 54개 테스트 통과. 새 페이지 한영 4조합의 실제 요청 endpoint와 입력 payload, 필수값, 성공 상태, metadata 확인. 사이트맵 테스트의 기존 17개 기대값은 신규 한영 URL 4개를 더한 21개로 수정 후 해당 테스트 22개 통과.
- [x] API / repository: 30개 테스트 통과 (백엔드 구현 담당 검증).
- [x] Worker: 20개 테스트, worker typecheck, 변경 범위 ESLint 통과 (백엔드 구현 담당 검증).
- [x] 일회용 PostgreSQL 17 fixture: 기존 행 default/hash, 권한, 유형 충돌, 공유 쿼터·동시성, claim·lease·재시도 제한, PII 삭제·retention 통과. pg_cron은 fixture stub으로 등록 인자만 확인.
- [x] 최종 UI 포함 web typecheck와 UI 변경 범위 ESLint 통과.
- [x] Aside 실제 페이지·문의창 접근, 별도 로컬 Playwright 390/1440 × 한영 × 두 페이지 8조합: 이미지 로딩, 본문/푸터, 초점 이동·trap·ESC·복귀, 오류 후 draft 보존, 동일 key 재시도, 성공 후 초기화 통과. 320px reflow에서 가로 넘침 없음. page/dialog axe 위반 0.
- [x] 스크린샷에서 두 페이지 한영 hero, 문의창, footer의 정렬·줄바꿈·간격 확인. 브라우저 문의 POST는 전부 mock으로 처리.
- [x] Web production build 통과: compile, TypeScript, 정적 생성 43/43 완료. 새 페이지 2개와 API 2개 라우트 포함 확인. 공개 Privy app ID만 주입했고 운영 DB·메일 환경은 연결하지 않았다.

화면·브라우저 결과·빌드 로그: 로컬 `artifacts/business-inquiries-20260911/` (Git 제외). 재실행 도구: `verify.mjs`, 결과: `results.json`.

## 배포 인계

새 worker → `20260911081906_categorize_business_inquiries.sql` → web 순서로 반영한다. **새 문의 페이지를 공개하기 전에 worker와 DB 양쪽 반영이 필요하다.** 기존 worker는 새 유형을 팬미팅으로 표시할 수 있다. worker와 DB 사이의 순서는 바꿔도 하위 호환되지만, web은 마지막이다.

독립 위험 검토에서 공개 API의 차단 결함은 발견하지 못했다. service_role이 직접 동일 UUID/hash를 조합해 새 유형 행을 legacy RPC로 재생하는 경우 type을 따로 비교하지 않는 기존 동작은 남아 있다. 공개 API는 서버 고정 유형과 유형별 HMAC으로 교차 replay를 차단한다.

작업 중 발견한 빈 `20260911081706_add_business_inquiry_types.sql`은 생성 주체를 확인하지 못해 보존했다. 이 작업이 작성·검증한 migration은 `20260911081906_categorize_business_inquiries.sql` 하나다.
