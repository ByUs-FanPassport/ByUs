# ByUs Instagram Login 연결 및 검증

작성/공식 문서 확인: 2026-09-08 KST. 이 작업은 개발 앱/Dev DB/로컬 검증 범위다. 후속 승인으로 커밋·푸시를 준비하며 전체 운영 통합/배포는 부모 작업이 담당한다. 앱 심사 제출, 외부인 메시지, 기존 Sally 앱/계정 변경은 수행하지 않는다.

## 목적과 연결 계약

운영자 → 특정 셀럽 팬페이지와 예상 Instagram 사용자명(확보했다면 professional ID도)을 지정하여 24시간 일회용 링크 발급 → 셀럽이 프로계정으로 Instagram 로그인 → 실제 계정 확인 → 명시적 연결. 팬의 ByUs 로그인과 별도다. 사용자가 프로계정(비즈니스/크리에이터)을 연결해주어야 하며 Facebook Page 연결은 이 Login 방식에서 필요하지 않다.

요청 권한은 `instagram_business_basic` 하나다. 사진/릴스/캐러셀 첫 이미지의 최근 3개를 9:16 카드로 보여주며 클릭은 원본 Instagram 새 창 이동이다. 사진/캐러셀에 영상 재생 표시를 붙이지 않는다. 원본 미디어 다운로드·재호스팅·인앱 플레이어는 구현하지 않는다.

응답 필드는 `id`, `mediaType`, `mediaProductType`, `imageUrl`(사진 또는 비디오 썸네일), `permalink`, `caption`, `timestamp`(ISO UTC), `sourceAccount.id`(professional ID), `sourceAccount.username`을 분리한다. Meta가 반환한 최근 25개 항목을 날짜순 정렬해 지원되는 카드 최대 3개를 제공한다. 원본에 3개가 없거나 썸네일이 없으면 임의 카드를 채우지 않는다.

## 구현 경로

- `POST /api/admin/instagram/invites`: 기존 Privy Google 관리자 검증 + admin/operator 역할. body: `celebrityId`, `expectedUsername`, 선택 `expectedUserId`. 응답 `connectionUrl`, `expiresIn=86400`. viewer 거부. 새 링크는 해당 셀럽의 기존 미사용 링크를 무효화한다.
- `GET/POST /connect/instagram/start`: 대상/예상 계정 표시 후 시작. GET은 링크를 소비하지 않는다.
- `GET /connect/instagram/callback`: 10분 state, 동일 브라우저 결합, 중복 필드/재사용/취소 검사, 코드 교환.
- `GET/POST /connect/instagram/confirm`: 실제 로그인 계정과 팬페이지를 별도 표시, 명시적 확인/취소. pending은 10분 후 만료한다.
- `POST /api/admin/instagram/disconnect`: body `celebrityId`. 먼저 로컬 토큰/캐시/미사용 연결 흐름을 지우고 generation을 바꾼다.
- `GET /api/celebrities/:slug/instagram`: 공개된 셀럽의 최신 캐시만. 토큰을 조회/반환하지 않는다. 실패/미연결/75분 초과 캐시/만료는 카드 없음. 클라이언트는 60초 및 탭 복귀 시 재조회한다.
- `GET /api/internal/instagram/sync`: CRON_SECRET bearer 보호. 최대 10개 lease, 기본 1시간 주기. 동시 작업/지연 응답은 generation/lease 비교로 배제한다. 7일 내 만료 예정이면서 24시간 이상 지난 장기 토큰만 갱신한다. 만료/Meta 190은 로컬 해제한다.
- `POST /api/instagram/deauthorize`, `POST /api/instagram/data-deletion`: HMAC-SHA256 signed_request 검증 후 app-scoped ID에 해당하는 데이터 삭제. 지연 삭제 webhook은 최초 OAuth 시작 시각을 기준으로 처리해 confirm/갱신 시각으로 삭제를 회피하지 못한다. 이전 삭제 이벤트 이후 새로 승인한 계정은 보호한다.
- `GET /connect/instagram/deletion-status?id=...`: 무작위 확인코드에 대한 삭제 결과. 확인코드 해시만 보관, 30일 뒤 정리.

## 서버 환경

모든 값은 서버 환경에만 둔다. `NEXT_PUBLIC_` 키로 옮기지 않는다. 비밀값을 명령 인자/채팅/스크린샷/로그에 출력하지 않는다.

| 키 | 내용 |
|---|---|
| INSTAGRAM_INTEGRATION_ENABLED | 기본 미설정/false. 설정 검증 후 해당 테스트 환경에서만 true |
| INSTAGRAM_APP_ID | **ByUs 전용 Instagram App ID**. Meta 상위 앱 ID와 다름 |
| INSTAGRAM_APP_SECRET | ByUs 전용 Instagram app secret |
| INSTAGRAM_TOKEN_ENCRYPTION_KEY | 암호학적 난수 32바이트를 canonical base64로 저장. API secret과 다른 키 |
| INSTAGRAM_GRAPH_VERSION | 명시적 버전, 공식 문서 현재 예제 v25.0. 실제 선택 앱으로 검증 필요 |
| INSTAGRAM_APP_ORIGIN | 경로/마지막 슬래시 없는 HTTPS origin. 로컬은 http://localhost:포트 허용 |
| INSTAGRAM_REMOTE_REVOCATION_VERIFIED | 기본 false. Instagram Login용 원격 permissions DELETE는 실계정 검증 전 활성화 금지 |
| CRON_SECRET | 최소 32자. 기존 서버 cron 자격정보를 사용하고 노출하지 않음 |

기존 ByUs 서버 환경(Privy, Supabase 등)은 프로젝트 방식대로 주입한다. Dev Supabase는 `xcppyedwusirqnfpbtit`이다. 운영 Supabase 키를 테스트 환경에 복사하지 않는다.

`vercel.json`에 매시 15분 수집 호출을 준비했다. 이 설정은 아직 배포하지 않았다. 실제 서비스 계획에서 해당 cron 주기/실행 제한이 가능한지 확인하고, 최초 10개를 초과하는 연결 수에서는 호출 빈도 또는 배치 처리량을 조정해야 한다. HTTP 경로가 존재하는 것과 스케줄 실행/실미디어 수집은 별개다.

수집 flag를 꺼도 설정된 secret/DB 자격정보는 삭제 처리와 만료 흐름 정리에 필요하다. 전체 연결 데이터를 지우기 전 해당 환경을 제거하지 않는다. 암호화 키를 그냥 교체하면 기존 토큰을 해독할 수 없으므로 별도 재암호화 또는 사용자 재연결이 필요하다.

## Meta 개발 앱 설정

현재 계정의 기존 앱 `Sally Social API`(Meta 1362876569039050), IGSync(Instagram 1306182501698994), mirrorworld.ai는 보존한다. ByUs 전용 앱 생성 승인만 받았다. mirrorworld.ai 테스트 사용은 승인되지 않았다.

ByUs 개발 앱에 설정할 주소(실제 테스트 HTTPS origin 확정/접근 검증 후 입력):

- OAuth redirect: `{origin}/connect/instagram/callback`
- Deauthorize: `{origin}/api/instagram/deauthorize`
- Data deletion callback: `{origin}/api/instagram/data-deletion`
- Privacy policy: 검토 및 실제 공개가 완료된 정책 URL. 현재 정책이 Instagram 처리 내용을 충분히 포함하는지 별도 확인 필요.

기존 앱의 localhost redirect를 교체하지 않는다. ByUs 앱을 개발 모드로 유지하고 기본 읽기 scope만 사용한다. 계정 테스트 역할 초대/수락 및 실제 프로계정 소유자의 동의가 필요하다. 관련 외부 소유자에게 메시지를 보내거나 자동으로 심사를 제출하지 않는다.

HTTPS 테스트 프록시는 정확히 connect/instagram 4개 경로와 Instagram signed callback 2개 경로만 전달하도록 제한한다. 관리자/API internal/DB/디버그/소스 경로는 404로 차단한다. OAuth URL에 code/state/invite가 들어가므로 프록시 요청 본문/전체 query 기록과 터널 inspector를 끈다. 임시 주소/로컬 서버는 세션 종료 후 유효성을 보장하지 않는다.

## 실제 계정 연결 전 점검

1. Meta 앱 생성/Instagram App ID/secret 설정 확인. 생성 완료 여부가 불명확하면 앱 목록부터 확인하고 중복 생성하지 않는다.
2. 실제 HTTPS 콜백과 삭제 주소의 접근 및 차단 경로 검증. 로컬 Mock 결과를 실연동으로 표시하지 않는다.
3. 운영자가 대상 셀럽/예상 Instagram 계정을 확인한다. 프로계정의 앱 테스트 역할 수락을 확인한다.
4. 운영자 API로 새 연결 링크를 발급한다. creator에게 보내는 행위는 별도 승인 범위다.
5. 셀럽 본인이 Instagram 로그인/기본읽기 동의/ByUs 계정 확인을 진행한다.
6. 실제 token→profile→media 성공, source ID/사용자명/원본링크/사진·릴스 구분을 확인한다. 토큰 자체를 증거에 남기지 않는다.
7. 신규/취소/잘못된 계정/만료/중복복귀/해제/삭제/미디어실패를 점검한다. 장기 토큰 refresh는 발급 후 24시간 전에는 실제 검증할 수 없다.

## App Review 자료 초안 (미제출)

권한 사유: 계정 소유자의 동의를 받아 해당 소유자의 Instagram 사진 및 릴스를 ByUs의 해당 팬페이지에 최신 활동 카드로 표시한다. 카드에는 계정명·원본 링크·게시 시각이 포함된다. 읽기 외 게시·댓글·메시지·인사이트 기능은 사용하지 않는다.

녹화 순서: 운영자의 대상 팬페이지/예상 계정 지정 → 셀럽 연결 링크 화면 → Instagram Login과 기본읽기 동의 → 실제 로그인 계정 확인 → 팬페이지 원본 미디어 3카드와 원본링크 → 연결 해제/삭제 결과. 실제 검증된 계정과 정상 응답으로 녹화해야 하며 Mock 영상을 심사 증거로 제출하지 않는다.

정책 검토에 포함할 처리내용: 프로계정 ID/사용자명, 서버 암호화 access token/발급·만료시각, 미디어 metadata 및 Instagram CDN 주소. 수집 목적은 소유자 팬페이지 최신 활동 표시와 연결 유지. 원본 파일은 보관하지 않는다. 해제 시 토큰/계정/미디어 캐시/연결 흐름 삭제. signed 삭제의 확인코드는 해시로 30일, 경합 차단 subject 해시는 최대 2일 유지 후 정리한다. 백업/법적 보유/운영자 연락처/수탁처 조건은 실제 ByUs 정책과 운영체계에 맞게 검토해야 한다.

## 확인된 제한

원격 Meta 권한 철회는 아직 미확인이다. 현재 코드는 로컬 해제를 보장하며 `remoteRevocation=unconfirmed`를 반환할 수 있다. Instagram 앱 및 웹사이트 설정에서 소유자가 접근 권한을 직접 해제할 수 있다는 안내를 제공한다. 일반 Graph User permissions 문서의 DELETE를 Instagram Login 호스트에 그대로 적용할 수 있다고 단정하지 않는다.

실제 App Review/고급 액세스, 미디어 필드별 사용 가능성(특히 caption/media_product_type/children), 테스트 역할, 라이브 OAuth, 갱신, 원격 revoke, provider signed webhook delivery는 실제 계정으로 별도 검증해야 한다. source response 검증 실패시 캐시를 표시하지 않는다.

## 검증 재실행

- `npm run test --workspace @byus/web -- server/instagram components/instagram-recent-activity.test.tsx`
- `npm run typecheck --workspace @byus/web`
- `node scripts/verify-instagram-local-db.mjs` (격리된 로컬 PostgreSQL ig_test 계정만 허용, 기본 127.0.0.1:56487)
- Migration: `supabase/migrations/20260908020000_instagram_creator_connections.sql`
- Dev 적용 증거: `docs/integrations/instagram-dev-migration-proof.txt`
- 수동 rollback: `supabase/rollback/20260908020000_instagram_creator_connections.sql` (연결 데이터 삭제 승인 후 실행)

## 공식 근거

- [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/) — 현재 `force_reauth`, data[0] token envelope, permissions 문자열, 60일 토큰 및 24시간 갱신 조건. 기존 flat 응답은 호환 파싱하되 permission 누락/정밀도 손실 ID를 거부한다.
- [Instagram Platform changelog](https://developers.facebook.com/docs/instagram-platform/changelog/) — 이전 force_authentication 폐기 확인.
- [Instagram Login get started](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/get-started/) — app-scoped id와 professional user_id 구분, /media 조회.
- [Instagram media reference](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/) — 사진/영상/thumbnail 필드.
- [Graph User permissions](https://developers.facebook.com/docs/graph-api/reference/user/permissions/) — 일반 DELETE 설명만 확인. IG Login 전용 실동작은 미확인.

## 구현 검증 결과 및 통합 경계 (2026-09-08)

- Instagram43개 + 기존 팬페이지/보안헤더32개 테스트 통과. TypeScript, production build, 변경 범위 ESLint 통과.
- 로컬 PostgreSQL migration/lifecycle/ACL/지연삭제 및4개 동시성 시나리오 통과. Dev migration 적용 및 기존 celebrity 데이터 불변, anon/authenticated 접근 차단 확인.
- PC1440/mobile390 실제 production 렌더에서 연결 시작·확인·취소,9:16 카드3개·영상 전용 표시·모바일 끝 카드·원본 새창을 확인. `instagram-render-proof/verification.json`과 PNG 참조. 실제 Instagram 응답은 테스트 fixture로 대체했으므로 실연동 증거가 아니다.
- 연결 문서는 script-free CSP, 외부 Instagram form만 허용. Referrer-Policy:same-origin으로 외부에는 참조 주소를 보내지 않고 내부 native POST의 Origin 검증을 유지한다.
- 통합 시 `INSTAGRAM_INTEGRATION_ENABLED`를 설정하지 않거나 false로 유지하면 최근 활동 영역이 노출되지 않는다. 실제 소유자 동의와 테스트 역할/권한 확인 뒤 별도 활성화한다.
- 본 작업은 운영DB/운영 배포를 직접 변경하지 않았다. 부모 작업이 migration, 환경변수, cron과 통합 배포를 적용한다. cron 배포 후에도 실제 수집 증거는 별도다.

## 전용 Meta 앱 현재 상태

2026-09-08 로그인 재확인 후 ByUs 앱 존재 확인. Meta App ID `1732948291088067`, Instagram 앱 이름 `ByUs-IG`, Instagram App ID `3397133600468084`. 환경변수 `INSTAGRAM_APP_ID`에는 **Instagram App ID**를 사용한다. 앱 시크릿은 해당 Instagram API 설정 화면에서 비밀 저장소로 직접 옮기고 문서/채팅에 기록하지 않는다. 후속 작업에서 기존 저장로그인 재인증을 거쳐 조회하고 접근권한0600인 로컬 환경 파일에 보관했다(아래 인계 항목 참조).

[ByUs Instagram API 설정](https://developers.facebook.com/apps/1732948291088067/use_cases/customize/?use_case_enum=INSTAGRAM_BUSINESS&product_route=instagram-business&selected_tab=API-Setup). 화면 증거 `instagram-render-proof/meta-api-setup.png`에는 ID와 마스킹된 secret, 미연결 계정과 미설정 webhook이 보인다. 대시보드에서 게시되지 않음 확인. redirect 설정 완료(아래 후속 확인 참조). Aside 보고상 basic은 Ready for testing이나 해당 권한 상태의 충분한 직접 캡처를 확보하지 못했으므로 실제 연결 전에 재확인한다. Add all required permissions 버튼은 메시지/댓글까지 포함하므로 누르지 않고 기본읽기만 개별 확인한다.

현재 실연동 차단사항은 부모 통합배포와 환경 주입, 승인된 프로계정 테스트 역할과 본인 동의다. Meta 주소등록 및 로컬 secret/암호화키 준비는 완료했다. 실제 크리에이터가 없으므로 OFF 상태로 통합한다. 라이브 앱 전환/심사 제출은 하지 않았다.

## Meta 운영 주소 저장 확인 (후속)

2026-09-08 전용 ByUs Instagram 비즈니스 로그인 설정에 아래3개 주소 저장 성공 후 **새로고침하고 설정창을 다시 열어 값이 유지됨**을 확인했다.

- OAuth redirect: `https://byus.kr/connect/instagram/callback`
- 승인 취소 callback: `https://byus.kr/api/instagram/deauthorize`
- 데이터 삭제 요청: `https://byus.kr/api/instagram/data-deletion`

일반 미디어 Webhooks 입력란과 구분된 Instagram 비즈니스 로그인 설정에 저장했다. 앱 게시/심사 제출/공유 앱 변경은 하지 않았다. 당시 운영3경로 GET은 모두404로 확인되어, 콘솔 등록은 완료지만 실제 delivery/OAuth 정상 동작은 부모 통합배포 후 검증해야 한다.

## 비밀 환경 인계

`/Users/jewel/Desktop/Developement/byus/.env.instagram-byus.local`에 실제 Instagram 전용 앱 secret, 새32바이트 토큰 암호화키와 앱ID/origin/version/flag를 저장했다. 파일 접근권한0600, Git ignore 확인, 채팅·커밋에 비밀값 없음. Aside 임시 전달 파일2개는 보관 후 제거했다. 해당 파일은 **운영 준비용**이며 수집 flag=false, 원격 revoke=false, origin=https://byus.kr, graph version=v25.0다. 부모 작업이 Vercel 비밀 환경변수로 직접 주입한다. Dev 테스트에는 별도 암호화키를 사용한다. 기존 서비스의 CRON_SECRET은 보존·확인하고 누락 시 부모가 생성/주입한다.

실제 token 교환·프로필·미디어·24시간 이후refresh·provider signed event 수신은 아직 수행하지 않았다. 비밀값 형식과 로컬 파일 권한 확인은 실제 OAuth 검증을 대체하지 않는다. 소유자 동의 전 기본 OFF로 통합한다.
