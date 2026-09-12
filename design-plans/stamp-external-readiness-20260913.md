# 커뮤니티 스탬프 외부 인증 준비 기준

작성일: 2026-09-13
상태: 구현 전 조사 완료, 외부 자동 인증 스탬프 비공개

## 결정

- `subscription`과 `support`는 각 플랫폼이 제공하는 공식 서버 증거를 ByUs 계정과 결합해 검증하기 전까지 공개하지 않는다.
- 스크린샷, 사용자 입력, 운영자 육안 확인 같은 수동 방식으로 자동 인증을 대체하지 않는다.
- 외부 계정 연동, 권한 신청, 메시지 발송, 실제 사용자 데이터 조회는 이 문서의 범위에 포함하지 않는다.
- 다음 구현 우선순위는 Instagram 팔로우 인증이다. 팬이 먼저 보낸 DM으로 IGSID를 얻고, 1회용 nonce로 ByUs 사용자와 결합한 뒤 공식 프로필 필드로 팔로우 상태를 확인한다.
- TikTok 후원 인증은 특정 팬이 특정 셀럽에게 보낸 LIVE Gift를 식별하는 공식 증거가 확보될 때까지 구현하지 않는다.
- YouTube 구독을 스탬프나 다른 보상 조건으로 쓰지 않는다. API로 구독 여부를 확인할 수 있는지와 별개로 보상 자체가 정책상 금지된다.

현재 제품도 이 결정을 따르고 있다. [`AVAILABLE_COMMUNITY_STAMPS`](../apps/web/features/community-stamps/domain/community-stamps.ts#L33-L34)는 `subscription`, `support`를 공개 목록에서 제외한다. 공유는 별도의 `share-link`와 `share-visit`으로 다른 회원의 확인을 증명하며, 일반 `share`·`subscription`·`support` 발급 action은 404로 닫힌다([`routes.ts`](../apps/web/server/community-stamps/routes.ts#L50-L68), [`routes.test.ts`](../apps/web/server/community-stamps/routes.test.ts#L19-L22)).

## YouTube 구독 인증

### 공식 근거

YouTube API Services Developer Policies III.F.3은 시청, 좋아요, 공유, 채널 구독, 댓글 등의 YouTube 참여에 인센티브·보상·대가를 제공하지 못하도록 규정한다.

- YouTube 정책: <https://developers.google.com/youtube/terms/developer-policies#f.-playback-integrity>
- 원문 위치: III.F. Playback Integrity, 3번 항목

실제 경품·리워드 도구도 같은 제한을 반영한다. Gleam은 `Subscribe to a YouTube Channel` action을 더 이상 제공하지 않으며 YouTube Fake Engagement Policy 준수를 이유로 명시한다. 댓글 작성과 영상 시청 action도 같은 이유로 종료했다. 채널 방문 action은 남아 있지만 구독을 유도하거나 구독 여부를 완료 조건으로 삼지 않는다.

- Gleam YouTube Actions: <https://gleam.io/docs/actions/youtube>
- 원문 위치: `Visit a YouTube Channel`, `Subscribe to a YouTube Channel` 섹션

### 권장안과 공개 조건

`subscription` 스탬프에 YouTube 채널 구독을 사용하지 않는다. OAuth, 구독 조회 API, 자체 증빙을 추가해도 정책 문제는 해소되지 않는다. YouTube는 보상 없는 채널 방문 링크로만 제공할 수 있으며, 방문·구독·시청 결과를 스탬프 발급 조건으로 결합하지 않는다.

## Instagram 팔로우 인증

### 가능한 공식 경로

Meta Instagram Messaging의 User Profile API는 Instagram-scoped ID(IGSID)를 대상으로 `is_user_follow_business` 팔로우 상태를 조회하는 경로를 제공한다. 이 경로는 전체 팔로워 목록 조회가 아니다. 대상 사용자가 먼저 Professional 계정에 메시지를 보내야 하며, Messaging 권한으로 받은 IGSID를 조회 대상으로 사용한다.

- Meta User Profile API: <https://developers.facebook.com/docs/messenger-platform/instagram/features/user-profile/>
- Meta 공식 Instagram API Postman 문서: <https://www.postman.com/meta/workspace/instagram/documentation/23987686-9386f468-7714-490f-9bfc-9442db5c8f00>

Manychat의 공식 제품 문서에서도 contact별 `Follows your Instagram account` system field와 팔로우 여부를 확인하는 자동화가 확인된다. 새 팔로워에게 먼저 DM을 보내는 Follow to DM은 2026년 현재 beta이며 Meta가 계정 eligibility를 결정한다. Unified Instagram onboarding 계정에만 열리고, 첫 메시지 뒤 사용자가 답하거나 버튼을 눌러야 후속 메시지를 보낼 수 있다. 따라서 ByUs의 필수 인증 경로를 이 beta 기능에 의존시키지 않는다.

- Manychat System Fields: <https://help.manychat.com/hc/en-us/articles/14281292522652-System-Fields>
- Manychat Follow to DM beta: <https://help.manychat.com/hc/en-us/articles/23096654243740-Follow-to-DM-on-Instagram-Say-Hi-to-New-Followers-BETA>

### 현재 ByUs와의 차이

현재 ByUs Instagram 연결은 creator Professional 계정의 기본 프로필과 미디어를 읽는 범위다.

- OAuth는 `instagram_business_basic`만 요청한다([`provider.ts`](../apps/web/server/instagram/provider.ts#L125-L130)).
- 토큰 교환 뒤에도 해당 기본 권한만 검사한다([`provider.ts`](../apps/web/server/instagram/provider.ts#L152-L156)).
- Provider 계약은 creator identity, media, token refresh/revoke만 지원하며 fan DM, webhook, fan IGSID, follower check가 없다([`model.ts`](../apps/web/server/instagram/model.ts#L39-L49)).
- 설정에는 Messaging webhook 관련 값이 없다([`config.ts`](../apps/web/server/instagram/config.ts#L4-L24)).

따라서 현재 연동을 팔로우 인증 증거로 사용할 수 없다.

### 다음 구현안

1. 로그인한 팬에게 짧은 만료 시간, 단일 사용, creator 결합 속성을 가진 nonce를 발급한다.
2. 팬이 해당 creator의 Instagram DM에서 nonce를 보내거나 지정 버튼을 누른다. ByUs가 먼저 임의 DM을 보내는 흐름은 사용하지 않는다.
3. 서명 검증을 통과한 Meta Messaging webhook에서 IGSID, creator Professional account, nonce를 결합한다. 원문 메시지는 검증 후 저장하지 않는다.
4. 서버가 User Profile API의 `is_user_follow_business`를 조회한다. `true`일 때만 `subscription` 발급용 불변 증거를 기록하고, 동일 사용자·creator·플랫폼 조합은 멱등 처리한다.
5. `false`, 권한 만료, webhook 재전송, nonce 만료, creator 불일치, IGSID 재결합 시도는 발급하지 않는다.

### 선행 조건과 실제 검증 게이트

- Meta 앱에 Instagram Messaging 제품과 `instagram_business_manage_messages`를 추가한다.
- 외부 사용자를 지원할 수 있도록 필요한 Advanced Access/App Review를 통과하고 앱을 Live 상태로 전환한다.
- `messages` webhook callback, 검증 토큰, 서명 검증, 재전송 멱등 처리를 준비한다.
- 기존 creator가 새 Messaging 권한에 다시 동의하도록 명시적인 재연결 절차를 제공한다. 기존 기본 권한 토큰을 새 권한 토큰으로 간주하지 않는다.
- 개인정보 처리방침과 삭제 경로에 IGSID, 팔로우 판정, 보관 기간과 철회 처리를 반영한다.
- Meta app-role 테스트 계정에서 DM → webhook → nonce 결합 → follower `true/false`를 검증한다.
- 실제 대상 creator 계정과 외부 팬 테스트 계정으로 App Review/Live 환경의 전체 흐름을 검증한다.
- 재동의 거부, DM 취소, 만료 nonce, 잘못된 creator, duplicate webhook, unfollow 상태에서 스탬프가 발급되지 않는지 확인한다.
- 위 게이트를 통과한 뒤에만 feature flag를 열고 `subscription`을 공개 목록에 추가한다.

## TikTok LIVE 후원 인증

### 공식 API에서 확인된 범위

TikTok Data Portability API의 `activity` 데이터에는 `Purchases` 아래 다음 항목이 있다.

- `Send Gifts History (Date, Price)`
- `Buy Gifts History (Date, Price)`

그러나 공개된 필드에는 선물을 받은 creator, LIVE room ID, gift event ID, 수신 계정 식별자가 없다. Full Archive의 TikTok LIVE host 데이터도 `Total Gifters`, `Total Earnings` 같은 집계이며 개별 gifter와 ByUs 팬을 결합할 수 있는 식별자는 문서화되어 있지 않다.

- TikTok Data Types: <https://developers.tiktok.com/docs/en/data-portability-data-types>

Data Portability API는 전 세계 사업자가 신청할 수 있지만 EEA·UK 사용자의 데이터만 반환한다. Login Kit 승인과 Data Portability scope 승인이 각각 필요하며, 사용 목적에 맞는 고해상도 UX mockup과 개인정보·보안 검토를 제출해야 한다.

- 제품 및 지역 제한: <https://developers.tiktok.com/products/data-portability-api/>
- 시작 및 권한 범위: <https://developers.tiktok.com/docs/en/data-portability-api-get-started>
- 신청 기준: <https://developers.tiktok.com/docs/en/data-portability-api-application-guidelines>

Data Portability webhook은 export가 준비됐다는 알림이다. LIVE Gift 발생을 증명하는 실시간 webhook이 아니다. TikTok Minis의 Beans 결제 API와 결제 webhook은 mini app 내부 상품 결제용이므로 TikTok LIVE 후원 증거로 사용하지 않는다.

- TikTok Minis In-App Purchases: <https://developers.tiktok.com/docs/en/tiktok-minis-in-app-purchases>

TikTok은 한국에서 LIVE 파트너 에이전시를 공식 계약 형태로 운영하고 운영 데이터 분석 교육을 제공한다고 밝히고 있다. 다만 공개 TikTok for Developers 문서에는 개별 LIVE Gift를 제3자 서비스에 전달하는 파트너 API 계약이나 스키마가 없다.

- TikTok 한국 LIVE 파트너 에이전시 안내: <https://newsroom.tiktok.com/rapa?lang=ko-KR>

### 권장안과 공개 조건

현재 Data Portability 결과만으로는 특정 팬이 특정 ByUs 셀럽에게 보낸 후원을 증명할 수 없다. `support`는 비공개로 유지하고, TikTok LIVE 파트너 또는 에이전시 채널에서 아래 필드를 제공하는 정식 계약을 확인한 뒤 구현 여부를 다시 결정한다.

- fan을 ByUs 계정과 결합할 수 있는 안정적인 TikTok scoped ID
- recipient creator ID와 LIVE room ID
- gift transaction 또는 event ID
- gift 발생 시각, 종류, 취소·환불 상태
- TikTok 서버가 서명한 webhook 또는 진위를 검증할 수 있는 공식 API 응답
- 재전송 순서, 멱등 키, 보존 기간, 삭제·철회 조건
- 한국 서비스 및 대상 creator 계정에 대한 사용 권한

문서와 샌드박스가 제공되면 서명 위조, 중복 이벤트, 순서 역전, 환불, creator 불일치, fan identity 재결합, 지연 전달을 먼저 검증한다. 실제 대상 creator와 외부 팬의 작은 금액 테스트는 계정 소유자와 운영 승인을 받은 별도 검증 단계에서만 수행한다. 이 조건이 충족되기 전에는 Data Portability export, 화면 캡처, 영수증 업로드, 운영자 승인으로 `support`를 발급하지 않는다.

## 출시 체크포인트

외부 스탬프별로 다음 조건을 모두 충족해야 공개할 수 있다.

1. 공식 API 또는 서명된 webhook이 사용자, creator, 행위, 시각을 함께 증명한다.
2. 플랫폼 권한과 App Review가 실제 서비스 계정에 승인됐다.
3. ByUs 로그인 사용자와 플랫폼 scoped ID가 nonce 또는 동등한 방식으로 명시적으로 결합됐다.
4. 서버가 원문 PII 없이 최소 증거만 저장하고 중복·취소·철회를 처리한다.
5. 성공과 주요 실패 경로를 App Review/Live 환경에서 실제 계정으로 검증했다.
6. 위 조건을 만족한 스탬프만 서버 action과 `AVAILABLE_COMMUNITY_STAMPS`에 추가한다.
