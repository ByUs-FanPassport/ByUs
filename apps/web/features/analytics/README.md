# ByUs 외부 링크 측정

일반 외부 링크의 UTM과 클릭 집계를 공통 기능으로 사용한다. 특정 브랜드만을 위한 기능이 아니다.

## 링크 작성

`app/layout.tsx`의 `OutboundLinkTracker`가 HTTP(S) 외부 앵커를 초기 렌더와 동적 삽입 때 처리한다. 정상적인 `<a href>` 또는 `FanAction external`을 사용하면 기본 적용된다. 새 창, 링크 복사에도 장식된 주소가 남는다. 서버 리다이렉트에는 `decorateOutboundUrl`을 사용한다. 기존 Banksy 리다이렉트와 LIVE 시청 이동도 이 함수를 사용하며 기존 전용 클릭 집계는 유지한다.

- 누락된 값만 추가: `utm_source=byus`, `utm_medium=referral`, `utm_campaign=<공개 맥락 또는 byus>`, `utm_content=<위치>.<종류>`.
- 기존 UTM과 쿼리·해시의 원문 바이트는 보존한다.
- 게시된 프로필의 DTO에서만 `data-outbound-campaign={slug}`를 표시한다. 현재 주소와 일치하는 marker를 사용하고, 그 외에는 고정 공개 목록 또는 `byus`로 제한한다.
- `data-outbound-placement`: `fanpage_hero`, `header`, `footer`, `content`.
- `data-outbound-kind`: `ticket`, `website`, `social`, `external`. 앵커 또는 부모 요소에 지정한다. 자유 입력 문구로 종류를 추정하지 않는다.

인증·결제 단계·서명·다운로드 URL은 변경하지 않는다. `download`, 알려진 민감 호스트·경로·쿼리 키는 자동 제외한다. 임의의 서명 URL을 모두 판별할 수는 없으므로 개인별 수령 주소나 새로운 인증/결제 링크에는 `data-outbound-tracking="off"`를 명시한다. 이 속성은 UTM과 클릭 수집 모두 끈다. 관리자·로그인·계정 연결 등 민감 화면도 제외한다. OAuth SDK·iframe·`window.location`을 전역으로 가로채지 않는다.

## 수집과 조회

일반 click(키보드 Enter 포함)과 가운데 버튼 auxclick을 `outbound_link_click`으로 전송한다. 익명 탭 세션을 기존 `/api/events` 경로로 보내고, 서버에서 해시한 뒤 이벤트 원장에 저장한다. source는 `web.outbound`, 모든 회원·콘텐츠 UUID 필드는 비운다. 속성은 `destinationHost`, `campaign`, `placement`, `linkKind` 네 개만 허용한다. 원본 URL·query·hash·링크 문구는 저장하지 않는다.

`/admin/traffic`의 외부 링크 집계에서 UTC 오늘을 포함한 최근 7·30·90일의 클릭 수와 세션 수를 확인한다. `GET /api/admin/analytics/outbound`는 기존 관리자 인증과 DB 관리자 검증 후 집계만 반환한다. 목적지·맥락·위치·종류별 상위 100개 조합을 표시하며, 전체 합계는 100개 제한과 무관하다. 브라우저 세션은 사람 수가 아니며 행별 세션 수를 더하면 중복될 수 있다. Banksy/LIVE의 기존 내부 리다이렉트 클릭은 각각 기존 전용 집계에 남는다.

전송은 keepalive를 사용하지만 네트워크·차단 확장·저장소 제한에 따라 누락될 수 있다. 전송 실패가 이동을 막지 않는다. 컨텍스트 메뉴 새 탭과 복사는 UTM만 보장하며 클릭으로 집계하지 않는다. 외부 구매 완료나 외부 사이트 내부의 UTM 보존은 제휴 측 연동 없이는 확인하지 못한다.

## 운영 순서와 검증

`20261011102000_profile_ticket_links.sql`, `20261011103000_outbound_link_analytics.sql`을 앱보다 먼저 적용한다. 앞선 브랜드 마이그레이션 두 개가 선행되어야 한다. 예매 URL은 CMS의 `ticketUrl`로 등록한다. 비어 있으면 버튼을 표시하지 않는다. 런앤뮤직 공식 개인참가 버튼의 목적지는 `https://wgrw.raceplan.co.kr/entryperson`이며 2026-10-11 실제 브라우저에서 UTM 포함 로드를 확인했다.

검증 대상은 원문 주소 보존, 민감 링크·개인 데이터 제외, 동적/SPA 링크 갱신, 키보드·가운데 클릭 중복 방지, 익명 이벤트 스키마·권한·재시도, 집계·관리자 권한과 실제 화면이다. 변경 시 관련 웹 테스트와 `supabase/tests/outbound_link_analytics.sql`을 사용한다.
