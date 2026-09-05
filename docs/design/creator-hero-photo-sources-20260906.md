# 팬페이지 배너 사진 교체 기록

확인·반영일: 2026-09-06. 적용 범위: localhost 팬페이지 상단 배너. 홈 카드·원형 프로필·CMS 이미지 값은 이번 작업에서 변경하지 않았다.

| 인물 | 제공 파일 크기 | 원본 구도 | 공식 출처 |
| --- | --- | --- | --- |
| 창하 | 2160 × 1620 | 가로 | [공식 게시물](https://www.instagram.com/chang._.a/p/Dc0qbDbmW3E/) |
| 창하 모바일 | 3567 × 5351 | 세로 | [공식 소속사](https://jkent.io/artist/changa) |
| 엘리나 PC | 2730 × 1820 | 가로 | [공식 게시물](https://www.instagram.com/elina_4_22/p/DcqxxGUmSRi/) |
| 엘리나 모바일 | 3072 × 4096 | 세로 | [공식 게시물](https://www.instagram.com/elina_4_22/p/DcqxxGUmSRi/) |
| 유나 | 2730 × 1820 | 가로 | [공식 게시물](https://www.instagram.com/yuna_1_27/p/DclRoZRDwKY/) |
| 유나 모바일 | 5304 × 7952 | 세로 | [공식 소속사](https://jkent.io/artist/yuna) |
| 엑신 PC | 4096 × 2730 | 가로 | [공식 게시물](https://artist.mnetplus.world/main/stg/xin-official/contents/6a61bfa8dce1856382909c0d) |
| 엑신 모바일 | 4032 × 6048 | 세로 | [공식 게시물](https://artist.mnetplus.world/main/stg/xin-official/contents/6a61bfa8dce1856382909c0d) |
| 아렴 | 3072 × 4096 | 세로 | [공식 게시물](https://www.instagram.com/aryeomii/p/DbnFeFtCXSa/) |
| 정제니 | 3386 × 2667 | 가로 | [공식 게시물](https://www.instagram.com/jen2jen2_/p/Db2QkGek_rv/) |
| 이퓨 | 2160 × 3240 | 세로 | [공식 게시물](https://www.tiktok.com/@ifewknow/photo/7646344009828306197) |
| 박명호 | 1440 × 1800 | 세로 | [공식 게시물](https://www.instagram.com/myunghopark/) |

플랫폼에서 실제 제공된 파일의 픽셀 크기이며, 카메라 원본이라는 뜻은 아니다. 원본 픽셀을 확대 생성하거나 얼굴·문신을 수정하지 않았다.

## 적용 방식

- 가로 촬영 사진과 세로 촬영 사진을 구분해 보존한다. 세로 사진을 가로 원본으로 기록하지 않는다.
- 창하·엘리나·유나·엑신은 PC·모바일 사진을 나누어 얼굴과 문구가 겹치지 않게 한다. 엑신은 두 화면 모두 다섯 멤버를 보존한다.
- 아렴은 PC에서 세로 원본의 전체 비율을 보존하고 우측에 배치한다.
- 이퓨는 세로 사진에서 얼굴 전체가 들어오는 범위를 가로로 표시한다. 모바일은 상반신이 충분히 보이도록 별도 확대율과 초점을 사용한다.
- 기존 KATSEYE의 별도 PC·모바일 배너는 그대로 유지한다.
- 박명호는 새 공식 게시물 후보들의 선명도·구도가 부족해 기존 1440 × 1800px 프로필 원본을 임시 사용한다. PC는 얼굴 크롭, 모바일은 상단 사진·하단 카피 배치로 문신이 있는 팔을 제외한다. 새 고해상도 가로 원본 확보는 미완료다.

## 검증

- 1440px PC, 390px·320px 모바일의 24개 실제 화면에서 이미지 로딩과 가로 넘침 없음을 확인했다. 이후 창하·엘리나·유나·아렴의 모바일 초점·전용 사진 조정을 다시 렌더링해 확인했다.
- 팬페이지 컴포넌트 테스트 20개 통과.
- 전체 타입 검사는 수정 파일 밖의 calendar-parts.test.tsx Route 타입과 기존 Playwright Page 타입 불일치로 통과하지 못했다.

원본 파일·출처·SHA-256: `docs/design/creator-hero-image-sources.json`. 검수 화면 캡처는 로컬 `artifacts/design/creator-heroes-20260906/`에 보관한다.
