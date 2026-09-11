# ByUs 공통 가이드와 구조화 데이터

확인 기준: 2026-09-11 KST, 현재 브랜치의 제품 코드와 법적 문서.

## 확인한 사실

- `apps/web/components/legal-content.ts`는 ByUs 제공 회사를 `Sallylab Inc.`로, 서비스 및 개인정보 문의 창구를 `biz@sallylab.io`로 명시한다.
- `apps/web/components/fan-shell/fan-site-footer.tsx`는 ByUs 공식 채널로 Instagram `official_byus`, X `official_byus`, Threads `official_byus`, Telegram `ByUs_official`을 게시한다.
- 이용약관은 팬 인증과 디지털 기록, LIVE 일정·예약·출석 방식, 혜택 조건을 각각 안내한다. 실제 도메인과 화면도 예약, 출석, 혜택 응모를 별도 상태와 동작으로 처리한다.
- 공통 약관에는 모든 이벤트의 해외 참여 또는 배송 가능 국가를 보장하는 조건이 없다. 가이드에서는 이벤트와 혜택 화면의 대상 지역·배송·수령 조건을 확인하도록 안내한다.
- Fan Passport와 Stamp는 ByUs 안의 디지털 팬 활동 기록이며, 별도 명시가 없는 한 현금·증권·투자 상품 또는 회사에 대한 권리를 뜻하지 않는다.

## 구현

- `/guide?locale=ko|en`에 공통 서비스 가이드와 FAQ를 추가했다.
- 팬 인증 → LIVE 예약 → LIVE 출석 → 선물 응모의 순서를 설명하되 네 단계를 독립적으로 완료하고 상태를 확인하도록 명시했다.
- 가이드에 보이는 질문과 답변만 `FAQPage` JSON-LD로 제공한다.
- 홈에는 루트 URL `https://byus.kr/`을 사용하는 단일 `WebSite` 노드와, 법적 문서에서 확인한 운영사 `Sallylab Inc.`의 `Organization` 노드를 제공한다. 두 노드는 안정적인 `@id`로 연결했다.
- JSON-LD 직렬화 시 `<`와 JavaScript 줄 구분 문자를 이스케이프해 script 종료 문자열 삽입을 막는다.
- 공통 푸터와 sitemap에 한국어·영어 가이드 링크를 추가했다.

## 검증 범위

- 구조화 데이터 노드, 운영사·문의처·공식 소셜 값, 노드 연결, 안전한 직렬화 테스트.
- 가이드의 한국어·영어 핵심 참여 경계, 문의 링크, FAQ JSON-LD, canonical metadata 테스트.
- 공통 푸터와 sitemap의 양 언어 가이드 URL 테스트.

## LIVE 상세 CLS 후속 수정

- 변경 전 Lighthouse `artifacts/seo-20260911/performance-baseline/live-1.json`은 모바일 LIVE 상세의 CLS를 `1.287`로 기록했다. 같은 `main#live-detail-main`이 두 번 각각 `0.6436` 이동했다.
- 서버가 전달한 `initialData`로 본문을 렌더한 직후 클라이언트 효과가 일반 `load()`를 호출해 전체 본문을 loading skeleton으로 바꾸고, API 응답 후 다시 본문으로 바꾸는 흐름이 원인이었다.
- `initialData`가 있으면 본문을 유지한 채 viewer 상태를 백그라운드 갱신한다. 최초 페이지뷰 기록은 기존처럼 유지하고 LIVE 시작 상태 갱신은 추가 페이지뷰를 만들지 않는다.
- 같은 Lighthouse 진단이 푸터 워드마크를 명시적 크기가 없는 미디어로 지목했다. SVG 원본 비율과 실제 관찰 높이에 맞춰 `96 × 39px` 공간을 HTML 속성과 CSS 양쪽에 예약했다.
- 기준 Lighthouse의 `link-text` 감사는 점수 `1`로 통과해 LIVE 링크 문구는 변경하지 않았다.
- 기존 기준 파일은 변경 전 빌드를 측정한 결과다. 수정 후 CLS 수치는 새 빌드의 동일 조건 Lighthouse 재측정 전까지 미확인이다.
