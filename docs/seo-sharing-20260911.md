# 공개 페이지 검색·공유 기반 반영

2026-09-11 · `codex/seo-sharing-20260911` · 첨부 제안의 P0/P1 및 2026-09-11 후속 전체 진행 승인 범위

## 적용 기준과 구현

- [x] 홈, LIVE 목록·상세, 셀럽 목록·상세, 이퓨·엘리나 팬 가이드, 미국 팬미팅 안내에 페이지별 title/description/OG/X 카드.
- [x] canonical은 기존 내부 링크에 맞춰 `https://byus.kr/<path>?locale=ko` 또는 `?locale=en`. UTM, 탭, 검색·필터, 해시 제외. 언어마다 자기 canonical 유지.
- [x] ko/en 상호 hreflang. 동적 상세는 해당 번역이 실제 공개된 경우에만 상대 언어 지정.
- [x] 공유 이미지에는 기존 공개 사진 역할을 사용. 허용된 CMS 이미지·로컬 이미지에 기존 Next 이미지 최적화(너비 1200, 품질 75)를 적용. 자르기 없이 원본 비율 보존. 이미지가 없으면 `/share/default.png` 브랜드 이미지 사용.
- [x] `/robots.txt`: 공개 페이지 수집 허용, `/sitemap.xml` 명시. noindex 페이지도 지시문을 읽을 수 있도록 수집 허용. API·연동 경로만 제외. 학습 봇 정책은 종전의 기본 허용 상태를 바꾸지 않음.
- [x] `/sitemap.xml`: 고정 공개 안내와 공개된 셀럽·LIVE만 요청마다 조회. 부모 셀럽·브랜드 공개 상태와 언어별 번역을 확인. 리허설·테스트·개인 경로 제외. 종료된 공개 LIVE URL 유지. 데이터 조회 오류 시 불완전한 사이트맵을 성공으로 반환하지 않음. 실제 변경 시각을 확인하지 않은 `lastmod`는 생성하지 않음.
- [x] 관리자, MY, 패스포트, Stamp, 설정, 알림, 온보딩, 로그인, 팬 인증, 개인 미션·설문 화면에 noindex/nofollow 메타와 응답 헤더.
- [x] 개인 데이터의 기존 서버 인증·소유권 확인 유지. robots를 인증 수단으로 사용하지 않음.
- [x] LIVE 상세의 익명 공개 데이터를 서버에서 전달하여 초기 HTML에 제목, 출연자, 일정·KST, 플랫폼, 참여 안내 표시. 브라우저의 기존 인증·개인 상태 재조회 유지. 비공개 부모·없는 번역·없는 상세는 404.
- [x] Next.js 기본 HTML 전용 봇 목록을 유지하면서 카카오, TelegramBot, OAI-SearchBot을 추가. 해당 요청은 OG가 `<head>`에 들어간 뒤 응답.
- [x] Search Console/네이버/Bing 소유권 확인 태그 연결: 선택적 서버 환경변수 `GOOGLE_SITE_VERIFICATION`, `NAVER_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`. 기존 `public/google3277e05aaeb0cd5a.html` 보존. 등록 완료를 의미하지 않음.

## 검증 결과

- 최초 관련 Vitest 7개 파일/103개 통과 후, 후속 통합에서 21개 파일/162개 테스트 통과. 메타·사이트맵·프록시·LIVE·가이드·유입 측정 포함.
- `npm run typecheck`, `npm run lint:web`, `npm run build` 통과. 잠금 파일의 Next.js 16.3.4 사용.
- `node scripts/verify-seo-local.mjs` 통과: 로컬 production build + 공개 운영 데이터 읽기. 9개 경로×ko/en=18개 초기 HTML, 봇 6종, 사이트맵 36개 고유 URL, 개인 경로 6개 noindex, 비로그인 API 3개 401, 없는 LIVE/셀럽 2개 404.
- 브랜드 기본 이미지 1200×630 PNG, 21,266 bytes. 이퓨 가이드 공유 이미지 1200×600 PNG, 514,958 bytes. 이미지 원본 문구·인물 잘림 여부 확인.
- LIVE 화면: Aside 실화면 확인 및 별도 Playwright 브라우저에서 1440×1100 KO·390×844 EN 렌더링 확인. KO→EN 전환과 모바일 가로 넘침 없음 확인.
- 최종 실제 렌더링: 공통 가이드 KO/EN×PC/모바일 4개, 홈·LIVE 모바일 2개. 가로 넘침 0, axe serious/critical 0, pageerror 0. 분석 요청은 로컬 브라우저에서 인터셉트해 개인정보 없는 payload와 검색 유입 분류를 검증했다. 운영 이벤트 전송 검증을 뜻하지 않는다.
- 상세 증거: `artifacts/seo-20260911/verification.json`, `sitemap.xml`, 이미지·브라우저 캡처. 빌드 로그는 같은 디렉터리에 보관.
- 최초 DEV 검증의 `published_celebrities.primary_role` 누락은 기존 roles/primary_role 마이그레이션 2개를 독립 검토 후 DEV에 원자적으로 적용해 복구했다. 기존 셀럽 3개, LIVE 14개, 예약 3개, 출석 3개 보존. 6개 번역의 공개 뷰 REST 200, 로컬 DEV 셀럽 KO/EN 200, CRUD·권한·감사·게시 검증 PASS. 운영 DB에는 해당 마이그레이션을 실행하지 않았다. 증거는 `artifacts/seo-20260911/dev-schema/`.

## 배포 후 실행할 외부 단계

사용자가 후속 전체 진행 및 카카오 캐시 갱신을 승인했다. 코드 반영, 서비스 제출 접수, 실제 검색 색인 결과를 구분한다.

- [x] 구현 `fb0e7ac`와 최신 main `cb7babc` 통합 후 `be8f1f7`을 main에 push. Vercel `dpl_GpR4bFvmPPSamo4yyL59w2SgjWWs` READY, byus.kr/www 연결. GitHub Fan design system 및 Dependency audit 성공.
- [x] Google Search Console: `biz@sallylab.io`, `https://byus.kr/` 인증된 소유자 확인. 기존 HTML 방식 재사용.
- [x] Bing Webmaster: Google Search Console의 byus.kr만 가져오기, 등록·소유권 확인 완료.
- [ ] 네이버: 기존 KimBeautySong 계정과 서비스 발급 HTML verification 파일(HTTP200) 준비. 이미지 CAPTCHA 1회 자동입력 후 완료되지 않았고 사이트목록에서도 소유확인 진행 상태. 사용자의 보안문자 직접 입력이 남음.
- [x] Google: sitemap 제출 후 최초 가져올 수 없음에서 최종 성공으로 전환, 36개URL 발견. 홈·이퓨가이드·LIVE·이퓨채널 KO canonical 4개 색인 요청 접수.
- [x] Bing: sitemap 제출 및 같은4개KO URL 제출 접수(당일4개, 잔여쿼터96). 사이트맵 최종 Success·36URL 확인.
- [ ] Naver: 보안문자 직접 입력으로 소유권 인증 후 sitemap·4URL 수집 요청을 이어간다. Google·Bing과 달리 네이버 제출 완료로 표기하지 않는다.
- [x] 카카오 공식 공유 디버거: 주요4페이지 기본/KO/EN 12개 + 공통가이드KO/EN 2개, 총14 URL 캐시 삭제·재수집 완료. 입력URL/실제스크랩URL, canonical언어,제목·설명·og:image·site_name·type 일치 및 대표4카드 이미지 확인.
- [x] Meta 공식 공유 디버거: 주요4개KO URL 재수집,HTTP200·canonical·새카드 확인. fb:app_id 미설정 경고만 기록. Kakao/Meta 증거 `artifacts/seo-20260911/search/share-cache-results.json`.
- 실제 메시지 전송은 하지 않았다. X·Telegram은 봇 HTTP/메타 응답 검증이며 앱 내 발송 미리보기 확인과 구분한다.
- [x] 공개 운영 공유 HTTP: 주요5페이지 KO/EN 10개, Googlebot·Yeti·OAI-SearchBot·Facebook·Twitter·Telegram UA 6종 모두200 및 head OG 확인. 사이트맵36URL, Naver verification200. 이는 해당 요청시점 응답이며 모든 봇IP·모든 시간대 접근을 보장하지 않는다. 증거 `artifacts/seo-20260911/public-share.json`.

## 이번 범위 이후

- [x] WebSite/Organization 구조화 데이터: 기존 법적 문서의 Sallylab Inc. 운영사와 공식 소셜 근거로 구현.
- [x] `/guide?locale=ko|en` 공통 안내·6개 FAQ, 동일 내용 FAQPage 구현. 팬 인증/예약/출석/응모를 별도 단계로 안내. 상세 `docs/seo-guide-schema-20260911.md`.
- [x] 모바일 성능 기준선: 동일 Lighthouse 13.4.1, 390×844 DPR2, simulated RTT150ms/1638.4Kbps/CPU4 조건으로 홈·이퓨 가이드·LIVE 각3회. 실제 이용자 Core Web Vitals가 아닌 로컬 실험실 수치다. LIVE CLS 1.287을 확인해 SSR 본문 유지로 수정했고 최종3회 모두0. Lighthouse 로드 제한시간 경고가 있어 종합 점수를 속도 개선 성과로 단정하지 않음. 상세 `docs/seo-performance-20260911.md`.
- [x] 유입→팬 인증→예약→출석→응모 분석: 기존 완료 이벤트에 개인정보를 제한한 유입 이벤트 추가, 읽기 전용 집계 SQL DEV·운영 실행 확인. 상세 `docs/seo-conversion-20260911.md`.
- [x] 색인·AI 실적 계정 화면 확인: Google 검색 실적 및 색인 보고서는 처리 중, 별도 AI 지표 미표시. Bing AI Performance 최근3개월 인용0·평균 인용페이지0, Site Explorer 데이터 없음. 등록 직후라 제외 사유/성과를 판단할 근거는 아직 없다.
- GPTBot 정책은 검색 봇과 구분해서 결정. Search Console AI 관련 설정·노출 상태는 계정 화면에서 확인 필요.
- llms.txt, 대량 AI 문답, IndexNow, 유료 GEO 도구는 이번 구현에 포함하지 않음. 검색 노출·AI 인용의 시점이나 성과를 보장하지 않음.

## 참고한 공식 원문

- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [Next.js sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)
- [Google 언어별 페이지 지정](https://developers.google.com/search/docs/specialty/international/localized-versions)
- [Supabase 공개 데이터 조회 API](https://supabase.com/docs/reference/javascript/select)

Google sitemap 오류 확인에는 [공식 Sitemaps 보고서 안내](https://support.google.com/webmasters/answer/7451001?hl=en)의 마지막 가져오기 상태·상세 확인 절차를 참고했다. 최종 성공·36URL 확인으로 추가 재제출하지 않았다.

## 남은 작업과 재개 지점

- 네이버 Aside 탭에서 사용자가 이미지 보안문자 입력·소유권 확인을 완료하면 `https://byus.kr/sitemap.xml`과 위4개KO URL을 제출한다.
- 검색 제출 증거: `artifacts/seo-20260911/search/search-engine-registration.json`. Google·Bing 최종 성공36URL, 4URL씩 접수.
- 검색 색인·AI 인용의 후속 발생 시점은 완료 조건에 포함하지 않는다. 실제 결과는 각서비스가수집한뒤 확인할수있다.
