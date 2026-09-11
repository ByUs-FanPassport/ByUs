# 모바일 성능 측정

2026-09-11 · 로컬 production build · Lighthouse 13.4.1

390×844, DPR 2, simulated RTT 150ms / 1638.4Kbps / CPU slowdown 4. 각 페이지3회. 운영 RUM/CrUX 수치가 아니다.

| 화면 | 측정 | Performance 중앙값 | LCP 중앙값 | CLS 중앙값 | TBT 중앙값 |
|---|---|---:|---:|---:|---:|
| home | 수정 후 | 58 | 5.60초 | 0.0000 | 451ms |
| live | 수정 후 | 70 | 5.28초 | 0.0000 | 404ms |
| guide | 기준선 | 77 | 4.10초 | 0.0000 | 390ms |

## 해석과 한계

- 수정 후 홈·LIVE 각3회에는 Lighthouse의 로드 제한시간 경고가 있어 종합점수·LCP를 완전한 로딩 결과나 개선 성과로 단정하지 않는다. 모든 실행 원문과 trace를 보존했다.
- LIVE는 SSR 본문을 viewer 조회 중 스켈레톤으로 바꾸던 경로를 수정했다. 기준선 CLS는3회 모두1.2872, 수정 후3회 모두0이었다. 로컬 실제 렌더링에서도 본문을 유지한다.
- 홈의 설명이 없는 전체 보기 링크를 최애 전체 보기로 바꿔 해당 Lighthouse SEO 항목을 개선했다. 홈 SEO 점수는3회 모두100.
- 공유/검색 기반 구축과 별도로 초기 JS 전송·실행 비용과 LCP는 추가 개선 여지가 있다. 로그인 SDK를 포함한 공용 provider 재구성은 이번 범위에 포함하지 않았다.
- 가이드 기준선은 /pages/ifew-fan-guide이며 신규 /guide는 한영×PC/모바일 실렌더링·axe·메타/FAQ 검사로 검증했다.

## 증거

- artifacts/seo-20260911/performance-baseline: 홈/이퓨가이드/LIVE 각3회 JSON/trace.
- artifacts/seo-20260911/performance-verified: 최종 홈/LIVE 각3회 JSON/trace.
- artifacts/seo-20260911/render-final.json: 가이드4개+홈/LIVE 2개 로컬 렌더링.
